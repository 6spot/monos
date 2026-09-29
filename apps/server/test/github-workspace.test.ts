import { readFileSync } from 'node:fs';
import { verify } from 'node:crypto';
import { expect, it } from 'vitest';
import { GitHub } from '../src/github.ts';
import type { GitHubCredentials } from '../src/github.ts';
import type { WorkspaceResource } from '../../../packages/protocol/src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/github-v1-credentials.json', import.meta.url), 'utf8')) as {
  synthetic_signing_key: string; public_key: string; credentials: GitHubCredentials;
};
const resource: WorkspaceResource = { resource_id: 'resource', remote_url: 'git@github.com:Example/Repo.git',
  repository_identity: 'github.com/example/repo', provider_metadata: { github: { repository_id: '42' } } };
const repo = { id: 42, full_name: 'Example/Repo', clone_url: 'https://github.com/Example/Repo.git', default_branch: 'main', private: true };
const token = () => ({ token: 'synthetic-scoped-token', expires_at: new Date(Date.now() + 3600000).toISOString(),
  permissions: { contents: 'read', metadata: 'read' }, repository_selection: 'selected', repositories: [{ id: 42 }] });

it('requests a single-repository read token before private metadata and verifies the signed App request', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const github = new GitHub(fixture.synthetic_signing_key, async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(calls.length === 1 ? token() : repo);
  });
  const result = await github.repositoryAccess(resource, fixture.credentials);
  expect(result.remote_url).toBe('https://github.com/Example/Repo.git');
  expect(result.authentication).toMatchObject({ kind: 'github_installation', token: 'synthetic-scoped-token' });
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ repository_ids: [42], permissions: { contents: 'read', metadata: 'read' } });
  expect(calls[0]!.url).toBe('https://api.github.com/app/installations/456/access_tokens');
  const jwt = new Headers(calls[0]!.init.headers).get('Authorization')!.slice(7);
  const [head, body, signature] = jwt.split('.');
  expect(verify('RSA-SHA256', Buffer.from(`${head}.${body}`), fixture.public_key, Buffer.from(signature!, 'base64url'))).toBe(true);
  expect(new Headers(calls[1]!.init.headers).get('Authorization')).toBe('Bearer synthetic-scoped-token');
  expect(calls.every((call) => call.init.redirect === 'error')).toBe(true);
});

it('requires positive public metadata without an App and normalizes the verified SSH alias to HTTPS', async () => {
  const github = new GitHub(fixture.synthetic_signing_key, async (_url, init) => {
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    return Response.json({ ...repo, private: false });
  });
  expect((await github.repositoryAccess(resource)).authentication).toEqual({ kind: 'anonymous' });
  for (const metadata of [repo, { ...repo, private: false, id: 43 }, { ...repo, private: false, full_name: 'wrong/repo' },
    { ...repo, private: false, clone_url: 'https://attacker.test/repo' }]) {
    const denied = new GitHub(fixture.synthetic_signing_key, async () => Response.json(metadata));
    await expect(denied.repositoryAccess(resource)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
  }
});

it('rejects expired, broad, writable or wrong-repository tokens without anonymous fallback', async () => {
  const invalid = [
    { ...token(), expires_at: new Date(Date.now() - 1000).toISOString() },
    { ...token(), permissions: { contents: 'write', metadata: 'read' } },
    { ...token(), permissions: { contents: 'read', metadata: 'read', issues: 'read' } },
    { ...token(), repository_selection: 'all' }, { ...token(), repositories: [{ id: 43 }] },
    { ...token(), repositories: [{ id: 42 }, { id: 43 }] }, { ...token(), token: 'x'.repeat(4097) },
  ];
  for (const response of invalid) {
    let calls = 0;
    const github = new GitHub(fixture.synthetic_signing_key, async () => { calls++; return Response.json(response); });
    await expect(github.repositoryAccess(resource, fixture.credentials)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect(calls).toBe(1);
  }
});

it('fails missing private provider identity before network and sanitizes denial/oversized responses', async () => {
  let calls = 0;
  const github = new GitHub(fixture.synthetic_signing_key, async () => { calls++; return new Response('synthetic-secret-in-error', { status: 403 }); });
  await expect(github.repositoryAccess({ ...resource, provider_metadata: undefined }, fixture.credentials)).rejects.toThrow('credentials_missing');
  expect(calls).toBe(0);
  await expect(github.repositoryAccess(resource, fixture.credentials)).rejects.not.toThrow('synthetic-secret-in-error');
  expect(calls).toBe(1);
  const oversized = new GitHub(fixture.synthetic_signing_key, async () => new Response('x'.repeat(1024 * 1024 + 1)));
  await expect(oversized.repositoryAccess(resource)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
  await expect(github.repositoryAccess({ ...resource, remote_url: 'https://example.test/repo', repository_identity: 'example.test/repo' })).rejects.toThrow('unsupported_remote');
});
