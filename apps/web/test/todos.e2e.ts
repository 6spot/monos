import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { TodoCommand } from '../../../packages/protocol/generated/types.ts';

async function signIn(page: Page) {
  await page.goto('/'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
}
async function capture(page: Page, text: string) {
  await page.getByLabel('Capture an idea', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Capture Todo', exact: true }).click();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('');
  await expect(page.getByRole('heading', { name: text.split('\n').map((line) => line.trim()).find(Boolean), exact: true })).toBeVisible();
}
async function createProject(page: Page, name: string) {
  const id = randomUUID();
  const status = await page.evaluate(async ({ id, name, requestId }) => {
    const snapshot = await (await fetch('/v1/owner/configuration')).json();
    const response = await fetch('/v1/owner/configuration/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: 1, request_id: requestId, name: 'save_project', expected_control_version: snapshot.control_version, payload: { id, name, context: '', resources: [], role_ids: [], archived: false } }) });
    return response.status;
  }, { id, name, requestId: randomUUID() });
  expect(status).toBe(200); return id;
}
async function saveProject(page: Page) {
  await page.getByRole('button', { name: 'Save Project', exact: true }).click();
  await expect(page.getByText('Unsaved Project change', { exact: true })).not.toBeVisible();
}
async function openOrganization(page: Page) {
  const details = page.locator('.todo-organization');
  await expect(details).toBeVisible();
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator('summary').click();
}

test('capture and keyboard opening preserve exact text without AI work; initial selection stays empty', async ({ page }, info) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveCount(0);
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.getByRole('button', { name: 'Create Todo', exact: true }).click();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  const original = '  A quiet captured idea  \n\nKeep <markup> & 中文 exactly.\n';
  await capture(page, original);
  await expect(page.getByLabel('Todo Project', { exact: true })).not.toBeVisible();
  expect(await page.getByRole('region', { name: 'Original Capture', exact: true }).locator('.todo-original').textContent()).toBe(original);
  expect(writes).toEqual(['/v1/owner/todos/commands']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  const row = page.getByRole('button', { name: /^A quiet captured idea/ });
  await row.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'A quiet captured idea', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveCount(2);
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('');
  expect(writes).toEqual(['/v1/owner/todos/commands']);
  await page.screenshot({ path: info.outputPath('todos-desktop.png'), fullPage: true });
});

test('Inbox, Project, archive and restore preserve capture and scoped drafts', async ({ page }) => {
  await signIn(page);
  const project = await createProject(page, 'Todo organization Project'); await page.reload();
  await capture(page, 'Organize first idea'); await capture(page, 'Organize second idea');
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await openOrganization(page);
  await page.getByLabel('Todo Project', { exact: true }).selectOption(project);
  await page.getByLabel('Capture an idea', { exact: true }).fill('Keep my next idea');
  await page.getByRole('button', { name: /^Organize second idea/ }).click();
  await openOrganization(page);
  await expect(page.getByLabel('Todo Project', { exact: true })).toHaveValue('');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await openOrganization(page);
  await expect(page.getByLabel('Todo Project', { exact: true })).toHaveValue(project);
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('Keep my next idea');
  await page.getByLabel('Todo scope', { exact: true }).selectOption('inbox'); await saveProject(page);
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Organize first idea/ })).toHaveCount(0);
  await page.getByLabel('Todo scope', { exact: true }).selectOption(`project:${project}`);
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await page.getByLabel('Todo scope', { exact: true }).focus();
  await page.getByLabel('Todo scope', { exact: true }).selectOption('inbox');
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  await expect(page.getByLabel('Todo scope', { exact: true })).toBeFocused();
  await page.getByLabel('Todo scope', { exact: true }).selectOption(`project:${project}`);
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await openOrganization(page);
  await page.getByRole('button', { name: 'Archive Todo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  await page.getByLabel('Todo scope', { exact: true }).selectOption('archived');
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await openOrganization(page);
  await expect(page.getByRole('region', { name: 'Original Capture', exact: true })).toContainText('Organize first idea');
  await page.getByRole('button', { name: 'Restore Todo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  await page.getByLabel('Todo scope', { exact: true }).selectOption(`project:${project}`);
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await openOrganization(page);
  await page.getByLabel('Todo Project', { exact: true }).selectOption(''); await saveProject(page);
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  await page.getByLabel('Todo scope', { exact: true }).selectOption('inbox');
  await page.getByRole('button', { name: /^Organize first idea/ }).click();
  await openOrganization(page);
  await expect(page.getByLabel('Todo Project', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('Keep my next idea');
  await page.getByLabel('Capture Project (optional)', { exact: true }).selectOption(project);
  await page.getByLabel('Todo scope', { exact: true }).selectOption(`project:${project}`);
  await capture(page, 'Captured directly in a Project');
  await openOrganization(page);
  await expect(page.getByLabel('Todo Project', { exact: true })).toHaveValue(project);
  await page.reload(); await expect(page.getByLabel('Todo scope', { exact: true })).toHaveValue(`project:${project}`);
  await expect(page.getByRole('heading', { name: 'No Todo selected', exact: true })).toBeVisible();
});

test('lost capture replies and malformed receipt reads retain one immutable command and the draft', async ({ page }) => {
  await signIn(page); const original = '  Recover the original capture\n';
  await page.getByLabel('Capture an idea', { exact: true }).fill(original); let writes = 0;
  await page.route('**/v1/owner/todos/commands', async (route) => { writes++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Capture Todo', exact: true }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole('button', { name: 'Check Todo result', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue(original);
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeDisabled();
  await page.route('**/v1/owner/todos/commands/*', (route) => route.fulfill({ json: { malformed: true } }));
  await page.getByRole('button', { name: 'Check Todo result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check Todo result', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue(original); expect(writes).toBe(1);
  await page.unroute('**/v1/owner/todos/commands/*');
  await page.getByRole('button', { name: 'Check Todo result', exact: true }).click();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Recover the original capture/ })).toHaveCount(1); expect(writes).toBe(1);
});

test('an unknown receipt replays the identical capture while a definitive error preserves editable text', async ({ page }) => {
  await signIn(page); const commands: TodoCommand[] = [];
  await page.route('**/v1/owner/todos/commands', async (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) await route.abort('failed');
    else await route.fulfill({ response: await route.fetch() });
  });
  await page.getByLabel('Capture an idea', { exact: true }).fill('Replay a not-yet-committed idea');
  await page.getByRole('button', { name: 'Capture Todo', exact: true }).click();
  await page.getByRole('button', { name: 'Check Todo result', exact: true }).click();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('');
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
  await page.unroute('**/v1/owner/todos/commands');
  await page.route('**/v1/owner/todos/commands', (route) => route.fulfill({ status: 409, json: { schema_version: 1, status: 'error', error: { code: 'unmet_precondition', message: 'Project is no longer active.' } } }));
  await page.getByLabel('Capture an idea', { exact: true }).fill('Keep this rejected draft');
  await page.getByRole('button', { name: 'Capture Todo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Project is no longer active.');
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('Keep this rejected draft');
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeEnabled();
});

test('two tabs reject stale organization without silently replacing its expected version', async ({ page, context }) => {
  await signIn(page);
  const first = await createProject(page, 'First Todo Project'); const second = await createProject(page, 'Second Todo Project'); await page.reload();
  await capture(page, 'Concurrent Todo organization');
  await openOrganization(page);
  await page.getByLabel('Todo Project', { exact: true }).selectOption(first);
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: /^Concurrent Todo organization/ }).click();
  await openOrganization(other);
  await other.getByLabel('Todo Project', { exact: true }).selectOption(second); await saveProject(other);
  await page.getByRole('button', { name: 'Save Project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/changed|version/i);
  await expect(page.getByLabel('Todo Project', { exact: true })).toHaveValue(first);
  await page.getByRole('button', { name: 'Reload saved Project', exact: true }).click();
  await expect(page.getByLabel('Todo Project', { exact: true })).toHaveValue(second);
});

test('mobile returns from detail to the list with capture drafts intact and no horizontal overflow', async ({ page }, info) => {
  await signIn(page); await capture(page, 'Mobile captured idea');
  await page.getByLabel('Capture an idea', { exact: true }).fill('Mobile unfinished capture');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Mobile captured idea', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('todos-mobile-detail.png'), fullPage: true });
  await page.getByRole('button', { name: '← Back to Todos', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Mobile captured idea/ })).toBeFocused();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('Mobile unfinished capture');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('todos-mobile-list.png'), fullPage: true });
  await page.getByRole('button', { name: /^Mobile captured idea/ }).click();
  await page.locator('.todo-organization > summary').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Archive Todo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive Todo', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('Mobile unfinished capture');
  await page.getByLabel('Todo scope', { exact: true }).selectOption('archived');
  await page.getByRole('button', { name: /^Mobile captured idea/ }).click();
  await openOrganization(page);
  await page.getByRole('button', { name: 'Restore Todo', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Capture an idea', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('Mobile unfinished capture');
});
