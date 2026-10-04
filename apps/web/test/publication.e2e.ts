import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { PublicationCandidatePage, PublicationCommand, PublicationRecord, TaskOverview, TaskSpecificationStatus } from '../../../packages/protocol/generated/types.ts';

test.setTimeout(120000);
interface Fixture { task: string; operation_id: string }
const canary = 'ghp_' + 'X'.repeat(36);
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
async function scenario(page: Page, mode: string): Promise<Fixture> { return post(page, '/__test__/publication-scenario', { mode }); }
async function peer(page: Page, f: Fixture, action: string, mode?: string): Promise<{ held: number; requests: { operation_id: string; candidate_id: string; scan_run_id: string }[]; unexpected: string[] }> { return post(page, '/__test__/publication-peer', { task_id: f.task, action, mode }); }
async function open(page: Page, task: string) { await page.goto(`/#task?task_id=${task}&section=overview`); await expect(page.getByRole('heading', { name: 'Local publication candidate', exact: true })).toBeVisible(); }
const section = (page: Page) => page.getByRole('region', { name: 'Local publication candidate', exact: true });
async function records(page: Page, f: Fixture): Promise<PublicationCandidatePage> { return get(page, `/v1/owner/tasks/${f.task}/publication-candidates?source_operation_id=${f.operation_id}`); }
const run = new Date().toISOString().replaceAll(/[^0-9]/g, '');
async function capture(page: Page, info: TestInfo, name: string, state: string, target = '.publication-record') {
  const root = resolve('../..');
  const tracked = execFileSync('git', ['ls-files', 'apps/web/src', 'apps/server/src', 'apps/server/test/fixtures', 'packages/db/src', 'packages/db/migrations', 'packages/protocol/generated/types.ts', 'packages/protocol/schemas/v1/contracts.json', 'packages/protocol/src', 'package.json', 'pnpm-lock.yaml'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const added = ['apps/web/src/features/publication-candidate.tsx', 'apps/web/src/lib/publication-api.ts', 'apps/web/src/lib/publication-api.test.ts', 'apps/web/test/publication.e2e.ts', 'apps/server/src/publication-candidates.ts', 'apps/server/src/publication-candidate-reads.ts', 'apps/server/src/publication-commands.ts', 'apps/server/src/publication-policy.ts', 'packages/db/migrations/0022_publication_candidates.sql'];
  const sources = Object.fromEntries(await Promise.all([...new Set([...tracked, ...added])].sort().map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])));
  const assets = Object.fromEntries(await Promise.all((await readdir(resolve('dist/assets'))).sort().map(async name => [name, createHash('sha256').update(await readFile(resolve('dist/assets', name))).digest('hex')])));
  const source = createHash('sha256').update(JSON.stringify(sources)).digest('hex'), bundle = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
  const dir = resolve(root, '.trellis/tasks/10-03-a-publication-candidate/research/screenshots', `${source.slice(0, 12)}-${bundle.slice(0, 12)}-${run}`); await mkdir(dir, { recursive: true });
  const metadata = { dirty_candidate: true, source_sha256: source, source_files: sources, bundle_sha256: bundle, assets, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), test: info.title, state, route: page.url(), evidence: 'Built SPA, actual authenticated Owner/PostgreSQL/WSS publication admission and receipts; explicitly synthetic candidate Git OIDs/scan bytes, no native Runtime/provider', views: [] as unknown[] };
  for (const viewport of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(selector => { const element = document.querySelector(selector)!; scrollTo({ top: scrollY + element.getBoundingClientRect().top - 64, left: 0, behavior: 'instant' }); }, target);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow`).toBe(true);
    const body = await page.locator('body').innerText(); expect(body).not.toContain(canary);
    metadata.views.push({ viewport, scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY })), body });
    for (const fullPage of [false, true]) {
      if (fullPage) await page.evaluate(() => scrollTo(0, 0));
      const bytes = await page.screenshot({ fullPage }), file = `${name}-${viewport.label}${fullPage ? '-full' : ''}.png`;
      await writeFile(resolve(dir, file), bytes, { flag: 'wx' }); await info.attach(file, { body: bytes, contentType: 'image/png' });
    }
  }
  await writeFile(resolve(dir, `${name}.json`), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  await page.setViewportSize({ width: 1440, height: 1000 }); console.log(`Publication screenshot evidence: ${relative(root, dir)}/${name}`);
}

test('exact paginated redacted findings and prepare/confirm/apply survive lost receipts and reload', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'findings'), traffic: string[] = [], consoleText: string[] = [], commands: PublicationCommand[] = [];
  page.on('console', message => consoleText.push(message.text()));
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/v1/owner/tasks/publication/commands')) commands.push(request.postDataJSON()); });
  page.on('response', response => { if (response.url().includes('/publication-candidates') || response.url().includes('/publication/commands')) void response.text().then(text => traffic.push(text)).catch(() => {}); });
  await open(page, f.task); await expect(section(page)).toContainText('64 of 70 findings loaded.');
  const before = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`);
  await page.getByRole('button', { name: 'Load more findings', exact: true }).click(); await expect(section(page)).toContainText('70 of 70 findings loaded.');
  await expect(section(page)).toContainText('[redacted credential path]');
  for (const kind of ['Published credential', 'Provider hard size', 'Workflow permission']) await expect(page.getByRole('checkbox', { name: new RegExp(kind) })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select finding 0: Credential pattern', exact: true }).focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'Select finding 0: Credential pattern', exact: true })).toBeChecked();
  await capture(page, info, 'candidate-findings', '70 exact findings, safe filename/content redaction, hard constraints disabled', '.publication-findings');
  await page.route('**/v1/owner/tasks/publication/commands', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: '{"interrupted":true}' });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Review selected policy override', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Check original override step', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check original override step', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm exact policy override', exact: true })).toBeVisible();
  await capture(page, info, 'candidate-override-review', 'Recovered exact prepared selection; immutable head/parents/scan/config/basis/IDs', '.publication-override-review');
  await page.getByRole('button', { name: 'Confirm exact policy override', exact: true }).click(); await expect(page.getByRole('button', { name: 'Record confirmed override', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Record confirmed override', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record confirmed override', exact: true }).click(); await expect(section(page)).toContainText('Exact override recorded');
  await capture(page, info, 'candidate-override-recorded', 'One immutable eligible override receipt; findings and hard guards remain', '.publication-override-review');
  expect(commands.map(command => command.name)).toEqual(['prepare_publication_override', 'confirm_publication_override', 'override_publication_findings']);
  expect(commands[0]!.payload.finding_ids).toEqual(commands[2]!.payload.finding_ids);
  const after = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`);
  expect({ state: after.state, version: after.control_version, spec: after.specification_id, plan: after.plan_id }).toEqual({ state: before.state, version: before.control_version, spec: before.specification_id, plan: before.plan_id });
  expect((await peer(page, f, 'observe')).unexpected).toEqual([]);
  expect(JSON.stringify(traffic) + JSON.stringify(consoleText) + await page.locator('body').innerText() + await page.evaluate(() => Object.values(sessionStorage).join(''))).not.toContain(canary);
  await expect(page.getByRole('button', { name: /Accept|Prepare PR/ })).toHaveCount(0);
});

test('incomplete Retry creates new scans over one candidate, reaches history past 32 and direct selection', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'incomplete'); await open(page, f.task);
  await expect(section(page)).toContainText('Scan incomplete'); await expect(page.getByRole('button', { name: 'Review selected policy override', exact: true })).toHaveCount(0);
  await capture(page, info, 'candidate-incomplete', 'Terminal incomplete coverage, no override and explicit local Retry');
  await peer(page, f, 'history'); await page.reload();
  await expect(page.getByRole('button', { name: 'Load older candidates', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load older candidates', exact: true }).click();
  await expect(section(page).locator('summary').filter({ hasText: 'Candidate and scan history · 34 loaded' })).toBeVisible();
  await section(page).locator('summary').filter({ hasText: 'Candidate and scan history' }).click();
  await expect(page.getByRole('group', { name: 'Candidate history', exact: true }).getByRole('button')).toHaveCount(34);
  const all = (await peer(page, f, 'observe')).requests;
  expect(new Set(all.map(request => request.candidate_id)).size).toBe(1); expect(new Set(all.map(request => request.scan_run_id)).size).toBe(34);
  await section(page).locator('summary').filter({ hasText: 'Candidate and scan history' }).click();
  await peer(page, f, 'mode', 'clean'); await page.getByRole('button', { name: 'Retry local preparation', exact: true }).click();
  await expect.poll(async () => (await records(page, f)).items[0]?.scan?.status).toBe('complete');
  const newest = (await records(page, f)).items[0]!;
  await section(page).locator('summary').filter({ hasText: 'Open an exact candidate' }).click();
  await page.getByLabel('Candidate ID', { exact: true }).fill(newest.candidate!.candidate_id); await page.getByRole('button', { name: "Open candidate's latest scan", exact: true }).click();
  await expect(section(page)).toContainText('Current scan complete with no new findings.');
  await expect(section(page)).toContainText('Known published credential exposure');
  await expect(section(page)).not.toContainText('Local publication checks complete');
  expect(newest.known_public_exposure_count).toBeGreaterThan(0);
  await capture(page, info, 'candidate-clean-exposure', 'New complete empty scan reuses candidate; historical published exposure remains blocking and cannot be waived');
  const old: PublicationRecord = (await records(page, f)).items[1]!;
  await section(page).locator('summary').filter({ hasText: 'Candidate and scan history' }).click();
  await page.getByRole('group', { name: 'Candidate history', exact: true }).getByRole('button', { name: new RegExp(old.operation_id) }).click();
  await expect(section(page)).toContainText('Scan historical or configuration changed');
});

test('preparing/offline/unsupported/missing/no-change remain truthful with result inspection intact', async ({ page }, info) => {
  await signIn(page);
  for (const [mode, text] of [['preparing', 'Preparing the local candidate'], ['offline', 'The owning Runner is offline'], ['unsupported', 'does not support local publication'], ['unavailable', 'Retained source evidence is unavailable'], ['no_change', 'No tree changes from the fixed base']] as const) {
    const f = await scenario(page, mode); await open(page, f.task); await expect(section(page)).toContainText(text);
    await expect(page.getByRole('button', { name: 'Inspect changes', exact: true })).toBeVisible();
    await capture(page, info, `candidate-${mode}`, `${mode} canonical local preparation; no fabricated passed/empty findings`);
    if (mode === 'preparing') { await expect.poll(async () => (await peer(page, f, 'observe')).held).toBe(1); await peer(page, f, 'release'); await expect(section(page)).toContainText('64 of 70 findings loaded.'); }
    if (mode === 'offline') { await peer(page, f, 'mode', 'clean'); await peer(page, f, 'reconnect'); await expect(section(page)).toContainText('Local publication checks complete'); await capture(page, info, 'candidate-clean', 'Complete zero-findings current scan and no known exposure after authorized Runner reconnect'); }
  }
});

test('late findings/session replacement and changed effective basis cannot revive actions or replace selected history', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'findings'); await open(page, f.task); await expect(section(page)).toContainText('64 of 70 findings loaded.');
  await page.getByRole('checkbox', { name: 'Select finding 0: Credential pattern', exact: true }).check(); await page.getByRole('button', { name: 'Review selected policy override', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm exact policy override', exact: true })).toBeVisible();
  const status = await get<TaskSpecificationStatus>(page, `/v1/owner/tasks/${f.task}/specification`);
  await post(page, '/v1/owner/tasks/specification/commands', { schema_version: 1, request_id: crypto.randomUUID(), task_id: f.task, name: 'edit_specification', payload: { proposal_id: crypto.randomUUID(), specification: '# Updated requested behavior\n\nRetain earlier publication evidence as history.', summary: 'Change applicability without replacing retained candidate bytes.', basis: status.basis, impact: status.impact, source_input_ids: [] } });
  await post(page, '/__test__/execution-settle', { task_id: f.task });
  await expect(section(page)).toContainText('Historical candidate evidence'); await expect(page.getByRole('button', { name: 'Confirm exact policy override', exact: true })).toBeDisabled();
  await capture(page, info, 'candidate-historical', 'Ordinary Owner requirement change preserves original candidate/scan/review but removes current actions');
  let release: (() => void) | undefined;
  await page.route('**/publication-candidates/*/findings?*', async route => { const response = await route.fetch(); await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ response }); }, { times: 1 });
  await page.getByRole('button', { name: 'Load more findings', exact: true }).click(); await expect.poll(() => !!release).toBe(true);
  const replacement = await page.context().newPage(); await replacement.goto('/#todos');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await replacement.reload(); await replacement.getByLabel('Password', { exact: true }).fill('monos-browser-test-password'); await replacement.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(replacement.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  release!(); await expect(page.getByRole('region', { name: 'Local publication candidate', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(''))).not.toContain('publication-override');
  await replacement.close();
});
