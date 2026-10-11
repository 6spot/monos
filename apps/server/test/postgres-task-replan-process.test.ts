import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope } from '../../../packages/protocol/src/index.ts';
import { replanImpact } from '../src/task-replan-state.ts';
import { issueOwnerSession } from '../src/owner-commands.ts';
import { replanFixture, replacementImpact } from './fixtures/task-replan-fixture.ts';
import { Worker } from './fixtures/process-worker.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Independent Replan COMMIT and contention', { timeout: 50000 }, () => {
  let x: Awaited<ReturnType<typeof replanFixture>>;
  const workers: Worker[] = [];
  beforeEach(async () => { x = await replanFixture(); }, 30000);
  afterEach(async () => { await Promise.all(workers.splice(0).map(w => w.stop())); await x?.close(); }, 30000);
  function worker() { const w = new Worker(x.databaseUrl, new URL('./task-replan-process-worker.ts', import.meta.url)); workers.push(w); return w; }
  async function prepared(joint = false) {
    await x.request(); const p = await x.prepare(joint);
    const a = await x.command('confirm_replan', { proposal_id: p.payload.proposal_id, content_digest: p.result.result!.replan_outcome!.content_digest });
    const ra = joint ? await x.spec.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'confirm_specification', payload: { proposal_id: p.payload.requirement!.proposal_id, content_digest: p.result.result!.replan_outcome!.requirement_content_digest } }) : undefined;
    return { p, body: { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'publish_replan', payload: { proposal_id: p.payload.proposal_id, confirmation_id: a.confirmation_id, basis: p.payload.basis, ...(ra ? { requirement_confirmation_id: ra.confirmation_id } : {}) } } };
  }
  async function snapshot() {
    // One statement, all formal tables including immutable sources and native
    // authority, excluding only Owner session access bookkeeping.
    const tables = ['tasks','nodes','node_activations','plan_revisions','plan_nodes','specification_revisions','replan_requests','replan_sources','replan_proposals','replan_publications','replan_node_applicability','replan_workspace_transfers','replan_control_holds','requirement_changes','requirement_publications','requirement_obligations','authorization_receipts','task_publication_slots','attempts','operations','outbox','owner_command_receipts','command_receipts','node_blockers','node_execution_outbox','replan_decisions','task_events'];
    return (await x.db.pool.query('SELECT jsonb_build_object(' + tables.map(t => `'${t}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${t} r)`).join(',') + ') snapshot')).rows[0].snapshot;
  }
  it.each(['before','after'] as const)('SIGKILL %s joint publication COMMIT retains atomic pointers and receipts', async point => {
    const { p, body } = await prepared(true), before = await snapshot(), w = worker();
    await w.next('ready'); w.send({ token: x.token, body, crash: point }); await w.exited;
    expect(w.child.signalCode, JSON.stringify(w.messages)).toBe('SIGKILL');
    expect(w.messages.filter(m => ['error','unexpected-survival'].includes(m.type))).toEqual([]);
    if (point === 'before') { expect(await snapshot()).toEqual(before); expect((await x.replan.receipt(x.token, x.f.task, body.request_id)).status).toBe('unknown'); }
    else {
      const task = (await x.db.pool.query('SELECT plan_id,specification_id FROM tasks')).rows[0];
      expect(task.plan_id).toBe(p.payload.plan_id); expect(task.specification_id).not.toBe(x.f.spec);
      expect((await x.replan.receipt(x.token, x.f.task, body.request_id)).status).toBe('committed');
    }
    const result = await x.replan.command(x.token, body), frozen = await snapshot();
    expect(await x.replan.command(x.token, body)).toEqual(result); expect(await snapshot()).toEqual(frozen);
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT count(*) FROM requirement_publications')).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT count(*) FROM task_publication_slots')).rows[0].count).toBe('0');
  });
  it.each(['before','after'] as const)('SIGKILL %s request COMMIT preserves one terminal handoff', async point => {
    await x.start(); const node = await x.node();
    const body: CommandEnvelope = { schema_version: 1, request_id: randomUUID(), scope_id: x.f.task,
      name: 'request_replan', expected_control_version: node.dispatch.control_version, payload: { reason: 'Replace insufficient formal work definition' } };
    const before = await snapshot(), w = worker(); await w.next('ready');
    w.send({ phase: 'agent', instance: x.service.instanceId, token: node.credential, body, crash: point }); await w.exited;
    expect(w.child.signalCode, JSON.stringify(w.messages)).toBe('SIGKILL');
    expect(w.messages.filter(m => ['error','unexpected-survival'].includes(m.type))).toEqual([]);
    if (point === 'before') expect(await snapshot()).toEqual(before);
    const result = await x.service.admit(node.credential, submission(body)), frozen = await snapshot();
    expect(await x.service.admit(node.credential, submission(body))).toEqual(result); expect(await snapshot()).toEqual(frozen);
    expect((await x.db.pool.query('SELECT count(*) FROM replan_requests')).rows[0].count).toBe('1');
    expect((await x.db.pool.query("SELECT count(*) FROM operations WHERE attempt_id=$1 AND kind='stop'", [node.dispatch.attempt_id])).rows[0].count).toBe('1');
    await expect(x.agent(node,'complete_node',{summary:'Competing terminal completion'})).rejects.toMatchObject({detail:{code:'stale_execution'}});
    await x.finish(result.operation_id!,node.dispatch.attempt_id);
    await x.replan.pump(); expect((await x.db.pool.query('SELECT count(*) FROM replan_sources')).rows[0].count).toBe('1');
  });
  it.each(['before','after'] as const)('SIGKILL %s terminal prepare COMMIT retains proposal and cleanup together', async point => {
    const request = await x.request(); await x.replan.pump(); const turn = await x.promote();
    const task = (await x.db.pool.query('SELECT * FROM tasks')).rows[0];
    const definition = (await x.db.pool.query('SELECT definition FROM plan_nodes WHERE plan_id=$1',[x.f.plan])).rows[0].definition;
    const target = randomUUID(); const impact = replacementImpact(await transaction(x.db,tx=>replanImpact(tx,task)),target);
    const body: CommandEnvelope = {schema_version:1,request_id:randomUUID(),scope_id:x.f.task,expected_control_version:turn.dispatch.control_version,name:'prepare_replan',payload:{
      replan_request_id:request,source_id:turn.dispatch.task_replan_source!.source_id,proposal_id:randomUUID(),plan_id:randomUUID(),
      basis:await x.basis(),nodes:[{...definition,node_id:target,goal:'New formal work'}],summary:'Complete graph',impact }};
    const before=await snapshot(),w=worker();await w.next('ready');w.send({phase:'agent',instance:x.service.instanceId,token:turn.credential,body,crash:point});await w.exited;
    expect(w.child.signalCode,JSON.stringify(w.messages)).toBe('SIGKILL');expect(w.messages.filter(m=>['error','unexpected-survival'].includes(m.type))).toEqual([]);
    if(point==='before')expect(await snapshot()).toEqual(before);
    const result=await x.service.admit(turn.credential,submission(body)),frozen=await snapshot();expect(await x.service.admit(turn.credential,submission(body))).toEqual(result);expect(await snapshot()).toEqual(frozen);
    expect((await x.db.pool.query('SELECT count(*) FROM replan_proposals')).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1',[turn.dispatch.attempt_id])).rows[0]).toEqual({mutation_allowed:false,process_released:false});
    await x.finish(result.operation_id!,turn.dispatch.attempt_id);
  });
  it.each(['before','after'] as const)('SIGKILL %s dismissal COMMIT preserves decision and request-bound Stop', async point => {
    const request=await x.request();await x.replan.pump();const turn=await x.promote();
    const r=(await x.db.pool.query('SELECT * FROM replan_requests WHERE id=$1',[request])).rows[0];
    const body={schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'dismiss_replan',payload:{replan_request_id:request,expected_version:Number(r.version),direction:'Current graph is sufficient'}};
    const before=await snapshot(),w=worker();await w.next('ready');w.send({phase:'owner',token:x.token,body,crash:point});await w.exited;
    expect(w.child.signalCode,JSON.stringify(w.messages)).toBe('SIGKILL');expect(w.messages.filter(m=>['error','unexpected-survival'].includes(m.type))).toEqual([]);
    if(point==='before')expect(await snapshot()).toEqual(before);
    const result=await x.replan.command(x.token,body),frozen=await snapshot();expect(await x.replan.command(x.token,body)).toEqual(result);expect(await snapshot()).toEqual(frozen);
    expect((await x.db.pool.query('SELECT status FROM replan_requests WHERE id=$1',[request])).rows[0].status).toBe('dismissed');
    await expect(x.agent(turn,'raise_planning_issue',{replan_request_id:request,source_id:turn.dispatch.task_replan_source!.source_id,reason:'Late issue'})).rejects.toMatchObject({detail:{code:'stale_execution'}});
    expect((await x.db.pool.query('SELECT process_released FROM attempts WHERE id=$1',[turn.dispatch.attempt_id])).rows[0].process_released).toBe(false);
    await x.finish(result.operation_id!,turn.dispatch.attempt_id);await x.replan.pump();
    expect((await x.db.pool.query('SELECT plan_id FROM tasks')).rows[0].plan_id).toBe(x.f.plan);
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('0');
  });
  it('distinct blocked Node request and completion workers commit only one terminal outcome', async () => {
    await x.start();const node=await x.node();
    const commands:CommandEnvelope[]=[{schema_version:1,request_id:randomUUID(),scope_id:x.f.task,expected_control_version:node.dispatch.control_version,name:'request_replan',payload:{reason:'The work graph is insufficient'}},
      {schema_version:1,request_id:randomUUID(),scope_id:x.f.task,expected_control_version:node.dispatch.control_version,name:'complete_node',payload:{summary:'Competing completion'}}];
    const holder=await x.db.pool.connect();await holder.query('BEGIN');await holder.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[x.f.task]);
    const holderPid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;const group=commands.map(()=>worker());
    try{
      const ready=await Promise.all(group.map(w=>w.next('ready'))),pids=ready.map(r=>r.pid!);expect(new Set(pids).size).toBe(2);expect(new Set(group.map(w=>w.child.pid)).size).toBe(2);
      group.forEach((w,i)=>w.send({phase:'agent',instance:x.service.instanceId,token:node.credential,body:commands[i]}));
      let waiting:{pid:number;blockers:number[]}[]=[];
      for(let i=0;i<500;i++){waiting=(await x.admin.pool.query("SELECT pid,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[pids])).rows;if(waiting.length===2&&waiting.every(r=>r.blockers.length))break;await delay(10);}
      expect(waiting).toHaveLength(2);expect(waiting.some(r=>r.blockers.includes(holderPid))).toBe(true);await holder.query('COMMIT');
      const done=await Promise.all(group.map(w=>w.next('done','error')));expect(done.filter(r=>r.type==='done')).toHaveLength(1);expect(done.filter(r=>r.type==='error')).toHaveLength(1);expect(done.find(r=>r.type==='error')!.code).toBe('stale_execution');
      const receipts=(await x.db.pool.query("SELECT * FROM command_receipts WHERE attempt_id=$1 AND command_name IN ('request_replan','complete_node')",[node.dispatch.attempt_id])).rows;expect(receipts).toHaveLength(1);
      const requests=(await x.db.pool.query('SELECT * FROM replan_requests')).rows;expect(requests).toHaveLength(receipts[0].command_name==='request_replan'?1:0);
      const frozen=await snapshot();expect(await x.service.admit(node.credential,submission(commands[done.findIndex(r=>r.type==='done')]!))).toEqual(receipts[0].response);expect(await snapshot()).toEqual(frozen);
      await x.finish(receipts[0].operation_id,node.dispatch.attempt_id);
    }finally{await holder.query('ROLLBACK');holder.release();}
  });
  it('distinct blocked publication and dismissal processes cannot both win', async () => {
    const { p, body } = await prepared();
    const r = (await x.db.pool.query('SELECT * FROM replan_requests')).rows[0];
    const commands = [body, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'dismiss_replan', payload: { replan_request_id: r.id, expected_version: Number(r.version), direction: 'Retain the current graph' } }];
    const tokens = await Promise.all(commands.map(() => issueOwnerSession(x.db)));
    const holder = await x.db.pool.connect(); await holder.query('BEGIN');
    await holder.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
    const holderPid = (await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const group = commands.map(() => worker());
    try {
      const ready = await Promise.all(group.map(w => w.next('ready'))), pids = ready.map(r => r.pid!);
      expect(new Set(pids).size).toBe(2); expect(new Set(group.map(w => w.child.pid)).size).toBe(2);
      group.forEach((w,i) => w.send({ token: tokens[i]!.token, body: commands[i] }));
      let waiting: { pid: number; blockers: number[] }[] = [];
      for (let i=0;i<500;i++) { waiting = (await x.admin.pool.query("SELECT pid,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])).rows; if (waiting.length===2 && waiting.every(r => r.blockers.length)) break; await delay(10); }
      expect(waiting).toHaveLength(2); expect(waiting.some(r => r.blockers.includes(holderPid))).toBe(true);
      await holder.query('COMMIT');
      const done = await Promise.all(group.map(w => w.next('done','error')));
      expect(done.filter(r => r.type==='done')).toHaveLength(1); expect(done.filter(r => r.type==='error')).toHaveLength(1);
      expect(['version_conflict','unmet_precondition']).toContain(done.find(r => r.type==='error')!.code);
      const current = (await x.db.pool.query('SELECT * FROM replan_requests')).rows[0];
      const pubs = (await x.db.pool.query('SELECT * FROM replan_publications')).rows;
      expect(pubs).toHaveLength(current.status==='published'?1:0);
      expect((await x.db.pool.query('SELECT plan_id FROM tasks')).rows[0].plan_id).toBe(current.status==='published'?p.payload.plan_id:x.f.plan);
      expect((await x.db.pool.query('SELECT count(*) FROM task_publication_slots')).rows[0].count).toBe('0');
    } finally { await holder.query('ROLLBACK'); holder.release(); }
  });
});
