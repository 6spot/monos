/** Authorized exact synthetic provider kernel evidence. Never production App proof. */
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {lstat, open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {canonicalJSON, validate} from '../../../../packages/protocol/src/index.ts';
import type {PublicationCandidateManifest, RemotePreparationReview} from '../../../../packages/protocol/src/index.ts';
import {GitHub} from '../../../../apps/server/src/github.ts';
import {GitHubRemote, remoteProfile} from '../../../../apps/server/src/github-remote.ts';
import type {GitHubRemoteScope, RemoteReviewSnapshot, RemoteReviewIntent} from '../../../../apps/server/src/github-remote.ts';

export const fixture = Object.freeze({
  name: '6spot/monolab-feasibility-20260928-160020-public',
  id: '1393178791',
  description: 'Synthetic MonoLab provider feasibility fixture; no product source.',
  identity: 'github.com/6spot/monolab-feasibility-20260928-160020-public',
  url: 'https://github.com/6spot/monolab-feasibility-20260928-160020-public.git',
});
const hash = (value: unknown) => createHash('sha256').update(canonicalJSON(value)).digest('hex');
const oid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
function ensure(condition: unknown, safeMessage: string): asserts condition {
  if (!condition) throw new Error(safeMessage);
}
export interface NativeKernelInput {
  action: 'prepare_push' | 'correction_push'; repository: string; repository_id: string;
  task_id: string; resource_id: string; item_id: string; operation_id: string;
  previous_operation_id?: string; base: string; expected_head: string | null;
  synthetic_text?: string;
}
export interface NativePushEvidence {
  intent: NativeKernelInput;
  candidate: PublicationCandidateManifest;
  scan: {complete: boolean; workflow_changes: boolean; findings_count: number; candidate_manifest_digest: string};
  absence: {worker_absent: boolean; request_digest: string};
  result: {fixture_scope: string; operation_id: string; status: string; head: string; observed_head: string; worker_absent: boolean};
  proof: {schema_version: number; fixture_scope: string; input: NativeKernelInput; request_digest: string;
    candidate_manifest_digest: string; head: string; tree: string; parents: string[];
    delivery_ref: string; observed_head: string; worker_absent: boolean};
}
// These are explicitly scoped kernel facts, not fabricated workspace/Runner
// provenance or a formal PublicationPushRequest accepted by the coordinator.
export interface NativePublishedPush {input: NativeKernelInput; candidate: PublicationCandidateManifest; delivery_ref: string; target_branch: 'main'; item_id: string}
function verifyKernelInput(input: NativeKernelInput): void {
  ensure(input.repository === fixture.name && input.repository_id === fixture.id, 'Push scope differs from fixture');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const id = /^[A-Za-z0-9_-]{1,128}$/;
  ensure(uuid.test(input.task_id) && uuid.test(input.resource_id) && id.test(input.item_id) && id.test(input.operation_id) && oid(input.base), 'Native kernel identity invalid');
  ensure(input.action === 'prepare_push' ? input.expected_head === null && !input.previous_operation_id : input.action === 'correction_push' && oid(input.expected_head) && !!input.previous_operation_id && id.test(input.previous_operation_id), 'Native kernel parent invalid');
  ensure(input.synthetic_text === undefined || typeof input.synthetic_text === 'string' && Buffer.byteLength(input.synthetic_text) <= 4096 && !input.synthetic_text.includes(String.fromCharCode(0)) && !input.synthetic_text.includes('\r'), 'Native synthetic text invalid');
}

export class NativeProviderKernel {
  readonly scope: GitHubRemoteScope = {
    resource_id: '', repository_identity: fixture.identity, repository_id: fixture.id,
    remote_url: fixture.url, workflow_changes: false,
  };
  readonly provider: GitHubRemote;
  readonly evidenceDirectory: string;
  private readonly token: string;
  private sequence = 0;
  private withheldCreates = 0;
  private createCalls = 0;
  private metadataCalls = 0;
  private closeCalls = 0;
  private withholdNextCreate = false;

  private constructor(evidenceDirectory: string, token: string) {
    this.evidenceDirectory = evidenceDirectory;
    this.token = token;
    // The synthetic dependency declares the profile required by this kernel.
    // OAuth is broader and this is never evidence of a real installation grant.
    this.provider = new GitHubRemote(new GitHub('synthetic-kernel-encryption-key-000000000000'), {
      acquireGrant: async (scope, profile) => {
        this.requireScope(scope);
        return {token: this.token, expires_at: new Date(Date.now() + 3600_000).toISOString(),
          repository_id: fixture.id, permissions: remoteProfile(scope, profile)};
      },
      fetcher: async (input, init) => {
        const url = String(input);
        ensure(url.startsWith('https://api.github.com/repos/' + fixture.name + '/'), 'Unexpected synthetic provider scope');
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          ensure(url === 'https://api.github.com/repos/' + fixture.name + '/pulls', 'Unexpected synthetic POST');
          this.createCalls++;
          ensure(this.createCalls === 1, 'Duplicate native PR create refused');
        } else if (method === 'PATCH') {
          ensure(new RegExp('^https://api[.]github[.]com/repos/' + fixture.name + '/pulls/[1-9][0-9]*$').test(url), 'Unexpected synthetic PATCH');
          const body = JSON.parse(String(init?.body)) as {state?: unknown};
          if (body.state === 'closed') this.closeCalls++; else this.metadataCalls++;
        } else ensure(method === 'GET', 'Unexpected synthetic provider method');
        const name = String(++this.sequence).padStart(4, '0');
        await this.saveExclusive(name + '-http-intent.json', {method, url, body_digest: init?.body ? createHash('sha256').update(String(init.body)).digest('hex') : null});
        const response = await fetch(input, init);
        await this.saveExclusive(name + '-http-observation.json', {method, url, status: response.status, observed_at: new Date().toISOString()});
        if (method === 'POST' && this.withholdNextCreate && response.ok) {
          this.withholdNextCreate = false; this.withheldCreates++;
          await response.body?.cancel();
          throw new Error('Synthetic successful create response withheld');
        }
        return response;
      },
    });
  }

  static async create(evidenceDirectory: string): Promise<NativeProviderKernel> {
    const dir = await lstat(evidenceDirectory);
    ensure(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o777) === 0o700 && dir.uid === process.getuid?.(), 'Evidence directory must be private and owned');
    const auth = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], {encoding: 'utf8', maxBuffer: 8192});
    ensure(auth.status === 0 && typeof auth.stdout === 'string', 'Private OAuth acquisition unavailable');
    const token = auth.stdout.trim();
    ensure(token.length > 0 && token.length <= 4096, 'Private OAuth acquisition invalid');
    return new NativeProviderKernel(evidenceDirectory, token);
  }

  requireScope(scope: GitHubRemoteScope): void {
    ensure(scope.repository_id === fixture.id && scope.repository_identity === fixture.identity && scope.remote_url === fixture.url && !scope.workflow_changes, 'Exact synthetic fixture scope required');
  }

  async saveExclusive(name: string, value: unknown): Promise<void> {
    ensure(/^[a-z0-9-]+[.]json$/.test(name), 'Invalid evidence basename');
    const text = canonicalJSON(value);
    ensure(Buffer.byteLength(text) <= 512 * 1024 && !text.includes(this.token), 'Unsafe or oversized native evidence');
    const file = await open(join(this.evidenceDirectory, name), 'wx', 0o600);
    try {await file.writeFile(text); await file.sync();} finally {await file.close();}
    const directory = await open(this.evidenceDirectory, 'r');
    try {await directory.sync();} finally {await directory.close();}
  }

  async preflight(): Promise<string> {
    const headers = {Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'monos'};
    const boundedRead = async (path: string): Promise<unknown> => {
      const response = await fetch('https://api.github.com' + path, {headers, redirect: 'error', signal: AbortSignal.timeout(10_000)});
      ensure(response.ok && response.body, 'Synthetic preflight unavailable');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {while (true) {const next = await reader.read(); if (next.done) break; size += next.value.length; ensure(size <= 1024 * 1024, 'Synthetic preflight overflow'); chunks.push(next.value);}} finally {await reader.cancel();}
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))) as unknown;
    };
    const user = await boundedRead('/user') as {login?: unknown};
    ensure(user.login === '6spot', 'Synthetic account differs');
    const repo = await boundedRead('/repos/' + fixture.name) as {id?: unknown; full_name?: unknown; description?: unknown; private?: unknown; archived?: unknown; default_branch?: unknown; permissions?: {push?: unknown}; clone_url?: unknown};
    ensure(String(repo.id) === fixture.id && repo.full_name === fixture.name && repo.description === fixture.description && repo.private === false && repo.archived === false && repo.default_branch === 'main' && repo.permissions?.push === true && repo.clone_url === fixture.url, 'Synthetic repository identity or marker differs');
    const ref = await boundedRead('/repos/' + fixture.name + '/git/ref/heads/main') as {ref?: unknown; object?: {type?: unknown; sha?: unknown}};
    ensure(ref.ref === 'refs/heads/main' && ref.object?.type === 'commit' && oid(ref.object.sha), 'Synthetic main ref invalid');
    await this.saveExclusive('preflight-' + randomUUID() + '.json', {scope: 'authenticated read-only exact historical synthetic fixture', account: '6spot', repository: fixture, base_head: ref.object.sha, observed_at: new Date().toISOString()});
    return ref.object.sha;
  }

  verifyPush(raw: NativePushEvidence): NativePublishedPush {
    const input = raw.intent, proof = raw.proof, result = raw.result;
    verifyKernelInput(input);
    const candidate = validate<PublicationCandidateManifest>('PublicationCandidateManifest', raw.candidate);
    const manifestDigest = hash(candidate), requestDigest = hash(input);
    const deliveryRef = `refs/heads/monos/task/${input.task_id}/${input.resource_id}`;
    ensure(candidate.candidate_id === input.operation_id && candidate.construction_id === input.operation_id && candidate.source_digest === requestDigest && candidate.parents.length === 1 && candidate.parents[0] === (input.expected_head ?? input.base), 'Native candidate identity/parent differs');
    ensure(raw.scan.complete === true && raw.scan.workflow_changes === false && raw.scan.findings_count === 0 && raw.scan.candidate_manifest_digest === manifestDigest, 'Native kernel requires exact complete clean scan with explicit workflow fact');
    ensure(proof.schema_version === 1 && proof.fixture_scope === 'oauth_injected_remote_kernel' && hash(proof.input) === requestDigest && proof.request_digest === requestDigest && proof.candidate_manifest_digest === manifestDigest && proof.head === candidate.head && proof.tree === candidate.tree && canonicalJSON(proof.parents) === canonicalJSON(candidate.parents) && proof.delivery_ref === deliveryRef && proof.observed_head === candidate.head && proof.worker_absent === true, 'Native proof does not bind exact published candidate');
    ensure(raw.absence.worker_absent === true && raw.absence.request_digest === requestDigest && result.fixture_scope === proof.fixture_scope && result.operation_id === input.operation_id && result.status === 'published' && result.head === candidate.head && result.observed_head === candidate.head && result.worker_absent === true, 'Native push lacks exact result/physical release');
    this.scope.resource_id = input.resource_id;
    return {input, candidate, delivery_ref: deliveryRef, target_branch: 'main', item_id: input.item_id};
  }

  async nativePush(input: NativeKernelInput, bridge: (input: NativeKernelInput, ephemeralToken: string) => Promise<NativePushEvidence>): Promise<NativePublishedPush> {
    verifyKernelInput(input);
    ensure(await this.preflight() === input.base, 'Synthetic public main changed before native effect');
    await this.saveExclusive('native-' + input.operation_id + '-intent.json', {fixture_scope: 'oauth_injected_remote_kernel', input});
    const evidence = await bridge(input, this.token);
    ensure(hash(evidence.intent) === hash(input), 'Native bridge returned another intent');
    const published = this.verifyPush(evidence);
    await this.saveExclusive('native-' + input.operation_id + '-evidence.json', evidence);
    return published;
  }

  providerIntent(push: NativePublishedPush, kind: RemoteReviewIntent['kind'], review?: RemotePreparationReview): RemoteReviewIntent {
    const content = {title: 'monos synthetic remote preparation ' + push.candidate.head.slice(0, 12), body: `Synthetic lower-kernel fixture only. No product source or Owner acceptance.\n\nHead: ${push.candidate.head}\n\n<!-- monos-delivery-item:${push.item_id} -->`};
    return {
      item_id: push.item_id, delivery_ref: push.delivery_ref, target_branch: push.target_branch,
      kind, ...(review ? {review} : {}), ...(kind === 'close_pr' ? {} : {content}),
    };
  }

  async find(intent: RemoteReviewIntent): Promise<RemoteReviewSnapshot[]> {
    const budget = {remaining: 8}; let grant = await this.provider.grant(this.scope, 'poll', budget);
    const matches: RemoteReviewSnapshot[] = [];
    for (let page = 1; page <= 10; page++) {
      if (budget.remaining === 0) {budget.remaining = 8; grant = await this.provider.grant(this.scope, 'poll', budget);}
      const result = await this.provider.findReviewPage(this.scope, intent, grant, page, budget);
      matches.push(...result.items);
      if (!result.more) return matches;
    }
    throw new Error('Native review lookup incomplete');
  }

  async openWithLostResponse(push: NativePublishedPush): Promise<RemoteReviewSnapshot> {
    await this.preflight();
    const intent = this.providerIntent(push, 'create_pr');
    ensure((await this.find(intent)).length === 0, 'Existing native review prevents fresh create');
    await this.saveExclusive('create-pr-intent.json', intent); // Precedes the actual POST.
    const grant = await this.provider.grant(this.scope, 'review', {remaining: 8});
    const ref = await this.provider.request(this.scope, '/repos/' + fixture.name + '/git/ref/' + push.delivery_ref.slice(5), grant, {remaining: 7});
    const advertised = ref.data as {ref?: unknown; object?: {type?: unknown; sha?: unknown}};
    ensure(ref.status === 200 && advertised?.ref === push.delivery_ref && advertised.object?.type === 'commit' && advertised.object.sha === push.candidate.head, 'Synthetic delivery ref changed before PR create');
    this.withholdNextCreate = true;
    try {await this.provider.mutate(this.scope, intent, grant, {remaining: 6}); throw new Error('Lost-response fixture did not withhold');}
    catch {ensure(this.withheldCreates === 1 && this.createCalls === 1, 'Create did not reach withheld successful response');}
    const found = await this.find(intent);
    ensure(found.length === 1 && found[0]!.head === push.candidate.head && found[0]!.review.state === 'open', 'Uncertain create did not resolve to one exact review');
    await this.saveExclusive('create-pr-reconciled.json', {scope: 'OAuth injected provider kernel; not production App grant or installed coordinator', intent_digest: hash(intent), snapshot: found[0], create_requests: this.createCalls, successful_responses_withheld: this.withheldCreates});
    return found[0]!;
  }

  async update(push: NativePublishedPush, previous: RemotePreparationReview): Promise<RemoteReviewSnapshot> {
    await this.preflight();
    const intent = this.providerIntent(push, 'update_pr', previous);
    await this.saveExclusive('update-pr-intent.json', intent);
    const grant = await this.provider.grant(this.scope, 'review', {remaining: 8});
    const before = await this.provider.review(this.scope, intent, grant, {remaining: 7});
    ensure(before.head === push.candidate.head && before.review.state === 'open', 'Correction is not exact current PR head');
    const result = await this.provider.mutate(this.scope, intent, grant, {remaining: 6});
    ensure(result.head === push.candidate.head && result.review.pr_id === previous.pr_id && result.content_digest === hash(intent.content), 'Metadata update differs from exact immutable intent');
    await this.saveExclusive('update-pr-result.json', {intent_digest: hash(intent), snapshot: result});
    return result;
  }

  async checks(push: NativePublishedPush, review: RemotePreparationReview): Promise<void> {
    const intent = this.providerIntent(push, 'update_pr', review); const budget = {remaining: 8};
    let grant = await this.provider.grant(this.scope, 'poll', budget);
    const before = await this.provider.review(this.scope, intent, grant, budget);
    ensure(before.head === push.candidate.head, 'Native poll head differs');
    const checks = [];
    for (const kind of ['check_run', 'status'] as const) {
      let complete = false;
      for (let page = 1; page <= 10; page++) {
        if (budget.remaining === 0) {budget.remaining = 8; grant = await this.provider.grant(this.scope, 'poll', budget);}
        const result = await this.provider.checkPage(this.scope, before.head, kind, page, grant, budget);
        checks.push(...result.items); if (!result.more) {complete = true; break;}
      }
      ensure(complete, 'Native check collection incomplete');
    }
    if (budget.remaining === 0) {budget.remaining = 8; grant = await this.provider.grant(this.scope, 'poll', budget);}
    const after = await this.provider.review(this.scope, intent, grant, budget);
    ensure(after.head === before.head && after.base_head === before.base_head && after.review.pr_id === before.review.pr_id, 'Native poll bracket drifted');
    await this.saveExclusive('checks-' + before.head + '.json', {scope: 'literal-head complete collections and trailing bracket; required readiness unknown', review, head: before.head, base_head: before.base_head, mergeability: after.mergeability, checks, complete: true, required: 'unknown', observed_at: new Date().toISOString()});
  }

  async close(push: NativePublishedPush, review: RemotePreparationReview): Promise<void> {
    await this.preflight(); const intent = this.providerIntent(push, 'close_pr', review);
    await this.saveExclusive('cancel-close-intent.json', intent);
    const grant = await this.provider.grant(this.scope, 'review', {remaining: 8});
    const before = await this.provider.review(this.scope, intent, grant, {remaining: 7});
    ensure(before.review.state === 'open' && before.head === push.candidate.head, 'Cancel close does not own exact open review');
    const result = await this.provider.mutate(this.scope, intent, grant, {remaining: 6});
    ensure(result.review.state === 'closed' && result.review.pr_id === review.pr_id, 'Cancel close did not settle exact review');
    const reply = await this.provider.request(this.scope, '/repos/' + fixture.name + '/git/ref/' + push.delivery_ref.slice(5), await this.provider.grant(this.scope, 'observe', {remaining: 8}), {remaining: 7});
    const raw = reply.data as {ref?: unknown; object?: {type?: unknown; sha?: unknown}};
    ensure(reply.status === 200 && raw?.ref === push.delivery_ref && raw.object?.type === 'commit' && raw.object.sha === push.candidate.head, 'Cancel did not retain exact branch');
    const ref = {fixture_scope: 'oauth_injected_remote_kernel', repository_id: fixture.id, delivery_ref: push.delivery_ref, observed_head: push.candidate.head};
    await this.saveExclusive('cancel-close-result.json', {scope: 'owned synthetic PR close kernel; product terminal Task proven separately by PG tests', snapshot: result, retained_ref: ref, create_requests: this.createCalls, metadata_updates: this.metadataCalls, close_requests: this.closeCalls});
  }
}

export async function loadNativePushEvidence(directory: string): Promise<NativePushEvidence> {
  const info = await lstat(directory);
  ensure(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700 && info.uid === process.getuid?.(), 'Native evidence directory invalid');
  const read = async (name: string): Promise<unknown> => {
    const file = await open(join(directory, name + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      ensure(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid?.() && stat.size <= 512 * 1024, 'Native evidence file invalid');
      const text = await file.readFile('utf8'), value: unknown = JSON.parse(text);
      ensure(text === canonicalJSON(value), 'Native evidence is not canonical');
      return value;
    } finally {await file.close();}
  };
  const names = ['intent', 'candidate', 'scan', 'absence', 'result', 'proof'] as const;
  const facts = await Promise.all(names.map(read));
  return Object.fromEntries(names.map((name, i) => [name, facts[i]])) as unknown as NativePushEvidence;
}
