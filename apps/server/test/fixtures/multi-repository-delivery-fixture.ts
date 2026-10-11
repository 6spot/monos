import { generateKeyPairSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { multiRepositoryWorkspacesFixture } from './multi-repository-workspaces-fixture.ts';
import { publicationPages } from './publication-fixture.ts';
import { Configuration } from '../../src/configuration.ts';
import { GitHub } from '../../src/github.ts';
import { GitHubRemote, remoteProfile } from '../../src/github-remote.ts';
import { GitHubFinalization } from '../../src/github-finalization.ts';
import { RemotePreparation } from '../../src/remote-preparation.ts';
import { PublicationPreparation } from '../../src/publication-candidates.ts';
import { observePublicationPermission } from '../../src/remote-preparation-access.ts';
import { OwnerDeliveryWorker } from '../../src/owner-delivery-worker.ts';
import { OwnerDeliveryCommands } from '../../src/owner-delivery-commands.ts';
import { OwnerDeliveryReads } from '../../src/owner-delivery-reads.ts';
import { ownerDeliveryHooks } from '../../src/owner-delivery-control.ts';
import { publicationDigest as hash } from '../../src/publication-policy.ts';
import { validate } from '../../../../packages/protocol/src/index.ts';
import type { OwnerDeliveryCommand, PublicationPushResult } from '../../../../packages/protocol/src/index.ts';

export async function multiRepositoryDeliveryFixture(mode: 'automatic' | 'after_acceptance' = 'automatic') {
  const x = await multiRepositoryWorkspacesFixture();
  try {
    const github = new GitHub(x.service.options.signingKey), configuration = new Configuration(x.db, github);
    const save = async (name: 'save_github' | 'save_project', payload: object) => configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version, name, payload,
    });
    await save('save_github', { app_id: '7', installation_id: '8', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
    await save('save_project', { id: x.f.project, name: 'Multi-repository delivery', context: 'One accepted result across two repositories',
      resources: x.resources.map((id, index) => ({ id, provider: 'github', provider_repo_id: String(index + 41), remote_url: `https://github.com/example/multi-${index}.git`, remote_preparation: mode, default_branch: 'main' })), role_ids: [x.f.role], archived: false });
    const states = x.resources.map((resource, index) => ({ resource, repository: String(index + 41), head: '', pr: null as Record<string, unknown> | null,
      reject: false, drop: false, ready: true, finalHead: (index ? '2' : '1').repeat(40) }));
    const calls: { method: string; path: string; resource: string }[] = [], grants: string[] = [];
    const provider = new GitHubRemote(github, {
      acquireGrant: async (scope, profile) => {
        grants.push(profile);
        return { token: 'synthetic-multi-delivery-grant', expires_at: new Date(Date.now() + 3600_000).toISOString(), repository_id: scope.repository_id, permissions: remoteProfile(scope, profile) };
      },
      fetcher: async (input, init) => {
        const url = new URL(String(input)), method = init?.method ?? 'GET', index = Number(url.pathname.match(/multi-(\d)/)?.[1]);
        const state = states[index]; if (!state) throw new Error('Unexpected fixture repository');
        calls.push({ method, path: url.pathname + url.search, resource: state.resource });
        if (url.pathname.includes('/git/ref/')) return Response.json({ ref: decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/git/ref/') + 9)).replace(/^heads\//, 'refs/heads/'), object: { type: 'commit', sha: state.head } });
        if (url.pathname.endsWith('/pulls') && method === 'GET') return Response.json(state.pr ? [state.pr] : []);
        if (url.pathname.endsWith('/pulls') && method === 'POST') {
          const body = JSON.parse(String(init?.body));
          state.pr = { id: index + 101, number: 1, title: body.title, body: body.body, html_url: `https://github.com/example/multi-${index}/pull/1`, state: 'open', draft: false,
            merged: false, merged_at: null, mergeable: true, merge_commit_sha: 'e'.repeat(40), head: { ref: body.head, sha: state.head, repo: { id: index + 41 } }, base: { ref: 'main', sha: 'a'.repeat(40), repo: { id: index + 41 } } };
          return Response.json(state.pr);
        }
        if (url.pathname.endsWith('/pulls/1/merge')) {
          assert.equal(method, 'PUT'); assert.equal(JSON.parse(String(init?.body)).sha, state.head);
          if (state.reject) return Response.json({ message: 'Synthetic rejection' }, { status: 409 });
          Object.assign(state.pr!, { state: 'closed', merged: true, merged_at: new Date().toISOString(), merge_commit_sha: state.finalHead });
          if (state.drop) throw new Error('Synthetic lost successful merge response');
          return Response.json({ merged: true, sha: state.finalHead, message: 'Merged' });
        }
        if (url.pathname.endsWith('/pulls/1')) { if (method === 'PATCH') Object.assign(state.pr!, JSON.parse(String(init?.body))); return Response.json(state.pr); }
        if (url.pathname.endsWith('/branches/main/protection')) return Response.json({ required_status_checks: { strict: true, contexts: ['build'], checks: [{ context: 'build', app_id: 10 }] }, required_linear_history: { enabled: false }, required_pull_request_reviews: null });
        if (url.pathname.includes('/rules/branches/')) return Response.json([]);
        if (url.pathname.includes('/compare/')) return Response.json({ base_commit: { sha: 'a'.repeat(40) }, merge_base_commit: { sha: 'a'.repeat(40) }, status: 'ahead' });
        if (url.pathname.endsWith('/check-runs')) {
          const sha = url.pathname.split('/')[5], rows = sha === state.head ? [{ id: 1, name: 'build', head_sha: sha, status: state.ready ? 'completed' : 'in_progress', conclusion: state.ready ? 'success' : null, started_at: new Date().toISOString(), app: { id: 10 } }] : [];
          return Response.json({ total_count: rows.length, check_runs: rows });
        }
        if (url.pathname.endsWith('/statuses')) return Response.json([]);
        if (url.pathname === `/repos/example/multi-${index}`) return Response.json({ id: index + 41, full_name: `example/multi-${index}`, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true });
        throw new Error('Unexpected fixture provider path ' + url.pathname);
      },
    });
    const remote = new RemotePreparation(x.db, x.service.instanceId, provider), preparation = new PublicationPreparation(x.db, x.service.instanceId);
    const due = async () => {
      await x.service.touch(x.f.runner, x.f.incarnation, true);
      await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp()-interval '1 second'");
      await x.db.pool.query("UPDATE remote_preparation_items i SET next_poll_at=clock_timestamp() WHERE NOT EXISTS(SELECT 1 FROM remote_preparation_observations o WHERE o.item_id=i.item_id AND o.kind='review') OR cancel_requested OR EXISTS(SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=i.item_id AND o.active)");
      await x.db.pool.query("UPDATE remote_preparation_operations SET next_attempt_at=clock_timestamp() WHERE active AND state='pending'");
      await x.db.pool.query('UPDATE owner_delivery_batches SET due_at=clock_timestamp()');
    };
    await x.db.pool.query('UPDATE runners SET remote_preparation_supported=true WHERE id=$1', [x.f.runner]);
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    const completion = (await x.admitCompletion(turn)).operation; await x.settleCompletion(turn, completion);
    for (const state of states) {
      await due();
      const local = (await x.db.pool.query<{ id: string }>('SELECT id FROM delivery_operations WHERE task_id=$1 AND resource_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1', [x.f.task, state.resource])).rows[0]!;
      await observePublicationPermission(x.db, provider, local.id);
    }
    const frames = await preparation.pending(x.f.runner, x.f.incarnation, true);
    for (const frame of frames) {
      const request = frame.publication_prepare!;
      for (const page of publicationPages(request)) {
        page.result.scan!.workflow_changes = false; page.result.scan_digest = hash(page.result.scan);
        await preparation.finish(x.f.runner, x.f.incarnation, page);
      }
    }
    const commands = new OwnerDeliveryCommands(x.db, ownerDeliveryHooks), reads = new OwnerDeliveryReads(x.db);
    const command = (name: OwnerDeliveryCommand['name'], payload: OwnerDeliveryCommand['payload']) => commands.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name, payload });
    const accept = async () => {
      const current = await x.basis(), basis = { control_version: current.control_version, specification_id: current.specification_id, plan_id: current.plan_id };
      const proposal = await command('prepare_delivery_acceptance', { basis });
      const confirmation = await command('confirm_delivery_acceptance', { proposal_id: proposal.proposal_id!, content_digest: proposal.content_digest! });
      return command('accept_delivery', { proposal_id: proposal.proposal_id!, content_digest: proposal.content_digest!, confirmation_id: confirmation.confirmation_id!, basis });
    };
    const prepareRemote = async () => {
      for (let turn = 0; turn < 8; turn++) {
        await due(); await remote.pump(); await due();
        for (const frame of await remote.pending(x.f.runner, x.f.incarnation, true)) {
          const push = frame.publication_push; if (!push) continue;
          const state = states.find(s => s.resource === push.resource_id)!; state.head = push.prepared.candidate!.head;
          const observation = { schema_version: 1, observation_id: randomUUID(), operation_id: push.operation_id, item_id: push.item_id, task_id: push.task_id, resource_id: push.resource_id, runner_id: push.runner_id, storage_id: push.storage_id, repository_identity: push.repository_identity, repository_id: push.repository_id, delivery_ref: push.delivery_ref, status: 'present', head: state.head, observed_at: new Date().toISOString() };
          const result = validate<PublicationPushResult>('PublicationPushResult', { schema_version: 1, operation_id: push.operation_id, request_digest: hash(push), item_id: push.item_id, delivery_ref: push.delivery_ref, candidate_head: state.head, candidate_manifest_digest: push.prepared.candidate_manifest_digest, push_started: false, worker_absent: true, status: 'published', observation, observation_digest: hash(observation) });
          await remote.finish(x.f.runner, x.f.incarnation, result);
        }
        if (states.every(s => s.pr)) return;
      }
      throw new Error('Remote preparation did not finish: ' + JSON.stringify((await x.db.pool.query('SELECT kind,state,reason FROM remote_preparation_operations')).rows));
    };
    const worker = new OwnerDeliveryWorker(x.db, x.service.instanceId, new GitHubFinalization(provider));
    const pump = async (selected = worker) => { await due(); const start = calls.length + grants.length; await selected.pump(); assert.ok(calls.length + grants.length - start <= 8); };
    const barrier = async (batchId: string) => {
      for (let i = 0; i < 16; i++) {
        await pump(); if ((await x.db.pool.query('SELECT 1 FROM owner_delivery_item_validations WHERE batch_id=$1', [batchId])).rowCount === states.length) return;
      }
      throw new Error('Readiness did not validate: ' + JSON.stringify((await x.db.pool.query('SELECT status,attention_reason FROM owner_delivery_batches')).rows));
    };
    const control = async (batchId: string, name: 'retry_delivery' | 'cancel_delivery') => {
      const batch = (await reads.batch(x.token, x.f.task, batchId)).batch;
      return command(name, { operation_id: batchId, content_digest: batch.content_digest, expected_version: batch.version });
    };
    return { ...x, mode, states, calls, grants, remote, preparation, provider, worker, due, reads, accept, prepareRemote, pump, barrier, control, completion };
  } catch (error) { await x.close(); throw error; }
}
