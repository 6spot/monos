import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { multiRepositoryDeliveryFixture } from './fixtures/multi-repository-delivery-fixture.ts';
import { publicationDigest as hash } from '../src/publication-policy.ts';
import { validate } from '../../../packages/protocol/src/index.ts';
import { publicationPages } from './fixtures/publication-fixture.ts';
import { RemotePreparationReads } from '../src/remote-preparation-reads.ts';
import { RemotePreparationAccess } from '../src/remote-preparation-access.ts';

const suite = process.env.MONOS_TEST_DATABASE === '1' ? describe : describe.skip;
suite('Plain HTTPS Git and mixed accepted delivery', { timeout: 60_000 }, () => {
  let x: Awaited<ReturnType<typeof multiRepositoryDeliveryFixture>>;
  afterEach(async () => { await x?.close(); });
  it.each(['automatic', 'after_acceptance'] as const)('%s publishes branches, requires exact acceptance and fresh final observations', async mode => {
    x = await multiRepositoryDeliveryFixture(mode, [0, 1]);
    await x.due(); await x.remote.pump();
    if (mode === 'after_acceptance') expect((await x.db.pool.query('SELECT 1 FROM remote_preparation_operations')).rowCount).toBe(0);
    else { await x.prepareRemote(); expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW'); }
    const remoteReads=new RemotePreparationReads(x.db,x.service.instanceId);
    const preview=await remoteReads.list(x.token,x.f.task,{});expect(preview.items.every(r=>r.delivery_kind==='git_branch'&&!r.review&&!r.checks&&!r.cooldown_until&&r.status===(mode==='automatic'?'prepared':'local_only'))).toBe(true);
    const accepted = await x.accept(); await x.prepareRemote();
    expect((await remoteReads.list(x.token,x.f.task,{})).items.every(r=>r.status==='prepared')).toBe(true);
    const batch = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(batch.manifest.repositories.every(r => r.delivery_kind === 'git_branch' && !r.marker && !r.review && !r.provider_content)).toBe(true);
    expect(batch.items.map(i => i.checks)).toEqual(['not_applicable', 'not_applicable']);
    await x.barrier(accepted.operation_id!); expect(x.refRequests).toHaveLength(2);
    expect((await x.db.pool.query('SELECT 1 FROM owner_delivery_finalizations')).rowCount).toBe(0);
    await x.pump(); await x.pump();
    expect(x.refRequests).toHaveLength(4); expect(new Set(x.refRequests.map(r => r.request_id)).size).toBe(4);
    const final = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(final.batch.status).toBe('completed'); expect(final.items.map(i => i.finality_kind)).toEqual(['git_branch', 'git_branch']);
    expect(final.items.map(i => i.final_commit)).toEqual(final.items.map(i => i.accepted_head));
    const history=await remoteReads.list(x.token,x.f.task,{});expect(history.items.every(r=>r.status==='prepared'&&!r.scan_applicable&&!r.retry_allowed&&r.reason===undefined)).toBe(true);
    expect((await x.db.pool.query('SELECT 1 FROM owner_delivery_merge_operations')).rowCount).toBe(0);
    expect(x.calls).toEqual([]); expect(x.grants).toEqual([]);
  });
  it.each([0, 1])('certifies all members then finalizes mixed resources in order (plain index %s)', async index => {
    x = await multiRepositoryDeliveryFixture('after_acceptance', [index]);
    const accepted = await x.accept(); await x.prepareRemote(); await x.barrier(accepted.operation_id!);
    expect(x.calls.filter(c => c.method === 'PUT')).toEqual([]);
    await x.pump();
    expect((await x.db.pool.query('SELECT item_id FROM owner_delivery_finalizations')).rows[0].item_id).toBe((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).manifest.repositories[0]!.item_id);
    await x.pump();
    const final = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(final.batch.status).toBe('completed'); expect(final.items[index]!.finality_kind).toBe('git_branch'); expect(final.items[1 - index]!.finality_kind).toBe('github_merge');
    expect(x.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
  });
  it('preserves first branch finality, retries a changed sibling ref and ignores later chat', async () => {
    x = await multiRepositoryDeliveryFixture('after_acceptance', [0, 1]);
    const accepted = await x.accept(); await x.prepareRemote(); await x.barrier(accepted.operation_id!); await x.pump();
    const first = (await x.db.pool.query('SELECT * FROM owner_delivery_finalizations')).rows[0];
    x.readState.head = 'f'.repeat(40); await x.pump();
    expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch).toMatchObject({ status: 'attention', finalized_items: 1 });
    await x.send('Explain the accepted result'); x.readState.head = undefined;
    await x.control(accepted.operation_id!, 'retry_delivery'); await x.pump();
    expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch.status).toBe('completed');
    expect((await x.db.pool.query('SELECT * FROM owner_delivery_finalizations WHERE item_id=$1', [first.item_id])).rows[0]).toEqual(first);
  });
  it('Cancel winning the Task lock retains read history without branch finality or branch deletion', async () => {
    x = await multiRepositoryDeliveryFixture('after_acceptance', [0, 1]);
    const accepted = await x.accept(); await x.prepareRemote(); await x.barrier(accepted.operation_id!);
    let release!: () => void, entered!: () => void;
    x.readState.hold = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; }); x.readState.entered = entered;
    const pump = x.pump(); await started; try { await x.control(accepted.operation_id!, 'cancel_delivery'); } finally { release(); await pump; }
    expect((await x.db.pool.query('SELECT 1 FROM owner_delivery_finalizations')).rowCount).toBe(0);
    expect((await x.db.pool.query("SELECT 1 FROM remote_preparation_observations WHERE kind='ref' AND observation ? 'request'")).rowCount).toBe(3);
    expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch.status).toBe('cancelled'); expect(x.calls).toEqual([]);
  });
  it('grants only the saved exact URL and accepts same-scope token renewal without reacceptance', async () => {
    x = await multiRepositoryDeliveryFixture('after_acceptance', [0, 1]);
    const accepted = await x.accept(); await x.due(); await x.remote.pump(); await x.due();
    const frame = (await x.remote.pending(x.f.runner, x.f.incarnation, true))[0]!, push = frame.publication_push!;
    const scope = push.permission_proof.scope_digest;
    await x.save('save_git_https_credential', { resource_id: push.resource_id, username: 'git-user', token: 'renewed-secret' });
    const access = new RemotePreparationAccess(x.service, x.provider);
    const grant = await access.access(x.runnerCredential, push.operation_id, { schema_version: 1, incarnation: x.f.incarnation, request_digest: (await x.db.pool.query('SELECT request_digest FROM remote_preparation_operations WHERE id=$1', [push.operation_id])).rows[0].request_digest, purpose: 'push', attempt_id: randomUUID() });
    expect(grant.remote_url).toBe('https://git.example.test:8443/Exact/Repo-0.git'); expect(grant.provider_metadata).toEqual({});
    expect(grant.authentication).toMatchObject({ kind: 'https_basic', username: 'git-user', token: 'renewed-secret' }); expect(grant.permission_proof?.scope_digest).toBe(scope);
    expect(accepted.operation_id).toBeDefined(); expect(x.grants).toEqual([]);
  });
  it('recovers the original unknown push only after worker absence, without creating a successor push', async () => {
    x=await multiRepositoryDeliveryFixture('after_acceptance',[0,1]);const accepted=await x.accept();await x.due();await x.remote.pump();await x.due();
    const frames=await x.remote.pending(x.f.runner,x.f.incarnation,true),access=new RemotePreparationAccess(x.service,x.provider);
    const original=frames[0]!.publication_push!;
    for(const frame of frames){
      const push=frame.publication_push!,state=x.states.find(s=>s.resource===push.resource_id)!;state.head=push.prepared.candidate!.head;
      await access.access(x.runnerCredential,push.operation_id,{schema_version:1,incarnation:x.f.incarnation,request_digest:hash(push),purpose:'push',attempt_id:randomUUID()});
      const unknown=push.operation_id===original.operation_id;
      const observation={schema_version:1,observation_id:randomUUID(),operation_id:push.operation_id,item_id:push.item_id,task_id:push.task_id,resource_id:push.resource_id,runner_id:push.runner_id,storage_id:push.storage_id,repository_identity:push.repository_identity,provider_metadata:{},delivery_ref:push.delivery_ref,...(unknown?{status:'unavailable',reason:'possible_publication'}:{status:'present',head:state.head}),observed_at:new Date().toISOString()};
      const result=validate('PublicationPushResult',{schema_version:1,operation_id:push.operation_id,item_id:push.item_id,request_digest:hash(push),delivery_ref:push.delivery_ref,candidate_head:state.head,candidate_manifest_digest:push.prepared.candidate_manifest_digest,status:unknown?'reconciliation_required':'published',...(unknown?{reason:'possible_publication'}:{}),push_started:true,worker_absent:true,observation,observation_digest:hash(observation)});
      await x.remote.finish(x.f.runner,x.f.incarnation,result);
    }
    expect((await x.db.pool.query("SELECT 1 FROM remote_preparation_observations WHERE operation_id=$1 AND kind='published'",[original.operation_id])).rowCount).toBe(0);
    await x.due();await x.remote.pump();
    expect(x.refRequests[0]!.push.operation_id).toBe(original.operation_id);
    expect((await x.db.pool.query("SELECT 1 FROM remote_preparation_observations WHERE operation_id=$1 AND kind='published'",[original.operation_id])).rowCount).toBe(1);
    await x.barrier(accepted.operation_id!);await x.pump();await x.pump();
    expect((await x.reads.batch(x.token,x.f.task,accepted.operation_id!)).batch.status).toBe('completed');
    expect((await x.db.pool.query("SELECT 1 FROM remote_preparation_operations WHERE kind='push'")).rowCount).toBe(2);
  });
  it('keeps local scans available without credentials and rejects acceptance of that unconfigured scope', async () => {
    x=await multiRepositoryDeliveryFixture('after_acceptance',[0,1]);
    const current=await x.configuration.read(x.token);
    await x.configuration.save(x.token,{schema_version:1,request_id:randomUUID(),expected_control_version:current.control_version,name:'clear_git_https_credential',payload:{resource_id:x.resources[0]}});
    await x.preparation.pump();const frames=await x.preparation.pending(x.f.runner,x.f.incarnation,true);
    const request=frames.find(f=>f.publication_prepare?.source.resource_id===x.resources[0])!.publication_prepare!;
    expect(request.configuration).toMatchObject({provider_blob_limit:null,workflow_write:'not_applicable'});expect(request.permission_proof).toBeUndefined();
    for(const page of publicationPages(request)){page.result.scan!.workflow_changes=true;page.result.scan_digest=hash(page.result.scan);await x.preparation.finish(x.f.runner,x.f.incarnation,page);}
    await expect(x.accept()).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
    expect(x.calls).toEqual([]);expect((await x.db.pool.query('SELECT 1 FROM remote_preparation_operations')).rowCount).toBe(0);
  });

  it.each(['changed_user','cleared'] as const)('denies accepted pushes after credential scope is %s without claiming an effect',async change=>{
    x=await multiRepositoryDeliveryFixture('after_acceptance',[0,1]);await x.accept();await x.due();await x.remote.pump();await x.due();
    const push=(await x.remote.pending(x.f.runner,x.f.incarnation,true))[0]!.publication_push!;
    if(change==='changed_user')await x.save('save_git_https_credential',{resource_id:push.resource_id,username:'another-user',token:'replacement'});
    else await x.configuration.save(x.token,{schema_version:1,request_id:randomUUID(),expected_control_version:(await x.configuration.read(x.token)).control_version,name:'clear_git_https_credential',payload:{resource_id:push.resource_id}});
    await expect(new RemotePreparationAccess(x.service,x.provider).access(x.runnerCredential,push.operation_id,{schema_version:1,incarnation:x.f.incarnation,request_digest:hash(push),purpose:'push',attempt_id:randomUUID()})).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
    expect((await x.db.pool.query('SELECT state,effect_owned,may_have_mutated FROM remote_preparation_operations WHERE id=$1',[push.operation_id])).rows[0]).toEqual({state:'pending',effect_owned:false,may_have_mutated:false});
  });
  it.each([0,1])('Cancel preserves first finality and closes only an unfinished GitHub PR (plain index %s)',async index=>{
    x=await multiRepositoryDeliveryFixture('after_acceptance',[index]);const accepted=await x.accept();await x.prepareRemote();await x.barrier(accepted.operation_id!);await x.pump();
    const original=(await x.db.pool.query('SELECT * FROM owner_delivery_finalizations')).rows[0];await x.control(accepted.operation_id!,'cancel_delivery');
    for(let turn=0;turn<4;turn++){await x.due();await x.remote.pump();}
    expect((await x.db.pool.query('SELECT * FROM owner_delivery_finalizations')).rows).toEqual([original]);
    expect(x.calls.filter(c=>c.method==='PATCH').map(c=>c.resource)).toEqual(index===0?[x.resources[1]]:[]);
    expect(x.calls.some(c=>c.method==='DELETE')).toBe(false);
    const result=await x.reads.batch(x.token,x.f.task,accepted.operation_id!);expect(result.batch).toMatchObject({status:'cancelled',finalized_items:1});
  });

});
