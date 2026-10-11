import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { readArtifact } from '../src/artifacts.ts';
import { assertNodeConsumes } from '../src/node-consumes.ts';
import { multiReplanFixture } from './fixtures/task-replan-multi-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Explicit Task Artifact context', () => {
  let x: Awaited<ReturnType<typeof multiReplanFixture>>;
  beforeEach(async () => { x = await multiReplanFixture(); });
  afterEach(async () => { await x?.close(); });

  async function outputs(text = 'Original exact output') {
    const root = x.definition(x.f.node); await x.start([root]);
    const turn = await x.node(), selected = randomUUID(), draft = randomUUID();
    for (const [id, title] of [[selected, 'Selected output'], [draft, 'Unselected draft']]) {
      await x.agent(turn, 'publish_artifact', { artifact_id: id, title, content: { text, media_type: 'text/plain' } });
    }
    const completion = await x.agent(turn, 'complete_node', { summary: 'Exact original evidence', artifact_ids: [selected] });
    await x.finish(completion.operation_id!, turn.dispatch.attempt_id);
    return { root, selected, draft, completion };
  }

  it('injects exact selected and draft Artifacts without adding dependencies or borrowing their completion', async () => {
    const { root, selected, draft } = await outputs(); await x.request();
    const consumer = { ...x.definition(), consumes: [draft, selected] };
    const p = await x.prepare([root, consumer], impact => { impact.nodes[0]!.disposition = 'carry'; });
    await x.publish(p);
    const turn = await x.node(), context = JSON.parse(turn.dispatch.prompt);
    expect(turn.dispatch.node_id).toBe(consumer.node_id);
    expect(context.upstream_outputs.items).toEqual([]);
    const records = await transaction(x.db, async tx => Promise.all([readArtifact(tx, x.f.task, draft), readArtifact(tx, x.f.task, selected)]));
    expect(context.upstream_outputs.consumed_artifacts).toEqual([
      { ...records[0], validity: 'historical_context' }, { ...records[1], validity: 'current_completion' },
    ]);
    expect((await x.db.pool.query('SELECT definition FROM plan_nodes WHERE plan_id=$1 AND node_id=$2', [p.payload.plan_id, consumer.node_id])).rows[0].definition).toEqual(consumer);
    const done = await x.complete(turn);
    expect((await x.db.pool.query('SELECT artifact_ids FROM completion_manifests WHERE operation_id=$1', [done.operation_id])).rows[0].artifact_ids).toEqual([]);
  });

  it('retains removed-Node output as historical context and rejects dangling or foreign IDs in backend and SQL', async () => {
    const { selected } = await outputs(); await x.request();
    const consumer = { ...x.definition(), consumes: [selected] }, d = await x.draft([consumer]);
    await expect(x.agent(d.turn, 'prepare_replan', { ...d.payload, nodes: [{ ...consumer, consumes: [randomUUID()] }] }))
      .rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await expect(transaction(x.db, tx => assertNodeConsumes(tx, randomUUID(), [consumer])))
      .rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await expect(x.db.pool.query('SELECT assert_node_consumes($1,$2)', [randomUUID(), consumer])).rejects.toMatchObject({ code: '23514' });
    const p = await x.submit(d);
    // The independent persisted graph validator rejects missing references even
    // when all the surrounding genuine proposal authority is retained.
    await expect(x.db.pool.query(`SELECT validate_replan_graph_impact(jsonb_populate_record(NULL::replan_proposals,
      to_jsonb(p)||jsonb_build_object('content',jsonb_set(p.content,'{nodes,0,consumes}',to_jsonb(ARRAY[$2]::text[])))))
      FROM replan_proposals p WHERE p.id=$1`, [p.payload.proposal_id, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await x.publish(p);
    const turn = await x.node();
    expect(JSON.parse(turn.dispatch.prompt).upstream_outputs.consumed_artifacts).toEqual([
      { ...await transaction(x.db, tx => readArtifact(tx, x.f.task, selected)), validity: 'historical_context' },
    ]);
    expect((await x.db.pool.query('SELECT 1 FROM node_completions WHERE node_id=$1', [consumer.node_id])).rowCount).toBe(0);
  });

  it('retains an actionable preparation failure when explicit bodies exceed the context budget', async () => {
    const { selected, draft } = await outputs('x'.repeat(262144)); await x.request();
    const consumer = { ...x.definition(), consumes: [selected, draft] };
    await x.publish(await x.prepare([consumer])); await x.execution.pump();
    const source = (await x.db.pool.query('SELECT preparation_failure,prompt FROM node_execution_outbox WHERE node_id=$1', [consumer.node_id])).rows[0];
    expect(source).toEqual({ preparation_failure: 'context_budget_exceeded', prompt: null });
    expect((await x.db.pool.query('SELECT 1 FROM attempts WHERE node_id=$1', [consumer.node_id])).rowCount).toBe(0);
  });
});
