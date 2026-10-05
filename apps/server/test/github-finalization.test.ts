import {afterEach, describe, expect, it, vi} from 'vitest';
import {GitHub} from '../src/github.ts';
import {GitHubRemote, ProviderTurnComplete, remoteProfile} from '../src/github-remote.ts';
import type {GitHubRemoteGrant, GitHubRemoteProfile, GitHubRemoteScope} from '../src/github-remote.ts';
import {GitHubFinalization, evaluateReadiness, selectMergeMethod, validateReadinessCollection} from '../src/github-finalization.ts';
import type {FinalizationIntent, FinalizationReview, ProtectionPolicy, ReadinessCheck, ReadinessCollection, ReadinessCollections} from '../src/github-finalization.ts';
const head='a'.repeat(40), base='b'.repeat(40), test='c'.repeat(40), final='d'.repeat(40);
const item='30000000-0000-4000-8000-000000000092';
const scope: GitHubRemoteScope={resource_id:'resource',repository_identity:'github.com/example/repo',repository_id:'42',remote_url:'https://github.com/Example/Repo.git',workflow_changes:true};
const marker=`<!-- monos-delivery-item:${item} -->`;
const intent: FinalizationIntent={item_id:item,delivery_ref:'refs/heads/monos/task/task/resource',target_branch:'main',kind:'update_pr',accepted_head:head,review:{repository_id:'42',pr_id:'101',pr_number:7,url:'https://github.com/example/repo/pull/7',head_ref:'monos/task/task/resource',base_ref:'main',marker,state:'open'}};
const time=()=>new Date().toISOString();
const grant=(profile: GitHubRemoteProfile): GitHubRemoteGrant=>({token:'synthetic-memory-only-token',expires_at:new Date(Date.now()+3600_000).toISOString(),repository_id:'42',permissions:remoteProfile(scope,profile)});
const rawReview=()=>({id:101,number:7,title:'Synthetic review',body:marker,html_url:'https://github.com/example/repo/pull/7',state:'open',draft:false,merged:false,merged_at:null,merge_commit_sha:test,mergeable:true,head:{ref:intent.review.head_ref,sha:head,repo:{id:42}},base:{ref:'main',sha:base,repo:{id:42}}});
const adapter=(fetcher: typeof fetch)=>new GitHubFinalization(new GitHubRemote(new GitHub('synthetic-service-signing-key-for-tests'),{fetcher,acquireGrant:async(_s,p)=>grant(p)}));
const review=(): FinalizationReview=>({review:intent.review,head,base_head:base,content_digest:'e'.repeat(64),mergeability:'mergeable',draft:false,merged:false,merged_at:null,final_head:null,test_head:test,observed_at:time()});
const policy=(): ProtectionPolicy=>({repository_id:'42',target_branch:'main',protected:true,strict:false,linear_history:false,requirements:[{context:'build',app_id:null}],supported:true,reason:'supported',digest:'f'.repeat(64),observed_at:time()});
const check=(name='build',state: ReadinessCheck['state']='success',sha=head,id=1): ReadinessCheck=>({kind:'check_run',provider_id:id,head:sha,name,state,app_id:10,created_at:time()});
const collection=(sha:string,kind:ReadinessCheck['kind'],items:ReadinessCheck[]): ReadinessCollection=>({repository_id:'42',head:sha,kind,pages:[{repository_id:'42',head:sha,kind,page:1,items,more:false,...(kind==='check_run'?{total:items.length}:{}),observed_at:time()}]});
const inputs=(headChecks:ReadinessCheck[]=[check()],testChecks:ReadinessCheck[]=[]): ReadinessCollections=>({head:[collection(head,'check_run',headChecks.filter(c=>c.kind==='check_run')),collection(head,'status',headChecks.filter(c=>c.kind==='status'))],test:[collection(test,'check_run',testChecks.filter(c=>c.kind==='check_run')),collection(test,'status',testChecks.filter(c=>c.kind==='status'))]});
const status=(state:ReadinessCheck['state'],id=2):ReadinessCheck=>({...check('build',state,head,id),kind:'status',app_id:null});
afterEach(()=>vi.useRealTimers());

describe('exact GitHub finalization observations',()=>{
 it('separates test merge OID from accepted head and validates recovered original PR identity',async()=>{
  const raw=rawReview(), provider=adapter(async()=>Response.json(raw));
  const observed=await provider.review(scope,intent,grant('readiness'));
  expect(observed).toMatchObject({head,test_head:test,final_head:null,merged:false});
  expect(await provider.reconcile(scope,intent,grant('reconcile'))).toMatchObject({state:'unknown',reason:'unresolved_merge'});
  Object.assign(raw,{state:'closed',merged:true,merged_at:time(),merge_commit_sha:final});
  expect(await provider.reconcile(scope,intent,grant('reconcile'))).toMatchObject({state:'merged',final_head:final});
  raw.head.sha=base;
  expect(await provider.reconcile(scope,intent,grant('reconcile'))).toEqual({state:'unknown',reason:'unexpected_head'});
  raw.head.sha=head; raw.id=102;
  expect(await provider.reconcile(scope,intent,grant('reconcile'))).toEqual({state:'unknown',reason:'invalid_provider_response'});
 });
 it('never recovers delivery from provisional OID, closure or missing merge facts',async()=>{
  for(const overrides of [{state:'closed'}, {merged:true,merged_at:null}, {merged:true,merged_at:time(),state:'closed',merge_commit_sha:null}]) {
   const provider=adapter(async()=>Response.json({...rawReview(),...overrides}));
   expect((await provider.reconcile(scope,intent,grant('reconcile'))).state).toBe('unknown');
  }
  expect(await adapter(async()=>new Response(null,{status:404})).reconcile(scope,intent,grant('reconcile'))).toEqual({state:'unknown',reason:'pr_missing'});
 });
 it('requires explicit absence and complete rules, not a protection 404',async()=>{
  let calls=0;
  const provider=adapter(async(url)=>{calls++;return Response.json(String(url).includes('/rules/')?[]:{name:'main',protected:false});});
  expect(await provider.policy(scope,'main',grant('readiness'),{remaining:2},'unprotected')).toMatchObject({supported:true,protected:false}); expect(calls).toBe(2);
  calls=0;
  const missing=adapter(async()=>{calls++;return new Response(null,{status:404});});
  expect(await missing.policy(scope,'main',grant('readiness'))).toMatchObject({supported:false,reason:'protection_unknown'}); expect(calls).toBe(1);
  expect(await adapter(async(url)=>Response.json(String(url).includes('/rules/')?[{type:'merge_queue'}]:{name:'main',protected:false})).policy(scope,'main',grant('readiness'),undefined,'unprotected')).toMatchObject({supported:false,reason:'unsupported_rules'});
 });
 it('preserves App-bound classic requirements and rejects unsupported reviews/signatures',async()=>{
  const raw={required_status_checks:{strict:true,contexts:['build'],checks:[{context:'build',app_id:10}]},required_linear_history:{enabled:true},required_pull_request_reviews:null,required_signatures:{enabled:false}};
  const provider=adapter(async(url)=>Response.json(String(url).includes('/rules/')?[]:raw));
  expect(await provider.policy(scope,'main',grant('readiness'))).toMatchObject({supported:true,strict:true,linear_history:true,requirements:[{context:'build',app_id:10}]});
  raw.required_signatures.enabled=true;
  expect(await provider.policy(scope,'main',grant('readiness'))).toMatchObject({supported:false,reason:'unsupported_protection'});
 });
 it('accepts only literal immutable ancestry and write-visible exact repository settings',async()=>{
  const provider=adapter(async(url)=>Response.json(String(url).includes('/compare/')?{base_commit:{sha:base},merge_base_commit:{sha:base},status:'ahead'}:{id:42,full_name:'Example/Repo',allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true}));
  expect(await provider.ancestry(scope,base,head,grant('readiness'))).toMatchObject({base,head,merge_base:base});
  expect(await provider.settings(scope,grant('merge'))).toMatchObject({allow_merge:true,allow_squash:true,allow_rebase:true});
  await expect(provider.settings(scope,grant('readiness'))).rejects.toThrow();
  await expect(adapter(async()=>Response.json({id:42,full_name:'other/repo'})).settings(scope,grant('merge'))).rejects.toThrow();
 });
});

describe('complete producer-aware readiness',()=>{
 it('chooses a whole test input; unrelated test evidence forbids head-context fallback',()=>{
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs()})).toMatchObject({state:'ready',input_head:head});
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([check()],[check('lint','success',test)])})).toMatchObject({state:'waiting',reason:'required_check_missing',input_head:test});
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([check()],[check('build','failure',test)])})).toMatchObject({state:'conflicting',input_head:test});
 });
 it('distinguishes required latest producer, App mismatch, unknown status provenance and both lanes',()=>{
  const p=policy(); p.requirements[0]!.app_id=10;
  expect(evaluateReadiness({review:review(),policy:p,collections:inputs([{...check(),app_id:11}])})).toMatchObject({state:'waiting'});
  expect(evaluateReadiness({review:review(),policy:p,collections:inputs([check(),status('success')])})).toMatchObject({state:'unknown',reason:'status_producer_unknown'});
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([check(),status('failure')])})).toMatchObject({state:'conflicting'});
  const old={...check('build','failure',head,1),created_at:'2025-01-01T00:00:00Z'};
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([old,check('build','neutral',head,3)])})).toMatchObject({state:'ready'});
  for(const state of ['neutral','skipped'] as const) expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([check('build',state)])})).toMatchObject({state:'ready'});
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([check('build','pending')])})).toMatchObject({state:'waiting'});
 });
 it('uses latest status timestamp rather than provider ordering and ignores unrelated failed checks',()=>{
  const success={...status('success',3),created_at:'2026-10-05T01:01:02Z'},failed={...status('failure',4),created_at:'2026-10-05T01:01:01Z'};
  expect(evaluateReadiness({review:review(),policy:policy(),collections:inputs([success,failed,check('unrelated','failure',head,5)])})).toMatchObject({state:'ready'});
 });
 it('requires scoped strict graph proof and fresh actual page observations',()=>{
  const p={...policy(),strict:true}, ancestry={repository_id:'42',base,head,merge_base:base,observed_at:'2025-01-01T00:00:00Z'};
  expect(evaluateReadiness({review:review(),policy:p,collections:inputs(),ancestry})).toMatchObject({state:'ready'});
  expect(evaluateReadiness({review:review(),policy:p,collections:inputs(),ancestry:{...ancestry,merge_base:head}})).toMatchObject({state:'conflicting',reason:'branch_behind'});
  expect(evaluateReadiness({review:review(),policy:p,collections:inputs(),ancestry:{...ancestry,base:head}})).toMatchObject({state:'unknown',reason:'ancestry_unknown'});
  const collections=inputs(); collections.head[0]!.pages[0]!.observed_at=new Date(Date.now()-16_000).toISOString();
  expect(evaluateReadiness({review:review(),policy:policy(),collections})).toMatchObject({state:'unknown',reason:'checks_incomplete_or_stale'});
 });
 it('rejects truncated totals, duplicate page records, changed total and the page cap',async()=>{
  const raw={total_count:2,check_runs:[{id:1,name:'build',head_sha:head,status:'completed',conclusion:'success',started_at:time(),app:{id:10}}]};
  await expect(adapter(async()=>Response.json(raw)).checkPage(scope,head,'check_run',1,grant('readiness'))).rejects.toThrow();
  const c=collection(head,'check_run',[check()]); c.pages[0]!.total=2; expect(validateReadinessCollection(c)).toBe(false);
  const first={...c.pages[0]!,total:101,items:Array.from({length:100},(_,i)=>check('build','success',head,i+1)),more:true};
  c.pages=[first,{...c.pages[0]!,page:2,total:102,items:[check('build','success',head,101)]}]; expect(validateReadinessCollection(c)).toBe(false);
  c.pages[1]!.total=101; expect(validateReadinessCollection(c)).toBe(true);
  c.pages[1]!.items[0]!.provider_id=1; expect(validateReadinessCollection(c)).toBe(false);
  await expect(adapter(async()=>Response.json(raw)).checkPage(scope,head,'check_run',11,grant('readiness'))).rejects.toThrow();
 });
 it('retains scope and revalidates cached-page time only after an actual 304',async()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  let init:RequestInit|undefined;
  const provider=adapter(async(_url,options)=>{init=options;return new Response(null,{status:304});});
  const retained={...collection(head,'check_run',[check()]).pages[0]!,etag:'"page-1"',observed_at:'2026-10-04T23:59:00Z'};
  expect((await provider.checkPage(scope,head,'check_run',1,grant('readiness'),undefined,retained)).observed_at).toBe('2026-10-05T00:00:00.000Z');
  expect(new Headers(init?.headers).get('If-None-Match')).toBe('"page-1"');
  await expect(provider.checkPage(scope,head,'check_run',1,grant('readiness'),undefined,{...retained,head:base})).rejects.toThrow();
 });
 it('reads real check-run started_at/App identity and status creation time under exact latest filtering',async()=>{
  const urls:string[]=[];
  const provider=adapter(async(url)=>{urls.push(String(url));return Response.json(String(url).includes('/check-runs')?{total_count:1,check_runs:[{id:1,name:'build',head_sha:head,status:'queued',conclusion:null,started_at:null,app:{id:10}}]}:[{id:2,context:'build',state:'success',created_at:'2026-10-05T00:00:00Z'}]);});
  const c=await provider.checkPage(scope,head,'check_run',1,grant('readiness'));
  expect(c.items[0]).toMatchObject({app_id:10,state:'pending',created_at:'1970-01-01T00:00:00Z'});
  expect(urls[0]).toContain('&filter=latest');
  expect((await provider.checkPage(scope,head,'status',1,grant('readiness'))).items[0]).toMatchObject({app_id:null,created_at:'2026-10-05T00:00:00Z'});
  await expect(adapter(async()=>Response.json([{id:2,context:'build',state:'success',created_at:'2026-02-29T00:00:00Z'}])).checkPage(scope,head,'status',1,grant('readiness'))).rejects.toThrow();
 });
});

describe('minimal methods, one guarded effect and lost-response reconciliation',()=>{
 it('keeps minimal finalization grants and all old profile behavior',()=>{
  expect(remoteProfile(scope,'readiness')).toEqual({contents:'read',metadata:'read',pull_requests:'read',checks:'read',statuses:'read',administration:'read'});
  expect(remoteProfile(scope,'merge')).toEqual({contents:'write',metadata:'read'});
  expect(remoteProfile(scope,'reconcile')).toEqual({contents:'read',metadata:'read',pull_requests:'read'});
  expect(remoteProfile(scope,'push')).toMatchObject({workflows:'write'});
 });
 it('selects configured/default allowed methods without replacing a retained selection',()=>{
  const settings={repository_id:'42',allow_merge:true,allow_squash:true,allow_rebase:true,observed_at:time()};
  for(const method of ['merge','squash','rebase'] as const) expect(selectMergeMethod(settings,policy(),method)).toBe(method);
  expect(selectMergeMethod(settings,policy())).toBe('merge');
  expect(selectMergeMethod(settings,{...policy(),linear_history:true})).toBe('squash');
  expect(selectMergeMethod({...settings,allow_squash:false},policy(),undefined,'squash')).toBeNull();
  expect(selectMergeMethod(settings,policy(),'rebase','squash')).toBeNull();
 });
 it.each(['merge','squash','rebase'] as const)('PUT guards exact head and selected %s method with one call',async(method)=>{
  const seen:{url:string;init:RequestInit}[]=[];
  const provider=adapter(async(url,init)=>{seen.push({url:String(url),init:init!}); return Response.json({merged:true,sha:final,message:'Merged'});});
  const budget={remaining:1}; expect(await provider.merge(scope,intent,method,grant('merge'),budget)).toEqual({state:'merged',final_head:final});
  expect(seen).toHaveLength(1); expect(seen[0]!.url).toBe('https://api.github.com/repos/example/repo/pulls/7/merge');
  expect(JSON.parse(String(seen[0]!.init.body))).toEqual({sha:head,merge_method:method}); expect(seen[0]!.init.redirect).toBe('error');
  expect(new Headers(seen[0]!.init.headers).get('X-GitHub-Api-Version')).toBe('2022-11-28');
  await expect(provider.merge(scope,intent,method,grant('merge'),budget)).rejects.toBeInstanceOf(ProviderTurnComplete); expect(seen).toHaveLength(1);
 });
 it('distinguishes definitive expected-head/permission failures and bounded rate limits from unknown',async()=>{
  for(const status of [403,404,405,409,422]) expect(await adapter(async()=>Response.json({message:'synthetic sensitive diagnostic'},{status})).merge(scope,intent,'merge',grant('merge'))).toMatchObject({state:'rejected',status});
  expect(await adapter(async()=>Response.json({message:'secondary rate limit'},{status:403})).merge(scope,intent,'merge',grant('merge'))).toMatchObject({state:'rejected',reason:'rate_limited',cooldown_ms:60_000});
  for(const reply of [Response.json({merged:false,sha:final}),Response.json({message:'bad'},{status:500}),new Response('invalid-json',{status:409}),new Response('x'.repeat(1024*1024+1))]) expect((await adapter(async()=>reply).merge(scope,intent,'merge',grant('merge'))).state).toBe('unknown');
 });
 it('recovers withheld success by original reads and never issues a second PUT',async()=>{
  let puts=0, gets=0;
  const provider=adapter(async(_url,init)=>{if(init?.method==='PUT'){puts++;throw new Error('synthetic dropped response');} gets++;return Response.json({...rawReview(),state:'closed',merged:true,merged_at:time(),merge_commit_sha:final});});
  expect(await provider.merge(scope,intent,'squash',grant('merge'))).toEqual({state:'unknown',reason:'provider_unavailable'});
  expect(await provider.reconcile(scope,intent,grant('reconcile'))).toMatchObject({state:'merged',final_head:final}); expect(puts).toBe(1); expect(gets).toBe(1);
 });
 it('rejects crossed original intent or wider credential profile before any effect',async()=>{
  let calls=0;const provider=adapter(async()=>{calls++;return Response.json({merged:true,sha:final});});
  await expect(provider.merge(scope,{...intent,review:{...intent.review,marker:'foreign'}},'merge',grant('merge'))).rejects.toThrow();
  await expect(provider.merge(scope,intent,'merge',grant('push'))).rejects.toThrow();
  expect(calls).toBe(0);
 });
 it('fits protected effect turn into exactly eight calls including issuance and two brackets',async()=>{
  let calls=0;
  const provider=adapter(async(url,init)=>{calls++;const u=String(url);return Response.json(init?.method==='PUT'?{merged:true,sha:final}:u.endsWith('/protection')?{required_status_checks:null}:u.includes('/rules/')?[]:u.endsWith('/pulls/7')?rawReview():{id:42,full_name:'example/repo',allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true});});
  const budget={remaining:8}, read=await provider.remote.grant(scope,'readiness',budget);
  await provider.review(scope,intent,read,budget);const protection=await provider.policy(scope,'main',read,budget);
  const write=await provider.remote.grant(scope,'merge',budget), settings=await provider.settings(scope,write,budget);
  await provider.review(scope,intent,read,budget);expect(await provider.merge(scope,intent,selectMergeMethod(settings,protection)!,write,budget)).toMatchObject({state:'merged'});
  expect(budget.remaining).toBe(0); expect(calls).toBe(6);
 });
});
