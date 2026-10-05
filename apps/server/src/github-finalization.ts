import {canonicalJSON} from '../../../packages/protocol/src/index.ts';
import {validateGitRef} from '../../../packages/domain/src/repositories.ts';
import {githubExpiry} from './github.ts';
import {ProviderTurnComplete, RemoteProviderError, remoteProfile} from './github-remote.ts';
import type {GitHubRemote, GitHubRemoteGrant, GitHubRemoteScope, ProviderBudget, RemoteReviewIntent, RemoteReviewSnapshot} from './github-remote.ts';
import {publicationDigest as hash} from './publication-policy.ts';

export type MergeMethod = 'merge'|'squash'|'rebase';
export type FinalizationIntent = RemoteReviewIntent & {review: NonNullable<RemoteReviewIntent['review']>; accepted_head: string};
export interface FinalizationReview extends RemoteReviewSnapshot {
 draft: boolean; merged: boolean; merged_at: string|null; final_head: string|null; test_head: string|null;
 observed_at: string;
}
export interface RequiredContext {context: string; app_id: number|null}
export interface ProtectionPolicy {
 repository_id: string; target_branch: string; protected: boolean; strict: boolean;
 linear_history: boolean; requirements: RequiredContext[]; supported: boolean;
 reason: 'supported'|'unsupported_protection'|'unsupported_rules'|'protection_unknown';
 digest: string; observed_at: string;
}
export interface ReadinessCheck {
 kind: 'check_run'|'status'; provider_id: number; head: string; name: string;
 state: 'pending'|'success'|'failure'|'neutral'|'skipped'|'cancelled'|'unknown';
 app_id: number|null; created_at: string; // Status creation time; check-run started_at (epoch when not started).
}
export interface ReadinessPage {
 repository_id: string; head: string; kind: ReadinessCheck['kind']; page: number;
 items: ReadinessCheck[]; more: boolean; total?: number; etag?: string; observed_at: string;
}
/** Persist only these public facts; grants and tokens are never checkpoints. */
export interface ReadinessCollection {repository_id: string; head: string; kind: ReadinessCheck['kind']; pages: ReadinessPage[]}
export interface ReadinessCollections {head: ReadinessCollection[]; test: ReadinessCollection[]}
export interface AncestryProof {repository_id: string; base: string; head: string; merge_base: string; observed_at: string}
export interface MergeSettings {repository_id: string; allow_merge: boolean; allow_squash: boolean; allow_rebase: boolean; observed_at: string}
export type ReadinessReason = ProtectionPolicy['reason']|'review_unavailable'|'merge_conflict'|'mergeability_pending'|'ancestry_unknown'|'branch_behind'|'checks_incomplete_or_stale'|'test_checks_incomplete_or_stale'|'test_merge_unknown'|'status_producer_unknown'|'required_check_missing'|'required_check_pending'|'required_check_unknown'|'required_check_failed'|'required_checks_satisfied';
export type ReadinessDecision = {state: 'ready'|'waiting'|'conflicting'|'unknown'; reason: ReadinessReason; input_head?: string};
export type MergeOutcome = {state: 'merged'; final_head: string}|{state: 'rejected'; status: number; reason: 'access_denied'|'pr_missing'|'merge_rejected'|'unexpected_head'|'rate_limited'; cooldown_ms: number}|{state: 'unknown'; reason: 'provider_unavailable'|'invalid_provider_response'};
export type MergeRecovery = {state: 'merged'; final_head: string; merged_at: string; review: FinalizationReview}|{state: 'unknown'; reason: 'unresolved_merge'|'pr_missing'|'unexpected_head'|'provider_unavailable'|'invalid_provider_response'};
const oid = (v: unknown): v is string => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const stamp = () => new Date().toISOString();
const validTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(githubExpiry(v));
function invalid(): never {throw new RemoteProviderError('invalid_provider_response');}
function object(v: unknown): Record<string, unknown> {if (!v || typeof v !== 'object' || Array.isArray(v)) invalid(); return v as Record<string, unknown>;}
function text(v: unknown): v is string {return typeof v === 'string' && v.length > 0 && [...v].length <= 256;}
function grantMatches(scope: GitHubRemoteScope, grant: GitHubRemoteGrant, profile: 'readiness'|'merge'|'reconcile'): void {
 if (grant.repository_id !== scope.repository_id || !grant.token || grant.token.length > 4096 || githubExpiry(grant.expires_at) <= Date.now() + 30_000 || githubExpiry(grant.expires_at) > Date.now() + 7200_000 || !Number.isFinite(githubExpiry(grant.expires_at)) || canonicalJSON(grant.permissions) !== canonicalJSON(remoteProfile(scope, profile))) invalid();
}
function targetPath(target: string): string {validateGitRef('refs/heads/' + target); return encodeURIComponent(target);}
function validateIntent(scope: GitHubRemoteScope, intent: FinalizationIntent): void {
 if (!oid(intent.accepted_head) || !positive(intent.review.pr_number) || !/^[1-9][0-9]{0,15}$/.test(intent.review.pr_id) || !positive(Number(intent.review.pr_id)) || intent.review.repository_id !== scope.repository_id || intent.review.head_ref !== intent.delivery_ref.slice(11) || intent.review.base_ref !== intent.target_branch || intent.review.marker !== `<!-- monos-delivery-item:${intent.item_id} -->` || intent.review.url !== `https://github.com/${scope.repository_identity.slice(11)}/pull/${intent.review.pr_number}`) invalid();
 validateGitRef(intent.delivery_ref); targetPath(intent.target_branch);
}
function policyFacts(scope: GitHubRemoteScope, target: string, value: Omit<ProtectionPolicy, 'repository_id'|'target_branch'|'digest'|'observed_at'>): ProtectionPolicy {
 const facts = {repository_id: scope.repository_id, target_branch: target, ...value};
 return {...facts, digest: hash(facts), observed_at: stamp()};
}
function parsePolicy(scope: GitHubRemoteScope, target: string, protection: unknown, rules: unknown, unprotected: boolean): ProtectionPolicy {
 if (!Array.isArray(rules) || rules.length > 100) invalid();
 // The rules endpoint is an unpaginated complete applicable-rule array. Any active
 // rule is outside this adapter's classic-only support, including unknown kinds.
 for (const rule of rules) {const r = object(rule); if (!text(r.type)) invalid();}
 const result = {protected: !unprotected, strict: false, linear_history: false, requirements: [] as RequiredContext[], supported: true, reason: 'supported' as ProtectionPolicy['reason']};
 if (rules.length) {result.supported = false; result.reason = 'unsupported_rules';}
 if (!unprotected) {
  const p = object(protection);
  const known = new Set(['url', 'required_status_checks', 'enforce_admins', 'required_pull_request_reviews', 'restrictions', 'required_linear_history', 'allow_force_pushes', 'allow_deletions', 'block_creations', 'required_conversation_resolution', 'required_signatures', 'lock_branch', 'allow_fork_syncing']);
  if (Object.keys(p).some(k => !known.has(k))) {result.supported = false; result.reason = 'unsupported_protection';}
  for (const key of ['required_conversation_resolution', 'required_signatures', 'lock_branch', 'block_creations']) {
   if (p[key] !== undefined) {const f = object(p[key]); if (typeof f.enabled !== 'boolean') invalid(); if (f.enabled) {result.supported = false; result.reason = 'unsupported_protection';}}
  }
  if (p.required_pull_request_reviews != null || p.restrictions != null) {result.supported = false; result.reason = 'unsupported_protection';}
  if (p.required_linear_history !== undefined) {const f = object(p.required_linear_history); if (typeof f.enabled !== 'boolean') invalid(); result.linear_history = f.enabled;}
  if (p.required_status_checks != null) {
   const c = object(p.required_status_checks);
   if (typeof c.strict !== 'boolean' || !Array.isArray(c.contexts) || !Array.isArray(c.checks) || c.contexts.length > 100 || c.checks.length > 100) invalid();
   if (Object.keys(c).some(k => !['url','strict','contexts','contexts_url','checks'].includes(k))) {result.supported = false; result.reason = 'unsupported_protection';}
   result.strict = c.strict;
   for (const entry of c.checks) {const e = object(entry); if (!text(e.context) || !(e.app_id === null || e.app_id === -1 || positive(e.app_id))) invalid(); result.requirements.push({context: e.context, app_id: e.app_id === -1 ? null : e.app_id as number|null});}
   for (const context of c.contexts) {if (!text(context)) invalid(); if (!result.requirements.some(r => r.context === context)) result.requirements.push({context, app_id: null});}
   const seen = new Set<string>(); for (const r of result.requirements) {const key = canonicalJSON(r); if (seen.has(key)) invalid(); seen.add(key);}
   result.requirements.sort((a,b) => a.context.localeCompare(b.context) || (a.app_id ?? -1) - (b.app_id ?? -1));
  }
 }
 const facts = policyFacts(scope, target, result);
 return {...facts,digest:hash({repository_id:scope.repository_id,target_branch:target,policy:result,protection:unprotected?null:protection,rules})};
}

/** Validate durable pages before they can supply completeness or cached authority. */
export function validateReadinessCollection(c: ReadinessCollection): boolean {
 try {
  if (!c || !/^[1-9][0-9]{0,15}$/.test(c.repository_id) || !positive(Number(c.repository_id)) || !oid(c.head) || !['check_run','status'].includes(c.kind) || !Array.isArray(c.pages) || c.pages.length < 1 || c.pages.length > 10) return false;
  let total: number|undefined; const ids = new Set<number>();
  for (let i = 0; i < c.pages.length; i++) {
   const p = c.pages[i]!;
   if (p.repository_id !== c.repository_id || p.head !== c.head || p.kind !== c.kind || p.page !== i+1 || !validTime(p.observed_at) || typeof p.more !== 'boolean' || !Array.isArray(p.items) || p.items.length > 100 || p.etag !== undefined && (typeof p.etag !== 'string' || p.etag.length > 512)) return false;
   if (c.kind === 'check_run') {
    if (!Number.isSafeInteger(p.total) || p.total! < 0 || p.total! > 1000 || total !== undefined && p.total !== total) return false;
    total = p.total; if (p.items.length !== Math.max(0,Math.min(100,total! - i*100)) || p.more !== ((i+1)*100 < total!)) return false;
   } else if (p.more !== (p.items.length === 100)) return false;
   if (i < c.pages.length-1 && !p.more) return false;
   for (const item of p.items) {
    if (!positive(item.provider_id) || ids.has(item.provider_id) || item.head !== c.head || item.kind !== c.kind || !text(item.name) || !validTime(item.created_at) || !(item.app_id === null || positive(item.app_id)) || c.kind === 'status' && item.app_id !== null || c.kind === 'check_run' && !positive(item.app_id) || !['pending','success','failure','neutral','skipped','cancelled','unknown'].includes(item.state)) return false;
    ids.add(item.provider_id);
   }
  }
  return !c.pages.at(-1)!.more;
 } catch {return false;}
}
function inputCollections(repository: string, head: string, collections: ReadinessCollection[], now: number): ReadinessCheck[]|null {
 if (collections.length !== 2 || !['check_run','status'].every(k => collections.filter(c => c.kind === k).length === 1)) return null;
 for (const c of collections) if (c.repository_id !== repository || c.head !== head || !validateReadinessCollection(c) || c.pages.some(p => now-githubExpiry(p.observed_at) > 15_000 || githubExpiry(p.observed_at) > now)) return null;
 return collections.flatMap(c => c.pages.flatMap(p => p.items));
}
export function evaluateReadiness(input: {review: FinalizationReview; policy: ProtectionPolicy; collections: ReadinessCollections; ancestry?: AncestryProof; now?: number}): ReadinessDecision {
 const {review,policy,collections,ancestry} = input, now = input.now ?? Date.now();
 if (!policy.supported) return {state:'unknown',reason:policy.reason};
 if (policy.repository_id !== review.review.repository_id || policy.target_branch !== review.review.base_ref || review.merged || review.review.state !== 'open' || review.draft) return {state:'unknown',reason:'review_unavailable'};
 if (review.mergeability === 'conflicting') return {state:'conflicting',reason:'merge_conflict'};
 if (review.mergeability !== 'mergeable') return {state:'waiting',reason:'mergeability_pending'};
 if (policy.strict && (!ancestry || ancestry.repository_id !== policy.repository_id || ancestry.base !== review.base_head || ancestry.head !== review.head || !oid(ancestry.merge_base))) return {state:'unknown',reason:'ancestry_unknown'};
 if (policy.strict && ancestry!.merge_base !== review.base_head) return {state:'conflicting',reason:'branch_behind'};
 const head = inputCollections(policy.repository_id,review.head,collections.head,now);
 if (!head) return {state:'unknown',reason:'checks_incomplete_or_stale'};
 let selected = head, selectedHead = review.head;
 if (review.test_head) {
  const test = inputCollections(policy.repository_id,review.test_head,collections.test,now);
  if (!test) return {state:'unknown',reason:'test_checks_incomplete_or_stale'};
  if (test.length) {selected = test; selectedHead = review.test_head;}
 } else if (policy.requirements.length) return {state:'unknown',reason:'test_merge_unknown'};
 const latest = new Map<string, ReadinessCheck>();
 for (const c of selected) {
  const key = canonicalJSON([c.kind,c.name,c.app_id]), old = latest.get(key);
  if (!old || (c.kind === 'check_run' ? c.provider_id > old.provider_id : githubExpiry(c.created_at) > githubExpiry(old.created_at) || githubExpiry(c.created_at) === githubExpiry(old.created_at) && c.provider_id > old.provider_id)) latest.set(key,c);
 }
 for (const required of policy.requirements) {
  const matching = [...latest.values()].filter(c => c.name === required.context);
  const statuses = matching.filter(c => c.kind === 'status');
  if (required.app_id !== null && statuses.length) return {state:'unknown',reason:'status_producer_unknown',input_head:selectedHead};
  const checks = matching.filter(c => c.kind === 'check_run' && (required.app_id === null || c.app_id === required.app_id));
  if (!checks.length && !statuses.length) return {state:'waiting',reason:'required_check_missing',input_head:selectedHead};
  for (const c of [...checks,...statuses]) {
   if (c.state === 'pending') return {state:'waiting',reason:'required_check_pending',input_head:selectedHead};
   if (c.state === 'unknown') return {state:'unknown',reason:'required_check_unknown',input_head:selectedHead};
   if (!(c.kind === 'check_run' ? ['success','neutral','skipped'].includes(c.state) : c.state === 'success')) return {state:'conflicting',reason:'required_check_failed',input_head:selectedHead};
  }
 }
 return {state:'ready',reason:'required_checks_satisfied',input_head:selectedHead};
}
export function selectMergeMethod(settings: MergeSettings, policy: Pick<ProtectionPolicy,'linear_history'|'repository_id'>, configured?: MergeMethod, retained?: MergeMethod): MergeMethod|null {
 if (settings.repository_id !== policy.repository_id || typeof settings.allow_merge !== 'boolean' || typeof settings.allow_squash !== 'boolean' || typeof settings.allow_rebase !== 'boolean') return null;
 const allowed = (m: MergeMethod) => (m !== 'merge' || !policy.linear_history) && settings['allow_'+m as 'allow_merge'|'allow_squash'|'allow_rebase'];
 if (retained) return (!configured || configured === retained) && allowed(retained) ? retained : null;
 if (configured) return allowed(configured) ? configured : null;
 return (['merge','squash','rebase'] as const).find(allowed) ?? null;
}

export class GitHubFinalization {
 readonly remote: GitHubRemote;
 constructor(remote: GitHubRemote) {this.remote = remote;}
 async review(scope: GitHubRemoteScope, intent: FinalizationIntent, grant: GitHubRemoteGrant, budget?: ProviderBudget): Promise<FinalizationReview> {
  validateIntent(scope,intent);
  if (canonicalJSON(grant.permissions) === canonicalJSON(remoteProfile(scope,'reconcile'))) grantMatches(scope,grant,'reconcile'); else grantMatches(scope,grant,'readiness');
  const reply = await this.remote.request(scope,this.remote.prefix(scope)+'/pulls/'+intent.review.pr_number,grant,budget);
  if (reply.status === 404) throw new RemoteProviderError('pr_missing');
  const snap = this.remote.snapshot(scope,intent,reply.data), p = object(reply.data);
  if (snap.review.pr_id !== intent.review.pr_id || snap.review.pr_number !== intent.review.pr_number || intent.review.repository_id !== scope.repository_id || snap.review.head_ref !== intent.review.head_ref || snap.review.base_ref !== intent.review.base_ref || snap.review.marker !== intent.review.marker) invalid();
  if (snap.head !== intent.accepted_head) throw new RemoteProviderError('unexpected_head');
  if (typeof p.draft !== 'boolean' || typeof p.merged !== 'boolean' || !(p.merged_at === null || validTime(p.merged_at)) || !(p.merge_commit_sha === null || oid(p.merge_commit_sha))) invalid();
  if (p.merged && (!p.merged_at || !oid(p.merge_commit_sha) || p.state !== 'closed') || !p.merged && p.merged_at !== null) invalid();
  return {...snap,draft:p.draft,merged:p.merged,merged_at:p.merged_at as string|null,final_head:p.merged ? p.merge_commit_sha as string : null,test_head:p.merged ? null : p.merge_commit_sha as string|null,observed_at:stamp()};
 }
 async policy(scope: GitHubRemoteScope, target: string, grant: GitHubRemoteGrant, budget?: ProviderBudget, mode: 'protected'|'unprotected' = 'protected'): Promise<ProtectionPolicy> {
  grantMatches(scope,grant,'readiness'); const prefix = this.remote.prefix(scope)+'/branches/'+targetPath(target);
  const response = await this.remote.request(scope,prefix+(mode === 'protected' ? '/protection' : ''),grant,budget);
  if (response.status === 404) return policyFacts(scope,target,{protected:mode==='protected',strict:false,linear_history:false,requirements:[],supported:false,reason:'protection_unknown'});
  if (mode === 'unprotected') {const b = object(response.data); if (b.name !== target || typeof b.protected !== 'boolean') invalid(); if (b.protected) return policyFacts(scope,target,{protected:true,strict:false,linear_history:false,requirements:[],supported:false,reason:'protection_unknown'});}
  const rules = await this.remote.request(scope,this.remote.prefix(scope)+'/rules/branches/'+targetPath(target),grant,budget);
  if (rules.status === 404) return policyFacts(scope,target,{protected:mode==='protected',strict:false,linear_history:false,requirements:[],supported:false,reason:'protection_unknown'});
  return parsePolicy(scope,target,response.data,rules.data,mode==='unprotected');
 }
 async checkPage(scope: GitHubRemoteScope, head: string, kind: ReadinessCheck['kind'], page: number, grant: GitHubRemoteGrant, budget?: ProviderBudget, retained?: ReadinessPage): Promise<ReadinessPage> {
  grantMatches(scope,grant,'readiness'); if (!oid(head) || !['check_run','status'].includes(kind) || !Number.isInteger(page) || page < 1 || page > 10) invalid();
  if (retained && (retained.repository_id !== scope.repository_id || retained.head !== head || retained.kind !== kind || retained.page !== page || !validTime(retained.observed_at))) invalid();
  const path = this.remote.prefix(scope)+`/commits/${head}/`+(kind==='check_run'?'check-runs':'statuses')+`?per_page=100&page=${page}`+(kind==='check_run'?'&filter=latest':'');
  const reply = await this.remote.request(scope,path,grant,budget,'GET',undefined,retained?.etag);
  if (reply.status === 304) {
   if (!retained || !retained.etag) invalid();
   // Validation of partial cached pages is independent of final collection length.
   this.validatePage(retained); return {...retained,observed_at:stamp()};
  }
  const raw = kind==='check_run'?object(reply.data):{}, rows = kind==='check_run'?raw.check_runs:reply.data;
  if (!Array.isArray(rows) || rows.length > 100 || kind==='check_run' && (!Number.isSafeInteger(raw.total_count) || Number(raw.total_count)<0)) invalid();
  const items = rows.map(v => {
   const c = object(v); if (!positive(c.id) || !text(kind==='check_run'?c.name:c.context) || kind==='status' && !validTime(c.created_at)) invalid();
   let state: ReadinessCheck['state'], app: number|null = null;
   if (kind==='status') {if (!['success','pending','failure','error'].includes(String(c.state))) invalid(); if (c.sha !== undefined && c.sha !== head) invalid(); state = c.state==='error'?'failure':c.state as ReadinessCheck['state'];}
   else {
    if (!(c.started_at === null || validTime(c.started_at)) || c.head_sha !== head || !['queued','in_progress','completed','waiting','requested','pending'].includes(String(c.status))) invalid();
    const producer = object(c.app); if (!positive(producer.id)) invalid(); app = producer.id;
    state = c.status!=='completed'?'pending':['success','neutral','skipped','cancelled'].includes(String(c.conclusion))?c.conclusion as ReadinessCheck['state']:['failure','timed_out','action_required','startup_failure','stale'].includes(String(c.conclusion))?'failure':'unknown';
   }
   return {kind,provider_id:c.id,head,name:(kind==='check_run'?c.name:c.context) as string,state,app_id:app,created_at:(kind==='status'?c.created_at:c.started_at ?? '1970-01-01T00:00:00Z') as string};
  });
  const value: ReadinessPage = {repository_id:scope.repository_id,head,kind,page,items,more:kind==='check_run'?page*100<Number(raw.total_count):items.length===100,...(kind==='check_run'?{total:Number(raw.total_count)}:{}),...(reply.etag?{etag:reply.etag}:{}),observed_at:stamp()};
  this.validatePage(value); return value;
 }
 private validatePage(p: ReadinessPage): void {
  if (!Number.isInteger(p.page) || p.page<1 || p.page>10 || typeof p.more !== 'boolean' || !Array.isArray(p.items) || p.items.length>100) invalid();
  if (p.kind==='check_run' && (!Number.isSafeInteger(p.total) || p.total!<0 || p.total!>1000 || p.items.length!==Math.max(0,Math.min(100,p.total!-(p.page-1)*100)) || p.more!==(p.page*100<p.total!))) invalid();
  if (p.kind==='status' && p.more!==(p.items.length===100)) invalid();
  for (const c of p.items) if (c.head!==p.head || c.kind!==p.kind || !positive(c.provider_id) || !text(c.name) || !validTime(c.created_at) || !(c.app_id===null || positive(c.app_id)) || c.kind==='status'&&c.app_id!==null || c.kind==='check_run'&&!positive(c.app_id) || !['pending','success','failure','neutral','skipped','cancelled','unknown'].includes(c.state)) invalid();
 }
 async ancestry(scope: GitHubRemoteScope, base: string, head: string, grant: GitHubRemoteGrant, budget?: ProviderBudget): Promise<AncestryProof> {
  grantMatches(scope,grant,'readiness'); if (!oid(base)||!oid(head)) invalid();
  const reply = await this.remote.request(scope,this.remote.prefix(scope)+`/compare/${base}...${head}`,grant,budget), p = object(reply.data);
  const original = object(p.base_commit), merge = object(p.merge_base_commit);
  if (original.sha!==base || !oid(merge.sha) || !['ahead','behind','identical','diverged'].includes(String(p.status))) invalid();
  return {repository_id:scope.repository_id,base,head,merge_base:merge.sha,observed_at:stamp()};
 }
 async settings(scope: GitHubRemoteScope, grant: GitHubRemoteGrant, budget?: ProviderBudget): Promise<MergeSettings> {
  grantMatches(scope,grant,'merge'); const reply = await this.remote.request(scope,this.remote.prefix(scope),grant,budget), p = object(reply.data);
  if (String(p.id)!==scope.repository_id || typeof p.full_name!=='string' || 'github.com/'+p.full_name.toLowerCase()!==scope.repository_identity || typeof p.allow_merge_commit!=='boolean' || typeof p.allow_squash_merge!=='boolean' || typeof p.allow_rebase_merge!=='boolean') invalid();
  return {repository_id:scope.repository_id,allow_merge:p.allow_merge_commit,allow_squash:p.allow_squash_merge,allow_rebase:p.allow_rebase_merge,observed_at:stamp()};
 }
 /** One call only. The coordinator must persist possible effect and locked authority
  * before invoking; unknown is never permission for a second invocation. */
 async merge(scope: GitHubRemoteScope, intent: FinalizationIntent, method: MergeMethod, grant: GitHubRemoteGrant, budget?: ProviderBudget): Promise<MergeOutcome> {
  grantMatches(scope,grant,'merge'); this.remote.prefix(scope);
  validateIntent(scope,intent); if (!['merge','squash','rebase'].includes(method)) invalid();
  if (budget) {if (budget.remaining<1) throw new ProviderTurnComplete(); budget.remaining--;}
  try {
   const response = await this.remote.fetcher('https://api.github.com'+this.remote.prefix(scope)+'/pulls/'+intent.review.pr_number+'/merge',{method:'PUT',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{Authorization:'Bearer '+grant.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'monos','Content-Type':'application/json'},body:JSON.stringify({sha:intent.accepted_head,merge_method:method})});
   const data = await boundedJSON(response), p = object(data);
   if (response.status===200) return p.merged===true && oid(p.sha) ? {state:'merged',final_head:p.sha} : {state:'unknown',reason:'invalid_provider_response'};
   if (![403,404,405,409,422,429].includes(response.status) || typeof p.message!=='string' || !p.message.length) return {state:'unknown',reason:'invalid_provider_response'};
   const retry=response.headers.get('retry-after'), reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
   const rate=response.status===429 || response.status===403 && (retry!==null || response.headers.get('x-ratelimit-remaining')==='0' || /\bsecondary rate limit\b/i.test(p.message));
   let delay=retry ? /^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-Date.now() : response.headers.get('x-ratelimit-remaining')==='0' ? reset-Date.now() : 0;
   if (rate) delay=Math.max(60_000,Number.isFinite(delay)?delay:60_000);
   return {state:'rejected',status:response.status,reason:rate?'rate_limited':response.status===403?'access_denied':response.status===404?'pr_missing':response.status===409?'unexpected_head':'merge_rejected',cooldown_ms:rate?Math.min(86400_000,delay):0};
  } catch(e) {return {state:'unknown',reason:e instanceof RemoteProviderError && e.reason==='invalid_provider_response'?'invalid_provider_response':'provider_unavailable'};}
 }
 async reconcile(scope: GitHubRemoteScope, intent: FinalizationIntent, grant: GitHubRemoteGrant, budget?: ProviderBudget): Promise<MergeRecovery> {
  grantMatches(scope,grant,'reconcile');
  try {const review=await this.review(scope,intent,grant,budget); return review.merged && review.final_head && review.merged_at ? {state:'merged',final_head:review.final_head,merged_at:review.merged_at,review} : {state:'unknown',reason:'unresolved_merge'};}
  catch(e) {if (e instanceof ProviderTurnComplete) throw e; return {state:'unknown',reason:e instanceof RemoteProviderError && ['pr_missing','unexpected_head','invalid_provider_response'].includes(e.reason) ? e.reason as 'pr_missing'|'unexpected_head'|'invalid_provider_response' : 'provider_unavailable'};}
 }
}
async function boundedJSON(response: Response): Promise<unknown> {
 if (!response.body) invalid(); const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
 try {while(true) {const c=await reader.read(); if(c.done) break; size+=c.value.length; if(size>1024*1024) invalid(); chunks.push(c.value);}}
 finally {await reader.cancel();}
 try {const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown; canonicalJSON(value); return value;} catch {invalid();}
}
