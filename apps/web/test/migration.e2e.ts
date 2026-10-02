import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { InfrastructureSnapshot, TaskOverview, TodoRecord } from '../../../packages/protocol/generated/types.ts';
import { captureView } from './visual.ts';

test.setTimeout(90000);
async function post<T>(page: Page, path: string, body: unknown = {}): Promise<T> {
  const result = await page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { path, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200); return result.data as T;
}
async function get<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (path) => { const response = await fetch(path); if (!response.ok) throw new Error(`Read failed: ${response.status}`); return response.json(); }, path);
}
async function signIn(page: Page) {
  await page.goto('/'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  await post(page, '/__test__/execution-reset');
}

test('long exact preview remains readable with its disabled creation reason and discussion draft', async ({ page }, info) => {
  await signIn(page);
  const { todo } = await post<{ todo: TodoRecord }>(page, '/v1/owner/todos/commands', { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: randomUUID(), original_capture: 'A long independent requirement to discuss and verify.' } });
  const title = 'A complete independently reviewable improvement with precise requirements '.repeat(3).trim();
  const specification = '# Full exact proposal\n\n' + 'Preserve all original behavior and make the complete requirement readable on mobile. 中文内容必须完整保留。\n\n'.repeat(16);
  await post(page, '/__test__/discussion-proposal', { todo_id: todo.todo_id, title, specification });
  await page.goto(`/#todos?todo_id=${todo.todo_id}`); await page.reload();
  const proposal = page.getByRole('complementary', { name: 'Proposed Task', exact: true });
  await expect(proposal.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await proposal.locator('.discussion-content').textContent()).toBe(specification);
  await expect(proposal.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
  await page.getByLabel('Message Planner', { exact: true }).fill('Keep this scoped draft while reviewing the complete proposal.');
  await captureView(page, info, 'preview-long-content');
  await page.setViewportSize({ width: 390, height: 844 });
  await proposal.getByRole('button', { name: 'Continue discussing', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Keep this scoped draft while reviewing the complete proposal.');
});

test('source Todo and local REVIEW keep the same canonical Task across the migrated visual handoff', async ({ page }, info) => {
  await signIn(page);
  // Actual canonical transitions with explicit synthetic Runtime/effect acknowledgements.
  const f = await post<{ task: string; runner: string }>(page, '/__test__/execution-scenario', { kind: 'review', title: 'A verified local UI handoff' });
  const task = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`);
  expect(task.state).toBe('REVIEW'); expect(task.todo_id).toBeTruthy();
  await page.goto(`/#todos?todo_id=${task.todo_id}`); await page.reload();
  const created = page.getByRole('complementary', { name: 'Created Task', exact: true });
  await expect(created).toContainText('A verified local UI handoff');
  const link = created.getByRole('link', { name: 'View Task →', exact: true });
  expect(await link.getAttribute('href')).toContain(f.task);
  await page.getByLabel('Message Planner', { exact: true }).fill('Source Todo draft survives the Task handoff.');
  await captureView(page, info, 'integrated-todo-created');
  await link.click(); await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current result', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Task detail', exact: true })).not.toContainText('Project unavailable');
  await captureView(page, info, 'integrated-local-review');
  await page.getByRole('link', { name: '← Back to Todo', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Source Todo draft survives the Task handoff.');

  // Restrict the projection to this fixture's synthetic Runner for a small populated image.
  const infrastructure = await get<InfrastructureSnapshot>(page, '/v1/owner/infrastructure');
  const runner = infrastructure.runners.find((item) => item.runner_id === f.runner);
  if (!runner) throw new Error('Synthetic Runner observation is missing');
  await page.route('**/v1/owner/infrastructure', (route) => route.fulfill({ json: { schema_version: 1, runners: [runner] } }));
  await page.goto('/#execution'); await page.reload();
  await expect(page.getByText(runner.runner_id, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Installation detected', { exact: true }).first()).toBeVisible();
  await captureView(page, info, 'execution-runner-observed');
  await page.unroute('**/v1/owner/infrastructure');
  await page.route('**/v1/owner/infrastructure', (route) => route.fulfill({ status: 503, json: { schema_version: 1, status: 'error', error: { code: 'control_unavailable', message: 'Synthetic Runner status is temporarily unavailable' } } }));
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic Runner status is temporarily unavailable');
  await captureView(page, info, 'execution-read-error');
  await post(page, '/__test__/execution-reset');
});
