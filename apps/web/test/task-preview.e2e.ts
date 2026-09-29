import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ConfigurationSnapshot, TaskOverview, TaskPreviewCommand, TaskPreviewStatus, TodoRecord } from '../../../packages/protocol/generated/types.ts';

const markdown = '  # Exact task\n\nKeep <markup> & 中文 literally.\n- Preserve this boundary\n';
async function signIn(page: Page) {
  await page.goto('/'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
}
async function post<T>(page: Page, path: string, body: unknown): Promise<T> {
  const response = await page.evaluate(async ({ path, body }) => { const result = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: result.status, body: await result.json() }; }, { path, body });
  expect(response.status, JSON.stringify(response.body)).toBe(200); return response.body as T;
}
async function get<T>(page: Page, path: string): Promise<T> { return page.evaluate(async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Read failed: ${response.status}`); return response.json(); }, path); }
async function project(page: Page, name: string) {
  const id = randomUUID(); const snapshot = await get<ConfigurationSnapshot>(page, '/v1/owner/configuration');
  await post(page, '/v1/owner/configuration/commands', { schema_version: 1, request_id: randomUUID(), name: 'save_project', expected_control_version: snapshot.control_version, payload: { id, name, context: '', resources: [], role_ids: [], archived: false } });
  return id;
}
async function archiveProject(page: Page, id: string) {
  const snapshot = await get<ConfigurationSnapshot>(page, '/v1/owner/configuration'); const existing = snapshot.projects.find((item) => item.id === id);
  if (!existing) throw new Error('Fixture Project missing');
  await post(page, '/v1/owner/configuration/commands', { schema_version: 1, request_id: randomUUID(), name: 'save_project', expected_control_version: snapshot.control_version, payload: { ...existing, archived: true } });
}
async function capture(page: Page, label: string) {
  const result = await post<{ todo: TodoRecord }>(page, '/v1/owner/todos/commands', { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: randomUUID(), original_capture: label } });
  return result.todo.todo_id;
}
async function seed(page: Page, todoId: string, title: string) {
  return post<{ proposal_message_id: string }>(page, '/__test__/discussion-proposal', { todo_id: todoId, title, specification: markdown });
}
async function open(page: Page, todoId: string) { await page.goto(`/#todos?todo_id=${todoId}`); await page.reload(); await expect(page.getByLabel('Message Planner', { exact: true })).toBeVisible(); }
async function choose(page: Page, projectId: string) { await page.getByLabel('Task Project', { exact: true }).selectOption(projectId); await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeEnabled(); }
async function created(page: Page) { const card = page.getByRole('complementary', { name: 'Created Task', exact: true }); await expect(card).toContainText('Ready to start'); return card; }
async function taskFromLink(page: Page) { const href = await page.getByRole('link', { name: 'View Task →', exact: true }).getAttribute('href'); const id = new URLSearchParams(href?.split('?')[1]).get('task_id'); if (!id) throw new Error('Task identity missing'); return id; }

test('exact Project confirmation creates a ready Task; read-only navigation preserves drafts and current Specification', async ({ page }, info) => {
  await signIn(page); const first = await project(page, 'Preview first Project'); const second = await project(page, 'Preview chosen Project');
  const todoId = await capture(page, 'Exact preview source'); const proposal = await seed(page, todoId, 'An independent improvement');
  await open(page, todoId); const card = page.getByRole('complementary', { name: 'Proposed Task', exact: true });
  expect(await card.locator('.discussion-content').textContent()).toBe(markdown);
  await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
  await choose(page, first); const firstPreview = await get<TaskPreviewStatus>(page, `/v1/owner/todos/${todoId}/task-previews/${proposal.proposal_message_id}?project_id=${first}`);
  let releaseSelection: () => void = () => {}; const selectionRead = new Promise<void>((resolve) => { releaseSelection = resolve; });
  await page.route(`**/task-previews/${proposal.proposal_message_id}?project_id=${second}`, async (route) => { await selectionRead; await route.continue(); });
  await page.getByLabel('Task Project', { exact: true }).selectOption(second);
  await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
  releaseSelection(); await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeEnabled();
  const commands: TaskPreviewCommand[] = []; let discussionWrites = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/task-previews/commands')) commands.push(request.postDataJSON() as TaskPreviewCommand); if (request.method() === 'POST' && request.url().endsWith('/todos/discussion/commands')) discussionWrites++; });
  await page.getByLabel('Message Planner', { exact: true }).fill('Keep this discussion draft');
  await page.getByRole('button', { name: 'Continue discussing', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toBeFocused(); expect(discussionWrites).toBe(0);
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: info.outputPath('task-preview-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: info.outputPath('task-preview-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create Task', exact: true }).click(); await created(page);
  expect(commands.map((command) => command.name)).toEqual(['confirm_task_preview', 'create_execution_task']);
  expect(commands[0]?.payload.project_id).toBe(second); expect(commands[0]?.payload.content_digest).not.toBe(firstPreview.content_digest);
  expect(commands[1]?.payload.content_digest).toBe(commands[0]?.payload.content_digest);
  const todo = await get<TodoRecord>(page, `/v1/owner/todos/${todoId}`); expect(todo.project_id).toBeUndefined();
  const taskId = await taskFromLink(page); const task = await get<TaskOverview>(page, `/v1/owner/tasks/${taskId}`);
  expect(task).toMatchObject({ title: 'An independent improvement', todo_id: todoId, project_id: second, specification: markdown, state: 'PLANNING', queued_attempts: 0, held_attempts: 0, open_operations: 0 });
  expect(task.plan_id).toBeUndefined(); expect(Object.values(task.nodes)).toEqual([0, 0, 0, 0, 0]); expect(task.initial_specification_id).toBe(task.specification_id);
  await page.getByRole('link', { name: 'View Task →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'An independent improvement', exact: true })).toBeFocused();
  expect(await page.getByRole('region', { name: 'Task Specification', exact: true }).locator('.discussion-content').textContent()).toBe(markdown);
  await expect(page.getByRole('button', { name: /^Start/ })).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: info.outputPath('task-detail-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: info.outputPath('task-detail-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '← Back to Todo', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Keep this discussion draft');
  await page.getByRole('link', { name: 'View Task →', exact: true }).click(); await page.reload();
  await expect(page.getByRole('article', { name: 'Task detail', exact: true })).toContainText('Preview chosen Project'); expect(discussionWrites).toBe(0);
  await post(page, '/__test__/task-specification', { task_id: taskId, specification: '# Revised current specification\n' });
  await page.reload(); await expect(page.getByRole('region', { name: 'Task Specification', exact: true })).toContainText('# Revised current specification');
  const revised = await get<TaskOverview>(page, `/v1/owner/tasks/${taskId}`); expect(revised.initial_specification_id).toBe(task.initial_specification_id); expect(revised.specification_id).not.toBe(task.specification_id);
  await post(page, '/__test__/task-specification', { task_id: taskId, specification: { legacy: 'not Markdown' } });
  await page.reload(); await expect(page.getByRole('region', { name: 'Task Specification', exact: true })).toContainText('The current Specification is unavailable as Markdown.');
});

test('two clients confirm concurrently and resolve to one Task with distinct request IDs', async ({ page, browser }) => {
  await signIn(page); const projectId = await project(page, 'Concurrent preview Project'); const todoId = await capture(page, 'Two clients one Task'); await seed(page, todoId, 'One canonical Task'); await open(page, todoId); await choose(page, projectId);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:18555' }); const other = await context.newPage(); await signIn(other); await open(other, todoId); await choose(other, projectId);
  const commands: TaskPreviewCommand[] = []; let release: () => void = () => {}; const barrier = new Promise<void>((resolve) => { release = resolve; });
  for (const client of [page, other]) await client.route('**/v1/owner/task-previews/commands', async (route) => {
    const command = route.request().postDataJSON() as TaskPreviewCommand; commands.push(command);
    if (command.name === 'confirm_task_preview') { if (commands.filter((item) => item.name === 'confirm_task_preview').length === 2) release(); await barrier; }
    await route.continue();
  });
  await Promise.all([page.getByRole('button', { name: 'Create Task', exact: true }).click(), other.getByRole('button', { name: 'Create Task', exact: true }).click()]);
  await Promise.all([created(page), created(other)]); expect(await taskFromLink(page)).toBe(await taskFromLink(other));
  expect(new Set(commands.map((command) => command.request_id)).size).toBe(commands.length);
  expect(commands.filter((command) => command.name === 'confirm_task_preview')).toHaveLength(2);
  await other.reload(); await created(other); expect(await taskFromLink(page)).toBe(await taskFromLink(other)); await context.close();
});

for (const lostStage of ['confirm_task_preview', 'create_execution_task'] as const) test(`lost ${lostStage} response recovers the original request across Todo switches and malformed lookups`, async ({ page }) => {
  await signIn(page); const projectId = await project(page, `Recovery ${lostStage}`); const todoId = await capture(page, `Recovery source ${lostStage}`); const otherId = await capture(page, `Other source ${lostStage}`); await seed(page, todoId, 'Recover exact Task'); await open(page, todoId); await choose(page, projectId);
  await page.getByLabel('Message Planner', { exact: true }).fill('Draft retained during creation');
  const commands: TaskPreviewCommand[] = [];
  await page.route('**/v1/owner/task-previews/commands', async (route) => { const command = route.request().postDataJSON() as TaskPreviewCommand; commands.push(command); const response = await route.fetch(); expect(response.status(), await response.text()).toBe(200); if (command.name === lostStage) await route.abort('failed'); else await route.fulfill({ response }); });
  await page.getByRole('button', { name: 'Create Task', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check Task result', exact: true })).toBeVisible();
  await page.evaluate((id) => { location.hash = `todos?todo_id=${id}`; }, otherId); await expect(page.getByRole('heading', { name: `Other source ${lostStage}`, exact: true })).toBeVisible(); await page.getByLabel('Message Planner', { exact: true }).fill('Independent second draft');
  await page.evaluate((id) => { location.hash = `todos?todo_id=${id}`; }, todoId); await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Draft retained during creation');
  const pending = commands.find((command) => command.name === lostStage); expect(pending).toBeDefined();
  const receiptPath = `**/v1/owner/task-previews/commands/${pending?.request_id}`;
  await page.route(receiptPath, (route) => route.fulfill({ json: { invalid: true } })); await page.getByRole('button', { name: 'Check Task result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check Task result', exact: true })).toBeEnabled(); expect(commands.filter((command) => command.name === lostStage)).toHaveLength(1);
  await page.unroute(receiptPath); await page.getByRole('button', { name: 'Check Task result', exact: true }).click();
  await created(page); await expect(page.getByRole('button', { name: 'Check Task result', exact: true })).toHaveCount(0);
  expect(commands.map((command) => command.name)).toEqual(['confirm_task_preview', 'create_execution_task']);
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Draft retained during creation');
});

test('new input stales a proposal, cancellation persists, and created Project overrides another client selection', async ({ page, browser }) => {
  await signIn(page); const first = await project(page, 'Stale preview Project'); const second = await project(page, 'Other preview Project'); const todoId = await capture(page, 'Stale proposal source'); await seed(page, todoId, 'Stale proposal'); await open(page, todoId); await choose(page, first);
  await page.getByLabel('Message Planner', { exact: true }).fill('Change this requirement before creation'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Proposed Task', exact: true })).toContainText('Discussion has moved on.'); await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel proposal', exact: true }).click(); await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('complementary', { name: 'Proposed Task', exact: true })).toContainText('Task proposal cancelled.');
  const createdTodo = await capture(page, 'Canonical created Project'); await seed(page, createdTodo, 'Stable association'); await open(page, createdTodo); await choose(page, first);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:18555' }); const other = await context.newPage(); await signIn(other); await open(other, createdTodo); await choose(other, second);
  await page.getByRole('button', { name: 'Create Task', exact: true }).click(); await created(page); const otherCard = await created(other);
  await expect(otherCard).toContainText('Stale preview Project'); await expect(otherCard).not.toContainText('Other preview Project'); expect(await taskFromLink(page)).toBe(await taskFromLink(other));
  await context.close();
});

test('Project defaults, archive guards and Todo reassignment preserve canonical created associations', async ({ page }) => {
  await signIn(page); const first = await project(page, 'Default preview Project'); const second = await project(page, 'Available preview Project');
  const todoId = await capture(page, 'Project eligibility source');
  let todo = await get<TodoRecord>(page, `/v1/owner/todos/${todoId}`);
  await post(page, '/v1/owner/todos/commands', { schema_version: 1, request_id: randomUUID(), name: 'assign_todo_project', expected_control_version: todo.control_version, payload: { todo_id: todoId, project_id: first } });
  await seed(page, todoId, 'Project guarded Task'); await open(page, todoId);
  await expect(page.getByLabel('Task Project', { exact: true })).toHaveValue(first); await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeEnabled();
  // Make the choice explicit, so an archived selection cannot silently rebase.
  await choose(page, second); await choose(page, first); await archiveProject(page, first);
  await expect(page.getByRole('complementary', { name: 'Proposed Task', exact: true })).toContainText('This Project is unavailable.');
  await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
  await choose(page, second); await page.getByRole('button', { name: 'Create Task', exact: true }).click(); await created(page);
  const taskId = await taskFromLink(page);
  todo = await get<TodoRecord>(page, `/v1/owner/todos/${todoId}`);
  await post(page, '/v1/owner/todos/commands', { schema_version: 1, request_id: randomUUID(), name: 'assign_todo_project', expected_control_version: todo.control_version, payload: { todo_id: todoId, project_id: second } });
  todo = await get<TodoRecord>(page, `/v1/owner/todos/${todoId}`);
  await post(page, '/v1/owner/todos/commands', { schema_version: 1, request_id: randomUUID(), name: 'set_todo_archived', expected_control_version: todo.control_version, payload: { todo_id: todoId, archived: true } });
  await archiveProject(page, second); await page.reload();
  await expect(await created(page)).toContainText('Available preview Project'); expect(await taskFromLink(page)).toBe(taskId);
  await page.getByRole('link', { name: 'View Task →', exact: true }).click(); await page.reload();
  await expect(page.getByRole('article', { name: 'Task detail', exact: true })).toContainText('Available preview Project');
  await page.getByRole('link', { name: '← Back to Todo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project eligibility source', exact: true })).toBeVisible();
  await expect(page.getByLabel('Todo scope', { exact: true })).toHaveValue('archived');
  const third = await project(page, 'Changed source Project'); const changedTodo = await capture(page, 'Changed Project source');
  await seed(page, changedTodo, 'Old Project basis'); await open(page, changedTodo); await choose(page, third);
  const basis = await get<TodoRecord>(page, `/v1/owner/todos/${changedTodo}`);
  await post(page, '/v1/owner/todos/commands', { schema_version: 1, request_id: randomUUID(), name: 'assign_todo_project', expected_control_version: basis.control_version, payload: { todo_id: changedTodo, project_id: third } });
  await expect(page.getByRole('complementary', { name: 'Proposed Task', exact: true })).toContainText('The Todo’s Project context changed.');
  await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
});
