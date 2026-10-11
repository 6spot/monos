import { generateKeyPairSync } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { captureView } from './visual.ts';

test.setTimeout(90000);

async function navigate(page: Page, name: string) {
  if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function signIn(page: Page) {
  await page.goto('/#projects'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
}
async function save(page: Page) {
  const response = page.waitForResponse((r) => r.url().endsWith('/configuration/commands') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); expect((await response).status()).toBe(200);
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
}

test('real login, Role/Project/policy/provider persistence, drafts and responsive controls', async ({ page }, info) => {
  await page.goto('/#projects');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await captureView(page, info, 'login-empty');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid Owner credentials');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  const errorId = await page.getByLabel('Password', { exact: true }).getAttribute('aria-describedby');
  expect(errorId).toBeTruthy();
  await expect(page.locator(`[id="${errorId}"]`)).toContainText('Invalid Owner credentials');
  await captureView(page, info, 'login-error');
  let releaseLogin: () => void = () => {}; const loginBarrier = new Promise<void>((resolve) => { releaseLogin = resolve; });
  await page.route('**/v1/owner/login', async (route) => { await loginBarrier; await route.continue(); });
  await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.login-form button[type=submit]')).toBeDisabled();
  await captureView(page, info, 'login-busy');
  releaseLogin();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.unroute('**/v1/owner/login');
  await captureView(page, info, 'projects-empty');
  await navigate(page, 'Roles');
  await captureView(page, info, 'roles-empty'); await page.getByRole('button', { name: 'New role', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Product engineer'); await page.getByLabel('Description', { exact: true }).fill('Build thoughtful, tested product changes.');
  await page.getByLabel('Instructions', { exact: true }).fill('Read Project context. Implement the smallest complete change and verify it.');
  const hidden = page.getByRole('checkbox', { name: 'Hide from new selections', exact: true });
  await hidden.focus(); await page.keyboard.press('Space'); await expect(hidden).toBeChecked();
  await page.keyboard.press('Space'); await expect(hidden).not.toBeChecked();
  await page.getByText('Hide from new selections', { exact: true }).click(); await expect(hidden).toBeChecked();
  await page.getByText('Hide from new selections', { exact: true }).click(); await expect(hidden).not.toBeChecked();
  await save(page); await captureView(page, info, 'roles-populated');
  await page.getByLabel('Instructions', { exact: true }).fill('Long instructions with 中文 and exact examples. Keep each requirement independently readable.\n'.repeat(25));
  await captureView(page, info, 'roles-long-draft');
  await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  await navigate(page, 'Projects'); await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Personal website'); await page.getByLabel('Project context', { exact: true }).fill('A calm, accessible home for writing and selected work. Keep dependencies small.');
  await page.getByRole('button', { name: 'Add Git repository', exact: true }).click(); await page.getByLabel('Repository 1 remote URL', { exact: true }).fill('https://github.com/example/personal-website.git');
  await page.getByLabel('Repository 1 target branch', { exact: true }).fill('main'); await page.getByRole('checkbox', { name: 'Product engineer', exact: true }).check(); await save(page);
  await page.reload(); await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Personal website');
  await page.getByLabel('Project name', { exact: true }).fill('Unsaved website draft'); await navigate(page, 'Roles'); await navigate(page, 'Projects');
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unsaved website draft'); await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Personal website');
  await page.evaluate(() => scrollTo(0, 0));
  await captureView(page, info, 'projects-populated');
  await navigate(page, 'Execution');
  await expect(page.getByText('No Runner enrolled yet.', { exact: false })).toBeVisible();
  await captureView(page, info, 'execution-empty');
  await page.getByRole('checkbox', { name: 'Set a global default policy' }).check();
  await page.getByLabel('Default model', { exact: true }).fill('provider/new-manual-model'); await save(page); await page.reload(); await expect(page.getByLabel('Default model', { exact: true })).toHaveValue('provider/new-manual-model');
  await page.getByLabel('Planner guidance', { exact: true }).fill('Ask focused questions. Keep each Todo discussion independent.');
  await page.getByRole('button', { name: 'Save Planner guidance', exact: true }).click();
  await expect(page.getByText('Unsaved Planner guidance', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByLabel('Planner guidance', { exact: true })).toHaveValue('Ask focused questions. Keep each Todo discussion independent.');
  await page.getByLabel('Planner guidance', { exact: true }).fill('Unfinished Planner guidance');
  await navigate(page, 'Roles'); await navigate(page, 'Execution');
  await expect(page.getByLabel('Planner guidance', { exact: true })).toHaveValue('Unfinished Planner guidance');
  await page.getByRole('button', { name: 'Reload saved guidance', exact: true }).click();
  await expect(page.getByLabel('Planner guidance', { exact: true })).toHaveValue('Ask focused questions. Keep each Todo discussion independent.');
  await captureView(page, info, 'execution-policy');
  await navigate(page, 'GitHub');
  await captureView(page, info, 'github-empty');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await page.getByLabel('GitHub App ID', { exact: true }).fill('123'); await page.getByLabel('Installation ID', { exact: true }).fill('456'); await page.getByLabel('App private key', { exact: true }).fill(key); await save(page);
  await expect(page.getByLabel('App private key', { exact: true })).toHaveValue('');
  await page.route('**/v1/owner/github/repositories?*', (route) => route.fulfill({ status: 503, json: { schema_version: 1, status: 'error', error: { code: 'control_unavailable', message: 'Synthetic repository access is temporarily unavailable' } } }));
  await page.getByRole('button', { name: 'Check repository access', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic repository access is temporarily unavailable');
  await captureView(page, info, 'github-access-error');
  await page.unroute('**/v1/owner/github/repositories?*');
  // Provider response fixture: this proves UI behavior, not live GitHub readiness.
  await page.route('**/v1/owner/github/repositories?*', (route) => route.fulfill({ json: { schema_version: 1, repositories: [{ provider_repo_id: '42', full_name: 'example/personal-website', remote_url: 'https://github.com/example/personal-website.git', default_branch: 'main', private: true }] } }));
  await page.getByRole('button', { name: 'Check repository access', exact: true }).click(); await expect(page.getByText(/Read access confirmed/)).toBeVisible();
  await captureView(page, info, 'github-configured');
  await page.setViewportSize({ width: 390, height: 844 }); await navigate(page, 'Projects');
  await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('projects-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
});

test('two tabs reject stale edits and explicitly reload the saved version', async ({ page, context }, info) => {
  await signIn(page); await page.getByRole('button', { name: 'New project', exact: true }).click(); await page.getByLabel('Project name', { exact: true }).fill('Concurrent project'); await save(page);
  const other = await context.newPage(); await other.goto('/#projects'); await other.getByRole('button', { name: 'Concurrent project', exact: false }).click();
  await other.getByLabel('Project name', { exact: true }).fill('Second tab draft');
  await page.getByLabel('Project name', { exact: true }).fill('First tab saved'); await save(page);
  await other.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(other.getByRole('alert')).toContainText('Configuration changed');
  await expect(other.getByLabel('Project name', { exact: true })).toHaveValue('Second tab draft');
  await captureView(other, info, 'settings-version-conflict');
  await other.getByRole('button', { name: 'Reload saved version', exact: true }).click(); await expect(other.getByLabel('Project name', { exact: true })).toHaveValue('First tab saved');
});

test('a lost save reply recovers the original receipt without a second write', async ({ page }, info) => {
  await signIn(page); await navigate(page, 'Roles'); await page.getByRole('button', { name: 'New role', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Recovered role'); let writes = 0;
  await page.route('**/v1/owner/configuration/commands', async (route) => { writes++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check save result', exact: true })).toBeVisible();
  await expect(page.getByLabel('Role name', { exact: true })).toBeDisabled();
  const policy = page.getByRole('checkbox', { name: 'Use a custom execution policy', exact: true });
  await expect(policy).toBeDisabled();
  await policy.evaluate((control) => (control as HTMLElement).click());
  await expect(policy).not.toBeChecked();
  await captureView(page, info, 'settings-save-uncertain');
  await page.route('**/v1/owner/configuration/commands/*', (route) => route.fulfill({ json: { broken: true } }));
  await page.getByRole('button', { name: 'Check save result', exact: true }).click();
  await expect(page.getByLabel('Role name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check save result', exact: true })).toBeEnabled();
  await page.unroute('**/v1/owner/configuration/commands/*');
  await page.getByRole('button', { name: 'Check save result', exact: true }).click(); await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible(); expect(writes).toBe(1);
  await expect(page.getByText('Unsaved changes', { exact: true })).not.toBeVisible(); await page.reload();
  await expect(page.getByRole('button', { name: 'Recovered role', exact: false })).toHaveCount(1);
});


test('per-record drafts survive switching and duplicate submits create one receipt', async ({ page }) => {
  await signIn(page); await navigate(page, 'Roles');
  await page.getByRole('button', { name: 'New role', exact: true }).click(); await page.getByLabel('Role name', { exact: true }).fill('First local draft');
  await page.getByRole('button', { name: 'New role', exact: true }).click(); await page.getByLabel('Role name', { exact: true }).fill('Second local draft');
  await page.getByRole('button', { name: /First local draft/ }).click(); await expect(page.getByLabel('Role name', { exact: true })).toHaveValue('First local draft');
  let writes = 0;
  await page.route('**/v1/owner/configuration/commands', async (route) => { writes++; await route.fulfill({ response: await route.fetch() }); });
  await page.getByRole('button', { name: 'Save changes', exact: true }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible(); expect(writes).toBe(1);
  await page.getByRole('button', { name: /Second local draft/ }).click(); await expect(page.getByLabel('Role name', { exact: true })).toHaveValue('Second local draft');
});

test('session check outages preserve drafts; revoked sessions clear private editors', async ({ page }) => {
  await signIn(page); await navigate(page, 'GitHub'); await page.getByLabel('App private key', { exact: true }).fill('synthetic-unsaved-secret');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.route('**/v1/owner/session', (route) => route.abort('failed'));
  const check = page.waitForEvent('requestfailed', (request) => request.url().endsWith('/v1/owner/session'));
  // Focus revalidation follows visibility changes even when the cached read is fresh.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await check;
  await expect(page.getByLabel('App private key', { exact: true })).toHaveValue('synthetic-unsaved-secret');
  await page.unroute('**/v1/owner/session');
  expect(await page.evaluate(async () => (await fetch('/v1/owner/logout', { method: 'POST', credentials: 'same-origin' })).status)).toBe(200);
  await navigate(page, 'Execution'); await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await navigate(page, 'GitHub'); await expect(page.getByLabel('App private key', { exact: true })).toHaveValue('');
});

test('keyboard skip navigation retains the current view and moves focus to content', async ({ page }) => {
  await signIn(page); await navigate(page, 'Roles');
  await page.getByRole('link', { name: 'Skip to content', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused(); await expect(page.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
});

test('setup status retries failed reads and exposes concrete recovery without claiming execution readiness', async ({ page }, info) => {
  let unavailable = true;
  let storageAttention = false;
  await page.route('**/v1/owner/setup-readiness', async (route) => {
    if (unavailable) return route.fulfill({ status: 503, json: { schema_version: 1, status: 'error', error: { code: 'control_unavailable', message: 'Setup observation temporarily unavailable' } } });
    const response = await route.fetch();
    const report = await response.json();
    await route.fulfill({ json: { ...report,
      planner: storageAttention ? { status: 'unavailable', source: 'global', reason: 'database_storage_attention', action: 'restore_storage' } : { status: 'unavailable', source: 'global', reason: 'runner_missing', action: 'enroll_runner' },
      database_storage: { current: false, observed_at: new Date().toISOString(), observation: { scope: 'database', status: 'low', min_free_bytes: 1024 ** 3, free_bytes: 1024 ** 2, total_bytes: 1024 ** 4 } },
    } });
  });
  await signIn(page); await navigate(page, 'Execution');
  const setup = page.getByRole('region', { name: 'Setup status', exact: true });
  await expect(setup.getByRole('alert')).toContainText('Setup observation temporarily unavailable');
  unavailable = false;
  await setup.getByRole('button', { name: 'Retry setup check', exact: true }).click();
  await expect(setup.getByRole('heading', { name: 'Still unverified', exact: true })).toBeVisible();
  for (const label of ['Storage durability and host recovery', 'Coding tool login', 'Actual model execution', 'Git read access', 'Git write access']) await expect(setup.getByText(label, { exact: true })).toBeVisible();
  await setup.getByRole('button', { name: 'Enroll a Runner', exact: true }).click();
  await expect(setup.getByText('Runner enrollment and recovery', { exact: true })).toBeFocused();
  await expect(setup.getByText('pnpm runner:enroll-token', { exact: false })).toBeVisible();
  await expect(setup.getByText('These checks do not run a model', { exact: false })).toBeVisible();
  storageAttention = true;
  await setup.getByRole('button', { name: 'Refresh setup', exact: true }).click();
  await setup.getByRole('button', { name: 'Restore storage', exact: true }).click();
  await expect(setup.getByText('Storage recovery', { exact: true })).toBeFocused();
  await expect(setup.getByText('Previous or expired observation', { exact: false })).toBeVisible();
  await captureView(page, info, 'setup-recovery');
});

test('policy editing supports Codex before discovery and keeps pinned observations separate', async ({ page }, info) => {
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'] as const;
  let observed = false;
  await page.route('**/v1/owner/infrastructure', (route) => route.fulfill({ json: { schema_version: 1, runners: observed ? ids.map((runner_id, index) => ({ runner_id, capacity: 1, online: index === 0, runtimes: [{ current: index === 0, observed_at: new Date().toISOString(), installation: { runtime_id: 'codex', executable: 'codex', availability: 'detected', model_ids: [], supports_model: index === 0, supports_thinking: index === 0 } }] })) : [] } }));
  await signIn(page); await navigate(page, 'Execution');
  const policies = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Execution policies', exact: true }) });
  await policies.getByRole('checkbox', { name: 'Set a global default policy', exact: true }).uncheck();
  await policies.getByRole('checkbox', { name: 'Set a global default policy', exact: true }).check();
  await policies.getByLabel('Default Runtime', { exact: true }).selectOption('codex');
  const model = policies.getByLabel('Default model', { exact: true });
  await expect(model).toBeVisible();
  await expect(model).toHaveAttribute('required', '');
  await policies.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(model).toBeFocused();
  await model.fill('gpt-5.4');
  await policies.getByLabel('Default thinking level', { exact: true }).selectOption('high');
  await save(page);
  observed = true;
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await policies.getByLabel('Default Runner', { exact: true }).selectOption(ids[1]);
  const facts = policies.getByLabel('Default Runner observations', { exact: true });
  await expect(facts).toContainText(ids[1]);
  await expect(facts).not.toContainText(ids[0]);
  await expect(facts).toContainText('Previous connection');
  await expect(facts).toContainText('Model control: not reported');
  await expect(model).toHaveValue('gpt-5.4');
  await expect(policies.getByLabel('Default thinking level', { exact: true })).toHaveValue('high');
  await policies.getByLabel('Default Runner', { exact: true }).selectOption('');
  await expect(facts).toContainText(ids[0]);
  await expect(facts).toContainText(ids[1]);
  await captureView(page, info, 'policy-observations');
});

test('GitHub picker retries a failed page and searches only the explicitly selected page', async ({ page }, info) => {
  await signIn(page); await navigate(page, 'GitHub');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await page.getByLabel('GitHub App ID', { exact: true }).fill('123');
  await page.getByLabel('Installation ID', { exact: true }).fill('456');
  await page.getByLabel('App private key', { exact: true }).fill(key); await save(page);
  let failed = true;
  await page.route('**/v1/owner/github/repositories?*', (route) => {
    if (failed) return route.fulfill({ status: 503, json: { schema_version: 1, status: 'error', error: { code: 'control_unavailable', message: 'Repository page temporarily unavailable' } } });
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    const name = second ? 'second-repository' : 'first-repository';
    return route.fulfill({ json: { schema_version: 1, repositories: [{ provider_repo_id: second ? '202' : '201', full_name: `example/${name}`, remote_url: `https://github.com/example/${name}.git`, default_branch: 'main', private: true }], ...(second ? {} : { next_page: 2 }) } });
  });
  await navigate(page, 'Projects'); await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'Choose from GitHub', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Repository page temporarily unavailable');
  failed = false; await page.getByRole('button', { name: 'Retry repository page', exact: true }).click();
  await page.getByLabel('Search repositories on this page', { exact: true }).fill('SECOND');
  await expect(page.getByText('No matching repositories on page 1. Other pages have not been searched.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'example/second-repository Private', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'example/second-repository Private', exact: true }).click();
  await expect(page.getByLabel('Repository 1 remote URL', { exact: true })).toHaveValue('https://github.com/example/second-repository.git');
  await page.getByRole('button', { name: 'Choose from GitHub', exact: true }).click();
  await expect(page.getByLabel('Search repositories on this page', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  await captureView(page, info, 'github-page-search');
});

test('completed Task cleanup settings persist while retaining the configured disabled interval', async ({ page }) => {
  await signIn(page); await navigate(page, 'Execution');
  const cleanup = page.getByRole('form', { name: 'Completed Task cleanup settings', exact: true });
  await cleanup.getByLabel('Days after Task completion', { exact: true }).fill('14');
  await cleanup.getByRole('checkbox', { name: 'Automatically clean up completed Tasks', exact: true }).uncheck();
  await cleanup.getByRole('button', { name: 'Save cleanup settings', exact: true }).click();
  await expect(cleanup.getByText('Unsaved cleanup settings', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(cleanup.getByLabel('Days after Task completion', { exact: true })).toHaveValue('14');
  await expect(cleanup.getByRole('checkbox', { name: 'Automatically clean up completed Tasks', exact: true })).not.toBeChecked();
  await cleanup.getByRole('checkbox', { name: 'Automatically clean up completed Tasks', exact: true }).check();
  await cleanup.getByRole('button', { name: 'Save cleanup settings', exact: true }).click();
  await expect(cleanup.getByText('Unsaved cleanup settings', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(cleanup.getByRole('checkbox', { name: 'Automatically clean up completed Tasks', exact: true })).toBeChecked();
  await expect(cleanup.getByLabel('Days after Task completion', { exact: true })).toHaveValue('14');
  await expect(cleanup).toContainText('Cancelled Tasks keep their private work.');
});
