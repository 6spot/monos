import {readFileSync} from 'node:fs';
import {verify} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {GitHub} from '../src/github.ts';
import type {GitHubCredentials} from '../src/github.ts';
import {GitHubRemote, ProviderTurnComplete, remoteProfile} from '../src/github-remote.ts';
import type {GitHubRemoteGrant, GitHubRemoteProfile, GitHubRemoteScope, RemoteRefIntent, RemoteReviewIntent} from '../src/github-remote.ts';

const saved = JSON.parse(readFileSync(new URL('./fixtures/github-v1-credentials.json', import.meta.url), 'utf8')) as {
  synthetic_signing_key: string; public_key: string; credentials: GitHubCredentials;
};
const task = '30000000-0000-4000-8000-000000000090';
const resource = '30000000-0000-4000-8000-000000000091';
const item = '30000000-0000-4000-8000-000000000092';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const scope: GitHubRemoteScope = {resource_id: resource, repository_identity: 'github.com/example/repo',
  repository_id: '42', remote_url: 'https://github.com/Example/Repo.git', workflow_changes: false, config: saved.credentials};
const intent: RemoteReviewIntent = {item_id: item, delivery_ref: `refs/heads/monos/task/${task}/${resource}`,
  target_branch: 'main', kind: 'create_pr', content: {title: 'Synthetic review', body: `Synthetic completion\n<!-- monos-delivery-item:${item} -->`}};
const refIntent: RemoteRefIntent = {operation_id: 'synthetic-push', item_id: item, task_id: task, resource_id: resource,
  runner_id: 'synthetic-runner', storage_id: 'synthetic-storage', repository_identity: scope.repository_identity,
  repository_id: scope.repository_id, delivery_ref: intent.delivery_ref};
const expires = () => new Date(Date.now() + 3600_000).toISOString();
const grant = (profile: GitHubRemoteProfile = 'poll', s = scope): GitHubRemoteGrant => ({token: 'synthetic-memory-only-token',
  expires_at: expires(), repository_id: s.repository_id, permissions: remoteProfile(s, profile)});
const tokenResponse = (permissions: Record<string, 'read'|'write'>) => ({token: 'synthetic-issued-token', expires_at: expires(),
  permissions, repository_selection: 'selected', repositories: [{id: 42, full_name: 'Example/Repo', clone_url: scope.remote_url}]});
const rawReview = () => ({id: 101, number: 7, title: intent.content!.title, body: intent.content!.body,
  html_url: 'https://github.com/example/repo/pull/7', state: 'open', merged_at: null, mergeable: null,
  head: {ref: intent.delivery_ref.slice(11), sha: head, repo: {id: 42}}, base: {ref: 'main', sha: base, repo: {id: 42}}});
const adapter = (fetcher: typeof fetch) => new GitHubRemote(new GitHub(saved.synthetic_signing_key), {
  fetcher, acquireGrant: async (s, profile) => grant(profile, s),
});
afterEach(() => vi.useRealTimers());

describe('remote App grant profiles and preserved v1 encryption', () => {
  it.each(['permission', 'observe', 'push', 'review', 'poll'] as const)('signs a real RSA request and selects one exact repository for %s', async (profile) => {
    const requests: {url: string; init: RequestInit}[] = [];
    const permissions = remoteProfile(scope, profile);
    const github = new GitHub(saved.synthetic_signing_key, async (url, init) => {
      requests.push({url: String(url), init: init!}); return Response.json(tokenResponse(permissions));
    });
    const issued = await new GitHubRemote(github).grant(scope, profile);
    expect(issued).toMatchObject({repository_id: '42', permissions});
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe('https://api.github.com/app/installations/456/access_tokens');
    expect(request.init.redirect).toBe('error');
    expect(JSON.parse(String(request.init.body))).toEqual({repository_ids: [42], permissions});
    expect(new Headers(request.init.headers).get('X-GitHub-Api-Version')).toBe('2022-11-28');
    const [header, payload, signature] = new Headers(request.init.headers).get('Authorization')!.slice(7).split('.');
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), saved.public_key, Buffer.from(signature!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({iss: saved.credentials.app_id});
    expect(permissions).not.toHaveProperty('administration');
    expect(permissions).not.toHaveProperty('actions');
  });

  it('requests workflows write only for an explicit changed-workflow push', async () => {
    const changed = {...scope, workflow_changes: true}, seen: unknown[] = [];
    const github = new GitHub(saved.synthetic_signing_key, async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {permissions: Record<string, 'read'|'write'>};
      seen.push(body); return Response.json(tokenResponse(body.permissions));
    });
    await new GitHubRemote(github).grant(changed, 'push');
    expect(seen).toEqual([{repository_ids: [42], permissions: {contents: 'write', metadata: 'read', workflows: 'write'}}]);
    expect(remoteProfile(scope, 'push')).not.toHaveProperty('workflows');
    expect(remoteProfile(changed, 'poll')).not.toHaveProperty('workflows');
    expect(remoteProfile(changed, 'review')).not.toHaveProperty('workflows');
  });

  it('rejects broad, expired, malformed or wrong selected-repository grants without fallback', async () => {
    const permissions = remoteProfile(scope, 'push'), good = tokenResponse(permissions);
    const bad = [
      {...good, permissions: {...permissions, administration: 'write'}},
      {...good, permissions: {contents: 'read', metadata: 'read'}},
      {...good, permissions: {contents: 'write'}},
      {...good, expires_at: new Date(Date.now() + 20_000).toISOString()},
      {...good, expires_at: new Date(Date.now() + 3 * 3600_000).toISOString()},
      {...good, expires_at: 'not-a-date'}, {...good, repository_selection: 'all'},
      {...good, repositories: []}, {...good, repositories: [...good.repositories, ...good.repositories]},
      {...good, repositories: [{...good.repositories[0], id: 43}]},
      {...good, repositories: [{...good.repositories[0], full_name: 'other/repo'}]},
      {...good, repositories: [{...good.repositories[0], clone_url: 'https://attacker.test/repo.git'}]},
      {...good, token: ''}, {...good, token: 'x'.repeat(4097)},
    ];
    for (const response of bad) {
      let calls = 0;
      const github = new GitHub(saved.synthetic_signing_key, async () => {calls++; return Response.json(response);});
      await expect(new GitHubRemote(github).grant(scope, 'push')).rejects.toMatchObject({reason: 'access_denied'});
      expect(calls).toBe(1);
    }
    let calls = 0;
    const unconfigured = new GitHubRemote(new GitHub(saved.synthetic_signing_key, async () => {calls++; return Response.json(good);}));
    await expect(unconfigured.grant({...scope, config: undefined}, 'push')).rejects.toMatchObject({reason: 'credentials_missing'});
    expect(calls).toBe(0);
  });

  it('refuses noncanonical numeric repository scope before acquiring a grant', async () => {
    let acquired = 0;
    const provider = new GitHubRemote(new GitHub(saved.synthetic_signing_key), {acquireGrant: async (s, p) => {acquired++; return grant(p, s);}});
    for (const repository_id of ['0', '042', '4.2e1', '+42', '42\n', '42.0']) {
      await expect(provider.grant({...scope, repository_id}, 'push')).rejects.toThrow();
    }
    expect(acquired).toBe(0);
  });

  it('refuses impossible-calendar grant expiry rather than Date.parse normalization', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    const response = {...tokenResponse(remoteProfile(scope, 'push')), expires_at: '2026-02-29T00:40:00Z'};
    const github = new GitHub(saved.synthetic_signing_key, async () => Response.json(response));
    await expect(new GitHubRemote(github).grant(scope, 'push')).rejects.toThrow();
  });
});

describe('fixed-host transport, bounded turns and safe provider failures', () => {
  it('bounds the whole body and invalid UTF-8 without returning provider body text', async () => {
    for (const body of ['x'.repeat(1024 * 1024 + 1), new Uint8Array([0xff]), 'not JSON']) {
      const provider = adapter(async () => new Response(body));
      await expect(provider.request(scope, '/repos/example/repo/pulls', grant())).rejects.not.toThrow('not JSON');
    }
    const requests: RequestInit[] = [], provider = adapter(async (_url, init) => {requests.push(init!); return new Response('synthetic-secret-in-error', {status: 403});});
    await expect(provider.request(scope, '/repos/example/repo/pulls', grant())).rejects.toMatchObject({reason: 'access_denied'});
    expect(requests[0]!.redirect).toBe('error');
    expect(requests[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('counts grant and HTTP requests toward eight calls and never performs the ninth', async () => {
    let calls = 0; const provider = adapter(async () => {calls++; return Response.json([]);}), budget = {remaining: 8};
    const issued = await provider.grant(scope, 'poll', budget);
    for (let i = 0; i < 7; i++) await provider.request(scope, '/repos/example/repo/pulls', issued, budget);
    await expect(provider.request(scope, '/repos/example/repo/pulls', issued, budget)).rejects.toBeInstanceOf(ProviderTurnComplete);
    expect(calls).toBe(7); expect(budget.remaining).toBe(0);
    await expect(provider.request(scope, '/repos/foreign/repo/pulls', issued)).rejects.toThrow();
    expect(calls).toBe(7);
  });

  it.each([
    {status: 429, headers: {}, expected: 60_000},
    {status: 403, headers: {'retry-after': '90'}, expected: 90_000},
    {status: 403, headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791072120'}, expected: 120_000},
  ])('retains finite cooldown for $status / $headers', async ({status, headers, expected}) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
    const provider = adapter(async () => new Response('synthetic-provider-error-body', {status, headers: headers as HeadersInit}));
    await expect(provider.request(scope, '/repos/example/repo/pulls', grant())).rejects.toMatchObject({reason: 'rate_limited', cooldown_ms: expected});
  });

  it('recognizes body-only secondary limit and waits at least one minute without exposing its body', async () => {
    const provider = adapter(async () => Response.json({message: 'You have exceeded a secondary rate limit. synthetic-sensitive-body'}, {status: 403, headers: {'x-ratelimit-remaining': '4999'}}));
    await expect(provider.request(scope, '/repos/example/repo/pulls', grant())).rejects.toMatchObject({reason: 'rate_limited', cooldown_ms: 60_000});
  });

  it('keeps absent ref distinct from unavailable and requires literal returned ref/commit identity', async () => {
    const absent = adapter(async () => new Response(null, {status: 404}));
    expect(await absent.observeRef(scope, refIntent, grant('observe'))).toMatchObject({status: 'absent', operation_id: refIntent.operation_id});
    const outage = adapter(async () => {throw new Error('synthetic-secret-network');});
    await expect(outage.observeRef(scope, refIntent, grant('observe'))).rejects.toMatchObject({reason: 'provider_unavailable'});
    for (const response of [{ref: intent.delivery_ref, object: {type: 'tree', sha: head}}, {ref: 'refs/heads/foreign', object: {type: 'commit', sha: head}}]) {
      await expect(adapter(async () => Response.json(response)).observeRef(scope, refIntent, grant('observe'))).rejects.toMatchObject({reason: 'invalid_provider_response'});
    }
    expect(await adapter(async () => Response.json({ref: intent.delivery_ref, object: {type: 'commit', sha: head}})).observeRef(scope, refIntent, grant('observe'))).toMatchObject({status: 'present', head});
  });
});

describe('exact review identity and uncertain effect recovery', () => {
  it('requires same numeric repo, literal head/base, marker and fixed PR URL', () => {
    const provider = adapter(async () => Response.json(null)), good = rawReview();
    expect(provider.snapshot(scope, intent, good)).toMatchObject({head, base_head: base, mergeability: 'unknown'});
    const bad = [{...good, head: {...good.head, repo: {id: 43}}}, {...good, base: {...good.base, ref: 'other'}},
      {...good, head: {...good.head, ref: 'other'}}, {...good, body: 'wrong marker'},
      {...good, html_url: 'https://attacker.test/pull/7'}, {...good, title: 'x'.repeat(257)},
      {...good, body: intent.content!.body + 'x'.repeat(64 * 1024)}, {...good, merged_at: 'not-a-date'}];
    for (const p of bad) expect(() => provider.snapshot(scope, intent, p)).toThrow();
    expect(provider.snapshot(scope, intent, {...good, state: 'closed'}).review.state).toBe('closed');
    expect(provider.snapshot(scope, intent, {...good, state: 'closed', merged_at: new Date().toISOString()}).review.state).toBe('merged');
  });

  it('freezes exact create/update/close payloads and resolves a lost create through one lookup', async () => {
    let posts = 0; const calls: {url: string; method: string; body?: unknown}[] = [];
    const provider = adapter(async (url, init) => {
      const method = init?.method ?? 'GET'; calls.push({url: String(url), method, ...(init?.body ? {body: JSON.parse(String(init.body))} : {})});
      if (method === 'POST') {posts++; throw new Error('synthetic successful response withheld');}
      const body = JSON.parse(String(init?.body ?? '{}')) as {state?: string; title?: string; body?: string};
      return Response.json(method === 'GET' ? [rawReview()] : {...rawReview(), ...body});
    });
    await expect(provider.mutate(scope, intent, grant('review'))).rejects.toMatchObject({reason: 'provider_unavailable'});
    const found = await provider.findReviewPage(scope, intent, grant('poll'), 1); expect(found.items).toHaveLength(1); expect(posts).toBe(1);
    expect(calls[0]!.body).toEqual({...intent.content, head: intent.delivery_ref.slice(11), base: 'main'});
    const review = found.items[0]!.review;
    await provider.mutate(scope, {...intent, kind: 'update_pr', review}, grant('review'));
    await provider.mutate(scope, {...intent, kind: 'close_pr', review, content: undefined}, grant('review'));
    expect(calls.filter(c => c.method === 'PATCH').map(c => c.body)).toEqual([intent.content, {state: 'closed'}]);
    expect(calls.filter(c => c.method !== 'GET').every(c => c.url.startsWith('https://api.github.com/repos/example/repo/pulls'))).toBe(true);
    expect(posts).toBe(1);
  });

  it('bounds exact lookup pages and retains PR identity on read', async () => {
    let calls = 0; const provider = adapter(async () => {calls++; return Response.json(Array.from({length: 100}, () => rawReview()));});
    expect((await provider.findReviewPage(scope, intent, grant(), 1)).more).toBe(true);
    await expect(provider.findReviewPage(scope, intent, grant(), 0)).rejects.toThrow();
    await expect(provider.findReviewPage(scope, intent, grant(), 11)).rejects.toThrow(); expect(calls).toBe(1);
    const other = adapter(async () => Response.json({...rawReview(), id: 102}));
    const review = provider.snapshot(scope, intent, rawReview()).review;
    await expect(other.review(scope, {...intent, kind: 'update_pr', review}, grant())).rejects.toThrow();
    await expect(adapter(async () => Response.json(Array.from({length: 101}, () => rawReview()))).findReviewPage(scope, intent, grant(), 1)).rejects.toThrow();
  });
});

describe('head-bound check and status facts', () => {
  it.each([
    ['success', 'success'], ['failure', 'failure'], ['neutral', 'neutral'], ['skipped', 'skipped'],
    ['cancelled', 'cancelled'], ['timed_out', 'failure'], ['action_required', 'failure'], ['stale', 'unknown'], [null, 'unknown'],
  ] as const)('preserves conclusion %s as %s with numeric provider identity', async (conclusion, state) => {
    const provider = adapter(async () => Response.json({total_count: 1, check_runs: [{id: 901, head_sha: head, name: 'synthetic check', status: 'completed', conclusion}]}));
    const page = await provider.checkPage(scope, head, 'check_run', 1, grant());
    expect(page.items).toHaveLength(1); expect(page.items[0]).toMatchObject({provider_id: 901, head, state}); expect(page.more).toBe(false);
  });

  it('separates pending and no-check pages and rejects wrong literal heads or overflow', async () => {
    const pending = adapter(async () => Response.json({total_count: 101, check_runs: Array.from({length: 100}, (_, i) => ({id: i + 1, head_sha: head, name: 'synthetic', status: 'in_progress', conclusion: null}))}));
    const page = await pending.checkPage(scope, head, 'check_run', 1, grant()); expect(page.more).toBe(true); expect(page.items.every(x => x.state === 'pending')).toBe(true);
    expect((await adapter(async () => Response.json({total_count: 0, check_runs: []})).checkPage(scope, head, 'check_run', 1, grant())).items).toEqual([]);
    for (const response of [{total_count: 1, check_runs: [{id: 1, head_sha: base, name: 'wrong head', status: 'completed', conclusion: 'success'}]},
      {total_count: 1, check_runs: []}, {total_count: -1, check_runs: []},
      {total_count: 1, check_runs: Array.from({length: 101}, () => ({id: 1}))}]) {
      await expect(adapter(async () => Response.json(response)).checkPage(scope, head, 'check_run', 1, grant())).rejects.toThrow();
    }
  });

  it('keeps status pending/success/failure/error literal-head information and bounded continuation', async () => {
    const provider = adapter(async (url) => {expect(String(url)).toContain(`/commits/${head}/statuses?`); return Response.json(['pending', 'success', 'failure', 'error'].map((state, i) => ({id: i + 1, context: 'synthetic status', state})));});
    const page = await provider.checkPage(scope, head, 'status', 1, grant()); expect(page.items.map(x => x.state)).toEqual(['pending', 'success', 'failure', 'failure']); expect(page.more).toBe(false);
    await expect(provider.checkPage(scope, head, 'status', 11, grant())).rejects.toThrow();
    await expect(adapter(async () => Response.json([{id: 1, context: 'synthetic', state: 'unknown'}])).checkPage(scope, head, 'status', 1, grant())).rejects.toThrow();
  });
});
