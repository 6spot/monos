import { describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON } from '../../../packages/protocol/src/index.ts';
import { createApp } from '../src/app.ts';
import { taskResults, selectedTaskResult } from '../src/task-result-reads.ts';
import { canonicalReviewManifest } from '../src/task-review-basis.ts';
import { PublicationCandidateReads } from '../src/publication-candidate-reads.ts';
import { multiRepositoryWorkspacesFixture } from './fixtures/multi-repository-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-repository result selection', { timeout: 30000 }, () => {
  it('keeps one Node manifest, exact per-resource identities and complete review/candidate coverage', async () => {
    const x = await multiRepositoryWorkspacesFixture();
    try {
      await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
      const { operation } = await x.admitCompletion(turn); await x.settleCompletion(turn, operation);
      const page = await taskResults(x.db, x.token, x.f.task);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.git_results.map(result => result.resource_id)).toEqual(x.resources);
      const selected = await Promise.all(x.resources.map(resource => selectedTaskResult(x.db, x.token, x.f.task, operation.operation_id, resource)));
      expect(new Set(selected.map(result => result.identity.operation_identity_digest)).size).toBe(1);
      expect(new Set(selected.map(result => result.git.identity_digest)).size).toBe(2);
      expect(selected.map(result => result.identity.capture.node_commit)).toEqual(['c'.repeat(40), 'd'.repeat(40)]);
      await expect(selectedTaskResult(x.db, x.token, x.f.task, operation.operation_id, 'other-resource')).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
      const review = await transaction(x.db, tx => canonicalReviewManifest(tx, x.f.task));
      expect(review.outputs).toHaveLength(1);
      expect(review.outputs[0]!.sources.map(result => result.source)).toEqual(selected.map(result => result.identity));
      expect((await x.db.pool.query('SELECT resource_id,source_operation_id FROM delivery_operations ORDER BY resource_id')).rows)
        .toEqual(x.resources.map(resource_id => ({ resource_id, source_operation_id: operation.operation_id })));
      const candidates = new PublicationCandidateReads(x.db);
      const selectedCandidates = await candidates.list(x.token, x.f.task, { source_operation_id: operation.operation_id, resource_id: x.resources[0] });
      expect(selectedCandidates.items).toHaveLength(1);
      expect(selectedCandidates.items[0]!.source.resource_id).toBe(x.resources[0]);
      const cursor = Buffer.from(canonicalJSON({ version: 1, binding: { kind: 'publication_operations', task_id: x.f.task,
        source_operation_id: operation.operation_id, resource_id: x.resources[0] }, after: selectedCandidates.items[0]!.operation_id })).toString('base64url');
      await expect(candidates.list(x.token, x.f.task, { source_operation_id: operation.operation_id, resource_id: x.resources[1], cursor }))
        .rejects.toMatchObject({ detail: { code: 'denied_scope' } });
      const app = createApp(x.service);
      try {
        const base = `/v1/owner/tasks/${x.f.task}/results/${operation.operation_id}/changes`;
        const headers = { authorization: `Bearer ${x.token}` };
        expect((await app.inject({ url: `${base}?identity_digest=${selected[0]!.git.identity_digest}`, headers })).statusCode).toBe(409);
        expect((await app.inject({ url: `${base}?resource_id=${x.resources[1]}&identity_digest=${selected[0]!.git.identity_digest}`, headers })).statusCode).toBe(409);
        expect((await app.inject({ url: `${base}?resource_id=${x.resources[1]}&identity_digest=${selected[1]!.git.identity_digest}`, headers })).json().request.identity.resource_id).toBe(x.resources[1]);
      } finally { await app.close(); }
    } finally { await x.close(); }
  });

  it('selects the newest canonical result independently for every repository', async () => {
    const x = await multiRepositoryWorkspacesFixture();
    try {
      const root = x.definition(x.f.node), next = x.definition(undefined, [root.node_id]);
      await x.start([root, next]); const first = await x.node(); await x.openAll(first);
      const initial = (await x.admitCompletion(first)).operation; await x.settleCompletion(first, initial);
      const second = await x.node(); await x.open(second, x.resources[1]);
      const latest = (await x.admitCompletion(second)).operation; await x.settleCompletion(second, latest);
      const rows = (await x.db.pool.query('SELECT resource_id,source_operation_id FROM delivery_operations ORDER BY resource_id')).rows;
      expect(rows).toEqual([{ resource_id: x.resources[0], source_operation_id: initial.operation_id },
        { resource_id: x.resources[1], source_operation_id: latest.operation_id }]);
    } finally { await x.close(); }
  });
});
