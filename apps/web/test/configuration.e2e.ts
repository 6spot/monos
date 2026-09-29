import { generateKeyPairSync } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function navigate(page: Page, name: string) {
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
  await page.getByLabel('Password', { exact: true }).fill('incorrect-test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid Owner credentials');
  await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await navigate(page, 'Roles'); await page.getByRole('button', { name: 'New role', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Product engineer'); await page.getByLabel('Description', { exact: true }).fill('Build thoughtful, tested product changes.');
  await page.getByLabel('Instructions', { exact: true }).fill('Read Project context. Implement the smallest complete change and verify it.'); await save(page);
  await navigate(page, 'Projects'); await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Personal website'); await page.getByLabel('Project context', { exact: true }).fill('A calm, accessible home for writing and selected work. Keep dependencies small.');
  await page.getByRole('button', { name: 'Add Git repository', exact: true }).click(); await page.getByLabel('Repository 1 remote URL', { exact: true }).fill('https://github.com/example/personal-website.git');
  await page.getByLabel('Repository 1 target branch', { exact: true }).fill('main'); await page.getByRole('checkbox', { name: 'Product engineer', exact: true }).check(); await save(page);
  await page.reload(); await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Personal website');
  await page.getByLabel('Project name', { exact: true }).fill('Unsaved website draft'); await navigate(page, 'Roles'); await navigate(page, 'Projects');
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unsaved website draft'); await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Personal website');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('projects-desktop.png'), fullPage: true });
  await navigate(page, 'Execution'); await page.getByRole('checkbox', { name: 'Set a global default policy' }).check();
  await page.getByLabel('Default model', { exact: true }).fill('provider/new-manual-model'); await save(page); await page.reload(); await expect(page.getByLabel('Default model', { exact: true })).toHaveValue('provider/new-manual-model');
  await navigate(page, 'GitHub');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await page.getByLabel('GitHub App ID', { exact: true }).fill('123'); await page.getByLabel('Installation ID', { exact: true }).fill('456'); await page.getByLabel('App private key', { exact: true }).fill(key); await save(page);
  await expect(page.getByLabel('App private key', { exact: true })).toHaveValue('');
  // Provider response fixture: this proves UI behavior, not live GitHub readiness.
  await page.route('**/v1/owner/github/repositories?*', (route) => route.fulfill({ json: { schema_version: 1, repositories: [{ provider_repo_id: '42', full_name: 'example/personal-website', remote_url: 'https://github.com/example/personal-website.git', default_branch: 'main', private: true }] } }));
  await page.getByRole('button', { name: 'Check repository access', exact: true }).click(); await expect(page.getByText(/Read access confirmed/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await navigate(page, 'Projects');
  await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('projects-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
});

test('two tabs reject stale edits and explicitly reload the saved version', async ({ page, context }) => {
  await signIn(page); await page.getByRole('button', { name: 'New project', exact: true }).click(); await page.getByLabel('Project name', { exact: true }).fill('Concurrent project'); await save(page);
  const other = await context.newPage(); await other.goto('/#projects'); await other.getByRole('button', { name: 'Concurrent project', exact: false }).click();
  await other.getByLabel('Project name', { exact: true }).fill('Second tab draft');
  await page.getByLabel('Project name', { exact: true }).fill('First tab saved'); await save(page);
  await other.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(other.getByRole('alert')).toContainText('Configuration changed');
  await expect(other.getByLabel('Project name', { exact: true })).toHaveValue('Second tab draft');
  await other.getByRole('button', { name: 'Reload saved version', exact: true }).click(); await expect(other.getByLabel('Project name', { exact: true })).toHaveValue('First tab saved');
});

test('a lost save reply recovers the original receipt without a second write', async ({ page }) => {
  await signIn(page); await navigate(page, 'Roles'); await page.getByRole('button', { name: 'New role', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Recovered role'); let writes = 0;
  await page.route('**/v1/owner/configuration/commands', async (route) => { writes++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check save result', exact: true })).toBeVisible();
  await expect(page.getByLabel('Role name', { exact: true })).toBeDisabled();
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
