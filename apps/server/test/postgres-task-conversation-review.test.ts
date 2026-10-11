import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { initializeTask, publishInitialPlan } from '../src/task-records.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

// These are direct SQL attribution tests, not simulated native execution. Each
// rejected row is a mutation of an independently committed, valid owner/source.
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Task conversation migration attribution review', () => {
  const namespace = 'conversation_review_' + randomUUID().replaceAll('-', '');
  let db: Database, admin: Database;
  beforeAll(async () => {
    admin = database(process.env.DATABASE_URL!);
    await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString());
    await migrate(db);
  }, 20000);
  afterAll(async () => {
    if (db) await db.pool.end();
    if (admin) {
      await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`);
      await admin.pool.end();
    }
  });

  async function task() {
    const f = { task: randomUUID(), spec: randomUUID(), runner: randomUUID() };
    await transaction(db, (tx) => initializeTask(tx, {
      task_id: f.task, specification_id: f.spec, specification: 'Review fixture',
    }));
    await enrollFixture(db, f.runner, randomUUID());
    return f;
  }

  async function turn(f: Awaited<ReturnType<typeof task>>) {
    const t = { input: randomUUID(), owner: randomUUID(), reply: randomUUID(), source: randomUUID(), attempt: randomUUID(), sequence: 0 };
    const context = { input_id: t.input, content: 'Owner input' };
    const prompt = canonicalJSON(context);
    await transaction(db, async (tx) => {
      t.sequence = Number((await tx.query('UPDATE tasks SET conversation_sequence=conversation_sequence+2 WHERE id=$1 RETURNING conversation_sequence', [f.task])).rows[0].conversation_sequence) - 1;
      await tx.query('INSERT INTO task_inputs(id,task_id,message_id) VALUES($1,$2,$3)', [t.input, f.task, t.owner]);
      await tx.query("INSERT INTO task_messages(id,task_id,input_id,sequence,author,content) VALUES($1,$2,$3,$4,'owner','Owner input')", [t.owner, f.task, t.input, t.sequence]);
      await tx.query(`INSERT INTO task_conversation_outbox(id,task_id,input_id,planned_attempt_id,expected_version,source_watermark,configuration_version,reply_only,context,prompt,context_digest,done)
        VALUES($1,$2,$3,$4,1,$5,0,false,$6,$7,$8,true)`, [t.source, f.task, t.input, t.attempt, t.sequence, context, prompt, digest(prompt)]);
      const launch = {
        dispatch_id: randomUUID(), attempt_id: t.attempt, task_id: f.task, runner_id: f.runner,
        kind: 'planner', fencing_generation: 1, node_activation: 0, control_version: 1,
        runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt,
        source_watermark: t.sequence, mutation_allowed: false, process_released: true,
        workspace_reservations: { project_id: 'project', configuration_version: 0, resources: [] },
        task_conversation_source: { source_id: t.source, input_id: t.input, source_watermark: t.sequence,
          conversation_version: 1, context_digest: digest(prompt), reply_only: false },
      };
      validate('Dispatch', launch);
      await tx.query(`INSERT INTO attempts(id,runner_id,task_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,specification_id,task_conversation_source_id,mutation_allowed,process_released)
        VALUES($1,$2,$3,$4,$5,'planner',1,0,$6,$7,$8,false,true)`, [t.attempt, f.runner, f.task, `planner:${f.task}`, launch.dispatch_id, launch, f.spec, t.source]);
      await tx.query(`INSERT INTO task_messages(id,task_id,input_id,sequence,author,content,source_id,source_watermark,observed_control_version,observed_at)
        VALUES($1,$2,$3,$4,'assistant','Reply',$5,$6,1,clock_timestamp())`, [t.reply, f.task, t.input, t.sequence + 1, t.source, t.sequence]);
    });
    return t;
  }

  async function node(f: Awaited<ReturnType<typeof task>>, t: Awaited<ReturnType<typeof turn>>, guidanceId: string = randomUUID()) {
    const n = { node: randomUUID(), plan: randomUUID(), role: randomUUID(), source: randomUUID(), attempt: randomUUID(),
      guidance: { id: guidanceId, obligation: randomUUID() } };
    await db.pool.query("INSERT INTO roles(id,name,description,instructions) VALUES($1,'Builder','Descriptor','Instructions')", [n.role]);
    const planner = randomUUID();
    await transaction(db, async (tx) => {
      await tx.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [f.task]);
      await tx.query(`INSERT INTO attempts(id,runner_id,task_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,specification_id)
        VALUES($1,$2,$3,$4,$5,'planner',1,0,'{}',$6)`, [planner, f.runner, f.task, `planner:${f.task}`, randomUUID(), f.spec]);
      await publishInitialPlan(tx, {
        task_id: f.task, plan_id: n.plan, expected: { control_version: 1, specification_id: f.spec, plan_id: null },
        nodes: [{ node_id: n.node, role_id: n.role, goal: 'Build', dependencies: [] }],
        claim: { attempt_id: planner, fencing_generation: 1 },
      });
      await tx.query('UPDATE attempts SET mutation_allowed=false,process_released=true WHERE id=$1', [planner]);
      await tx.query('INSERT INTO task_guidance(id,task_id,input_id,text,content_digest,node_id) VALUES($1,$2,$3,$4,$5,$6)', [n.guidance.id, f.task, t.input, 'Instruction', digest('Instruction'), n.node]);
      await tx.query('INSERT INTO task_guidance_obligations(id,task_id,guidance_id,node_id,node_activation) VALUES($1,$2,$3,$4,1)', [n.guidance.obligation, f.task, n.guidance.id, n.node]);
      const reservations = { project_id: 'project', configuration_version: 0, resources: [] };
      const context = { workspace_reservations: reservations, guidance: {
        items: [{ guidance_id: n.guidance.id, obligation_id: n.guidance.obligation,
          input_id: t.input, text: 'Instruction', content_digest: digest('Instruction') }],
        required_guidance_ids: [n.guidance.id],
      } };
      const prompt = canonicalJSON(context);
      await tx.query(`INSERT INTO node_execution_outbox(id,task_id,node_id,node_activation,specification_id,plan_id,expected_version,planned_attempt_id,configuration_version,role_id,context,prompt,context_digest,done)
        VALUES($1,$2,$3,1,$4,$5,2,$6,0,$7,$8,$9,$10,true)`, [n.source, f.task, n.node, f.spec, n.plan, n.attempt, n.role, context, prompt, digest(prompt)]);
      await tx.query('INSERT INTO task_guidance_assignments(source_id,obligation_id,guidance_id) VALUES($1,$2,$3)', [n.source, n.guidance.obligation, n.guidance.id]);
      const launch = {
        dispatch_id: randomUUID(), attempt_id: n.attempt, task_id: f.task, runner_id: f.runner,
        node_id: n.node, kind: 'node', fencing_generation: 1, node_activation: 1, control_version: 2,
        runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt, source_watermark: 0,
        mutation_allowed: false, process_released: true, workspace_reservations: reservations,
        node_execution_source: { source_id: n.source, node_id: n.node, node_activation: 1,
          specification_id: f.spec, plan_id: n.plan, control_version: 2, context_digest: digest(prompt) },
      };
      validate('Dispatch', launch);
      await tx.query(`INSERT INTO attempts(id,runner_id,task_id,node_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,specification_id,plan_id,node_execution_source_id,mutation_allowed,process_released)
        VALUES($1,$2,$3,$4,$5,$6,'node',1,1,$7,$8,$9,$10,false,true)`, [n.attempt, f.runner, f.task, n.node, `node:${n.node}`, launch.dispatch_id, launch, f.spec, n.plan, n.source]);
    });
    return n;
  }

  it('accepts exact resolution and rejects another input source, reply or Attempt', async () => {
    const f = await task(), a = await turn(f), b = await turn(f);
    async function resolve(source: string = a.source, reply: string = a.reply, attempt: string = a.attempt) {
      return db.pool.query(`INSERT INTO task_input_resolutions(input_id,task_id,source_id,reply_message_id,disposition,routing,request_id,attempt_id)
        VALUES($1,$2,$3,$4,'replied','{"kind":"reply"}',$5,$6)`, [a.input, f.task, source, reply, randomUUID(), attempt]);
    }
    for (const ids of [[b.source, a.reply, a.attempt], [a.source, b.reply, a.attempt], [a.source, a.reply, b.attempt]]) {
      await expect(resolve(...ids as [string, string, string])).rejects.toMatchObject({ code: '23514' });
    }
    await resolve();
    expect((await db.pool.query('SELECT count(*) FROM task_input_resolutions WHERE input_id=$1', [a.input])).rows[0].count).toBe('1');
    await expect(db.pool.query('UPDATE task_input_resolutions SET routing=routing WHERE input_id=$1', [a.input])).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects assignment and follow-up cross attribution while accepting exact ownership', async () => {
    const f = await task(), g = await task();
    const a = await turn(f), b = await turn(g), n = await node(f, a), m = await node(g, b);
    const own = n.guidance, foreign = m.guidance;
    for (const [source, obligation, id] of [
      [n.source, own.obligation, foreign.id], [n.source, foreign.obligation, foreign.id],
      [m.source, own.obligation, own.id],
    ]) {
      await expect(db.pool.query('INSERT INTO task_guidance_assignments(source_id,obligation_id,guidance_id) VALUES($1,$2,$3)', [source, obligation, id])).rejects.toMatchObject({ code: '23514' });
    }
    expect((await db.pool.query('SELECT obligation_id,guidance_id FROM task_guidance_assignments WHERE source_id=$1', [n.source])).rows).toEqual([{ obligation_id: own.obligation, guidance_id: own.id }]);
    await expect(db.pool.query('INSERT INTO task_guidance_followups(obligation_id,task_id,node_id,node_activation,source_id) VALUES($1,$2,$3,1,$4)', [own.obligation, g.task, m.node, m.source])).rejects.toMatchObject({ code: '23514' });
    await db.pool.query('INSERT INTO task_guidance_followups(obligation_id,task_id,node_id,node_activation,source_id) VALUES($1,$2,$3,1,$4)', [own.obligation, f.task, n.node, n.source]);
  });

  it('requires string guidance IDs before assignment lookup and preserves version 1 meaning', async () => {
    const f = await task(), t = await turn(f), n = await node(f, t, '123');
    async function manifest(ids: unknown, version = 2) {
      return transaction(db, async (tx) => {
        const operation = randomUUID();
        await tx.query(`INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,completion_manifest_digest)
          VALUES($1,$2,1,'complete_node',$3,'admitted',$4)`, [operation, n.attempt, randomUUID(), 'a'.repeat(64)]);
        await tx.query(`INSERT INTO completion_manifests(operation_id,task_id,node_id,node_activation,attempt_id,source_id,specification_id,plan_id,summary,artifact_ids,content_digest,manifest_version,handled_guidance_ids)
          VALUES($1,$2,$3,1,$4,$5,$6,$7,'Done','[]',$8,$9,$10)`, [operation, f.task, n.node, n.attempt, n.source, f.spec, n.plan, 'a'.repeat(64), version, JSON.stringify(ids)]);
      });
    }
    for (const ids of [[123], [123, '123'], ['123', '123'], ['unassigned']]) {
      await expect(manifest(ids)).rejects.toMatchObject({ code: '23514' });
    }
    await expect(manifest(['123'], 1)).rejects.toMatchObject({ code: '23514' });
    await manifest(['123']);
    expect((await db.pool.query('SELECT handled_guidance_ids FROM completion_manifests WHERE attempt_id=$1', [n.attempt])).rows[0].handled_guidance_ids).toEqual(['123']);
  });

  it('rejects same-Task assignment and follow-up from another activation', async () => {
    const f = await task(), t = await turn(f), n = await node(f, t), g = n.guidance;
    const newerSource = randomUUID(), newerObligation = randomUUID();
    await transaction(db, async (tx) => {
      await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,2,$3,$4,'recorded')", [f.task, n.node, f.spec, n.plan]);
      await tx.query('INSERT INTO task_guidance_obligations(id,task_id,guidance_id,node_id,node_activation) VALUES($1,$2,$3,$4,2)', [newerObligation, f.task, g.id, n.node]);
    });
    const context = (await db.pool.query('SELECT context FROM node_execution_outbox WHERE id=$1', [n.source])).rows[0].context;
    context.guidance.items[0].obligation_id = newerObligation;
    const prompt = canonicalJSON(context);
    const sourceWithAssignment = (source: string, activation: number) => transaction(db, async tx => {
      await tx.query(`INSERT INTO node_execution_outbox(id,task_id,node_id,node_activation,specification_id,plan_id,expected_version,planned_attempt_id,configuration_version,role_id,context,prompt,context_digest,done)
        SELECT $1,task_id,node_id,$2,specification_id,plan_id,expected_version,$3,configuration_version,role_id,$4,$5,$6,true FROM node_execution_outbox WHERE id=$7`, [source, activation, randomUUID(), context, prompt, digest(prompt), n.source]);
      await tx.query('INSERT INTO task_guidance_assignments(source_id,obligation_id,guidance_id) VALUES($1,$2,$3)', [source, newerObligation, g.id]);
    });
    // The negative source has a complete frozen assignment set, so rejection
    // specifically proves that activation 1 cannot borrow activation 2's work.
    await expect(sourceWithAssignment(randomUUID(), 1)).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('INSERT INTO task_guidance_followups(obligation_id,task_id,node_id,node_activation,source_id) VALUES($1,$2,$3,2,$4)', [newerObligation, f.task, n.node, n.source])).rejects.toMatchObject({ code: '23514' });
    await sourceWithAssignment(newerSource, 2);
    await db.pool.query('INSERT INTO task_guidance_followups(obligation_id,task_id,node_id,node_activation,source_id) VALUES($1,$2,$3,2,$4)', [newerObligation, f.task, n.node, newerSource]);
  });

  it('requires all frozen assignments at source commit and rejects later unfrozen additions', async () => {
    const f = await task(), t = await turn(f), n = await node(f, t);
    const original = (await db.pool.query('SELECT context FROM node_execution_outbox WHERE id=$1', [n.source])).rows[0].context;
    const cloneSource = async (source: string, context: object) => {
      const prompt = canonicalJSON(context);
      return db.pool.query(`INSERT INTO node_execution_outbox(id,task_id,node_id,node_activation,specification_id,plan_id,expected_version,planned_attempt_id,configuration_version,role_id,context,prompt,context_digest,done)
        SELECT $1,task_id,node_id,node_activation,specification_id,plan_id,expected_version,$2,configuration_version,role_id,$3,$4,$5,true FROM node_execution_outbox WHERE id=$6`, [source, randomUUID(), context, prompt, digest(prompt), n.source]);
    };
    const missing = randomUUID();
    await expect(cloneSource(missing, original)).rejects.toMatchObject({ code: '23514' });
    expect((await db.pool.query('SELECT id FROM node_execution_outbox WHERE id=$1', [missing])).rowCount).toBe(0);
    const empty = randomUUID();
    await cloneSource(empty, { ...original, guidance: { items: [], required_guidance_ids: [] } });
    await expect(db.pool.query('INSERT INTO task_guidance_assignments(source_id,obligation_id,guidance_id) VALUES($1,$2,$3)', [empty, n.guidance.obligation, n.guidance.id])).rejects.toMatchObject({ code: '23514' });
    expect((await db.pool.query('SELECT id FROM node_execution_outbox WHERE id=$1', [empty])).rowCount).toBe(1);
    expect((await db.pool.query('SELECT source_id FROM task_guidance_assignments WHERE source_id=$1', [empty])).rowCount).toBe(0);
  });

  it('does not turn a guidance-owned Stop into a factual blocker during normal scheduler passes', async () => {
    const x = await conversationFixture();
    try {
      await x.start();
      const original = await x.node();
      await x.send('Use the requested formatting');
      const planner = await x.turn();
      const response = await x.reply(planner, {
        kind: 'guidance', text: 'Use the requested formatting', basis: await x.basis(),
      });
      // main.ts schedules this independently of conversation.pump. A trusted
      // guidance Stop is expected control flow, even while the old writer lives.
      await x.execution.pump();
      const during = (await x.db.pool.query('SELECT state,blocker_id FROM nodes WHERE id=$1', [x.f.node])).rows[0];
      expect(during).toEqual({ state: 'RUNNING', blocker_id: null });
      const stop = (await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [original.dispatch.attempt_id])).rows[0];
      await x.finish(stop.id, original.dispatch.attempt_id);
      await x.finish(response.operation_id!, planner.dispatch.attempt_id);
      await x.conversation.pump();
      const successor = await x.node();
      expect(successor.dispatch.node_activation).toBe(original.dispatch.node_activation);
      expect(successor.dispatch.attempt_id).not.toBe(original.dispatch.attempt_id);
      expect(successor.dispatch.prompt).toContain('Use the requested formatting');
    } finally {
      await x.close();
    }
  }, 20000);

  it('does not let a Stop that loses to completion authorize new work without guidance', async () => {
    const x = await conversationFixture();
    try {
      await x.start();
      const original = await x.node();
      const completion = await x.agent(original, 'complete_node', { summary: 'Original result' });
      const control = async (name: 'stop_node' | 'continue_node') => x.execution.command(x.token, {
        schema_version: 1, request_id: randomUUID(), scope_id: x.f.task,
        expected_control_version: await x.version(), name,
        payload: { node_id: x.f.node, node_activation: 1, source_id: original.dispatch.node_execution_source!.source_id },
      });
      await control('stop_node');
      await x.finish(completion.operation_id!, original.dispatch.attempt_id);
      await expect(control('continue_node')).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
      expect((await x.db.pool.query('SELECT activation,state FROM nodes WHERE id=$1', [x.f.node])).rows[0]).toEqual({ activation: '1', state: 'COMPLETED' });
      expect((await x.db.pool.query('SELECT count(*) FROM node_execution_outbox')).rows[0].count).toBe('1');
    } finally {
      await x.close();
    }
  }, 20000);

  it('retains handled guidance attribution to its successful completion', async () => {
    const x = await conversationFixture();
    try {
      await x.send('Keep labels readable');
      const turn = await x.turn();
      const reply = await x.reply(turn, { kind: 'guidance', text: 'Keep labels readable', basis: await x.basis() });
      await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
      await x.start();
      const node = await x.node();
      const pending = (await x.db.pool.query('SELECT id,status FROM task_guidance_obligations WHERE guidance_id=$1', [reply.result!.obligation_id])).rows[0];
      expect(pending.status).toBe('pending');
      await expect(x.db.pool.query("UPDATE task_guidance_obligations SET status='handled',completion_operation_id=$2 WHERE id=$1", [pending.id, reply.operation_id])).rejects.toMatchObject({ code: '23514' });
      const completion = await x.agent(node, 'complete_node', { summary: 'Done', handled_guidance_ids: [reply.result!.obligation_id!] });
      await expect(x.db.pool.query("UPDATE task_guidance_obligations SET status='handled',completion_operation_id=$2 WHERE id=$1", [pending.id, completion.operation_id])).rejects.toMatchObject({ code: '23514' });
      await x.finish(completion.operation_id!, node.dispatch.attempt_id);
      const obligation = (await x.db.pool.query('SELECT id,status,completion_operation_id FROM task_guidance_obligations WHERE guidance_id=$1', [reply.result!.obligation_id])).rows[0];
      expect(obligation).toMatchObject({ status: 'handled', completion_operation_id: completion.operation_id });
      await expect(x.db.pool.query('UPDATE task_guidance_obligations SET completion_operation_id=$2 WHERE id=$1', [obligation.id, reply.operation_id])).rejects.toMatchObject({ code: '23514' });
      await expect(x.db.pool.query("UPDATE task_guidance_obligations SET status='pending',completion_operation_id=NULL WHERE id=$1", [obligation.id])).rejects.toMatchObject({ code: '23514' });
    } finally {
      await x.close();
    }
  }, 20000);
});
