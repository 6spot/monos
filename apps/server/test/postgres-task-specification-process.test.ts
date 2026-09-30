import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import type { TaskSpecificationResult } from '../../../packages/protocol/src/index.ts';
import { TaskSpecification } from '../src/task-specification.ts';
import { specificationImpact } from '../src/task-specification-state.ts';
import { issueOwnerSession } from '../src/owner-commands.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { Worker } from './fixtures/process-worker.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Specification independent processes and crash recovery', { timeout: 40000 }, () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let spec: TaskSpecification;
  const workers: Worker[] = [];
  beforeEach(async () => { x = await conversationFixture(); spec = new TaskSpecification(x.db); }, 30000);
  afterEach(async () => { await Promise.all(workers.splice(0).map(w => w.stop())); await x?.close(); }, 30000);
  const body = (name: string, payload: object) => ({ schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name, payload });
  const impact = () => transaction(x.db, async tx => specificationImpact(tx, (await tx.query('SELECT * FROM tasks WHERE id=$1', [x.f.task])).rows[0]));
  const edit = async () => body('edit_specification', { proposal_id: randomUUID(), specification: '# Revised requirement\nKeep the exact private result.', summary: 'Exact sufficient graph revision', basis: await x.basis(), impact: await impact(), source_input_ids: [] });
  const worker = () => { const w = new Worker(x.databaseUrl, new URL('./fixtures/task-specification-worker.ts', import.meta.url)); workers.push(w); return w; };
  async function proposal() {
    const input = await x.send('Revise the complete requirement');
    const turn = await x.turn(), basis = await x.basis(), id = randomUUID();
    const prepared = await x.agent(turn, 'prepare_specification_revision', { proposal_id: id, specification: 'Complete revised requirement', summary: 'Exact change', basis, impact: await impact(), source_input_ids: [input.input_id!] });
    const reply = await x.reply(turn, { kind: 'specification_proposal', proposal_id: id, basis });
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    return { id, digest: prepared.result!.content_digest! };
  }
  // One SQL statement observes a coherent committed projection. Owner-session
  // access times and unrelated configuration are deliberately outside this scope.
  async function snapshot() {
    return (await x.db.pool.query(`SELECT jsonb_build_object(
      'task',(SELECT to_jsonb(t) FROM tasks t WHERE id=$1),
      'nodes',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM nodes n),
      'activations',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY node_id,activation),'[]') FROM node_activations n),
      'completions',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY operation_id),'[]') FROM node_completions n),
      'manifests',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY operation_id),'[]') FROM completion_manifests n),
      'obligations',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM requirement_obligations n),
      'proposals',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM requirement_proposals p),
      'authorizations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM authorization_receipts a),
      'authorization_commands',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY authorization_id),'[]') FROM requirement_authorization_commands a),
      'proposal_envelopes',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM task_command_proposals a),
      'changes',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM requirement_changes c),
      'publications',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY change_id),'[]') FROM requirement_publications p),
      'applicability',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY specification_id,node_id,node_activation),'[]') FROM specification_node_applicability a),
      'revisions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM specification_revisions s),
      'slots',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY task_id),'[]') FROM task_publication_slots s),
      'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM attempts a),
      'effects',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY change_id,operation_id),'[]') FROM requirement_change_effects e),
      'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM operations o),
      'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM outbox o),
      'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY scope_id,request_id),'[]') FROM owner_command_receipts r),
      'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY sequence),'[]') FROM task_events e)
    ) snapshot`, [x.f.task])).rows[0].snapshot;
  }
  async function contend(commands: ReturnType<typeof body>[]) {
    const tokens = await Promise.all(commands.map(() => issueOwnerSession(x.db)));
    const holder = await x.db.pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
    const holderPid = (await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    try {
      const group = commands.map(() => worker());
      const ready = await Promise.all(group.map(w => w.next('ready')));
      const pids = ready.map(r => r.pid!);
      expect(new Set(pids).size).toBe(commands.length);
      expect(pids.every(pid => Number.isInteger(pid) && pid !== holderPid)).toBe(true);
      expect(new Set(group.map(w => w.child.pid)).size).toBe(commands.length);
      group.forEach((w, i) => w.send({ mode: 'command', token: tokens[i]!.token, body: commands[i] }));
      let waiting: { pid: number; blockers: number[] }[] = [];
      for (let i = 0; i < 500; i++) {
        waiting = (await x.admin.pool.query("SELECT pid,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])).rows;
        if (waiting.length === commands.length && waiting.every(r => r.blockers.length > 0)) break;
        await delay(10);
      }
      expect(waiting.length).toBe(commands.length);
      expect(waiting.every(r => r.blockers.length > 0)).toBe(true);
      // At least one contender waits directly on our held Task; the other may
      // queue behind its configuration/Runner lock, which is real contention.
      expect(waiting.some(r => r.blockers.includes(holderPid))).toBe(true);
      await holder.query('COMMIT');
      const done = await Promise.all(group.map(w => w.next('done', 'error')));
      expect(done.map(r => r.type)).toEqual(commands.map(() => 'done'));
      return done.map(r => (r as typeof r & { result: TaskSpecificationResult }).result);
    } finally { await holder.query('ROLLBACK'); holder.release(); }
  }
  async function crash(mode: 'command' | 'pump', point: 'before' | 'after' | 'before-publication' | 'after-publication', command?: ReturnType<typeof body>) {
    const w = worker();
    await w.next('ready');
    w.send({ mode, token: x.token, body: command, crash: point });
    await w.exited;
    expect(w.child.signalCode, JSON.stringify(w.messages)).toBe('SIGKILL');
    expect(w.child.exitCode).toBeNull();
    expect(w.messages.filter(m => m.type === 'error' || m.type === 'unexpected-survival')).toEqual([]);
  }
  it('two distinct waiting Owner sessions confirm one exact receipt without publication', async () => {
    const p = await proposal();
    const commands = Array.from({ length: 2 }, () => body('confirm_specification', { proposal_id: p.id, content_digest: p.digest }));
    const results = await contend(commands);
    expect(results[0]!.confirmation_id).toBeTruthy();
    expect(results[1]!.confirmation_id).toBe(results[0]!.confirmation_id);
    expect((await x.db.pool.query('SELECT count(*) FROM authorization_receipts WHERE proposal_id=$1', [p.id])).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT count(*) FROM requirement_changes')).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT specification_id FROM tasks')).rows[0].specification_id).toBe(x.f.spec);
    for (let i = 0; i < 2; i++) expect(await spec.receipt(x.token, x.f.task, commands[i]!.request_id)).toEqual(results[i]);
  });
  it('two distinct waiting Owner apply commands publish one exact revision and operation', async () => {
    const p = await proposal();
    const confirmation = await spec.command(x.token, body('confirm_specification', { proposal_id: p.id, content_digest: p.digest }));
    const payload = { proposal_id: p.id, confirmation_id: confirmation.confirmation_id, basis: await x.basis() };
    const commands = Array.from({ length: 2 }, () => body('apply_specification_revision', payload));
    const results = await contend(commands);
    expect(results[0]!.operation_id).toBeTruthy();
    expect(results[1]!.operation_id).toBe(results[0]!.operation_id);
    const publication = (await x.db.pool.query('SELECT * FROM requirement_publications')).rows;
    expect(publication).toHaveLength(1);
    expect(publication[0].change_id).toBe(results[0]!.operation_id);
    expect((await x.db.pool.query('SELECT specification_id FROM tasks')).rows[0].specification_id).toBe(publication[0].specification_id);
    expect((await x.db.pool.query('SELECT count(*) FROM specification_revisions')).rows[0].count).toBe('2');
    const frozen = await snapshot();
    for (let i = 0; i < 2; i++) expect(await spec.command(x.token, commands[i])).toEqual(results[i]);
    expect(await snapshot()).toEqual(frozen);
  });
  it.each(['before', 'after'] as const)('SIGKILL %s admission COMMIT preserves exact receipt, freeze and Stop', async point => {
    await x.start();
    const node = await x.node(), command = await edit(), before = await snapshot();
    await crash('command', point, command);
    if (point === 'before') {
      expect(await snapshot()).toEqual(before);
      expect((await spec.receipt(x.token, x.f.task, command.request_id)).status).toBe('unknown');
    } else {
      const recovered = await spec.receipt(x.token, x.f.task, command.request_id);
      expect(recovered.status).toBe('admitted');
      expect(recovered.operation_id).toBeTruthy();
      expect((await x.db.pool.query('SELECT id FROM requirement_changes')).rows.map(r => r.id)).toEqual([recovered.operation_id]);
      expect((await x.db.pool.query('SELECT count(*) FROM requirement_change_effects')).rows[0].count).toBe('1');
    }
    const result = await spec.command(x.token, command);
    const frozen = await snapshot();
    expect(await spec.receipt(x.token, x.f.task, command.request_id)).toEqual(result);
    expect(await spec.command(x.token, command)).toEqual(result);
    expect(await snapshot()).toEqual(frozen);
    expect((await x.db.pool.query('SELECT specification_id FROM tasks')).rows[0].specification_id).toBe(x.f.spec);
    const change = (await x.db.pool.query('SELECT * FROM requirement_changes')).rows;
    expect(change).toHaveLength(1); expect(change[0].id).toBe(result.operation_id); expect(change[0].status).toBe('settling');
    expect((await x.db.pool.query('SELECT operation_id FROM task_publication_slots')).rows[0].operation_id).toBe(result.operation_id);
    expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1', [change[0].authorization_id])).rows[0].consumed_by).toBe(command.request_id);
    const effects = (await x.db.pool.query('SELECT o.* FROM requirement_change_effects e JOIN operations o ON o.id=e.operation_id WHERE e.change_id=$1', [result.operation_id])).rows;
    expect(effects).toHaveLength(1); expect(effects[0].kind).toBe('stop'); expect(effects[0].attempt_id).toBe(node.dispatch.attempt_id);
    expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [node.dispatch.attempt_id])).rows[0]).toEqual({ mutation_allowed: false, process_released: false });
    await x.finish(effects[0].id, node.dispatch.attempt_id); await spec.pump();
    expect((await x.db.pool.query('SELECT count(*) FROM requirement_publications')).rows[0].count).toBe('1');
  });
  it.each(['before-publication', 'after-publication'] as const)('SIGKILL %s pump COMMIT atomically publishes applicability and durable history', async point => {
    await x.start();
    const node = await x.node(), command = await edit();
    const result = await spec.command(x.token, command);
    const effect = (await x.db.pool.query('SELECT operation_id FROM requirement_change_effects WHERE change_id=$1', [result.operation_id])).rows[0];
    await x.finish(effect.operation_id, node.dispatch.attempt_id);
    const before = await snapshot();
    await crash('pump', point);
    if (point === 'before-publication') expect(await snapshot()).toEqual(before);
    else {
      expect((await x.db.pool.query('SELECT count(*) FROM requirement_publications')).rows[0].count).toBe('1');
      expect((await x.db.pool.query('SELECT count(*) FROM specification_node_applicability')).rows[0].count).toBe('1');
    }
    expect(await spec.receipt(x.token, x.f.task, command.request_id)).toEqual(result);
    await spec.pump();
    const frozen = await snapshot();
    await spec.pump(); expect(await snapshot()).toEqual(frozen);
    const publication = (await x.db.pool.query('SELECT * FROM requirement_publications')).rows;
    expect(publication).toHaveLength(1); expect(publication[0].change_id).toBe(result.operation_id);
    expect((await x.db.pool.query('SELECT specification_id FROM tasks')).rows[0].specification_id).toBe(publication[0].specification_id);
    expect((await x.db.pool.query('SELECT parent_id,authorization_id FROM specification_revisions WHERE id=$1', [publication[0].specification_id])).rows[0].parent_id).toBe(x.f.spec);
    const applicability = (await x.db.pool.query('SELECT * FROM specification_node_applicability')).rows;
    expect(applicability).toHaveLength(1); expect(applicability[0]).toMatchObject({ change_id: result.operation_id, specification_id: publication[0].specification_id, disposition: 'refresh', node_id: x.f.node, node_activation: '1' });
    expect((await x.db.pool.query('SELECT count(*) FROM task_publication_slots')).rows[0].count).toBe('0');
    const fresh = await x.node();
    expect(fresh.dispatch.attempt_id).not.toBe(node.dispatch.attempt_id);
    expect(fresh.dispatch.node_activation).toBe(1);
    expect(fresh.dispatch.node_execution_source!.specification_id).toBe(publication[0].specification_id);
  });
  it.each(['before-publication', 'after-publication'] as const)('SIGKILL %s immediate carry publication atomically binds unchanged completion evidence', async point => {
    await x.start();
    const node = await x.node();
    const completion = await x.agent(node, 'complete_node', { summary: 'Original exact completion' });
    await x.finish(completion.operation_id!, node.dispatch.attempt_id);
    const completed = (await x.db.pool.query('SELECT * FROM node_completions')).rows;
    const manifests = (await x.db.pool.query('SELECT * FROM completion_manifests')).rows;
    const carried = await impact(); carried.nodes[0]!.disposition = 'carry';
    const command = body('edit_specification', { proposal_id: randomUUID(), specification: 'Complete requirement retaining this exact result', summary: 'Carry exact evidence', impact: carried, basis: await x.basis(), source_input_ids: [] });
    const before = await snapshot();
    await crash('command', point, command);
    if (point === 'before-publication') {
      expect(await snapshot()).toEqual(before);
      expect((await spec.receipt(x.token, x.f.task, command.request_id)).status).toBe('unknown');
    } else {
      const recovered = await spec.receipt(x.token, x.f.task, command.request_id);
      expect(recovered.operation_id).toBeTruthy();
      expect((await x.db.pool.query('SELECT change_id FROM requirement_publications')).rows.map(r => r.change_id)).toEqual([recovered.operation_id]);
      expect((await x.db.pool.query('SELECT count(*) FROM specification_node_applicability')).rows[0].count).toBe('1');
    }
    const result = await spec.command(x.token, command);
    const frozen = await snapshot();
    expect(await spec.command(x.token, command)).toEqual(result);
    await spec.pump(); expect(await snapshot()).toEqual(frozen);
    expect((await x.db.pool.query('SELECT * FROM node_completions')).rows).toEqual(completed);
    expect((await x.db.pool.query('SELECT * FROM completion_manifests')).rows).toEqual(manifests);
    expect((await x.db.pool.query('SELECT state FROM tasks')).rows[0].state).toBe('REVIEW');
    const links = (await x.db.pool.query('SELECT * FROM specification_node_applicability')).rows;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ change_id: result.operation_id, disposition: 'carry', node_activation: '1', completion_operation_id: completion.operation_id, completion_manifest_digest: manifests[0].content_digest });
    expect((await x.db.pool.query('SELECT specification_id FROM tasks')).rows[0].specification_id).toBe(links[0].specification_id);
    expect((await x.db.pool.query('SELECT count(*) FROM specification_revisions')).rows[0].count).toBe('2');
  });

});
