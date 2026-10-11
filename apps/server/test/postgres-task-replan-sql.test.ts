import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionPlanNode, ReplanImpact, WorkspaceMetadata } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { multiReplanFixture } from './fixtures/task-replan-multi-fixture.ts';

type Fixture = Awaited<ReturnType<typeof multiReplanFixture>>;
type Prepared = Awaited<ReturnType<Fixture['prepare']>>;

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-Node Replan SQL authority', { timeout: 60000 }, () => {
  let x: Fixture;
  beforeEach(async () => { x = await multiReplanFixture(); });
  afterEach(async () => { await x?.close(); });

  // Exercise SQL independently of the API validator without rewriting immutable proposals.
  function validate(p: Prepared, change: { impact?: unknown; nodes?: ExecutionPlanNode[] } = {}) {
    return x.db.pool.query(`SELECT validate_replan_graph_impact(jsonb_populate_record(NULL::replan_proposals,
      (SELECT to_jsonb(p) || jsonb_build_object('content', p.content || $2::jsonb)
       FROM replan_proposals p WHERE p.id=$1)))`, [p.payload.proposal_id, JSON.stringify(change)]);
  }

  async function guidance() {
    await x.send('Keep the exact public compatibility constraint');
    const turn = await x.turn();
    const result = await x.reply(turn, { kind: 'guidance', basis: await x.basis(), text: 'Preserve public compatibility' });
    await x.finish(result.operation_id!, turn.dispatch.attempt_id);
  }

  it('rejects incomplete, reordered, duplicated and forged source Node evidence', async () => {
    const first = x.definition(x.f.node), second = x.definition();
    await x.start([first, second]); await x.complete(await x.node()); await x.request();
    const p = await x.prepare([first, second]);
    await expect(validate(p)).resolves.toBeDefined();
    const changes: ((impact: ReplanImpact) => void)[] = [
      impact => { impact.nodes.pop(); },
      impact => { impact.nodes.reverse(); },
      impact => { impact.nodes[1] = structuredClone(impact.nodes[0]); },
      impact => { impact.nodes[0].source_id = randomUUID(); },
      impact => { impact.nodes[0].completion_operation_id = randomUUID(); },
      impact => { impact.nodes[0].completion_manifest_digest = 'f'.repeat(64); },
      impact => { impact.nodes[0].target_node_id = randomUUID(); },
      impact => { impact.nodes[0].target_node_activation = 2; },
      impact => { impact.nodes[0].disposition = 'remove'; impact.nodes[0].target_node_id = null; impact.nodes[0].target_node_activation = null; },
    ];
    for (const change of changes) {
      const impact = structuredClone(p.payload.impact); change(impact);
      await expect(validate(p, { impact })).rejects.toMatchObject({ code: '23514' });
    }
    await expect(validate(p, { nodes: [{ ...first, hard_requirements: [] }, second] }))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('retained definitions are immutable') });
  });

  it('rejects malformed replacement graphs, unavailable Roles, dangling edges and cycles', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.request();
    const first = x.definition(), second = x.definition();
    const p = await x.prepare([first, second]);
    await expect(validate(p)).resolves.toBeDefined();
    for (const nodes of [[], [first, first], [{ ...first, role_id: randomUUID() }, second],
      [{ ...first, dependencies: [randomUUID()] }, second],
      [{ ...first, dependencies: [second.node_id] }, { ...second, dependencies: [first.node_id] }],
      [{ ...first, consumes: ['unsupported-artifact'] }, second]]) {
      await expect(validate(p, { nodes })).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('rejects missing or forged guidance and hold origins, invalid recipients and invented workspace inputs', async () => {
    await guidance();
    const first = x.definition(x.f.node), requester = x.definition();
    await x.start([first, requester]);
    const stopped = await x.node();
    const stop = await x.owner('stop_node', { node_id: first.node_id, node_activation: 1, source_id: stopped.dispatch.node_execution_source!.source_id });
    await x.finish(stop.operation_id!, stopped.dispatch.attempt_id); await x.request(await x.node());
    const p = await x.prepare([x.definition(), x.definition()]);
    expect(p.payload.impact.guidance).toHaveLength(1); expect(p.payload.impact.holds).toHaveLength(1);
    await expect(validate(p)).resolves.toBeDefined();
    const changes: ((impact: ReplanImpact) => void)[] = [
      impact => { impact.guidance = []; },
      impact => { impact.guidance[0]!.version += 1; },
      impact => { impact.guidance[0]!.target_node_ids = []; },
      impact => { impact.guidance[0]!.target_node_ids = [randomUUID()]; },
      impact => { impact.guidance[0]!.target_node_ids = [p.payload.nodes[0].node_id, p.payload.nodes[0].node_id]; },
      impact => { impact.holds = []; },
      impact => { impact.holds[0]!.origin.owner_request_id = randomUUID(); },
      impact => { impact.holds[0]!.target_node_ids.splice(0); },
      impact => { impact.holds[0]!.target_node_ids = [randomUUID()]; },
      impact => { impact.holds.push(structuredClone(impact.holds[0]!)); },
    ];
    for (const change of changes) {
      const impact = structuredClone(p.payload.impact); change(impact);
      await expect(validate(p, { impact })).rejects.toMatchObject({ code: '23514' });
    }
    const forged = { ...p.payload.impact, workspaces: [{ input: { workspace_id: randomUUID() }, target_nodes: [] }] };
    await expect(validate(p, { impact: forged })).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects assigning a private checkpoint to a carried completed Node', async () => {
    const config = new Configuration(x.db), resource = randomUUID();
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
      name: 'save_project', payload: { id: x.f.project, name: 'Project', context: 'Preserve unfinished private work',
        resources: [{ id: resource, remote_url: 'https://github.com/example/replan-sql.git', remote_preparation: 'after_acceptance', default_branch: 'main' }], role_ids: [x.f.role], archived: false } });
    const completed = x.definition(x.f.node), unfinished = x.definition();
    await x.start([completed, unfinished]); await x.complete(await x.node());
    const turn = await x.node(), opened = await x.agent(turn, 'open_workspace', { resource_id: resource });
    const operation = await x.service.recoverOperation(x.f.runner, opened.operation_id!), workspace = operation.workspace!;
    const metadata: WorkspaceMetadata = {
      generation: workspace.generation, lease_id: workspace.lease_id, storage_id: 'replan-sql-storage',
      repository_identity: workspace.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
      base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40),
      ...(workspace.isolation ? { isolation: { ...workspace.isolation, start_commit: 'a'.repeat(40) } } : {}),
    };
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id,
      success: true, result: { workspace_id: workspace.workspace_id, path: '/runner/worktree', instruction_files: [], workspace_metadata: metadata } });
    const stop = await x.agent(turn, 'request_replan', { reason: 'Preserve the unfinished repository checkpoint' });
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: stop.operation_id!, attempt_id: turn.dispatch.attempt_id,
      success: true, result: { writer_absent: true, workspace_id: workspace.workspace_id, workspace_metadata: { ...metadata,
        checkpoint: { operation_id: stop.operation_id!, head_commit: 'a'.repeat(40), tree_id: 'b'.repeat(40), commit_id: 'c'.repeat(40) } } } });
    const p = await x.prepare([completed, unfinished], impact => {
      impact.workspaces[0]!.target_nodes = [{ node_id: unfinished.node_id, node_activation: 1 }];
    });
    expect(p.payload.impact.nodes.find(n => n.node_id === completed.node_id)?.disposition).toBe('carry');
    expect(p.payload.impact.workspaces[0]!.input.kind).toBe('checkpoint');
    await expect(validate(p)).resolves.toBeDefined();
    const impact = structuredClone(p.payload.impact);
    impact.workspaces[0]!.target_nodes = [{ node_id: completed.node_id, node_activation: 1 }];
    await expect(validate(p, { impact })).rejects.toMatchObject({ code: '23514', message: 'private checkpoint requires an unfinished target' });
  });

  it.each([
    ['replan_node_applicability', 'every old applicability row'],
    ['node_activations', 'every exact new graph member and activation'],
    ['replan_guidance_applicability', 'every complete guidance disposition'],
    ['replan_control_holds', 'every independent hold target'],
  ] as const)('rolls back publication and approval consumption when a writer omits %s', async (table, message) => {
    if (table === 'replan_guidance_applicability') await guidance();
    const first = x.definition(x.f.node), second = x.definition();
    await x.start([first, second]);
    if (table === 'replan_control_holds') {
      const turn = await x.node();
      const stop = await x.owner('stop_node', { node_id: first.node_id, node_activation: 1, source_id: turn.dispatch.node_execution_source!.source_id });
      await x.finish(stop.operation_id!, turn.dispatch.attempt_id);
    }
    await x.request();
    const p = await x.prepare([first, second, x.definition()]), approval = await x.approve(p);
    // This schema belongs only to this test. Model a buggy writer that silently loses rows.
    await x.db.pool.query(`CREATE FUNCTION omit_replan_test_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER omit_replan_test_row BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION omit_replan_test_row()`);
    await expect(x.command('publish_replan', { proposal_id: p.payload.proposal_id, confirmation_id: approval.confirmation_id, basis: p.payload.basis }))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining(message) });
    expect((await x.db.pool.query('SELECT plan_id,specification_id FROM tasks WHERE id=$1', [x.f.task])).rows[0])
      .toEqual({ plan_id: x.f.plan, specification_id: x.f.spec });
    expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1', [approval.confirmation_id])).rows[0].consumed_by).toBeNull();
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT count(*) FROM plan_revisions WHERE id=$1', [p.payload.plan_id])).rows[0].count).toBe('0');
  });
});
