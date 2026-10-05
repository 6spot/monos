// Authorized isolated synthetic GitHub adapter proof. No monos source or real
// product Owner acceptance. OAuth is injected in RAM, not production App issuance.
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { GitHub } from '../../../../apps/server/src/github.ts';
import { GitHubRemote, remoteProfile } from '../../../../apps/server/src/github-remote.ts';
import { GitHubFinalization, evaluateReadiness, selectMergeMethod } from '../../../../apps/server/src/github-finalization.ts';

const name = '6spot/monolab-feasibility-20260928-160020-public', repositoryId = '1393178791';
const expectedBase = '9ac3353e97ed6a0cb96a80bb8e136d44cac982e4';
assert(process.argv.length === 2 || process.argv.length === 4 && process.argv[2] === '--resume-from' && /^[0-9a-f-]{36}$/.test(process.argv[3]));
const previous = process.argv[3] ? fileURLToPath(new URL(`./evidence/synthetic-finalization-${process.argv[3]}/`, import.meta.url)) : undefined;
const priorScope = previous ? JSON.parse(await readFile(previous + 'scope.json', 'utf8')) : undefined;
const priorCreated = previous ? JSON.parse(await readFile(previous + 'created-pr.json', 'utf8')) : undefined;
if (previous) {
  assert.equal(priorScope.repository, name); assert.equal(priorScope.repository_id, repositoryId);
  assert.equal(priorScope.expected_base, expectedBase); assert.equal(priorScope.task, process.argv[3]);
  const failed = JSON.parse(await readFile(previous + 'failure.json', 'utf8'));
  assert.equal(failed.successful_reply_observed, false);
  assert.equal(failed.calls.filter(call => call.method === 'PUT').length, 1);
  assert.deepEqual(JSON.parse(await readFile(previous + 'stale-head-rejection.json', 'utf8')), { state: 'rejected', status: 409, reason: 'unexpected_head', cooldown_ms: 0 });
  await assert.rejects(access(previous + 'merge-intent.json'));
}
const task = priorScope?.task ?? randomUUID(), resource = priorScope?.resource ?? randomUUID(), item = priorScope?.item ?? randomUUID();
const branch = `monos/task/${task}/${resource}`, marker = `<!-- monos-delivery-item:${item} -->`;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = fileURLToPath(new URL(`./evidence/synthetic-finalization-${task}${previous ? '-continuation-' + randomUUID() : ''}/`, import.meta.url));
await mkdir(output, { recursive: true, mode: 0o700 });
const token = execFileSync('/opt/homebrew/bin/gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
assert(token.length > 0 && token.length <= 4096 && !/[\r\n\0]/.test(token));
const save = async (file, value) => {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  assert(!bytes.includes(token) && Buffer.byteLength(bytes) <= 1024 * 1024);
  await writeFile(output + file, bytes, { flag: 'wx', mode: 0o600 });
};
const paths = ['apps/server/src/github-finalization.ts', 'apps/server/src/github-remote.ts', 'apps/server/src/github.ts', 'packages/domain/src/repositories.ts', 'packages/protocol/src/validation.ts', 'packages/protocol/schemas/v1/contracts.json', '.trellis/tasks/10-03-a-owner-delivery/research/synthetic-finalization-kernel.mjs'];
const inputs = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(root + path)).digest('hex')])));
const calls = [], grants = [];
let withheld = false, successfulMerge;
const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'monos-synthetic-finalization', 'Content-Type': 'application/json' };
async function api(path, method = 'GET', body) {
  assert(path.startsWith(`/repos/${name}`));
  const response = await fetch('https://api.github.com' + path, { method, headers, redirect: 'error', signal: AbortSignal.timeout(10_000), ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Synthetic API status ${response.status}`);
  const bytes = await response.text(); assert(Buffer.byteLength(bytes) <= 1024 * 1024 && !bytes.includes(token));
  return JSON.parse(bytes);
}
const scope = { resource_id: resource, repository_identity: 'github.com/' + name, repository_id: repositoryId, remote_url: `https://github.com/${name}.git`, workflow_changes: false };
const remote = new GitHubRemote(new GitHub('synthetic-kernel-not-an-installed-signing-key'), {
  acquireGrant: async (bound, profile) => { assert.equal(bound.repository_id, repositoryId); grants.push(profile); return { token, repository_id: repositoryId, expires_at: new Date(Date.now() + 3600_000).toISOString(), permissions: remoteProfile(bound, profile) }; },
  fetcher: async (url, options) => {
    const parsed = new URL(String(url)); assert.equal(parsed.origin, 'https://api.github.com'); assert(parsed.pathname === `/repos/${name}` || parsed.pathname.startsWith(`/repos/${name}/`));
    calls.push({ method: options?.method ?? 'GET', path: parsed.pathname + parsed.search });
    const response = await fetch(url, options);
    if (withheld && options?.method === 'PUT' && response.status === 200) {
      successfulMerge = await response.json(); assert.equal(successfulMerge.merged, true);
      await save('withheld-success.json', successfulMerge);
      throw new Error('Deliberately withheld successful synthetic merge reply');
    }
    return response;
  },
});
const provider = new GitHubFinalization(remote);
try {
  const repo = await api(`/repos/${name}`), base = await api(`/repos/${name}/branches/main`);
  assert.equal(String(repo.id), repositoryId); assert.equal(repo.full_name, name);
  assert.equal(repo.description, 'Synthetic MonoLab provider feasibility fixture; no product source.');
  assert.equal(repo.private, false); assert.equal(repo.archived, false); assert.equal(repo.default_branch, 'main');
  assert.equal(base.commit.sha, expectedBase); assert.equal(base.protected, true);
  const initialGrant = await remote.grant(scope, 'readiness');
  const initialPolicy = await provider.policy(scope, 'main', initialGrant);
  assert.equal(initialPolicy.supported, true);
  assert.deepEqual(initialPolicy.requirements, [{ context: 'monolab/probe', app_id: null }]);
  await save('scope.json', { observed_at: new Date().toISOString(), fixture_scope: 'oauth_injected_synthetic_adapter', repository: name, repository_id: repositoryId, expected_base: expectedBase, task, resource, item, branch, marker, inputs, production_app_issuance: 'not_proven', installed_coordinator: 'not_proven', product_owner_acceptance: 'not_performed' });
  let commit, pr, intent;
  if (previous) {
    intent = priorCreated.intent;
    assert.equal(intent.item_id, item); assert.equal(intent.delivery_ref, 'refs/heads/' + branch); assert.equal(intent.review.marker, marker); assert.equal(intent.review.repository_id, repositoryId); assert.equal(intent.review.base_ref, 'main');
    pr = await api(`/repos/${name}/pulls/${intent.review.pr_number}`);
    assert.equal(String(pr.id), intent.review.pr_id); assert.equal(pr.state, 'open'); assert.equal(pr.merged, false); assert.equal(pr.head.sha, intent.accepted_head); assert.equal(pr.base.sha, expectedBase);
    commit = { sha: intent.accepted_head };
    await save('original-continuation.json', { previous, original_intent: intent, original_scope: priorScope, verified_no_admitted_merge: true });
  } else {
  const tree = await api(`/repos/${name}/git/trees`, 'POST', { base_tree: base.commit.commit.tree.sha, tree: [{ path: 'owner-delivery-synthetic-proof.txt', mode: '100644', type: 'blob', content: `Synthetic Owner delivery adapter proof.\nTrial ${task}\nNo product source.\n` }] });
  commit = await api(`/repos/${name}/git/commits`, 'POST', { message: 'Synthetic Owner delivery adapter proof; no product source', tree: tree.sha, parents: [expectedBase] });
  await save('branch-intent.json', { ref: 'refs/heads/' + branch, sha: commit.sha });
  await api(`/repos/${name}/git/refs`, 'POST', { ref: 'refs/heads/' + branch, sha: commit.sha });
  const content = { title: 'Synthetic Owner delivery adapter proof', body: `Synthetic verification only; no product source.\n${marker}` };
  await save('pr-intent.json', { ...content, head: branch, base: 'main' });
  pr = await api(`/repos/${name}/pulls`, 'POST', { ...content, head: branch, base: 'main' });
  const review = { repository_id: repositoryId, pr_id: String(pr.id), pr_number: pr.number, url: pr.html_url, head_ref: branch, base_ref: 'main', marker, state: 'open' };
  intent = { item_id: item, delivery_ref: 'refs/heads/' + branch, target_branch: 'main', kind: 'update_pr', review, accepted_head: commit.sha };
  await save('created-pr.json', { intent, base: expectedBase });
  await api(`/repos/${name}/statuses/${commit.sha}`, 'POST', { state: 'success', context: 'monolab/probe', description: 'Explicit synthetic adapter verification; no Runtime/test claim' });
  }
  let stage;
  for (let turn = 0; turn < 12; turn++) {
    const grant = await remote.grant(scope, 'readiness'), before = await provider.review(scope, intent, grant);
    const policy = await provider.policy(scope, 'main', grant), collections = { head: [], test: [] };
    for (const [lane, sha] of [['head', before.head], ...(before.test_head ? [['test', before.test_head]] : [])]) {
      for (const kind of ['check_run', 'status']) {
        const pages = [];
        for (let page = 1; page <= 10; page++) { const observed = await provider.checkPage(scope, sha, kind, page, grant); pages.push(observed); if (!observed.more) break; }
        collections[lane].push({ repository_id: repositoryId, head: sha, kind, pages });
      }
    }
    const after = await provider.review(scope, intent, grant);
    if (before.base_head === after.base_head && before.test_head === after.test_head && evaluateReadiness({ review: after, policy, collections }).state === 'ready') { stage = { review: after, policy, collections }; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(stage, 'Real required checks and mergeability must become ready');
  await save('readiness.json', stage);
  const staleGrant = previous ? undefined : await remote.grant(scope, 'merge');
  if (!previous) await save('stale-head-intent.json', { ...intent, accepted_head: '0'.repeat(40) });
  const stale = previous ? JSON.parse(await readFile(previous + 'stale-head-rejection.json', 'utf8')) : await provider.merge(scope, { ...intent, accepted_head: '0'.repeat(40) }, 'merge', staleGrant);
  assert.equal(stale.state, 'rejected'); assert.equal(stale.reason, 'unexpected_head');
  await save('stale-head-rejection.json', stale);
  const start = calls.length + grants.length, budget = { remaining: 8 };
  const read = await remote.grant(scope, 'readiness', budget), before = await provider.review(scope, intent, read, budget), policy = await provider.policy(scope, 'main', read, budget);
  assert.equal(policy.digest, stage.policy.digest); assert.equal(before.base_head, stage.review.base_head); assert.equal(before.test_head, stage.review.test_head);
  const write = await remote.grant(scope, 'merge', budget), settings = await provider.settings(scope, write, budget), method = selectMergeMethod(settings, policy, 'merge');
  assert.equal(method, 'merge');
  const after = await provider.review(scope, intent, read, budget);
  assert.equal(after.base_head, before.base_head); assert.equal(after.test_head, before.test_head); assert.equal(after.content_digest, before.content_digest);
  assert.equal(evaluateReadiness({ review: after, policy, collections: stage.collections }).state, 'ready');
  assert.equal(budget.remaining, 1);
  await save('merge-intent.json', { operation_id: randomUUID(), intent, method, possible_effect: true, before, after, policy });
  withheld = true;
  const lost = await provider.merge(scope, intent, method, write, budget);
  assert.equal(lost.state, 'unknown'); assert(successfulMerge);
  assert.equal(calls.length + grants.length - start, 8); assert.equal(budget.remaining, 0);
  await save('unknown-original-outcome.json', lost);
  const reconcile = await remote.grant(scope, 'reconcile'), recovered = await provider.reconcile(scope, intent, reconcile);
  assert.equal(recovered.state, 'merged'); assert.equal(recovered.final_head, successfulMerge.sha);
  const retained = await api(`/repos/${name}/git/ref/heads/${branch}`), old = await api(`/repos/${name}/pulls/4`), final = await api(`/repos/${name}/branches/main`);
  assert.equal(retained.object.sha, commit.sha); assert.equal(old.state, 'closed'); assert.equal(old.merged, false); assert.equal(final.commit.sha, recovered.final_head);
  for (const [path, sha] of Object.entries(inputs)) assert.equal(createHash('sha256').update(await readFile(root + path)).digest('hex'), sha);
  await save('result.json', { complete: true, fixture_scope: 'oauth_injected_synthetic_adapter', repository: name, repository_id: repositoryId, review: intent.review, accepted_head: commit.sha, base_before: expectedBase, final_commit: recovered.final_head, stale_head: stale, lost_reply: lost, recovered, mutation_puts: calls.filter(call => call.method === 'PUT').length, prior_definitively_rejected_puts: previous ? 1 : 0, successful_merges: 1, recovery_mutations: 0, protected_effect_turn_calls: 8, branch_retained: true, old_pr4_untouched: true, inputs, calls, grants, production_app_issuance: 'not_proven', installed_coordinator: 'not_proven', product_owner_acceptance: 'not_performed' });
  process.stdout.write(`Synthetic finalization PASS: PR #${pr.number}, stale-head rejection, one successful merge, withheld reply and read-only recovery. Evidence ${output}\n`);
} catch (error) {
  const safe = error instanceof Error && !error.message.includes(token) ? error.message.slice(0, 512) : 'Synthetic trial failed; original effects require read-only inspection';
  await save('failure.json', { complete: false, safe_error: safe, successful_reply_observed: !!successfulMerge, calls, grants });
  process.stderr.write(`Synthetic finalization failed: ${safe}. Original evidence ${output}\n`);
  process.exitCode = 1;
}
