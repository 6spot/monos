import {conversationFixture} from './fixtures/task-conversation-fixture.ts';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {database} from '../../../packages/db/src/index.ts';
import {migrate} from '../../../packages/db/src/migrate.ts';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {WebSocket} from 'ws';
import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {transaction} from '../../../packages/db/src/index.ts';
import {PublicationPreparation,ensureLocalCandidate} from '../src/publication-candidates.ts';
import {PublicationCandidateReads,knownPublicExposureCount} from '../src/publication-candidate-reads.ts';
import {PublicationCommands} from '../src/publication-commands.ts';
import {publicationDigest as hash} from '../src/publication-policy.ts';
import {createApp} from '../src/app.ts';
import {publicationFixture,publicationPages} from './fixtures/publication-fixture.ts';
import {initializeTask} from '../src/task-records.ts';
import {OwnerCommands} from '../src/owner-commands.ts';
import {TaskSpecification} from '../src/task-specification.ts';
import {specificationImpact} from '../src/task-specification-state.ts';
import {submission,canonicalJSON} from '../../../packages/protocol/src/index.ts';
import type {Frame,PublicationCommand,PublicationResultPage,CommandEnvelope} from '../../../packages/protocol/src/index.ts';
const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('Durable local publication',()=>{
 it('leaves unsupported discovery polls untouched and fences supported dispatch until the current Runner is Ready',async()=>{
  const x=await publicationFixture();try {
   const incarnation=await x.service.connect(x.f.runner,'publication-discovery-test');
   const before=(await x.db.pool.query('SELECT * FROM delivery_operations')).rows;
   expect(await x.preparation.pending(x.f.runner,incarnation,false)).toEqual([]);
   await expect(x.preparation.pending(x.f.runner,incarnation,true)).rejects.toMatchObject({detail:{code:'stale_execution'}});
   await x.service.touch(x.f.runner,incarnation,true);
   await expect(x.preparation.pending(x.f.runner,incarnation-1,true)).rejects.toMatchObject({detail:{code:'stale_execution'}});
   await expect(new PublicationPreparation(x.db,randomUUID()).pending(x.f.runner,incarnation,true)).rejects.toMatchObject({detail:{code:'stale_execution'}});
   expect((await x.db.pool.query('SELECT * FROM delivery_operations')).rows).toEqual(before);
   expect((await x.preparation.pending(x.f.runner,incarnation,true)).map(f=>f.publication_prepare)).toEqual([x.request]);
  }finally{await x.close();}
 });
 it('pins direct candidate authority while a real Owner carry publishes a new Specification',async()=>{
  const x=await publicationFixture(),blocker=await x.db.pool.connect();const pending:Promise<unknown>[]=[];
  try {
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);await x.preparation.finish(x.f.runner,x.f.incarnation,publicationPages(x.request,0)[0]!);
   const impact=await transaction(x.db,async tx=>specificationImpact(tx,(await tx.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0]));impact.nodes[0]!.disposition='carry';
   const command={schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'edit_specification',payload:{proposal_id:randomUUID(),specification:'Carried exact result under new requirements',summary:'Preserve the canonical completion',impact,basis:await x.basis(),source_input_ids:[]}};
   await blocker.query('BEGIN');await blocker.query('LOCK TABLE delivery_operations IN ACCESS EXCLUSIVE MODE');
   const reads=new PublicationCandidateReads(x.db),reading=reads.candidate(x.token,x.f.task,x.request.construction.candidate_id);pending.push(reading);
   await expect.poll(async()=>Number((await x.db.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE application_name='monos-boundary-probe' AND wait_event_type='Lock' AND query LIKE 'SELECT o.* FROM delivery_operations o JOIN publication_scans%'")).rows[0]!.n)).toBe(1);
   const changing=new TaskSpecification(x.db).command(x.token,command);pending.push(changing);
   await expect.poll(async()=>Number((await x.db.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE application_name='monos-boundary-probe' AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM tasks WHERE id=%FOR UPDATE'")).rows[0]!.n)).toBe(1);
   await blocker.query('COMMIT');
   expect(await reading).toMatchObject({current:true,scan_applicable:true,override_allowed:true,effective_basis:x.request.effective_basis});
   expect((await changing).status).toBe('admitted');
   const task=(await x.db.pool.query('SELECT state,specification_id FROM tasks WHERE id=$1',[x.f.task])).rows[0]!;
   expect(task.state).toBe('REVIEW');expect(task.specification_id).not.toBe(x.f.spec);
   expect(await reads.candidate(x.token,x.f.task,x.request.construction.candidate_id)).toMatchObject({current:false,scan_applicable:false,override_allowed:false});
  }finally{await blocker.query('ROLLBACK');blocker.release();await Promise.allSettled(pending);await x.close();}
 },30000);
 it('accepts a complete multi-rule same-blob page with distinct finding ordinals',async()=>{
  const x=await publicationFixture();try {
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const page=publicationPages(x.request,2)[0]!;
   page.findings=page.findings.map((f,i)=>{
    const facts={...f,kind:'credential_pattern' as const,rule_id:i===0?'github_classic_token' as const:'aws_access_key' as const,path:'same-blob.txt',blob:'e'.repeat(40),content_digest:'f'.repeat(64),occurrence_ordinal:i+1,message:'Credential pattern matched; value redacted.' as const};
    const safe={...facts};delete (safe as Partial<typeof safe>).finding_id;
    return {...facts,finding_id:hash({candidate_manifest_digest:page.result.candidate_manifest_digest,configuration_digest:x.request.configuration_digest,scan_run_id:x.request.scan_run_id,finding_facts_without_id:safe})};
   });
   const update=(p:PublicationResultPage)=>{p.page_digest=hash(p.findings);p.result.scan!.coverage.paths=1;p.result.scan!.coverage.versions=1;p.result.scan!.findings_bytes=Buffer.byteLength(canonicalJSON(p.findings));p.result.scan!.findings_digest=hash(p.findings);p.result.scan_digest=hash(p.result.scan);};update(page);
   const duplicate=structuredClone(page);duplicate.findings[1]!.occurrence_ordinal=1;const {finding_id:ignored,...facts}=duplicate.findings[1]!;void ignored;
   duplicate.findings[1]!.finding_id=hash({candidate_manifest_digest:duplicate.result.candidate_manifest_digest,configuration_digest:x.request.configuration_digest,scan_run_id:x.request.scan_run_id,finding_facts_without_id:facts});update(duplicate);
   await expect(x.preparation.finish(x.f.runner,x.f.incarnation,duplicate)).rejects.toThrow('budget');expect((await x.db.pool.query('SELECT * FROM publication_result_pages')).rows).toHaveLength(0);
   expect((await x.preparation.finish(x.f.runner,x.f.incarnation,page))?.operation_id).toBe(x.deliveryOperationId);
   const findings=await new PublicationCandidateReads(x.db).findings(x.token,x.f.task,x.request.construction.candidate_id,{scan_digest:page.result.scan_digest});
   expect(findings.items).toEqual(page.findings);expect(findings.items.map(f=>f.occurrence_ordinal)).toEqual([1,2]);
   expect((await x.db.pool.query('SELECT summary FROM publication_scans')).rows[0]!.summary).toEqual(page.result.scan);
  }finally{await x.close();}
 });
 it('dispatches later due Tasks past two paused Planners and resumes the original paused operations',async()=>{
  const x=await publicationFixture();try {
   const tasks=[x.f.task];
   const admit=async(a:Awaited<ReturnType<typeof x.promote>>,task:string,name:CommandEnvelope['name'],payload:CommandEnvelope['payload'])=>x.service.admit(a.credential,submission({schema_version:1,request_id:randomUUID(),scope_id:task,expected_control_version:a.dispatch.control_version,name,payload}));
   // Three sibling Tasks complete through actual Planner/Node Tool operations on the same Runner.
   for(let i=0;i<3;i++) {
    const task=randomUUID(),spec=randomUUID(),plan=randomUUID(),nodeId=randomUUID();tasks.push(task);
    await transaction(x.db,tx=>initializeTask(tx,{task_id:task,specification_id:spec,project_id:x.f.project,specification:'Fair publication queue'}));
    const version=Number((await x.db.pool.query('SELECT control_version FROM tasks WHERE id=$1',[task])).rows[0]!.control_version);
    await new OwnerCommands(x.db).confirm(x.token,{schema_version:1,request_id:randomUUID(),scope_id:task,expected_control_version:version,name:'start_task',payload:{specification_id:spec}});
    await x.planning.pump();const planner=await x.promote();expect(planner.dispatch.task_id).toBe(task);
    const planned=await admit(planner,task,'publish_execution_plan',{planning_intent_id:planner.dispatch.task_planning_source!.intent_id,plan_id:plan,nodes:[{node_id:nodeId,role_id:x.f.role,goal:'Fair publication queue',dependencies:[]}]});
    await x.finish(planned.operation_id!,planner.dispatch.attempt_id);await x.execution.pump();const node=await x.promote();
    const opened=await admit(node,task,'open_workspace',{resource_id:x.resource}),open=await x.service.recoverOperation(x.f.runner,opened.operation_id!),w=open.workspace!;
    const metadata={generation:w.generation,storage_id:'fair-queue-storage-'+i,provider_metadata:{github:{repository_id:'42'}},lease_id:w.lease_id,repository_identity:w.resource.repository_identity,base_commit:'a'.repeat(40),target_branch:'main',target_commit:'a'.repeat(40),finalized_commit:'a'.repeat(40)};
    await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:open.operation_id,attempt_id:node.dispatch.attempt_id,success:true,result:{workspace_id:w.workspace_id,path:'/runner/private/worktree',instruction_files:[],workspace_metadata:metadata}});
    const done=await admit(node,task,'complete_node',{summary:'Exact fair queue result'});
    await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:done.operation_id!,attempt_id:node.dispatch.attempt_id,success:true,result:{writer_absent:true,workspace_id:w.workspace_id,workspace_metadata:{...metadata,finalized_commit:'b'.repeat(40)},git_commit:'b'.repeat(40),git_tree:'c'.repeat(40)}});
   }
   const original=(await x.db.pool.query<{id:string;task_id:string;request:unknown}>('SELECT id,task_id,request FROM delivery_operations ORDER BY created_at,id')).rows;
   expect(original.map(o=>o.task_id)).toEqual(tasks);
   const paused=[];
   for(const task of tasks.slice(0,2)) {
    await x.conversation.command(x.token,{schema_version:1,request_id:randomUUID(),task_id:task,name:'submit_task_message',payload:{message_id:randomUUID(),content:'Review this exact result'}});
    await x.conversation.pump();const planner=await x.promote();expect(planner.dispatch.task_id).toBe(task);paused.push({task,planner});
   }
   await x.service.touch(x.f.runner,x.f.incarnation,true);
   const frames=await x.preparation.pending(x.f.runner,x.f.incarnation,true);
   expect(frames.map(f=>f.publication_prepare!.operation_id)).toEqual(original.slice(2).map(o=>o.id));
   expect((await x.db.pool.query('SELECT count(*) n FROM delivery_operations WHERE task_id=ANY($1) AND sent_incarnation IS NULL AND dispatch_active',[tasks.slice(0,2)])).rows[0]!.n).toBe('2');
   for(const {task,planner} of paused) {
    const reply=await admit(planner,task,'commit_task_turn',{source_id:planner.dispatch.task_conversation_source!.source_id,input_id:planner.dispatch.task_conversation_source!.input_id,source_watermark:planner.dispatch.source_watermark,reply:'Reviewed',routing:{kind:'reply'}});
    await x.finish(reply.operation_id!,planner.dispatch.attempt_id);
   }
   // Advance only the mutable retry clock; authority is released by real settlement above.
   await x.db.pool.query("UPDATE delivery_operations SET next_attempt_at=clock_timestamp() WHERE task_id=ANY($1)",[tasks.slice(0,2)]);
   const resumed=await x.preparation.pending(x.f.runner,x.f.incarnation,true);
   expect(resumed.map(f=>f.publication_prepare)).toEqual(original.slice(0,2).map(o=>o.request));
   expect((await x.db.pool.query('SELECT count(*) n FROM delivery_operations')).rows[0]!.n).toBe('4');
  }finally{await x.close();}
 },30000);
 it('upgrades populated version 21 PostgreSQL to version 27 without changing prior checksums or Task revision history',async()=>{
  const url=new URL(process.env.DATABASE_URL!),admin=database(url.toString()),namespace='publication_upgrade_'+randomUUID().replaceAll('-','');
  await admin.pool.query(`CREATE SCHEMA ${namespace}`);url.searchParams.set('options',`-c search_path=${namespace}`);const db=database(url.toString());
  try {
   await db.pool.query('CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
   const directory=new URL('../../../packages/db/migrations/',import.meta.url),names=(await readdir(directory)).filter(n=>/^00(?:0[1-9]|1[0-9]|2[01])_.*\.sql$/.test(n)).sort();
   expect(names).toHaveLength(21);
   await transaction(db,async tx=>{for(const [i,name] of names.entries()){const sql=await readFile(new URL(name,directory),'utf8');await tx.query(sql);await tx.query('INSERT INTO schema_migrations VALUES($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);}});
   await transaction(db,tx=>initializeTask(tx,{task_id:randomUUID(),specification_id:randomUUID(),specification:'Retained pre-delivery Task'}));
   const versions=(await db.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
   const tasks=(await db.pool.query('SELECT * FROM tasks')).rows,revisions=(await db.pool.query('SELECT * FROM specification_revisions')).rows;
   await migrate(db);await migrate(db);expect((await db.pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')).rows[0]!.version).toBe(27);
   expect((await db.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows.slice(0,21)).toEqual(versions);
   expect((await db.pool.query('SELECT * FROM tasks')).rows).toEqual(tasks.map(task => ({ ...task, rework_epoch: '1' })));expect((await db.pool.query('SELECT * FROM specification_revisions')).rows).toEqual(revisions);
   expect((await db.pool.query('SELECT * FROM delivery_operations')).rows).toEqual([]);
  }finally{await db.pool.end();await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`);await admin.pool.end();}
 },30000);
 it('creates no delivery operation for a genuine repository-free completion; both resource modes keep identical local work',async()=>{
  const free=await conversationFixture();try {
   await free.start();const node=await free.node(),done=await free.agent(node,'complete_node',{summary:'Repository-free result'});
   await free.service.finishOperation(free.f.runner,free.f.incarnation,{operation_id:done.operation_id!,attempt_id:node.dispatch.attempt_id,success:true,result:{writer_absent:true}});
   await new PublicationPreparation(free.db,free.service.instanceId).pump();expect((await free.db.pool.query('SELECT * FROM delivery_operations')).rows).toEqual([]);expect((await free.db.pool.query('SELECT * FROM delivery_items')).rows).toEqual([]);
  }finally{await free.close();}
  const x=await publicationFixture();try {
   const before=(await x.db.pool.query('SELECT * FROM delivery_operations')).rows;
   expect((await new PublicationCandidateReads(x.db).list(x.token,x.f.task,{})).items[0]!.remote_preparation).toBe('after_acceptance');
   await x.db.pool.query("UPDATE project_resources SET settings=jsonb_set(settings,'{remote_preparation}','\"automatic\"') WHERE id=$1",[x.resource]);await x.preparation.pump();
   expect((await x.db.pool.query('SELECT * FROM delivery_operations')).rows).toEqual(before);expect((await new PublicationCandidateReads(x.db).list(x.token,x.f.task,{})).items[0]!.remote_preparation).toBe('automatic');
  }finally{await x.close();}
 });
 it('admits after actual completion, proves original parent, serializes competing workers and rollback/restart',async()=>{
  const x=await publicationFixture();try {
   expect(x.request.construction.parents[0]!.observation_operation_id).toBe(x.descriptor.open_operation_id);
   expect(x.request.construction.parents[0]!.workspace!.basis).toBeUndefined();
   expect((await x.db.pool.query('SELECT * FROM delivery_items')).rows).toHaveLength(0);
   const before=(await x.db.pool.query('SELECT count(*) n FROM attempts')).rows[0]!.n;
   // Relevant permission fingerprint change creates another scan, preserving construction.
   await x.db.pool.query("UPDATE project_resources SET settings=jsonb_set(settings,'{provider_repo_id}','\"42\"') WHERE id=$1",[x.resource]);
   const first=await x.db.pool.connect();await first.query('BEGIN');await first.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[x.f.task]);
   const second=new PublicationPreparation(x.db,x.service.instanceId).pump();
   await expect.poll(async()=>Number((await x.db.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE application_name='monos-boundary-probe' AND wait_event_type='Lock' AND query LIKE '%tasks%FOR UPDATE%'")).rows[0]!.n)).toBeGreaterThan(0);
   const id=await ensureLocalCandidate(first,x.f.task);await first.query('COMMIT');first.release();await second;
   expect((await x.db.pool.query('SELECT * FROM delivery_operations')).rows).toHaveLength(2);
   const current=(await x.db.pool.query('SELECT request FROM delivery_operations WHERE id=$1',[id])).rows[0]!.request;
   expect(current.construction).toEqual(x.request.construction);
   await expect(transaction(x.db,async tx=>{await tx.query("UPDATE project_resources SET settings=jsonb_set(settings,'{provider_repo_id}','\"43\"') WHERE id=$1",[x.resource]);await ensureLocalCandidate(tx,x.f.task);throw new Error('rollback');})).rejects.toThrow('rollback');
   await new PublicationPreparation(x.db,x.service.instanceId).pump();
   expect((await x.db.pool.query('SELECT count(*) n FROM delivery_operations')).rows[0]!.n).toBe('2');
   expect((await x.db.pool.query('SELECT count(*) n FROM attempts')).rows[0]!.n).toBe(before);
  }finally{await x.close();}
 },30000);
 it('persists out-of-order pages without early ack, rejects corruption and recovers exact ack after reconnect',async()=>{
  const x=await publicationFixture();try {
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const pages=publicationPages(x.request,65);
   expect(await x.preparation.finish(x.f.runner,x.f.incarnation,pages[1]!)).toBeUndefined();
   expect((await x.db.pool.query('SELECT * FROM publication_candidates')).rows).toHaveLength(0);
   const restart=new PublicationPreparation(x.db,x.service.instanceId);
   await expect(restart.finish(x.f.runner,x.f.incarnation,{...pages[0]!,result:{...pages[0]!.result,request_digest:'f'.repeat(64)}})).rejects.toThrow();
   const ack=await restart.finish(x.f.runner,x.f.incarnation,pages[0]!);expect(ack?.operation_id).toBe(x.deliveryOperationId);
   expect((await x.db.pool.query('SELECT * FROM publication_findings')).rows).toHaveLength(65);
   expect(await restart.finish(x.f.runner,x.f.incarnation,pages[0]!)).toEqual(ack);
   const inc=await x.service.connect(x.f.runner,'publication-reconnect');await x.service.touch(x.f.runner,inc,true);
   expect(await restart.finish(x.f.runner,inc,pages[1]!)).toEqual(ack);
   await expect(restart.finish(x.f.runner,x.f.incarnation,pages[0]!)).rejects.toThrow();
   await expect(x.db.pool.query("UPDATE publication_scans SET summary='{}'")).rejects.toThrow('immutable');
   const reads=new PublicationCandidateReads(x.db),first=await reads.findings(x.token,x.f.task,x.request.construction.candidate_id,{scan_digest:pages[0]!.result.scan_digest});
   expect(first.items).toHaveLength(64);expect(first.next_cursor).toBeTruthy();
   expect((await reads.findings(x.token,x.f.task,x.request.construction.candidate_id,{scan_digest:pages[0]!.result.scan_digest,cursor:first.next_cursor})).items).toHaveLength(1);
   await expect(reads.findings(x.token,x.f.task,x.request.construction.candidate_id,{scan_digest:'f'.repeat(64),cursor:first.next_cursor})).rejects.toThrow();
  }finally{await x.close();}
 },30000);
 it('retains immutable incomplete scans; exact Retry creates new run with same candidate and frozen dates',async()=>{
  const x=await publicationFixture();try{
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const page=publicationPages(x.request,0,'incomplete')[0]!;await x.preparation.finish(x.f.runner,x.f.incarnation,page);
   const commands=new PublicationCommands(x.db),cmd:PublicationCommand={schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'retry_publication_preparation',payload:{operation_id:x.deliveryOperationId,operation_digest:hash(x.request)}};
   const retry=await commands.command(x.token,cmd);expect(retry.operation_id).not.toBe(x.deliveryOperationId);expect(await commands.command(x.token,cmd)).toEqual(retry);
   const next=(await x.db.pool.query('SELECT request FROM delivery_operations WHERE id=$1',[retry.operation_id])).rows[0]!.request;
   expect(next.construction).toEqual(x.request.construction);expect(next.scan_run_id).not.toBe(x.request.scan_run_id);
   expect((await x.db.pool.query('SELECT summary FROM publication_scans')).rows[0]!.summary).toEqual(page.result.scan);
   await expect(commands.command(x.token,{...cmd,payload:{...cmd.payload,operation_digest:'f'.repeat(64)}})).rejects.toThrow();
   await x.preparation.pump();expect((await x.db.pool.query('SELECT * FROM delivery_operations')).rows).toHaveLength(2);
  }finally{await x.close();}
 });
 it('requires actual exact eligible Owner confirmation, rejects mixed hard selection atomically, preserves replay after Cancel',async()=>{
  const x=await publicationFixture();try{
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const page=publicationPages(x.request,2,'complete',true)[0]!;await x.preparation.finish(x.f.runner,x.f.incarnation,page);
   const commands=new PublicationCommands(x.db),base={candidate_id:x.request.construction.candidate_id,candidate_manifest_digest:page.result.candidate_manifest_digest!,effective_basis_digest:x.request.effective_basis_digest,scan_digest:page.result.scan_digest!};
   const invoke=(name:PublicationCommand['name'],payload:PublicationCommand['payload'])=>commands.command(x.token,{schema_version:1,task_id:x.f.task,request_id:randomUUID(),name,payload});
   await expect(invoke('prepare_publication_override',{...base,finding_ids:page.findings.map(f=>f.finding_id).sort() as [string,...string[]]})).rejects.toThrow();
   expect((await x.db.pool.query('SELECT * FROM publication_override_receipts')).rows).toHaveLength(0);
   const exact={...base,finding_ids:[page.findings[0]!.finding_id] as [string,...string[]]},proposal=await invoke('prepare_publication_override',exact);
   const confirmed=await invoke('confirm_publication_override',{proposal_id:proposal.proposal_id!,content_digest:proposal.content_digest!});
   const cmd:PublicationCommand={schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'override_publication_findings',payload:{...exact,confirmation_id:confirmed.confirmation_id!}};
   const applied=await commands.command(x.token,cmd);expect(applied.receipt_id).toBeTruthy();
   await x.db.pool.query("UPDATE tasks SET state='CANCELLED' WHERE id=$1",[x.f.task]);expect(await commands.command(x.token,cmd)).toEqual(applied);
   await expect(invoke('prepare_publication_override',exact)).rejects.toThrow();
   expect((await new PublicationCandidateReads(x.db).candidate(x.token,x.f.task,base.candidate_id)).current).toBe(false);
   expect((await x.db.pool.query('SELECT accepted_delivery_operation_id,accepted_delivery_input_cutoff FROM tasks')).rows[0]!).toEqual({accepted_delivery_operation_id:null,accepted_delivery_input_cutoff:null});
   expect((await x.db.pool.query('SELECT * FROM publication_override_receipts')).rows).toHaveLength(1);
  }finally{await x.close();}
 });
 it('carries known public exposure through a later clean scan and isolates Task/resource/repository scopes',async()=>{
  const x=await publicationFixture();try {
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const first=publicationPages(x.request,1)[0]!;
   const facts={...first.findings[0]!,kind:'published_credential' as const,rule_id:'github_classic_token' as const,override_eligible:false,message:'Previously published credential exposure requires remediation.' as const,baseline_commit:x.request.source.base_commit,baseline_path:'original.txt',baseline_path_redacted:false,blob:'e'.repeat(40),content_digest:'f'.repeat(64)};
   const safe={...facts};delete (safe as Partial<typeof safe>).finding_id;facts.finding_id=hash({candidate_manifest_digest:first.result.candidate_manifest_digest,configuration_digest:x.request.configuration_digest,scan_run_id:x.request.scan_run_id,finding_facts_without_id:safe});first.findings=[facts];first.page_digest=hash(first.findings);
   first.result.scan!.findings_digest=hash(first.findings);first.result.scan!.findings_bytes=Buffer.byteLength((await import('../../../packages/protocol/src/index.ts')).canonicalJSON(first.findings));first.result.scan_digest=hash(first.result.scan);
   await x.preparation.finish(x.f.runner,x.f.incarnation,first);
   // Relevant config authorizes a new scan over the identical immutable candidate.
   await x.db.pool.query("UPDATE project_resources SET settings=jsonb_set(settings,'{provider_repo_id}','\"42\"') WHERE id=$1",[x.resource]);await x.preparation.pump();
   const next=(await x.db.pool.query('SELECT request FROM delivery_operations ORDER BY created_at DESC,id DESC LIMIT 1')).rows[0]!.request;
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const clean=publicationPages(next,0)[0]!;await x.preparation.finish(x.f.runner,x.f.incarnation,clean);
   const current=await new PublicationCandidateReads(x.db).candidate(x.token,x.f.task,x.request.construction.candidate_id);expect(current.scan!.findings_count).toBe(0);expect(current.known_public_exposure_count).toBe(1);
   // Genuine command-admitted later source completion creates a distinct candidate,
   // whose synthetic clean physical scan cannot erase already recorded exposure.
   await x.send('Delete exposed content in a new exact result');await x.service.touch(x.f.runner,x.f.incarnation,true);
   const planner=await x.turn(),reply=await x.reply(planner,{kind:'guidance',text:'Delete exposed content',basis:await x.basis()});await x.finish(reply.operation_id!,planner.dispatch.attempt_id);await x.conversation.pump();
   const node=await x.node(),opened=await x.agent(node,'open_workspace',{resource_id:x.resource}),open=await x.service.recoverOperation(x.f.runner,opened.operation_id!),w=open.workspace!;
   const metadata={...x.request.construction.parents[0]!.outcome!.workspace_metadata!,lease_id:w.lease_id,finalized_commit:x.request.source.git_commit};
   await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:open.operation_id,attempt_id:node.dispatch.attempt_id,success:true,result:{workspace_id:w.workspace_id,path:'/runner/private/worktree',instruction_files:[],workspace_metadata:metadata}});
   const handled=(await x.db.pool.query('SELECT guidance_id FROM task_guidance_assignments WHERE source_id=$1',[node.dispatch.node_execution_source!.source_id])).rows.map(r=>r.guidance_id);
   const done=await x.agent(node,'complete_node',{summary:'Clean new exact source',handled_guidance_ids:handled});
   await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:done.operation_id!,attempt_id:node.dispatch.attempt_id,success:true,result:{writer_absent:true,workspace_id:w.workspace_id,workspace_metadata:{...metadata,finalized_commit:'e'.repeat(40)},git_commit:'e'.repeat(40),git_tree:'f'.repeat(40)}});
   const later=(await x.db.pool.query('SELECT request FROM delivery_operations WHERE source_operation_id=$1',[done.operation_id])).rows[0]!.request;
   expect(later.construction.candidate_id).not.toBe(x.request.construction.candidate_id);
   expect(later.construction.parents[0].observation_operation_id).toBe(x.descriptor.open_operation_id);
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);await x.preparation.finish(x.f.runner,x.f.incarnation,publicationPages(later,0)[0]!);
   const laterRecord=await new PublicationCandidateReads(x.db).candidate(x.token,x.f.task,later.construction.candidate_id);expect(laterRecord).toMatchObject({current:true,known_public_exposure_count:1});
   await transaction(x.db,async tx=>{expect(await knownPublicExposureCount(tx,randomUUID(),x.resource,x.request.source.repository_identity)).toBe(0);expect(await knownPublicExposureCount(tx,x.f.task,randomUUID(),x.request.source.repository_identity)).toBe(0);expect(await knownPublicExposureCount(tx,x.f.task,x.resource,'github.com/foreign/repository')).toBe(0);});
  }finally{await x.close();}
 });
 it('rejects secret-bearing paths before durable pages; safe redacted paths retain scoped identity',async()=>{
  const x=await publicationFixture();try{
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const page=publicationPages(x.request,1)[0]!;const token='ghp_'+'A'.repeat(36);
   const f={...page.findings[0]!,path:token+'.txt'};const facts={...f};delete (facts as Partial<typeof f>).finding_id;
   f.finding_id=hash({candidate_manifest_digest:page.result.candidate_manifest_digest,configuration_digest:x.request.configuration_digest,scan_run_id:x.request.scan_run_id,finding_facts_without_id:facts});
   const bad:PublicationResultPage={...page,findings:[f],page_digest:hash([f])};await expect(x.preparation.finish(x.f.runner,x.f.incarnation,bad)).rejects.toThrow('redacted');
   expect((await x.db.pool.query('SELECT * FROM publication_result_pages')).rows).toHaveLength(0);
   expect(JSON.stringify((await new PublicationCandidateReads(x.db).list(x.token,x.f.task,{})))).not.toContain(token);
  }finally{await x.close();}
 });
 it('uses actual authenticated TLS WSS capability, scoped pages, no premature ack and historical late settlement',async()=>{
  const x=await publicationFixture();let directory:string|undefined,app:ReturnType<typeof createApp>|undefined,socket:WebSocket|undefined;
  const pending=vi.spyOn(x.service,'pending');
  try {
  directory=await mkdtemp(join(tmpdir(),'monos-publication-tls-'));
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-days','1','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem')],{stdio:'ignore'});
  const tls={key:await readFile(join(directory,'key.pem')),cert:await readFile(join(directory,'cert.pem'))};app=createApp(x.service,tls);
   const credential=randomUUID();
   // Runner credential hashing is SHA256 of raw credential, not canonical JSON.
   const {digest}=await import('../../../packages/protocol/src/index.ts');await x.db.pool.query('UPDATE runners SET credential_hash=$2 WHERE id=$1',[x.f.runner,digest(credential)]);
   await app.listen({host:'127.0.0.1',port:0});socket=new WebSocket(`wss://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/runner`,{ca:tls.cert,rejectUnauthorized:true,headers:{authorization:`Bearer ${credential}`}});await once(socket,'open');
   const inbound:Frame[]=[];socket.on('message',body=>inbound.push(JSON.parse(body.toString()) as Frame));
   socket.send(JSON.stringify({schema_version:1,type:'hello',runner_id:x.f.runner,boot_id:'publication-native-transport-test'}));
   await expect.poll(()=>inbound.find(f=>f.type==='welcome')).toBeTruthy();const incarnation=inbound.find(f=>f.type==='welcome')!.incarnation!;
   // Native inventory/reconciliation and CLI discovery can take multiple polls.
   // With no Ready yet, the current socket must survive without dispatching work.
   await expect.poll(()=>pending.mock.calls.length).toBeGreaterThanOrEqual(2);
   expect(socket.readyState).toBe(WebSocket.OPEN);
   expect((await x.db.pool.query('SELECT ready FROM runners WHERE id=$1',[x.f.runner])).rows[0]!.ready).toBe(false);
   expect(inbound.map(f=>f.type)).toEqual(['welcome']);
   expect((await x.db.pool.query('SELECT sent_incarnation,last_sent_at FROM delivery_operations WHERE id=$1',[x.deliveryOperationId])).rows[0]).toEqual({sent_incarnation:null,last_sent_at:null});
   socket.send(JSON.stringify({schema_version:1,type:'ready',incarnation,log_modes:['ordered_v1']}));
   await expect.poll(async()=>(await x.db.pool.query('SELECT ready FROM runners WHERE id=$1',[x.f.runner])).rows[0]!.ready).toBe(true);
   const url=`/v1/owner/tasks/${x.f.task}/publication-candidates`,headers={authorization:`Bearer ${x.token}`};
   expect((await app.inject({url,headers})).json().items[0].status).toBe('unsupported');
   socket.send(JSON.stringify({schema_version:1,type:'ready',incarnation,log_modes:['ordered_v1'],publication_modes:['local_candidate_v1']}));
   await expect.poll(()=>inbound.find(f=>f.type==='publication_prepare')).toBeTruthy();
   expect(inbound.find(f=>f.type==='publication_prepare')!.publication_prepare).toEqual(x.request);
   const pages=publicationPages(x.request,65),send=(page:PublicationResultPage)=>socket!.send(JSON.stringify({schema_version:1,type:'publication_result',incarnation,publication_result:page}));
   send(pages[1]!);await expect.poll(async()=>Number((await x.db.pool.query('SELECT count(*) n FROM publication_result_pages')).rows[0]!.n)).toBe(1);
   expect(inbound.some(f=>f.type==='publication_ack')).toBe(false);
   socket.send(JSON.stringify({schema_version:1,type:'heartbeat',incarnation}));
   await x.db.pool.query("UPDATE tasks SET state='CANCELLED' WHERE id=$1",[x.f.task]);send(pages[0]!);
   await expect.poll(()=>inbound.find(f=>f.type==='publication_ack')).toBeTruthy();
   expect(inbound.find(f=>f.type==='publication_ack')!.publication_ack?.result_digest).toBe(hash(pages[0]!.result));
   const record=(await app.inject({url,headers})).json().items[0];expect(record).toMatchObject({status:'prepared',current:false,scan_applicable:false,override_allowed:false});
   expect((await x.db.pool.query('SELECT count(*) n FROM publication_scans')).rows[0]!.n).toBe('1');
  }finally{socket?.terminate();await app?.close();pending.mockRestore();await x.close();if(directory)await rm(directory,{recursive:true,force:true});}
 },30000);
 it('settles true no-change without creating an item and guards actual authenticated Owner routes',async()=>{
  const x=await publicationFixture(),app=createApp(x.service);try{
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);
   const result={schema_version:1,operation_id:x.deliveryOperationId,request_digest:hash(x.request),status:'not_applicable',reason:'no_change'};
   await x.preparation.finish(x.f.runner,x.f.incarnation,{schema_version:1,result,page_index:0,page_count:1,findings:[],page_digest:hash([])});
   expect((await x.db.pool.query('SELECT * FROM delivery_items')).rows).toHaveLength(0);
   const url=`/v1/owner/tasks/${x.f.task}/publication-candidates`,headers={authorization:`Bearer ${x.token}`};
   const reply=await app.inject({url,headers});expect(reply.statusCode).toBe(200);expect(reply.headers['cache-control']).toBe('no-store');expect(reply.headers['x-content-type-options']).toBe('nosniff');expect(reply.json().items[0]!).toMatchObject({status:'not_applicable',retry_allowed:false});
   expect((await app.inject({url})).statusCode).toBe(401);expect((await app.inject({url,headers:{...headers,'x-monos-session':randomUUID()}})).statusCode).toBe(401);
  }finally{await app.close();await x.close();}
 });
});
