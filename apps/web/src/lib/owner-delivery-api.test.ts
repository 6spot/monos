import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeliveryAcceptanceManifest, DeliveryBatch, DeliveryProposalDetail, OwnerDeliveryCommand, OwnerDeliveryCommandResult, OwnerDeliveryStatus } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError, UncertainError } from './api.ts';
import { ownerDeliveryBatch, ownerDeliveryProposal, ownerDeliveryStatus } from './owner-delivery-api.ts';
import { publicationDigest } from './publication-api.ts';
import { recoverTaskIntent, submitTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';
import { clearTaskStorage, validateTaskJournal } from './task-storage.ts';

const fixtures = JSON.parse(readFileSync(new URL('../../../../packages/protocol/fixtures/validation.json', import.meta.url), 'utf8')) as {name:string;value:unknown}[];
const task = '30000000-0000-4000-8000-000000000090', session = 'session-a', h = 'a'.repeat(64);
afterEach(() => vi.unstubAllGlobals());
function intent(name: OwnerDeliveryCommand['name'], payload: OwnerDeliveryCommand['payload']): TaskIntent {
  return {family:'delivery',command:{schema_version:1,task_id:task,request_id:'request-a',name,payload}};
}
function receipt(command: OwnerDeliveryCommand, fields: object): OwnerDeliveryCommandResult {
  return validate('OwnerDeliveryCommandResult',{schema_version:1,task_id:task,request_id:command.request_id,status:'committed',name:command.name,...fields});
}
async function proposal(modified = false): Promise<DeliveryProposalDetail> {
  const fixture = fixtures.find(value => value.name === (modified ? 'owner delivery modified exact manifest' : 'owner delivery repository free complete manifest'));
  const manifest = structuredClone(fixture?.value) as DeliveryAcceptanceManifest;
  for (const repository of manifest.repositories) repository.provider_content_digest = await publicationDigest(repository.provider_content);
  const content_digest = await publicationDigest(manifest);
  return {schema_version:1,task_id:task,proposal:{proposal_id:'proposal-a',content_digest,basis:manifest.basis,expires_at:'2026-10-05T23:00:00.000Z',current:true},manifest};
}
async function batch(modified = false): Promise<DeliveryBatch> {
  const p = await proposal(modified), repository = p.manifest.repositories[0];
  return {schema_version:1,task_id:task,proposal_id:p.proposal.proposal_id,confirmation_id:'confirmation-a',admission_request_id:'admission-a',manifest:p.manifest,
    batch:{operation_id:'batch-a',content_digest:p.proposal.content_digest,version:7,status:modified?'failed':'completed',input_cutoff:4,accepted_at:'2026-10-05T10:00:00.000Z',modified_items:modified?1:0,finalized_items:0,retry_allowed:modified,cancel_allowed:modified},
    items:repository?[{item_id:repository.item_id ?? '',resource_id:repository.resource_id,status:'failed',accepted_head:repository.candidate?.head ?? '',checks:'unknown'}]:[]};
}

it('persists exact delivery command in the existing allowlisted Task journal and recovers without a new control basis', async () => {
  const command = {schema_version:1,task_id:task,request_id:'request-a',name:'retry_delivery',expected_control_version:999,payload:{operation_id:'batch-a',content_digest:h,expected_version:7}} as const;
  const pending: TaskIntent = {family:'delivery',command};
  expect(validateTaskJournal({version:1,session_id:session,tasks:{[task]:{drafts:{},pending:{delivery:pending}}}},session).tasks[task]?.pending.delivery).toEqual(pending);
  const paths: string[] = [], bodies: unknown[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    paths.push(path); expect(init.cache).toBe('no-store'); expect((init.headers as Record<string,string>)['X-Monos-Session']).toBe(session);
    if (!init.body) return Response.json({schema_version:1,task_id:task,request_id:'request-a',status:'unknown'});
    bodies.push(JSON.parse(String(init.body))); return Response.json(receipt(command,{operation_id:'batch-a',content_digest:h,operation_version:8}));
  });
  await expect(recoverTaskIntent(pending,session)).resolves.toMatchObject({operation_id:'batch-a',operation_version:8});
  expect(paths).toEqual([`/v1/owner/tasks/${task}/delivery/commands/request-a`,'/v1/owner/tasks/delivery/commands']);
  expect(bodies).toEqual([command]);
});

it('acceptance requires its exact proposal, confirmation, digest, request and Task receipt', async () => {
  const pending = intent('accept_delivery',{proposal_id:'proposal-a',confirmation_id:'confirmation-a',content_digest:h,basis:{control_version:1,specification_id:'spec',plan_id:'plan'}});
  if(pending.family!=='delivery')throw new Error('Fixture family');
  const good = receipt(pending.command,{proposal_id:'proposal-a',confirmation_id:'confirmation-a',content_digest:h,operation_id:'batch-a',operation_version:1,input_cutoff:4});
  for (const changed of [{...good,proposal_id:'other'},{...good,confirmation_id:'other'},{...good,content_digest:'b'.repeat(64)},{...good,task_id:'other'},{...good,request_id:'other'},Object.fromEntries(Object.entries(good).filter(([key])=>key!=='input_cutoff'))]) {
    vi.stubGlobal('fetch',async()=>Response.json(changed));
    await expect(submitTaskIntent(pending,session)).rejects.toBeInstanceOf(UncertainError);
  }
});

it('mismatched actual action or batch version retains uncertainty instead of generic committed success', async () => {
  const pending = intent('retry_delivery',{operation_id:'batch-a',content_digest:h,expected_version:7});
  if(pending.family!=='delivery')throw new Error('Fixture family');
  const good = receipt(pending.command,{operation_id:'batch-a',content_digest:h,operation_version:8});
  for (const changed of [{...good,name:'cancel_delivery'},{...good,operation_id:'other'},{...good,operation_version:7}]) {
    vi.stubGlobal('fetch',async()=>Response.json(changed));await expect(submitTaskIntent(pending,session)).rejects.toBeInstanceOf(UncertainError);
  }
});

it('a malformed recovery receipt never replays, while a committed exact confirmation reuses its identity', async () => {
  const pending = intent('confirm_delivery_acceptance',{proposal_id:'proposal-a',content_digest:h});
  if(pending.family!=='delivery')throw new Error('Fixture family');
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch',async(_path:string,init:RequestInit)=>{calls.push(init);return Response.json({schema_version:1,task_id:task,request_id:'request-a',status:'unknown',confirmation_id:'invented'});});
  await expect(recoverTaskIntent(pending,session)).rejects.toBeInstanceOf(UncertainError);expect(calls).toHaveLength(1);expect(calls[0]?.body).toBeUndefined();
  vi.stubGlobal('fetch',async()=>Response.json(receipt(pending.command,{proposal_id:'proposal-a',confirmation_id:'same-confirmation',content_digest:h})));
  await expect(recoverTaskIntent(pending,session)).resolves.toMatchObject({confirmation_id:'same-confirmation'});
});

it('reads zero-item accepted history and nullable planning basis with exact scope, session and abort binding', async () => {
  const b = await batch(), p = await proposal(), controller = new AbortController();
  const status:OwnerDeliveryStatus={schema_version:1,task_id:task,basis:{control_version:1,specification_id:'specification_id',plan_id:null},accept_allowed:false,reason:'no_plan',proposals:[],proposals_has_more:false,batches:[],batches_has_more:false};
  const calls:{path:string;init:RequestInit}[]=[];
  vi.stubGlobal('fetch',async(path:string,init:RequestInit)=>{calls.push({path,init});return Response.json(path.endsWith('/proposal-a')?p:path.endsWith('/batch-a')?b:status);});
  await expect(ownerDeliveryStatus(task,session,controller.signal)).resolves.toEqual(status);
  await expect(ownerDeliveryProposal(task,p.proposal,session,controller.signal)).resolves.toEqual(p);
  await expect(ownerDeliveryBatch(task,b.batch,session,controller.signal)).resolves.toEqual(b);
  expect(calls.every(value=>value.init.signal===controller.signal&&value.init.cache==='no-store'&&(value.init.headers as Record<string,string>)['X-Monos-Session']===session)).toBe(true);
});

it('rejects crossed scope, changed approved digest and missing selected evidence even with a rehashed envelope', async () => {
  const p = await proposal();
  for (const change of ['task','digest','membership']) {
    const changed=structuredClone(p);
    if(change==='task')changed.manifest.outputs[0].completion.task_id='other';
    if(change==='digest')changed.proposal.content_digest='f'.repeat(64);
    if(change==='membership')changed.manifest.outputs[0].completion.artifact_ids=['omitted-artifact'];
    if(change!=='digest')changed.proposal.content_digest=await publicationDigest(changed.manifest);
    vi.stubGlobal('fetch',async()=>Response.json(changed));
    await expect(ownerDeliveryProposal(task,{proposal_id:p.proposal.proposal_id,content_digest:changed.proposal.content_digest},session)).rejects.toBeInstanceOf(APIError);
  }
});

it('modified batch reads preserve the exact frozen source and reject a replacement approved head or duplicate items', async () => {
  const b=await batch(true);
  vi.stubGlobal('fetch',async()=>Response.json(b));await expect(ownerDeliveryBatch(task,b.batch,session)).resolves.toEqual(b);
  for(const changed of [{...b,items:[{...b.items[0]!,accepted_head:'f'.repeat(40)}]},{...b,items:[b.items[0]!,b.items[0]!]}]){
    vi.stubGlobal('fetch',async()=>Response.json(changed));await expect(ownerDeliveryBatch(task,b.batch,session)).rejects.toBeInstanceOf(APIError);
  }
});

it('held Task reads cannot return evidence after abort or logout even when the transport ignores cancellation', async () => {
  const p=await proposal();
  for(const kind of ['task-switch','logout']){
    let release:(value:Response)=>void=()=>{throw new Error('No request')};
    vi.stubGlobal('fetch',()=>new Promise<Response>(resolve=>{release=resolve;}));
    const controller=new AbortController(),pending=ownerDeliveryProposal(task,p.proposal,session,controller.signal);
    if(kind==='task-switch')controller.abort();else clearTaskStorage();
    release(Response.json(p));await expect(pending).rejects.toMatchObject({name:'AbortError'});
  }
});

it('history cursors preserve separate scoped pages and reject loops or a crossed Task', async () => {
  const proposal_cursor = 'eyJ2IjoxfQ', batch_cursor = 'eyJ2IjoyfQ';
  const value:OwnerDeliveryStatus={schema_version:1,task_id:task,basis:{control_version:999,specification_id:'spec',plan_id:'plan'},accept_allowed:false,reason:'accepted',accepted_delivery_operation_id:'batch-a',accepted_delivery_input_cutoff:4,proposals:[],proposals_has_more:true,next_proposal_cursor:'eyJ2IjozfQ',batches:[],batches_has_more:true,next_batch_cursor:'eyJ2Ijo0fQ'};
  const paths:string[]=[];
  vi.stubGlobal('fetch',async(path:string)=>{paths.push(path);return Response.json(value);});
  await expect(ownerDeliveryStatus(task,session,undefined,{proposal_cursor,batch_cursor})).resolves.toEqual(value);
  expect(paths[0]).toBe(`/v1/owner/tasks/${task}/delivery?proposal_cursor=${proposal_cursor}&batch_cursor=${batch_cursor}`);
  for(const changed of [{...value,task_id:'other'},{...value,next_proposal_cursor:proposal_cursor},{...value,next_batch_cursor:batch_cursor}]){
    vi.stubGlobal('fetch',async()=>Response.json(changed));
    await expect(ownerDeliveryStatus(task,session,undefined,{proposal_cursor,batch_cursor})).rejects.toBeInstanceOf(APIError);
  }
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(ownerDeliveryStatus(task,session,undefined,{proposal_cursor:'padded=='})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it('selected current-activation artifacts retain their own earlier Attempt and revision attribution', async () => {
  const p=await proposal(),output=p.manifest.outputs[0],completion=output.completion;
  completion.artifact_ids=['earlier-artifact'];
  output.artifacts=[{artifact_id:'earlier-artifact',task_id:task,node_id:completion.node_id,node_activation:completion.node_activation,attempt_id:'earlier-attempt',specification_id:'earlier-specification',plan_id:'earlier-plan',title:'Retained current-activation evidence',media_type:'text/plain',size_bytes:12,content_digest:h,references:[],created_at:'2026-10-05T00:00:00.000Z'}];
  p.proposal.content_digest=await publicationDigest(p.manifest);
  vi.stubGlobal('fetch',async()=>Response.json(p));
  await expect(ownerDeliveryProposal(task,p.proposal,session)).resolves.toEqual(p);
  const wrong=structuredClone(p);wrong.manifest.outputs[0].artifacts[0]!.node_activation+=1;wrong.proposal.content_digest=await publicationDigest(wrong.manifest);
  vi.stubGlobal('fetch',async()=>Response.json(wrong));
  await expect(ownerDeliveryProposal(task,wrong.proposal,session)).rejects.toBeInstanceOf(APIError);
});
