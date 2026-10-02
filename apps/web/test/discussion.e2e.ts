import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { DiscussionCommand, DiscussionMessage, DiscussionStatus } from '../../../packages/protocol/generated/types.ts';

async function signIn(page: Page) {
  await page.goto('/'); await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
}
async function capture(page: Page, label: string) {
  const saved = page.waitForResponse((response) => response.url().endsWith('/todos/commands') && response.request().method() === 'POST');
  await page.getByLabel('Capture an idea', { exact: true }).fill(label); await page.getByRole('button', { name: 'Capture Todo', exact: true }).click();
  const result = await (await saved).json();
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  return result.todo.todo_id as string;
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Planner', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('');
  await expect(page.locator('.discussion-content').filter({ hasText: text })).toHaveCount(1);
}

test('real persisted input stays queued, drafts follow each Todo, and navigation does not submit them', async ({ page }) => {
  await signIn(page);
  await capture(page, 'Discussion draft first'); await page.getByLabel('Message Planner', { exact: true }).fill('First unfinished discussion');
  await capture(page, 'Discussion draft second'); await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('');
  await page.getByLabel('Message Planner', { exact: true }).fill('Second unfinished discussion');
  let writes = 0; page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/todos/discussion/commands')) writes++; });
  await page.getByRole('button', { name: /^Discussion draft first/ }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('First unfinished discussion');
  await page.getByRole('link', { name: 'Execution', exact: true }).click(); await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('First unfinished discussion'); expect(writes).toBe(0);
  await send(page, 'First persisted source'); await send(page, 'Later persisted source');
  await expect(page.locator('.discussion-messages > li')).toHaveCount(2);
  await expect(page.locator('.discussion-attention')).toContainText('Planner queued');
  await expect(page.locator('.discussion-messages > li').last()).toContainText('Queued');
  await page.getByRole('button', { name: /^Discussion draft second/ }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Second unfinished discussion');
  await expect(page.locator('.discussion-messages > li')).toHaveCount(0); expect(writes).toBe(2);
});

test('queued Discussion explains required changes while retaining saved input and drafts', async ({ page }) => {
  // Status reasons are fixtures; message persistence and the displayed controls are real.
  await signIn(page); const todoId = await capture(page, 'Discussion waiting reasons');
  await send(page, 'Saved question awaiting Planner');
  const sourceId = await page.locator('.discussion-messages > li').first().getAttribute('data-message-id');
  if (!sourceId) throw new Error('Saved message identity is missing');
  await page.getByLabel('Message Planner', { exact: true }).fill('Retained follow-up draft');
  const source: NonNullable<DiscussionStatus['current_source']> = { message_id: sourceId, source_watermark: 1, status: 'queued' };
  const status: DiscussionStatus = { schema_version: 1, todo_id: todoId, discussion_version: 1, resolved_watermark: 0, latest_sequence: 1, project_context_version: 0, project_context_digest: 'a'.repeat(64), current_source: source };
  await page.route(`**/v1/owner/todos/${todoId}/discussion`, (route) => route.fulfill({ json: status }));
  let writes = 0; page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/todos/discussion/commands')) writes++; });
  for (const [reason, explanation] of [
    ['context_budget_exceeded', 'Shorten Planner guidance or Project context, or withdraw this message and send a shorter one.'],
    ['installation_unavailable', 'Check its installation or choose another in Execution settings.'],
    ['unsupported_thinking', 'Remove it in Execution settings.'],
    ['context_unavailable', 'Review its Project and Planner guidance, or withdraw this message and try again.'],
  ] as const) {
    source.waiting_reason = reason;
    await expect(page.getByRole('button', { name: 'Refresh Discussion', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Refresh Discussion', exact: true }).click();
    await expect(page.locator('.discussion-attention')).toContainText(explanation);
    await expect(page.getByRole('button', { name: 'Withdraw message', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Retained follow-up draft');
    await expect(page.locator('.discussion-content').filter({ hasText: 'Saved question awaiting Planner' })).toHaveCount(1);
  }
  expect(writes).toBe(0);
});

test('lost Discussion responses preserve a Todo-scoped request while other Todos remain usable', async ({ page }) => {
  await signIn(page); const first = await capture(page, 'Uncertain discussion first');
  await capture(page, 'Uncertain discussion second');
  await page.getByRole('button', { name: /^Uncertain discussion first/ }).click();
  const commands: DiscussionCommand[] = [];
  await page.route('**/v1/owner/todos/discussion/commands', async (route) => {
    const command = route.request().postDataJSON() as DiscussionCommand; commands.push(command);
    const response = await route.fetch(); expect(response.status()).toBe(200);
    if (command.todo_id === first) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.getByLabel('Message Planner', { exact: true }).fill('  Original uncertain source\n');
  await page.getByRole('button', { name: 'Send message', exact: true }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole('button', { name: 'Check Discussion result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Uncertain discussion second/ }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toBeEnabled(); await send(page, 'Independent second Todo');
  await page.getByRole('button', { name: /^Uncertain discussion first/ }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('  Original uncertain source\n');
  await expect(page.getByLabel('Message Planner', { exact: true })).toBeDisabled();
  await page.route('**/v1/owner/todos/discussion/commands/*', (route) => route.fulfill({ json: { malformed: true } }));
  await page.getByRole('button', { name: 'Check Discussion result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check Discussion result', exact: true })).toBeEnabled();
  expect(commands.filter((command) => command.todo_id === first)).toHaveLength(1);
  await page.unroute('**/v1/owner/todos/discussion/commands/*');
  await page.getByRole('button', { name: 'Check Discussion result', exact: true }).click();
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('');
  await expect(page.locator('.discussion-messages > li')).toHaveCount(1);
  expect(commands.filter((command) => command.todo_id === first)).toHaveLength(1);
});

test('recent bounded history exposes new input without loading every older page', async ({ page }) => {
  await signIn(page); const todoId = await capture(page, 'Discussion history window');
  // Seed history in small batches: this tests pagination, not lock-timeout behavior
  // from 65 simultaneous writes over a remote database tunnel.
  const statuses = await page.evaluate(async ({ todoId, seeds }) => {
    const statuses: number[] = [];
    for (let offset = 0; offset < seeds.length; offset += 5) statuses.push(...await Promise.all(seeds.slice(offset, offset + 5).map(async ({ messageId, requestId }, index) => {
      const response = await fetch('/v1/owner/todos/discussion/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: 1, request_id: requestId, todo_id: todoId, name: 'submit_discussion_message', payload: { message_id: messageId, content: `Earlier message ${offset + index}` } }) });
      return response.status;
    })));
    return statuses;
  }, { todoId, seeds: Array.from({ length: 65 }, () => ({ messageId: randomUUID(), requestId: randomUUID() })) });
  expect(statuses.every((status) => status === 200)).toBe(true);
  await page.reload(); await page.getByRole('button', { name: /^Discussion history window/ }).click();
  await expect(page.locator('.discussion-messages > li')).toHaveCount(64);
  await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toBeVisible();
  await send(page, 'Newest message visible immediately');
  await expect(page.locator('.discussion-messages > li')).toHaveCount(64);
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await expect(page.locator('.discussion-messages > li')).toHaveCount(66);
  await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toHaveCount(0);
});

test('canonical status fixtures drive exact recovery exits and attributed replies across reconnect', async ({ page }, info) => {
  // This is a browser projection/recovery test, not a real Planner execution.
  await signIn(page); const todoId = await capture(page, 'Discussion recovery controls');
  const sourceId = randomUUID(), laterId = randomUUID();
  const messages: DiscussionMessage[] = [
    { message_id: sourceId, sequence: 1, author: 'owner', content: 'Original interrupted question', created_at: '2026-09-30T00:00:00.000Z' },
    { message_id: laterId, sequence: 2, author: 'owner', content: 'Later queued question', created_at: '2026-09-30T00:00:01.000Z' },
  ];
  const status: DiscussionStatus = { schema_version: 1, todo_id: todoId, discussion_version: 2, resolved_watermark: 0, latest_sequence: 2, project_context_version: 1, project_context_digest: 'a'.repeat(64), current_source: { message_id: sourceId, source_watermark: 1, status: 'queued', attempt_id: 'original-attempt' } };
  let offline = false;
  await page.route(`**/v1/owner/todos/${todoId}/discussion`, (route) => offline ? route.abort('failed') : route.fulfill({ json: status }));
  await page.route(`**/v1/owner/todos/${todoId}/discussion/messages*`, (route) => offline ? route.abort('failed') : route.fulfill({ json: { schema_version: 1, todo_id: todoId, messages, cursor: 'fixture', has_more: false } }));
  const commands: DiscussionCommand[] = [];
  await page.route('**/v1/owner/todos/discussion/commands', async (route) => {
    const command = route.request().postDataJSON() as DiscussionCommand; commands.push(command);
    expect(command.todo_id).toBe(todoId); expect(command.expected_discussion_version).toBe(status.discussion_version); expect(command.payload.source_message_id).toBe(sourceId);
    status.discussion_version++;
    if (command.name === 'stop_discussion_turn') {
      expect(command.payload.attempt_id).toBe('original-attempt'); status.current_source = { message_id: sourceId, source_watermark: 1, status: 'interrupted', end_reason: 'owner_stopped' };
    } else if (command.name === 'retry_discussion_turn') {
      status.current_source = { message_id: sourceId, source_watermark: 1, status: 'processing', attempt_id: 'retry-attempt' };
    } else if (command.name === 'withdraw_discussion_turn') {
      messages[0]!.disposition = 'withdrawn'; status.resolved_watermark = 1;
      status.current_source = { message_id: laterId, source_watermark: 2, status: 'queued' };
    }
    await route.fulfill({ json: { schema_version: 1, request_id: command.request_id, todo_id: todoId, discussion_version: status.discussion_version, status: 'committed' } });
  });
  await page.getByRole('button', { name: 'Refresh Discussion', exact: true }).click();
  await page.getByRole('button', { name: 'Stop Discussion', exact: true }).click();
  await expect(page.locator('.discussion-attention')).toContainText('Discussion interrupted');
  await page.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect(page.locator('.discussion-attention')).toContainText('Planner is answering');
  await page.getByRole('button', { name: 'Withdraw message', exact: true }).click();
  await expect(page.locator('.discussion-messages > li').first()).toContainText('Withdrawn');
  await expect(page.locator('.discussion-messages > li').first()).toContainText('Original interrupted question');
  expect(commands.map((command) => command.name)).toEqual(['stop_discussion_turn', 'retry_discussion_turn', 'withdraw_discussion_turn']);
  await page.getByLabel('Message Planner', { exact: true }).fill('Draft during reconnect');
  offline = true; await page.getByRole('button', { name: 'Refresh Discussion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry Discussion connection', exact: true })).toBeVisible();
  await page.route(`**/v1/owner/todos/${todoId}/task-previews/*`, (route) => { const proposal = messages.find((message) => message.task_preview); return route.fulfill({ json: { schema_version: 1, todo_id: todoId, proposal_message_id: proposal?.message_id, preview: proposal?.task_preview, source_message_id: laterId, source_watermark: 2, project_context_version: 1, state: 'project_required' } }); });
  messages.push({ message_id: randomUUID(), sequence: 3, author: 'assistant', content: 'Committed Planner reply', source_message_id: laterId, source_watermark: 2, project_context_version: 1, created_at: '2026-09-30T00:00:02.000Z', task_preview: { title: 'A proposed improvement', specification: 'A small independently reviewable change.' } });
  delete status.current_source; status.latest_sequence = 3; status.resolved_watermark = 2; status.working_requirement_state = 'Current understood requirement';
  offline = false; await page.getByRole('button', { name: 'Retry Discussion connection', exact: true }).click();
  await expect(page.locator('.discussion-content').filter({ hasText: 'Committed Planner reply' })).toHaveCount(1);
  await expect(page.locator('.discussion-messages > li').last()).toContainText('Later queued question');
  await expect(page.getByRole('complementary', { name: 'Proposed Task', exact: true })).toContainText('A proposed improvement');
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Draft during reconnect');
  await page.getByRole('button', { name: 'Refresh Discussion', exact: true }).click();
  await expect(page.locator('.discussion-content').filter({ hasText: 'Committed Planner reply' })).toHaveCount(1);
  await expect(page.getByLabel('Todo Project', { exact: true })).not.toBeVisible();
  await expect(page.locator('.discussion-attention')).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('discussion-populated-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel('Message Planner', { exact: true })).toHaveValue('Draft during reconnect');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('discussion-populated-mobile.png'), fullPage: true });
});
