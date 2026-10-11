import { describe, expect, it } from 'vitest';
import { taskResults } from '../src/task-result-reads.ts';
import { parallelWorkspacesFixture } from './fixtures/parallel-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Parallel result provenance', { timeout: 60000 }, () => {
  it('attributes each Node result to its own start and produced revision while retaining its integrated Task revision', async () => {
    const x = await parallelWorkspacesFixture();
    try {
      await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
      const a = await x.promote(), b = await x.promote();
      await x.open(a); await x.open(b);
      const first = await x.admitCompletion(a);
      const firstResult = await x.settleCompletion(a, first.operation, 'integrated', 'c'.repeat(40));
      const second = await x.admitCompletion(b);
      const secondResult = await x.settleCompletion(b, second.operation, 'integrated', 'f'.repeat(40));
      const page = await taskResults(x.db, x.token, x.f.task);
      expect(page.items).toHaveLength(2);
      for (const [operation, effect] of [[first.operation, firstResult], [second.operation, secondResult]] as const) {
        const item = page.items.find(row => row.manifest.operation_id === operation.operation_id)!;
        expect(item.current).toBe(true);
        expect(item.git_results[0]!.integration).toEqual(effect.workspace_results[0]!.integration);
        expect(item.git_results[0]!.git_commit).toBe(effect.workspace_results[0]!.integration!.task_commit);
        expect(item.git_results[0]!.integration!.start_commit).toBe('a'.repeat(40));
      }
      expect(page.items.find(row => row.manifest.operation_id === second.operation.operation_id)!.git_results[0]!.integration!.expected_task_commit).toBe('c'.repeat(40));
    } finally { await x.close(); }
  });
});
