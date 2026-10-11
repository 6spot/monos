import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { ResultReadRequest, TaskOverview, TaskResultPage, TaskSpecificationStatus } from '../../../packages/protocol/generated/types.ts';

test.setTimeout(90000);
interface Fixture { task: string; node: string; operation_id: string; runner: string; project: string }
async function post<T>(page: Page, path: string, body: unknown = {}): Promise<T> {
  const result = await page.evaluate(async ({ path, body }) => {
    const session = await fetch('/v1/owner/session').then(response => response.json());
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Monos-Session': session.session_id }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
  expect(result.status, JSON.stringify(result.body)).toBe(200); return result.body;
}
async function get<T>(page: Page, path: string): Promise<T> { return page.evaluate(async path => { const session = await fetch('/v1/owner/session').then(r => r.json()); const response = await fetch(path, { headers: { 'X-Monos-Session': session.session_id } }); if (!response.ok) throw new Error(`Read failed: ${response.status}`); return response.json(); }, path); }
async function signIn(page: Page) {
  await page.goto('/'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  await post(page, '/__test__/execution-reset');
}
async function scenario(page: Page, kind = 'result_inspection'): Promise<Fixture> { return post(page, '/__test__/execution-scenario', { kind, title: 'Exact immutable local result' }); }
async function open(page: Page, task: string) { await page.goto(`/#task?task_id=${task}&section=overview`); await expect(page.getByRole('button', { name: 'Inspect changes', exact: true })).toBeVisible(); }
async function peer(page: Page, f: Fixture, action: string, status?: string): Promise<{ held: number; requests: ResultReadRequest[] }> { return post(page, '/__test__/result-peer', { task_id: f.task, action, status }); }
const file = (page: Page, name: string) => page.getByRole('group', { name: 'Changed files', exact: true }).getByRole('button', { name, exact: true });
const selected = (page: Page) => page.getByRole('region', { name: 'Selected file content', exact: true });
const evidenceRun = new Date().toISOString().replaceAll(/[^0-9]/g, '');

// Evidence ties screenshots to a dirty candidate's actual bytes, not HEAD alone.
async function capture(page: Page, info: TestInfo, name: string, state: string) {
  const root = resolve('../..'), sources = execFileSync('git', ['ls-files', 'apps/web/src', 'apps/server/src/app.ts', 'apps/server/src/task-result-reads.ts', 'apps/server/test/fixtures/execution-ui-fixture.ts', 'apps/server/test/fixtures/web-server.ts', 'packages/protocol/generated/types.ts', 'packages/protocol/schemas/v1/contracts.json', 'packages/protocol/src/validation.ts'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  sources.push('apps/web/src/features/result-inspector.tsx', 'apps/server/src/result-read-broker.ts', 'apps/server/src/result-content-reads.ts', 'apps/web/test/results.e2e.ts');
  const hashes = Object.fromEntries(await Promise.all([...new Set(sources)].sort().map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])));
  const assets = Object.fromEntries(await Promise.all((await readdir(resolve('dist/assets'))).sort().map(async name => [name, createHash('sha256').update(await readFile(resolve('dist/assets', name))).digest('hex')])));
  const candidate = createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), bundle = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
  const directory = resolve(root, 'test-results/result-inspection', `${candidate.slice(0, 12)}-${bundle.slice(0, 12)}-${evidenceRun}`);
  await mkdir(directory, { recursive: true });
  const metadata: Record<string, unknown> = { dirty_candidate: true, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source_sha256: candidate, source_files: hashes, bundle_sha256: bundle, assets, test: info.title, state, evidence: 'Built SPA + actual Owner/Runner authenticated WebSocket/PG fixture; Git bytes/OIDs explicitly synthetic, no native Runtime/provider', route: page.url(), views: [] };
  for (const viewport of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => document.fonts.ready);
    await page.locator('.result-inspector').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${viewport.label}: page overflow`).toBe(true);
    if (name === 'result-populated-literal') {
      const code = page.locator('.result-code');
      expect(await code.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      await code.focus(); await expect(code).toBeFocused();
    }
    const view = { viewport, scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY })), body: await page.locator('body').innerText(), codeOverflow: await page.locator('.result-code').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, scroll: node.scrollWidth }))) };
    (metadata.views as unknown[]).push(view);
    for (const fullPage of [false, true]) {
      const suffix = `${name}-${viewport.label}${fullPage ? '-full' : ''}.png`, path = resolve(directory, suffix);
      if (fullPage) await page.evaluate(() => scrollTo(0, 0));
      const bytes = await page.screenshot({ fullPage }); await writeFile(path, bytes, { flag: 'wx' });
      await info.attach(suffix, { body: bytes, contentType: 'image/png' });
    }
  }
  await writeFile(resolve(directory, `${name}.json`), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  await info.attach(name, { path: resolve(directory, `${name}.json`), contentType: 'application/json' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(`Result screenshot evidence: ${relative(root, directory)}/${name}`);
}

test('on-demand exact result navigation reaches all changes, safely inspects both sides and preserves Task state', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page); const reads: string[] = [], writes: string[] = [];
  page.on('request', request => { if (/\/results\/[^/]+\/(changes|file|diff)/.test(request.url())) reads.push(request.url()); if (request.method() === 'POST' && request.url().includes('/v1/owner/')) writes.push(request.url()); });
  await open(page, f.task); const before = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`);
  const results = await get<TaskResultPage>(page, `/v1/owner/tasks/${f.task}/results`);
  expect(reads).toHaveLength(0);
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Changed files', exact: true }).getByRole('button')).toHaveCount(65);
  await page.getByRole('button', { name: 'Load more changes', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Changed files', exact: true }).getByRole('button')).toHaveCount(70);
  await file(page, 'Modified src/literal.txt').focus(); await page.keyboard.press('Enter');
  await expect(file(page, 'Modified src/literal.txt')).toHaveAttribute('aria-pressed', 'true');
  await expect(selected(page).locator('pre')).toContainText('--- a/src/literal.txt');
  await page.getByRole('button', { name: 'Result file', exact: true }).click();
  await expect(selected(page).locator('pre')).toContainText('<script>window.resultInjected = true</script>\n  exact whitespace\n');
  expect(await page.evaluate(() => 'resultInjected' in window)).toBe(false);
  await capture(page, info, 'result-populated-literal', '70 changes, exact literal result text and long contained code');
  await page.getByRole('button', { name: 'Base file', exact: true }).click(); await expect(selected(page).locator('pre')).toHaveText('before\n');
  await file(page, 'Deleted deleted.txt').click(); await expect(selected(page).locator('pre')).toHaveText('before\n');
  await page.getByRole('button', { name: 'Result file', exact: true }).click(); await expect(selected(page)).toContainText('This file does not exist on the selected side.');
  await capture(page, info, 'result-deleted-side', 'Deleted path result absent; base remains inspectable');
  await file(page, 'Added empty.txt').click(); await expect(selected(page)).toContainText('Empty file.');
  await capture(page, info, 'result-empty-file', 'Available zero-byte file, not absent');
  await file(page, 'Added binary.dat').click(); await expect(selected(page)).toContainText('Binary or unsupported text encoding.'); await expect(selected(page).locator('pre')).toHaveCount(0);
  await capture(page, info, 'result-binary', 'Explicit binary outcome without bytes');
  await file(page, 'Added oversized.txt').click(); await expect(selected(page)).toContainText('64 KiB inspection limit');
  await capture(page, info, 'result-oversized', '65537-byte file, no partial content');
  await file(page, 'Added link').click(); await expect(selected(page)).toContainText('Symlink target (not followed)'); await expect(selected(page).locator('pre')).toHaveText('/outside/not-followed');
  await file(page, 'Added submodule').click(); await expect(selected(page)).toContainText('Git submodule reference (not fetched)'); await expect(selected(page).locator('pre')).toHaveCount(0);
  const long = page.getByRole('group', { name: 'Changed files', exact: true }).getByRole('button', { name: /^Added src\/a-long-literal/ });
  await long.click(); await expect(selected(page).locator('pre')).toContainText('exact whitespace');
  await capture(page, info, 'result-long-path', 'Literal colon/spaces and long path; contained code scroll');
  await file(page, 'Added more/file-61.txt').click(); await expect(selected(page).locator('pre')).toContainText('exact whitespace');
  const observed = await peer(page, f, 'observe'); expect(observed.requests.length).toBeGreaterThan(10);
  expect(observed.requests.every(request => request.identity.task_id === f.task && request.identity.operation_id === f.operation_id && request.identity.runner_id === f.runner && request.identity_digest === results.items[0]!.git_results[0]!.identity_digest)).toBe(true);
  const cursors = observed.requests.filter(request => request.mode === 'changes').map(request => request.cursor);
  expect(cursors[0]).toBeUndefined(); expect(cursors).toHaveLength(2);
  expect(JSON.parse(Buffer.from(cursors[1]!, 'base64url').toString())).toEqual({ after: 64, identity: results.items[0]!.git_results[0]!.identity_digest, version: 1 });
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).control_version).toBe(before.control_version);
  expect(await get<TaskResultPage>(page, `/v1/owner/tasks/${f.task}/results`)).toEqual(results);
  expect(writes).toHaveLength(0);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(''))).not.toContain('exact whitespace');
});

test('offline and storage outcomes preserve metadata; explicit Retry reconnects without Task commands', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page); await peer(page, f, 'offline'); await open(page, f.task);
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click(); await expect(page.getByText(/The Runner is offline/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current result', exact: true })).toBeVisible();
  await capture(page, info, 'result-offline', 'Owner metadata retained, actual fixture Runner socket disconnected');
  await peer(page, f, 'reconnect'); await page.getByRole('button', { name: 'Retry read', exact: true }).click(); await expect(file(page, 'Added empty.txt')).toBeVisible();
  await file(page, 'Added empty.txt').click(); await page.getByRole('button', { name: 'Result file', exact: true }).click(); await expect(selected(page)).toContainText('Empty file.');
  await peer(page, f, 'status', 'unavailable'); await page.getByRole('button', { name: 'Base file', exact: true }).click(); await expect(selected(page)).toContainText('retained local result storage is unavailable');
  await capture(page, info, 'result-unavailable', 'Exact storage unavailable; no substituted bytes');
  await peer(page, f, 'status', 'available'); await selected(page).getByRole('button', { name: 'Retry read', exact: true }).click(); await expect(selected(page)).toContainText('This file does not exist');
  for (const status of ['scan_limit', 'unsupported_path', 'unsupported', 'busy', 'timeout']) {
    await page.getByRole('button', { name: 'Close inspection', exact: true }).click(); await peer(page, f, 'status', status);
    await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Changed files', exact: true })).toHaveCount(0);
    await expect(page.locator('.result-inspection-body .task-notice')).toBeVisible();
  }
});

test('empty changes, held loading, selection/close cancellation, late logout response and session replacement stay fenced', async ({ page }, info) => {
  await signIn(page); const empty = await scenario(page, 'result_empty'); await open(page, empty.task);
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click(); await expect(page.getByText('No changes from the fixed base.', { exact: true })).toBeVisible();
  await capture(page, info, 'result-no-changes', 'Available complete zero-change list');
  await post(page, '/__test__/execution-reset'); const f = await scenario(page); await peer(page, f, 'hold'); await open(page, f.task);
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click(); await expect(page.getByText('Loading changed files…', { exact: true })).toBeVisible();
  await capture(page, info, 'result-loading', 'Actual authenticated WSS reply held in fixture; no invented progress');
  await expect.poll(async () => (await peer(page, f, 'observe')).held).toBe(1);
  await page.getByRole('button', { name: 'Close inspection', exact: true }).click(); await peer(page, f, 'release');
  await expect(page.getByRole('region', { name: 'Local result inspection', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click(); await expect(file(page, 'Modified src/literal.txt')).toBeVisible();
  await peer(page, f, 'hold'); await file(page, 'Modified src/literal.txt').click(); await expect(selected(page).getByText('Loading exact content…', { exact: true })).toBeVisible();
  await expect.poll(async () => (await peer(page, f, 'observe')).held).toBe(1);
  await file(page, 'Deleted deleted.txt').click(); await expect(selected(page).getByRole('heading', { name: 'deleted.txt', exact: true })).toBeVisible();
  await expect.poll(async () => (await peer(page, f, 'observe')).held).toBe(2);
  await peer(page, f, 'release'); await expect(selected(page).locator('pre')).toContainText('--- a/deleted.txt'); await expect(selected(page).locator('pre')).not.toContainText('--- a/src/literal.txt');
  await peer(page, f, 'hold'); await page.getByRole('button', { name: 'Result file', exact: true }).click();
  await expect.poll(async () => (await peer(page, f, 'observe')).held).toBe(1);
  // A second authenticated tab performs fixture release after this tab logs out;
  // replacing the cookie must not restore the previous private content view.
  const release = await page.context().newPage(); await release.goto('/#todos');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await release.reload(); await release.getByLabel('Password', { exact: true }).fill('monos-browser-test-password'); await release.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(release.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible(); await peer(release, f, 'release');
  await expect(page.getByRole('region', { name: 'Local result inspection', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Inspect changes', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.values(sessionStorage).join(''))).not.toContain('exact whitespace');
  await release.close();
});

test('fresh result read becomes Historical before metadata polling and keeps the original completion selected', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page); await open(page, f.task); await peer(page, f, 'hold');
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click(); await expect.poll(async () => (await peer(page, f, 'observe')).held).toBe(1);
  // Freeze result metadata before mutation so only the content reply can relabel it.
  await page.route(`**/v1/owner/tasks/${f.task}/results`, route => route.abort());
  const status = await get<TaskSpecificationStatus>(page, `/v1/owner/tasks/${f.task}/specification`);
  await post(page, '/v1/owner/tasks/specification/commands', { schema_version: 1, request_id: crypto.randomUUID(), task_id: f.task, name: 'edit_specification', payload: { proposal_id: crypto.randomUUID(), specification: '# New requirement\n\nReplace the previous required behavior.', summary: 'Invalidate the previous completion without replacing retained immutable bytes.', basis: status.basis, impact: status.impact, source_input_ids: [] } });
  await post(page, '/__test__/execution-settle', { task_id: f.task });
  const cookies = (await page.context().cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  await expect.poll(async () => {
    const response = await page.request.get(`/v1/owner/tasks/${f.task}/results`, { headers: { Cookie: cookies } });
    expect(response.status()).toBe(200);
    return ((await response.json()) as TaskResultPage).items[0]!.current;
  }).toBe(false);
  // The newly released content reply owns the fresh flag; metadata remains held.
  await peer(page, f, 'release'); await expect(page.getByRole('heading', { name: 'Historical result', exact: true })).toBeVisible();
  await expect(page.locator('.result-inspection-body')).toContainText('Historical completion');
  await file(page, 'Modified src/literal.txt').click(); await page.getByRole('button', { name: 'Result file', exact: true }).click(); await expect(selected(page).locator('pre')).toContainText('exact whitespace');
  const responses = await peer(page, f, 'observe'); expect(responses.requests.every(request => request.identity.operation_id === f.operation_id)).toBe(true);
  await capture(page, info, 'result-historical', 'Fresh post-read applicability false after ordinary Owner requirement invalidation; original completion still selected');
});

for (const via of ['metadata', 'changes'] as const) test(`open cached file stays exact while fresh ${via} makes its completion Historical`, async ({ page }) => {
  await signIn(page); const f = await scenario(page); await open(page, f.task);
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
  await file(page, 'Modified src/literal.txt').click();
  await page.getByRole('button', { name: 'Result file', exact: true }).click();
  await expect(selected(page).locator('pre')).toContainText('exact whitespace');
  const bytes = await selected(page).locator('pre').textContent();
  await expect(page.locator('.result-inspection-body')).toContainText('Current completion');
  const before = await peer(page, f, 'observe');
  if (via === 'changes') await page.route(`**/v1/owner/tasks/${f.task}/results`, route => route.abort());
  const status = await get<TaskSpecificationStatus>(page, `/v1/owner/tasks/${f.task}/specification`);
  await post(page, '/v1/owner/tasks/specification/commands', { schema_version: 1, request_id: crypto.randomUUID(), task_id: f.task, name: 'edit_specification', payload: { proposal_id: crypto.randomUUID(), specification: '# Replacement requirement\n\nThe earlier completion is retained history.', summary: 'Invalidate applicability while keeping the opened immutable file.', basis: status.basis, impact: status.impact, source_input_ids: [] } });
  await post(page, '/__test__/execution-settle', { task_id: f.task });
  if (via === 'changes') await page.getByRole('button', { name: 'Load more changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Historical result', exact: true })).toBeVisible();
  await expect(page.locator('.result-inspection-body')).toContainText('Historical completion');
  await expect(selected(page).locator('pre')).toHaveText(bytes!);
  await expect(file(page, 'Modified src/literal.txt')).toHaveAttribute('aria-pressed', 'true');
  const after = await peer(page, f, 'observe');
  expect(after.requests.filter(request => request.mode !== 'changes')).toEqual(before.requests.filter(request => request.mode !== 'changes'));
  expect(after.requests.every(request => request.identity.operation_id === f.operation_id)).toBe(true);
});
