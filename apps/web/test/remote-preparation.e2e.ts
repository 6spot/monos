import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { PublicationCandidatePage, RemotePreparationPage, RemotePreparationCommand, TaskOverview } from '../../../packages/protocol/generated/types.ts';

test.setTimeout(120000);
interface Fixture { task: string; operation_id: string }
interface Peer { calls: { method: string; path: string }[]; grants: string[]; held: number; pushes: { operation_id: string; request_digest: string; head: string }[]; head?: string; review_number?: number }
const canary = 'synthetic-browser-ephemeral-grant';
async function post<T>(page: Page, path: string, body: unknown = {}): Promise<T> {
  const result = await page.evaluate(async ({ path, body }) => {
    const session = await fetch('/v1/owner/session').then(response => response.json());
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Monos-Session': session.session_id }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
  expect(result.status, JSON.stringify(result.body)).toBe(200); return result.body;
}
async function get<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async path => { const session = await fetch('/v1/owner/session').then(r => r.json()); const response = await fetch(path, { headers: { 'X-Monos-Session': session.session_id } }); if (!response.ok) throw new Error(`Read failed ${response.status}`); return response.json(); }, path);
}
async function signIn(page: Page) {
  await page.goto('/'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible(); await post(page, '/__test__/execution-reset');
}
async function scenario(page: Page, mode: string): Promise<Fixture> { return post(page, '/__test__/remote-scenario', { mode }); }
async function peer(page: Page, f: Fixture, action: string, mode?: string): Promise<Peer> { return post(page, '/__test__/remote-peer', { task_id: f.task, action, mode }); }
async function open(page: Page, task: string) { await page.goto(`/#task?task_id=${task}&section=overview`); await expect(page.getByRole('heading', { name: 'Remote review preparation', exact: true })).toBeVisible(); }
const section = (page: Page) => page.getByRole('region', { name: 'Remote review preparation', exact: true });
async function records(page: Page, f: Fixture): Promise<RemotePreparationPage> { return get(page, `/v1/owner/tasks/${f.task}/remote-preparation`); }
const run = new Date().toISOString().replaceAll(/[^0-9]/g, '');
async function capture(page: Page, info: TestInfo, name: string, state: string, target = '.remote-record') {
  if (process.env.MONOS_WEB_CAPTURE === '0') return;
  // Six distinct layouts; equivalent reason variants retain assertions only.
  if (!['remote-prepared-checks', 'remote-preparing', 'remote-history', 'remote-rate_limited', 'remote-cancelled', 'remote-deferred'].includes(name)) return;
  const root = resolve('../..');
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/web/src', 'apps/server/src', 'apps/server/test/fixtures', 'packages/db/src', 'packages/db/migrations', 'packages/protocol/generated/types.ts', 'packages/protocol/schemas/v1/contracts.json', 'packages/protocol/src', 'package.json', 'pnpm-lock.yaml'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const added = ['apps/web/src/features/remote-preparation.tsx', 'apps/web/src/lib/remote-preparation-api.ts', 'apps/web/src/lib/remote-preparation-api.test.ts', 'apps/web/test/remote-preparation.e2e.ts', 'apps/server/src/github-remote.ts', 'apps/server/src/remote-preparation-state.ts', 'apps/server/src/remote-preparation-guards.ts', 'packages/db/migrations/0023_remote_preparation.sql', 'apps/web/src/features/publication-candidate.tsx', 'apps/web/src/lib/publication-api.ts', 'apps/web/src/lib/publication-api.test.ts', 'apps/web/test/publication.e2e.ts', 'apps/server/src/publication-candidates.ts', 'apps/server/src/publication-candidate-reads.ts', 'apps/server/src/publication-commands.ts', 'apps/server/src/publication-policy.ts', 'packages/db/migrations/0022_publication_candidates.sql'];
  const sources = Object.fromEntries(await Promise.all([...new Set([...tracked, ...added])].sort().map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])));
  const assets = Object.fromEntries(await Promise.all((await readdir(resolve('dist/assets'))).sort().map(async name => [name, createHash('sha256').update(await readFile(resolve('dist/assets', name))).digest('hex')])));
  const source = createHash('sha256').update(JSON.stringify(sources)).digest('hex'), bundle = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
  const dir = resolve(root, '.trellis/tasks/10-03-a-remote-preparation/research/screenshots', `${source.slice(0, 12)}-${bundle.slice(0, 12)}-${run}`); await mkdir(dir, { recursive: true });
  const metadata = { dirty_candidate: true, source_sha256: source, source_files: sources, bundle_sha256: bundle, assets, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), test: info.title, state, route: page.url(), evidence: 'Built SPA, actual authenticated Owner/PostgreSQL/WSS/coordinator; explicitly synthetic Git OIDs, push acknowledgements and fixed-host GitHub grant/HTTP responses. No native Runtime, physical Git or live provider', views: [] as unknown[] };
  for (const viewport of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => document.fonts.ready);
    if (name === 'remote-prepared-checks') {
      // The provider orders numeric IDs as strings. Inspect the long name in
      // the bounded list rather than leaving it below its scroll viewport.
      await page.getByText('long-literal-check-name-'.repeat(10), { exact: true }).evaluate(name => {
        const row = name.closest('li')!, list = row.parentElement!;
        list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
      });
    }
    await page.evaluate(selector => { const element = document.querySelector(selector)!; scrollTo({ top: scrollY + element.getBoundingClientRect().top - 64, left: 0, behavior: 'instant' }); }, target);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow`).toBe(true);
    const body = await page.locator('body').innerText(); expect(body).not.toContain(canary);
    metadata.views.push({ viewport, scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY })), body });
    for (const fullPage of name === 'remote-prepared-checks' ? [false, true] : [false]) {
      if (fullPage) await page.evaluate(() => scrollTo(0, 0));
      const bytes = await page.screenshot({ fullPage }), file = `${name}-${viewport.label}${fullPage ? '-full' : ''}.png`;
      await writeFile(resolve(dir, file), bytes, { flag: 'wx' }); await info.attach(file, { body: bytes, contentType: 'image/png' });
    }
  }
  await writeFile(resolve(dir, `${name}.json`), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  await page.setViewportSize({ width: 1440, height: 1000 }); console.log(`Remote screenshot evidence: ${relative(root, dir)}/${name}`);
}


test('automatic coordinator prepares a stable PR with paginated exact-head literal checks and preserved local inspection', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'prepared'); await open(page, f.task);
  await expect(section(page)).toContainText('The review request is prepared.', { timeout: 30000 });
  const latest = (await records(page, f)).items.find(row => row.current)!;
  await section(page).getByText(/Remote operation history/).click();
  await section(page).getByRole('button', { name: new RegExp('Current ·.*' + latest.operation!.operation_id) }).click();
  await expect(section(page)).toContainText('Current remote evidence');
  await expect(page.getByRole('link', { name: /Open PR #/ })).toBeVisible();
  await expect(section(page)).toContainText('64 check entries loaded.', { timeout: 30000 });
  await page.getByRole('button', { name: 'Load more checks', exact: true }).click(); await expect(section(page)).toContainText('70 check entries loaded.');
  for (const text of ['Pending', 'Neutral', 'Skipped', 'Cancelled', 'Failure', 'Required check readiness is unknown']) await expect(section(page)).toContainText(text);
  expect(await page.evaluate(() => (window as unknown as { remoteInjected?: boolean }).remoteInjected)).toBeUndefined();
  await capture(page, info, 'remote-prepared-checks', 'Actual coordinator prepared PR, 70 synthetic provider checks, literal safe names, current exact head/base');
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Local result inspection', exact: true })).toContainText('64 of 70 loaded');
  const state = await peer(page, f, 'observe');
  expect(state.pushes).toHaveLength(1); expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('REVIEW');
  await expect(page.getByRole('button', { name: /^(Prepare PR|Accept|Merge|Request Changes)$/ })).toHaveCount(0);
  expect(await page.locator('body').innerText() + await page.evaluate(() => Object.values(sessionStorage).join(''))).not.toContain(canary);
});

for (const [mode, text] of [
  ['preparing', 'Preparing the remote review branch'], ['offline', 'Runner is offline'], ['unsupported', 'does not support remote preparation'], ['access_denied', 'Remote access is unavailable'], ['rate_limited', 'Provider cooldown until'], ['unknown', 'uncertain'],
] as const) test(`remote ${mode} attention remains separate from local Review`, async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, mode); await open(page, f.task);
  await expect(section(page)).toContainText(text, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Local publication candidate', exact: true })).toBeVisible();
  await capture(page, info, `remote-${mode}`, `Actual coordinator with explicitly synthetic ${mode} transport/provider outcome`);
  if (mode === 'unknown') {
    const original = (await records(page, f)).items.find(row => row.read_retry_allowed)!;
    await expect(page.getByRole('button', { name: 'Reconcile original remote effect', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Reconcile original remote effect', exact: true }).click();
    const after = (await records(page, f)).items.find(row => row.operation?.operation_id === original.operation!.operation_id)!;
    expect(after.operation!.request_digest).toBe(original.operation!.request_digest);
  }
  const state = await peer(page, f, 'observe');
  if (mode === 'unknown') { expect(state.pushes).toHaveLength(1); expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(0); }
  if (['unsupported', 'offline', 'access_denied', 'rate_limited'].includes(mode)) expect(state.calls.filter(call => call.method !== 'GET')).toHaveLength(0);
});

test('a failed before-start push Retry persists exact envelope and recovers original committed receipt after reply loss', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'blocked'); await open(page, f.task);
  await expect(page.getByRole('button', { name: 'Retry remote preparation', exact: true })).toBeEnabled({ timeout: 30000 });
  const before = (await records(page, f)).items.find(row => row.current)!;
  const commands: RemotePreparationCommand[] = [], receiptReads: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && request.url().includes('/remote-preparation/commands/')) receiptReads.push(request.url()); });
  await page.route('**/v1/owner/tasks/remote-preparation/commands', async route => {
    const command = route.request().postDataJSON(); commands.push(command);
    const journal = await page.evaluate(() => Object.values(sessionStorage).join(''));
    expect(journal).toContain(command.request_id); expect(journal).toContain(command.payload.operation_digest);
    const response = await route.fetch(); expect(response.ok()).toBe(true); await route.fulfill({ response, body: '{"interrupted":true}' });
  }, { times: 1 });
  await peer(page, f, 'mode', 'prepared'); await page.getByRole('button', { name: 'Retry remote preparation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Check request result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toHaveCount(0);
  expect(commands).toHaveLength(1); expect(commands[0]!.payload).toEqual({ operation_id: before.operation!.operation_id, operation_digest: before.operation!.request_digest, expected_version: before.operation!.version });
  expect(receiptReads.some(path => path.endsWith('/commands/' + commands[0]!.request_id))).toBe(true);
  await expect.poll(async () => (await records(page, f)).items.some(row => row.status === 'prepared' && row.current), { timeout: 30000 }).toBe(true);
  await section(page).getByText(/Remote operation history/).click();
  await section(page).getByRole('button', { name: /Current ·/ }).first().click();
  await expect(section(page)).toContainText('The review request is prepared.');
  await capture(page, info, 'remote-retry-recovered', 'Exact original journal envelope recovered; successful preparation remains separate from receipt');
  const state = await peer(page, f, 'observe'); expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
});

test('selected historical operation never inherits latest item authority and Cancel closes only its owned PR', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'prepared'); await open(page, f.task);
  await expect(section(page)).toContainText('The review request is prepared.', { timeout: 30000 });
  await section(page).getByText(/Remote operation history/).click();
  await section(page).getByRole('button', { name: /Historical · Push/ }).first().click();
  await expect(section(page)).toContainText('Historical remote evidence');
  await expect(section(page).getByRole('button', { name: 'Retry remote preparation', exact: true })).toHaveCount(0);
  const original = (await records(page, f)).items.find(row => row.current)!;
  await peer(page, f, 'carry');
  await expect.poll(async () => (await get<PublicationCandidatePage>(page, `/v1/owner/tasks/${f.task}/publication-candidates`)).items.some(row => row.status === 'mapped' && row.current), { timeout: 30000 }).toBe(true);
  const local = page.getByRole('region', { name: 'Local publication candidate', exact: true });
  await local.getByText('Open an exact candidate', { exact: true }).click();
  await local.getByLabel('Candidate ID', { exact: true }).fill(original.candidate.candidate_id);
  await local.getByRole('button', { name: "Open candidate's latest scan", exact: true }).click();
  await expect(local).toContainText('Current result mapped to the unchanged published head.');
  await expect(local).toContainText('Reused published manifest');
  const mapped = (await get<PublicationCandidatePage>(page, `/v1/owner/tasks/${f.task}/publication-candidates`)).items.find(row => row.status === 'mapped' && row.current)!;
  expect(mapped.candidate).toEqual(original.candidate);
  expect(mapped.effective_basis.specification_id).not.toBe(original.effective_basis.specification_id);
  expect(mapped.mapping!.published.candidate).toEqual(original.candidate);
  await expect(section(page)).toContainText('Historical remote evidence');
  await capture(page, info, 'remote-history', 'Actual Owner Specification carry, authenticated fresh same-tree scan and reused immutable published manifest; selected prior push remains historical', '.publication-record');
  await expect.poll(async () => (await records(page, f)).items.some(row => row.current && row.effective_basis.specification_id === mapped.effective_basis.specification_id), { timeout: 30000 }).toBe(true);
  const carriedCurrent = (await records(page, f)).items.find(row => row.current && row.effective_basis.specification_id === mapped.effective_basis.specification_id)!;
  await section(page).getByRole('button', { name: new RegExp('Current ·.*' + carriedCurrent.operation!.operation_id) }).click();
  await expect(section(page)).toContainText('Current remote evidence');
  const cached = await records(page, f), latest = cached.items.find(row => row.current)!;
  const detail = await get(page, `/v1/owner/tasks/${f.task}/remote-preparation/${latest.item_id}`);
  // Retain old remote responses while the real canonical overview changes.
  // Its fresh Task state must fence authority before remote polling catches up.
  const listURL = `**/v1/owner/tasks/${f.task}/remote-preparation`;
  const detailURL = `${listURL}/${latest.item_id}`;
  await page.route(listURL, route => route.fulfill({ json: cached }));
  await page.route(detailURL, route => route.fulfill({ json: detail }));
  await page.getByRole('button', { name: 'Cancel task', exact: true }).click();
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('CANCELLED');
  await expect(page.getByRole('button', { name: 'Cancel task', exact: true })).toHaveCount(0);
  await expect(section(page)).toContainText('Historical remote evidence');
  await expect(section(page).getByRole('button', { name: 'Retry remote preparation', exact: true })).toHaveCount(0);
  await page.unroute(listURL); await page.unroute(detailURL);
  await expect.poll(async () => (await peer(page, f, 'observe')).calls.filter(call => call.method === 'PATCH').length).toBeGreaterThan(0);
  await page.reload(); await expect(section(page)).toContainText('delivery branch is retained');
  await capture(page, info, 'remote-cancelled', 'Terminal Cancel reconciled exact owned PR closure, branch retained and no Owner acceptance');
  expect((await peer(page, f, 'observe')).calls.filter(call => call.method === 'POST')).toHaveLength(1);
});

test('no checks and unknown mergeability are informational; deferred and repository-free remain local', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'no_checks'); await open(page, f.task);
  await expect(section(page)).toContainText('No checks', { timeout: 30000 }); await expect(section(page)).toContainText('Mergeability · Unknown');
  await capture(page, info, 'remote-no-checks', 'No provider checks, unknown mergeability, no readiness inference');
  const deferred = await post<Fixture>(page, '/__test__/publication-scenario', { mode: 'clean' }); await open(page, deferred.task);
  await expect(page.getByRole('region', { name: 'Local publication candidate', exact: true })).toContainText('Remote preparation is deferred until acceptance.');
  await expect(page.getByRole('region', { name: 'Local publication candidate', exact: true })).toContainText('Local candidate retained.');
  await expect(section(page)).toContainText('No remote preparation is recorded');
  expect((await records(page, deferred)).items).toEqual([]);
  await capture(page, info, 'remote-deferred', 'Actual configured after_acceptance local candidate; no remote operation or provider observation fabricated', '.publication-record');
  const empty = await post<Fixture>(page, '/__test__/execution-scenario', { kind: 'review' }); await open(page, empty.task);
  await expect(section(page)).toContainText('No remote preparation is recorded'); await capture(page, info, 'remote-repository-free', 'Repository-free result does not imply missing PR', '.remote-preparation');
});

test('held detail and checks replies cannot restore private data after logout or Task selection change', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'prepared'); await open(page, f.task);
  await expect(section(page)).toContainText('The review request is prepared.', { timeout: 30000 });
  const original = (await records(page, f)).items.find(row => row.current)!, item = original.item_id;
  let release = () => {}; const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered = () => {}; const held = new Promise<void>(resolve => { entered = resolve; });
  await page.route(`**/v1/owner/tasks/${f.task}/remote-preparation/${item}`, async route => { const response = await route.fetch(); entered(); await barrier; await route.fulfill({ response }).catch(() => {}); });
  await page.reload(); await held;
  await capture(page, info, 'remote-loading', 'Latest item detail is held; immutable observations confer no unchecked Retry', '.remote-preparation');
  const other = await post<Fixture>(page, '/__test__/execution-scenario', { kind: 'review' });
  await open(page, other.task);
  release(); await page.waitForTimeout(100);
  await expect(section(page)).toContainText('No remote preparation is recorded');
  await expect(section(page)).not.toContainText(original.candidate.head);
  await page.unroute(`**/v1/owner/tasks/${f.task}/remote-preparation/${item}`);
  let releaseChecks = () => {}; const checksBarrier = new Promise<void>(resolve => { releaseChecks = resolve; });
  let enteredChecks = () => {}; const heldChecks = new Promise<void>(resolve => { enteredChecks = resolve; });
  await page.route(`**/v1/owner/tasks/${f.task}/remote-preparation/${item}/checks/**`, async route => { const response = await route.fetch(); enteredChecks(); await checksBarrier; await route.fulfill({ response }).catch(() => {}); });
  await open(page, f.task); await heldChecks;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  releaseChecks(); await page.waitForTimeout(100); await expect(page.getByRole('heading', { name: 'Remote review preparation', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('monos:task-ui:')))).toEqual([]);
});

test('authoritative unknown replays the same persisted Retry and a replaced session cannot adopt its command', async ({ page, context }) => {
  await signIn(page); const f = await scenario(page, 'blocked'); await open(page, f.task);
  await expect(page.getByRole('button', { name: 'Retry remote preparation', exact: true })).toBeEnabled({ timeout: 30000 });
  const writes: RemotePreparationCommand[] = [];
  await page.route('**/v1/owner/tasks/remote-preparation/commands', async route => {
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) await route.abort('failed'); else await route.continue();
  });
  await peer(page, f, 'mode', 'prepared');
  await page.getByRole('button', { name: 'Retry remote preparation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Check request result', exact: true }).click();
  await expect.poll(async () => (await records(page, f)).items.some(row => row.status === 'prepared' && row.current), { timeout: 30000 }).toBe(true);
  await section(page).getByText(/Remote operation history/).click();
  await section(page).getByRole('button', { name: /Current ·/ }).first().click();
  await expect(section(page)).toContainText('The review request is prepared.');
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  await page.unroute('**/v1/owner/tasks/remote-preparation/commands');
  const next = await scenario(page, 'blocked'); await open(page, next.task);
  await expect(page.getByRole('button', { name: 'Retry remote preparation', exact: true })).toBeEnabled({ timeout: 30000 });
  let release = () => {}; const barrier = new Promise<void>(resolve => { release = resolve; });
  let checked = () => {}; const preflight = new Promise<void>(resolve => { checked = resolve; });
  await page.route('**/v1/owner/session', async route => { const response = await route.fetch(); checked(); await barrier; await route.fulfill({ response }).catch(() => {}); });
  const statuses: number[] = [];
  await page.route('**/v1/owner/tasks/remote-preparation/commands', async route => { const response = await route.fetch(); statuses.push(response.status()); await route.fulfill({ response }); });
  await page.getByRole('button', { name: 'Retry remote preparation', exact: true }).click(); await preflight;
  const replacement = await context.request.post('/v1/owner/login', { headers: { Origin: new URL(page.url()).origin }, data: { schema_version: 1, password: 'monos-browser-test-password' } });
  expect(replacement.status()).toBe(200);
  release(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(statuses.every(status => status === 401)).toBe(true);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('monos:task-ui:')))).toEqual([]);
});

test('a fresh continuation marks cached green checks historical without replacing selected immutable head', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'prepared'); await open(page, f.task);
  await expect.poll(async () => (await records(page, f)).items.some(row => row.current && row.status === 'prepared'), { timeout: 30000 }).toBe(true);
  await section(page).getByText(/Remote operation history/).click();
  await section(page).getByRole('button', { name: /Current ·/ }).first().click();
  await expect(section(page)).toContainText('Current exact-head observations', { timeout: 30000 });
  const current = (await records(page, f)).items.find(row => row.current)!;
  await page.route(`**/v1/owner/tasks/${f.task}/remote-preparation/${current.item_id}/checks/${current.checks!.observation_id}?*`, async route => {
    const response = await route.fetch(), body = await response.json();
    // Supplemental browser transport fixture: only freshly returned canonical
    // applicability is changed; immutable head/time/check payload stays exact.
    if (new URL(route.request().url()).searchParams.has('cursor')) body.observation = { ...body.observation, current: false, stale: true };
    await route.fulfill({ response, json: body });
  });
  await page.getByRole('button', { name: 'Load more checks', exact: true }).click();
  await expect(section(page)).toContainText('70 check entries loaded.');
  await expect(section(page)).toContainText('Historical or incomplete observations');
  await expect(section(page)).toContainText(current.checks!.head);
  await capture(page, info, 'remote-checks-historical', 'Supplemental synthetic fresh applicability flag fences first-page cache; exact retained head/base/time and 70 bytes unchanged');
});
