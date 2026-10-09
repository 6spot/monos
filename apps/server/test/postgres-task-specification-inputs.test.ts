import {initializeTask} from '../src/task-records.ts';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {conversationFixture} from './fixtures/task-conversation-fixture.ts';
import {TaskSpecification} from '../src/task-specification.ts';
import {transaction} from '../../../packages/db/src/index.ts';
import {specificationImpact} from '../src/task-specification-state.ts';
import {validate,canonicalJSON,digest} from '../../../packages/protocol/src/index.ts';
import type {RequirementProposalDetail,TaskSpecificationStatus,RequirementHistoryPage,SpecificationRevisionPage} from '../../../packages/protocol/src/index.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE!=='1')('Specification inputs and history',{timeout:30000},()=>{
 let x:Awaited<ReturnType<typeof conversationFixture>>,spec:TaskSpecification;
 beforeEach(async()=>{x=await conversationFixture();spec=new TaskSpecification(x.db);},30000);afterEach(async()=>{await x?.close();},30000);
 const command=async(name:string,payload:object)=>spec.command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name,payload});
 const impact=async()=>transaction(x.db,async tx=>specificationImpact(tx,(await tx.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0]));
 async function propose(supersedes?:string){const input=await x.send('Full revised request'),turn=await x.turn(),id=randomUUID(),basis=await x.basis();const prepared=await x.agent(turn,'prepare_specification_revision',{proposal_id:id,specification:'Exact full revision',summary:'Exact revised proposal',impact:await impact(),basis,source_input_ids:[input.input_id!],...(supersedes?{supersedes}:{})});const reply=await x.reply(turn,{kind:'specification_proposal',proposal_id:id,basis});await x.finish(reply.operation_id!,turn.dispatch.attempt_id);return {id,prepared};}
 it('replacement retains one originating obligation and revokes old confirmation eligibility',async()=>{const old=await propose(),oldAuth=await command('confirm_specification',{proposal_id:old.id,content_digest:old.prepared.result!.content_digest}),next=await propose(old.id);expect((await x.db.pool.query('SELECT count(*) FROM requirement_obligations')).rows[0].count).toBe('1');await expect(command('apply_specification_revision',{proposal_id:old.id,confirmation_id:oldAuth.confirmation_id,basis:await x.basis()})).rejects.toMatchObject({detail:{code:'unmet_precondition'}});const auth=await command('confirm_specification',{proposal_id:next.id,content_digest:next.prepared.result!.content_digest});await command('apply_specification_revision',{proposal_id:next.id,confirmation_id:auth.confirmation_id,basis:await x.basis()});expect((await x.db.pool.query('SELECT status,current_proposal_id FROM requirement_obligations')).rows[0]).toEqual({status:'published',current_proposal_id:next.id});expect((await x.db.pool.query('SELECT count(*) FROM requirement_proposals')).rows[0].count).toBe('2');});
 it('Agent apply requires exact Owner deferral for its own later pending input and still must reply',async()=>{const p=await propose(),auth=await command('confirm_specification',{proposal_id:p.id,content_digest:p.prepared.result!.content_digest}),input=await x.send('Use the exact confirmation'),turn=await x.turn();const payload={proposal_id:p.id,confirmation_id:auth.confirmation_id!,basis:await x.basis()};await expect(x.agent(turn,'apply_specification_revision',payload)).rejects.toMatchObject({detail:{code:'unmet_precondition'}});await command('defer_specification_inputs',{proposal_id:p.id,inputs:[{input_id:input.input_id,version:1}]});const applied=await x.agent(turn,'apply_specification_revision',payload);expect(applied.result!.requirement_operation_id).toBeTruthy();expect((await x.db.pool.query('SELECT status FROM task_inputs WHERE id=$1',[input.input_id])).rows[0].status).toBe('pending');const reply=await x.reply(turn);await x.finish(reply.operation_id!,turn.dispatch.attempt_id);await spec.pump();expect((await x.db.pool.query('SELECT status FROM requirement_changes')).rows[0].status).toBe('published');});
 it('typed status/detail/history preserve full content, exact authorizations and current context',async()=>{const p=await propose();const status=validate<TaskSpecificationStatus>('TaskSpecificationStatus',await spec.status(x.token,x.f.task));expect(status.proposals[0]?.version).toBe(2);expect(status.proposals[0]?.current).toBe(true);const detail=validate<RequirementProposalDetail>('RequirementProposalDetail',await spec.status(x.token,x.f.task,p.id));expect(detail.specification).toBe('Exact full revision');expect(detail.input_cutoff).toBeGreaterThan(0);expect(detail.source_input_ids).toHaveLength(1);await x.send('What changed?');const turn=await x.turn(),context=await x.agent(turn,'read_task_context',{});const snapshot=JSON.parse(context.result!.task_context!.snapshot);expect(snapshot.requirement_changes[0].specification).toBe(detail.specification);const reply=await x.reply(turn);await x.finish(reply.operation_id!,turn.dispatch.attempt_id);const history=validate<RequirementHistoryPage>('RequirementHistoryPage',await spec.history(x.token,x.f.task,'proposals'));expect(history.proposals.map(p=>p.proposal_id)).toEqual([p.id]);const auth=await command('confirm_specification',{proposal_id:p.id,content_digest:p.prepared.result!.content_digest});await command('apply_specification_revision',{proposal_id:p.id,confirmation_id:auth.confirmation_id,basis:await x.basis()});const revisions=validate<SpecificationRevisionPage>('SpecificationRevisionPage',await spec.history(x.token,x.f.task,'revisions'));expect(revisions.revisions).toHaveLength(2);const current=revisions.revisions.find(r=>r.change_id)!;const full=validate('SpecificationRevisionDetail',await spec.history(x.token,x.f.task,'revisions',undefined,current.specification_id));expect(full).toHaveProperty('content_json',JSON.stringify(detail.specification));});
 it('Cancel during settlement preserves physical cleanup and cannot publish later',async()=>{await x.start();const n=await x.node();const change=await command('edit_specification',{proposal_id:randomUUID(),specification:'Revised',summary:'Revised',basis:await x.basis(),impact:await impact(),source_input_ids:[]});await x.owner('cancel_task',{specification_id:x.f.spec,plan_id:x.f.plan});const effect=(await x.db.pool.query('SELECT operation_id FROM requirement_change_effects WHERE change_id=$1',[change.operation_id])).rows[0];await x.finish(effect.operation_id,n.dispatch.attempt_id);await spec.pump();expect((await x.db.pool.query('SELECT state,specification_id FROM tasks')).rows[0]).toEqual({state:'CANCELLED',specification_id:x.f.spec});expect((await x.db.pool.query('SELECT status FROM requirement_changes')).rows[0].status).toBe('cancelled');});

 it('progress reply during settlement preserves the change and bypasses its observed publication-slot lock', async () => {
  await x.start();
  const node = await x.node();
  await x.service.event(x.f.runner, x.f.incarnation, {
   attempt_id: node.dispatch.attempt_id, dispatch_id: node.dispatch.dispatch_id,
   stream_id: 'lifecycle', sequence: 1, order_sequence: 1,
   boot_id: 'settling-progress-test', kind: 'started', text: '',
  });
  const proposalId = randomUUID();
  const change = await command('edit_specification', {
   proposal_id: proposalId, specification: 'Revised while the original writer settles',
   summary: 'Exact pending change', basis: await x.basis(), impact: await impact(), source_input_ids: [],
  });
  const facts = async () => (await x.db.pool.query(`SELECT
   (SELECT jsonb_build_object('state',state,'control_version',control_version,
    'specification_id',specification_id,'plan_id',plan_id) FROM tasks WHERE id=$1) task,
   (SELECT to_jsonb(c)-'last_checked_at' FROM requirement_changes c WHERE id=$2) change,
   (SELECT to_jsonb(s) FROM task_publication_slots s WHERE task_id=$1) slot,
   (SELECT to_jsonb(n) FROM nodes n WHERE id=$3) node,
   (SELECT to_jsonb(a) FROM attempts a WHERE id=$4) writer,
   (SELECT jsonb_agg(e ORDER BY operation_id) FROM requirement_change_effects e WHERE change_id=$2) effects,
   (SELECT jsonb_agg(o ORDER BY id) FROM operations o WHERE attempt_id=$4) operations,
   (SELECT jsonb_agg(s ORDER BY id) FROM specification_revisions s WHERE task_id=$1) specifications,
   (SELECT jsonb_agg(p ORDER BY id) FROM plan_revisions p WHERE task_id=$1) plans,
   (SELECT to_jsonb(p) FROM requirement_proposals p WHERE id=$5) proposal,
   (SELECT to_jsonb(o) FROM requirement_obligations o WHERE current_proposal_id=$5) obligation,
   (SELECT to_jsonb(a) FROM authorization_receipts a WHERE proposal_id=$5) authorization,
   (SELECT count(*) FROM requirement_publications WHERE task_id=$1) publications`,
   [x.f.task, change.operation_id, x.f.node, node.dispatch.attempt_id, proposalId])).rows[0];
  const before = await facts();
  expect(before.task).toMatchObject({ state: 'RUNNING', specification_id: x.f.spec, plan_id: x.f.plan });
  expect(before.change).toMatchObject({ id: change.operation_id, status: 'settling', attention: 'waiting_for_physical_settlement' });
  expect(before.slot).toMatchObject({ task_id: x.f.task, operation_id: change.operation_id });
  expect(before.writer).toMatchObject({ started: true, mutation_allowed: false, process_absent: false, process_released: false });
  expect(before.publications).toBe('0');

  const holder = await x.db.pool.connect();
  const waiter = await x.db.pool.connect();
  let waitingQuery: Promise<unknown> | undefined;
  try {
   await holder.query('BEGIN');
   await waiter.query('BEGIN');
   const holderPid = (await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const waiterPid = (await waiter.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   expect(holderPid).not.toBe(waiterPid);
   await holder.query('SELECT task_id FROM task_publication_slots WHERE task_id=$1 FOR UPDATE', [x.f.task]);
   // Observe an actual contender on this exact slot; elapsed time is not lock evidence.
   waitingQuery = waiter.query('SELECT task_id FROM task_publication_slots WHERE task_id=$1 FOR UPDATE', [x.f.task])
    .then(result => ({ result }), error => ({ error }));
   const waiting = async () => (await x.admin.pool.query(
    "SELECT wait_event_type,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1", [waiterPid],
   )).rows[0];
   let observed;
   for (let i = 0; i < 500; i++) {
    observed = await waiting();
    if (observed.wait_event_type === 'Lock' && observed.blockers.includes(holderPid)) break;
    await delay(10);
   }
   expect(observed).toMatchObject({ wait_event_type: 'Lock', blockers: [holderPid] });

   const input = await x.send('What is happening while the requirement change settles?');
   const turn = await x.turn();
   const sourceId = turn.dispatch.task_conversation_source!.source_id;
   const source = (await x.db.pool.query('SELECT context FROM task_conversation_outbox WHERE id=$1', [sourceId])).rows[0];
   const observation = source.context.observation;
   expect(observation.basis).toEqual({
    control_version: before.task.control_version, specification_id: x.f.spec, plan_id: x.f.plan,
   });
   expect(JSON.parse(observation.snapshot).requirement_changes).toEqual([
    expect.objectContaining({
     current_proposal_id: proposalId, operation_id: change.operation_id, status: 'settling',
     specification: before.proposal.specification, content_digest: before.proposal.content_digest,
     operation_version: before.change.version, attention: 'waiting_for_physical_settlement',
    }),
   ]);
   const reply = await x.reply(turn);
   await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
   await spec.pump();
   await x.execution.pump();
   expect(await facts()).toEqual(before);
   expect(await waiting()).toMatchObject({ wait_event_type: 'Lock', blockers: [holderPid] });
   const messages = (await x.db.pool.query(`SELECT source_id,source_watermark,observed_control_version,observed_at
    FROM task_messages WHERE input_id=$1 AND author='assistant'`, [input.input_id])).rows;
   expect(messages).toHaveLength(1);
   expect(messages[0]).toMatchObject({
    source_id: sourceId, source_watermark: String(turn.dispatch.task_conversation_source!.source_watermark),
    observed_control_version: String(observation.basis.control_version),
   });
   expect(messages[0].observed_at.toISOString()).toBe(observation.observed_at);
   expect((await x.db.pool.query('SELECT disposition,routing,attempt_id FROM task_input_resolutions WHERE input_id=$1', [input.input_id])).rows).toEqual([
    { disposition: 'replied', routing: { kind: 'reply' }, attempt_id: turn.dispatch.attempt_id },
   ]);
   expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
   await holder.query('COMMIT');
   expect(await waitingQuery).toHaveProperty('result.rowCount', 1);
  } finally {
   await holder.query('ROLLBACK');
   await waitingQuery;
   await waiter.query('ROLLBACK');
   holder.release();
   waiter.release();
  }

  // Only the original trusted Stop result releases the writer and enables publication.
  await x.finish(before.effects[0].operation_id, node.dispatch.attempt_id);
  await spec.pump();
  const after = await facts();
  expect(after.change).toMatchObject({ id: change.operation_id, proposal_id: proposalId, status: 'published', authorization_id: before.authorization.id });
  expect(after.task).toMatchObject({ specification_id: before.change.specification_id, plan_id: x.f.plan, control_version: before.task.control_version + 1 });
  expect(after.writer).toMatchObject({ process_absent: true, process_released: true, mutation_allowed: false });
  expect(after.slot).toBeNull();
  expect(after.publications).toBe('1');
  expect(after.plans).toEqual(before.plans);
  expect(after.proposal).toEqual(before.proposal);
  expect(after.authorization).toEqual(before.authorization);
  expect(after.specifications).toHaveLength(2);
  expect(after.specifications).toContainEqual(expect.objectContaining({
   id: before.change.specification_id, parent_id: x.f.spec,
   content: before.proposal.specification, authorization_id: before.authorization.id,
  }));
 });

 it('pages all retained drafts and keeps active proposal visible beyond status limit',async()=>{const active=await propose();const task=(await x.db.pool.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0],basis={control_version:Number(task.control_version),specification_id:task.specification_id,plan_id:task.plan_id},assessment=await impact(),specification='Retained draft';const rows=Array.from({length:70},()=>{const id=randomUUID(),obligation=randomUUID(),envelope={task_id:task.id,proposal_id:id,specification,summary:'Draft',impact:assessment,basis,source_input_ids:[],input_cutoff:0,source_id:null,specification_digest:digest(canonicalJSON(specification)),impact_digest:digest(canonicalJSON(assessment))};return {id,obligation,envelope,hash:digest(canonicalJSON(envelope))};});await transaction(x.db,async tx=>{
 const data=JSON.stringify(rows);await tx.query("INSERT INTO requirement_obligations(id,task_id) SELECT value->>'obligation',$2 FROM jsonb_array_elements($1::jsonb)",[data,task.id]);
 await tx.query("INSERT INTO task_command_proposals(id,task_id,action,content,content_digest,basis,expires_at) SELECT value->>'id',$2,'apply_specification_revision',value->'envelope',value->>'hash',value->'envelope'->'basis',clock_timestamp()+interval '1 hour' FROM jsonb_array_elements($1::jsonb)",[data,task.id]);
 await tx.query("INSERT INTO requirement_proposals(id,task_id,obligation_id,specification,summary,impact,specification_digest,impact_digest,content_digest,base_specification_id,base_plan_id,base_control_version,input_cutoff) SELECT value->>'id',$2,value->>'obligation',value->'envelope'->>'specification','Draft',value->'envelope'->'impact',value->'envelope'->>'specification_digest',value->'envelope'->>'impact_digest',value->>'hash',$3,NULL,$4,0 FROM jsonb_array_elements($1::jsonb)",[data,task.id,task.specification_id,task.control_version]);});
 const status=validate<TaskSpecificationStatus>('TaskSpecificationStatus',await spec.status(x.token,x.f.task));expect(status.proposals_has_more).toBe(true);expect(status.proposals[0]?.proposal_id).toBe(active.id);const ids:string[]=[];let cursor:string|undefined;do{const page=validate<RequirementHistoryPage>('RequirementHistoryPage',await spec.history(x.token,x.f.task,'proposals',cursor));ids.push(...page.proposals.map(p=>p.proposal_id));cursor=page.next_cursor??undefined;}while(cursor);expect(ids).toHaveLength(71);expect(new Set(ids).size).toBe(71);
 });

 it('waiting change cannot starve a later Task or flap operation versions',async()=>{
  const pending=async(block:boolean)=>{await x.service.touch(x.f.runner,x.f.incarnation,true);const p=await propose(),auth=await command('confirm_specification',{proposal_id:p.id,content_digest:p.prepared.result!.content_digest}),input=await x.send('Apply exact proposal');const turn=await x.turn();await command('defer_specification_inputs',{proposal_id:p.id,inputs:[{input_id:input.input_id,version:1}]});const out=await x.agent(turn,'apply_specification_revision',{proposal_id:p.id,confirmation_id:auth.confirmation_id!,basis:await x.basis()});const reply=await x.reply(turn,block?{kind:'issue',text:'New unresolved requirement',basis:await x.basis()}:{kind:'reply'});await x.finish(reply.operation_id!,turn.dispatch.attempt_id);return out.result!.requirement_operation_id!;};
  const first=await pending(true);x.f.task=randomUUID();x.f.spec=randomUUID();await transaction(x.db,tx=>initializeTask(tx,{task_id:x.f.task,specification_id:x.f.spec,project_id:x.f.project,specification:'Other independent Task'}));const second=await pending(false);await spec.pump(1);const blocked=(await x.db.pool.query('SELECT status,version FROM requirement_changes WHERE id=$1',[first])).rows[0];expect(blocked.status).toBe('settling');await spec.pump(1);expect((await x.db.pool.query('SELECT status FROM requirement_changes WHERE id=$1',[second])).rows[0].status).toBe('published');await spec.pump(1);expect((await x.db.pool.query('SELECT version FROM requirement_changes WHERE id=$1',[first])).rows[0].version).toBe(blocked.version);
 },60000);
});
