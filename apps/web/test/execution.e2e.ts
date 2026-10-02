import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { TaskOverview, TaskConversationCommand, TaskSpecificationCommand, RequirementProposalDetail, TaskReplanCommand, TaskReplanResult, TaskReplanStatus, ReplanProposalDetail, TaskResultPage } from '../../../packages/protocol/generated/types.ts';

test.setTimeout(90000);
interface Fixture { task: string; project: string; spec: string; plan: string; node: string; proposal_id?: string; request_id?: string; requirement_proposal_id?: string; attempt_id?: string; git_commit?: string; git_tree?: string; total_tasks?: number }
async function post<T>(page: Page, path: string, body: unknown = {}): Promise<T> {
  const response = await page.evaluate(async ({ path, body }) => { const result = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: result.status, body: await result.json() }; }, { path, body });
  expect(response.status, JSON.stringify(response.body)).toBe(200); return response.body as T;
}
async function get<T>(page: Page, path: string): Promise<T> { return page.evaluate(async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Read failed: ${response.status}`); return response.json(); }, path); }
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  await post(page, '/__test__/execution-reset');
}
async function scenario(page: Page, kind: string, title = `Browser ${kind}`): Promise<Fixture> { return post(page, '/__test__/execution-scenario', { kind, title }); }
async function openTask(page: Page, f: Fixture, section = 'conversation') {
  await page.goto(`/#task?task_id=${f.task}&section=${section}`);
  await expect(page.getByRole('article', { name: 'Task detail', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Task detail', exact: true })).not.toContainText('Project unavailable');
}
async function screenshots(page: Page, info: TestInfo, name: string) {
  for (const size of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    await page.setViewportSize(size); await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${size.label} overflow`).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}-${size.label}.png`) });
    await page.screenshot({ path: info.outputPath(`${name}-${size.label}-full.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('Board canonical columns, normal queueing, local Review and responsive navigation', async ({ page }, info) => {
  await signIn(page);
  const ready = await scenario(page, 'ready', 'A ready independent task');
  await scenario(page, 'queued', 'Queued without an attention failure');
  const review = await scenario(page, 'review', 'A verified local result');
  await page.goto('/#board');
  await expect(page.getByRole('heading', { name: 'Execution board', exact: true })).toBeVisible();
  for (const label of ['Ready to start', 'Running', 'Review']) await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  await expect(page.getByText('A ready independent task', { exact: true })).toBeVisible();
  await expect(page.getByText('Queued without an attention failure', { exact: true })).toBeVisible();
  await expect(page.getByText('Project unavailable', { exact: true })).toHaveCount(0);
  await screenshots(page, info, 'board-populated-queued');
  await page.getByLabel('Project', { exact: true }).selectOption(ready.project);
  await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByLabel('Attention', { exact: true }).selectOption('needed');
  await expect(page.locator('.board-card')).toHaveCount(0);
  await page.getByLabel('Attention', { exact: true }).selectOption('all');
  await page.getByLabel('Project', { exact: true }).selectOption('');
  await openTask(page, review, 'overview');
  await expect(page.getByRole('button', { name: /Accept|Merge|Prepare PR/ })).toHaveCount(0);
  const results = await get<TaskResultPage>(page, `/v1/owner/tasks/${review.task}/results`);
  expect(results.items[0]).toMatchObject({ current: true, repository_free: true, git: null });
  await expect(page.getByText('Current result', { exact: true })).toBeVisible();
  await screenshots(page, info, 'task-local-review');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Execution Board', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await post(page, '/__test__/execution-reset');
  await page.goto(`/#board?project_id=${ready.project}`);
  await expect(page.getByText('No tasks here.', { exact: true })).toHaveCount(3);
  await screenshots(page, info, 'board-empty');
  await page.getByRole('button', { name: 'Show history', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cancelled', exact: true }).getByText('A ready independent task', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible();
});

test('Task drafts survive scope navigation and reload; a lost persisted message recovers the same receipt', async ({ page }, info) => {
  await signIn(page); const a = await scenario(page, 'ready', 'Draft scope A'); const b = await scenario(page, 'ready', 'Draft scope B');
  await openTask(page, a); await page.getByLabel('Message to Planner', { exact: true }).fill('Draft belonging to A');
  await openTask(page, b); await page.getByLabel('Message to Planner', { exact: true }).fill('Draft belonging to B');
  await openTask(page, a); await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('Draft belonging to A');
  const writes: TaskConversationCommand[] = [];
  await page.route('**/v1/owner/tasks/conversation/commands', async (route) => { writes.push(route.request().postDataJSON()); await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText(/The result is not confirmed/)).toBeVisible();
  await page.getByLabel('Message to Planner', { exact: true }).fill('A newer unfinished draft');
  await screenshots(page, info, 'task-uncertain');
  await page.reload(); await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.unroute('**/v1/owner/tasks/conversation/commands');
  await page.getByRole('button', { name: 'Check request result', exact: true }).click();
  await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('A newer unfinished draft');
  expect(writes).toHaveLength(1);
  await expect(page.getByText('Draft belonging to A', { exact: true })).toHaveCount(1);
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${a.task}`)).state).toBe('PLANNING');
  await openTask(page, b); await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('Draft belonging to B');
});

test('unknown receipt replays original payload after reload; malformed receipt retains uncertainty', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'ready'); await openTask(page, f);
  const writes: TaskConversationCommand[] = [];
  await page.route('**/v1/owner/tasks/conversation/commands', async (route) => { writes.push(route.request().postDataJSON()); if (writes.length === 1) await route.abort('failed'); else await route.continue(); });
  await page.getByLabel('Message to Planner', { exact: true }).fill('Original exact command after network loss');
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByText(/The result is not confirmed/)).toBeVisible();
  await page.reload();
  const receipt = `**/v1/owner/tasks/${f.task}/conversation/commands/*`;
  await page.route(receipt, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ malformed: true }) }));
  await page.getByRole('button', { name: 'Check request result', exact: true }).click(); await expect(page.getByText(/The result is not confirmed/)).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.unroute(receipt); await page.getByRole('button', { name: 'Check request result', exact: true }).click();
  await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('');
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  await expect(page.getByText('Original exact command after network loss', { exact: true })).toHaveCount(1);
});

test('initial queue Stop and explicit issue answer preserve correct lifecycle', async ({ page }, info) => {
  await signIn(page); const queued = await scenario(page, 'queued'); await openTask(page, queued);
  await page.getByRole('button', { name: 'Stop planning', exact: true }).click();
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${queued.task}`)).state).toBe('PLANNING');
  const issue = await scenario(page, 'planning_issue'); await openTask(page, issue);
  await expect(page.getByText('Which output should be authoritative? Please describe the expected behavior.', { exact: true })).toBeVisible();
  await screenshots(page, info, 'task-planning-issue-disabled');
  await page.getByLabel('Planning answer', { exact: true }).fill('Use the exact local result as the authoritative output.');
  await page.getByRole('button', { name: 'Retry planning', exact: true }).click();
  await expect.poll(async () => (await get<{ status: string }>(page, `/v1/owner/tasks/${issue.task}/planning`)).status).toBe('pending');
});

test('Node blocker answer uses exact Retry and diagnostics remain separate from formal Timeline', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'blocked'); await openTask(page, f, 'execution');
  await expect(page.getByText('Semantic · Choose the intended fallback behavior before implementation continues.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raw execution log', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Execution environment and workspace', exact: true })).toContainText('No workspace was opened');
  await screenshots(page, info, 'task-execution-blocked');
  await page.getByLabel('Work answer', { exact: true }).fill('Keep the same work and use the documented fallback.');
  await page.getByRole('button', { name: 'Retry work', exact: true }).click();
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('RUNNING');
  await page.getByRole('link', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.task-timeline > ol > li').first()).toBeVisible();
  await expect(page.locator('.task-execution-flow > li')).toHaveCount(1);
  await screenshots(page, info, 'task-timeline');
});

test('exact Specification confirmation survives response loss and a second client sees the same applied revision', async ({ page, context }, info) => {
  await signIn(page); const f = await scenario(page, 'specification'); await openTask(page, f);
  const commands: TaskSpecificationCommand[] = [];
  await page.route('**/v1/owner/tasks/specification/commands', async (route) => { const command = route.request().postDataJSON() as TaskSpecificationCommand; commands.push(command); if (command.name === 'confirm_specification') { await route.fetch(); await route.abort('failed'); } else await route.continue(); });
  await expect(page.getByRole('button', { name: 'Confirm requirements', exact: true })).toBeEnabled();
  await screenshots(page, info, 'task-exact-requirements');
  await page.getByRole('button', { name: 'Confirm requirements', exact: true }).click(); await expect(page.getByText(/The result is not confirmed/)).toBeVisible();
  await page.reload(); await page.unroute('**/v1/owner/tasks/specification/commands');
  await page.getByRole('button', { name: 'Check request result', exact: true }).click();
  const other = await context.newPage(); await openTask(other, f);
  const detail = await get<RequirementProposalDetail>(page, `/v1/owner/tasks/${f.task}/specification/proposals/${f.proposal_id}`);
  expect(detail.confirmation_id).toBeTruthy(); expect(commands.filter((command) => command.name === 'confirm_specification')).toHaveLength(1);
  await page.getByRole('button', { name: 'Apply confirmed requirements', exact: true }).click();
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).specification_id).not.toBe(f.spec);
  await other.reload(); const updated = await get<TaskOverview>(other, `/v1/owner/tasks/${f.task}`);
  expect(updated.state).toBe('PLANNING'); expect(updated.specification).toContain('Revised exact requirement');
  await other.close();
});

test('joint Replan publishes exact dual approval; dismissal and requirement withdrawal remain independent', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'joint'); await openTask(page, f);
  await expect(page.getByRole('button', { name: 'Confirm plan', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm requirements', exact: true })).toBeEnabled();
  await screenshots(page, info, 'task-joint-replan');
  await page.getByRole('button', { name: 'Confirm requirements', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await page.getByRole('button', { name: 'Publish confirmed plan', exact: true }).click();
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).plan_id).not.toBe(f.plan);
  const changed = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`); expect(changed.specification_id).not.toBe(f.spec);
  const other = await scenario(page, 'joint', 'Independent linked exits'); await openTask(page, other);
  await page.getByRole('button', { name: 'Dismiss Replan', exact: true }).click();
  await expect.poll(async () => (await get<TaskReplanStatus>(page, `/v1/owner/tasks/${other.task}/replan`)).current_request).toBeNull();
  const requirement = await get<RequirementProposalDetail>(page, `/v1/owner/tasks/${other.task}/specification/proposals/${other.requirement_proposal_id}`);
  expect(requirement.proposal.status).toBe('pending');
  await page.getByRole('button', { name: 'Withdraw requirements', exact: true }).click();
  await expect.poll(async () => (await get<RequirementProposalDetail>(page, `/v1/owner/tasks/${other.task}/specification/proposals/${other.requirement_proposal_id}`)).proposal.status).toBe('withdrawn');
});

test('joint approvals and publication recover their original receipts across response loss and reload', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'joint'); await openTask(page, f);
  const writes: (TaskSpecificationCommand | TaskReplanCommand)[] = [];
  const results: TaskReplanResult[] = [];
  const receiptReads: string[] = [];
  page.on('request', (request) => { if (request.method() === 'GET' && request.url().includes('/commands/')) receiptReads.push(request.url()); });
  for (const family of ['specification', 'replan']) {
    await page.route(`**/v1/owner/tasks/${family}/commands`, async (route) => {
      writes.push(route.request().postDataJSON());
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      results.push(await response.json()); await route.abort('failed');
    });
  }
  for (const [index, label] of ['Confirm requirements', 'Confirm plan', 'Publish confirmed plan'].entries()) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByText(/The result is not confirmed/)).toBeVisible();
    expect(writes).toHaveLength(index + 1);
    const command = writes[index];
    await page.reload();
    await page.getByRole('button', { name: 'Check request result', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(index + 1);
    expect(receiptReads.some((url) => url.endsWith(`/commands/${command.request_id}`))).toBe(true);
    const overview = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`);
    if (index < 2) expect([overview.specification_id, overview.plan_id]).toEqual([f.spec, f.plan]);
    else expect([overview.specification_id, overview.plan_id]).toEqual([results[2].specification_id, results[2].plan_id]);
  }
  expect(writes.map((command) => command.name)).toEqual(['confirm_specification', 'confirm_replan', 'publish_replan']);
  expect(new Set(writes.map((command) => command.request_id)).size).toBe(3);
  expect(writes[0].payload.proposal_id).toBe(f.requirement_proposal_id);
  expect(writes[1].payload.proposal_id).toBe(f.proposal_id);
  expect(writes[2].payload).toMatchObject({ proposal_id: f.proposal_id, confirmation_id: results[1].confirmation_id, requirement_confirmation_id: results[0].confirmation_id });
  const proposal = await get<ReplanProposalDetail>(page, `/v1/owner/tasks/${f.task}/replan/proposals/${f.proposal_id}`);
  expect(proposal.confirmation_id).toBe(results[1].confirmation_id);
  const status = await get<TaskReplanStatus>(page, `/v1/owner/tasks/${f.task}/replan`);
  expect(status.current_request).toBeNull();
  expect(status.requests.filter((request) => request.status === 'published').map((request) => request.id)).toEqual([results[2].replan_request_id]);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Task detail', exact: true })).toBeVisible();
  expect(writes).toHaveLength(3);
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).plan_id).toBe(results[2].plan_id);
});

test('late response after logout cannot resurrect private Task recovery data', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'ready'); await openTask(page, f);
  let release: () => void = () => {}; const barrier = new Promise<void>((resolve) => { release = resolve; });
  let persisted: () => void = () => {}; const saved = new Promise<void>((resolve) => { persisted = resolve; });
  await page.route('**/v1/owner/tasks/conversation/commands', async (route) => { const response = await route.fetch(); persisted(); await barrier; await route.fulfill({ response }); });
  await page.getByLabel('Message to Planner', { exact: true }).fill('Old session request'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await saved; await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  release();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('monos:task-ui:')))).toEqual([]);
});

test('two clients racing Start retain one canonical planning intent and show the stale decision', async ({ page, context }) => {
  await signIn(page); const f = await scenario(page, 'ready'); await openTask(page, f);
  const other = await context.newPage(); await openTask(other, f);
  let release: () => void = () => {}; const barrier = new Promise<void>((resolve) => { release = resolve; });
  const responses: number[] = []; const requests: unknown[] = [];
  for (const target of [page, other]) await target.route('**/v1/owner/commands', async (route) => {
    requests.push(route.request().postDataJSON()); if (requests.length === 2) release();
    await barrier; const response = await route.fetch(); responses.push(response.status()); await route.fulfill({ response });
  });
  await Promise.all([page.getByRole('button', { name: 'Start task', exact: true }).click(), other.getByRole('button', { name: 'Start task', exact: true }).click()]);
  await expect.poll(() => responses.length).toBe(2); expect(responses.sort()).toEqual([200, 409]);
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('RUNNING');
  await other.reload();
  const status = await get<{ planning_source?: { intent_id: string } }>(other, `/v1/owner/tasks/${f.task}/planning`);
  expect(status.planning_source?.intent_id).toBeTruthy(); await other.close();
});

test('a cookie replacement after preflight cannot submit an old-session command', async ({ page, context }) => {
  await signIn(page); const f = await scenario(page, 'ready'); await openTask(page, f);
  const other = await context.newPage(); await other.goto('/');
  let release: () => void = () => {}; const barrier = new Promise<void>((resolve) => { release = resolve; });
  let checked: () => void = () => {}; const preflight = new Promise<void>((resolve) => { checked = resolve; });
  await page.route('**/v1/owner/session', async (route) => { const response = await route.fetch(); checked(); await barrier; await route.fulfill({ response }); });
  const responses: number[] = [];
  await page.route('**/v1/owner/tasks/conversation/commands', async (route) => { const response = await route.fetch(); responses.push(response.status()); await route.fulfill({ response }); });
  await page.getByLabel('Message to Planner', { exact: true }).fill('Must never enter the new session');
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); await preflight;
  await post(other, '/v1/owner/login', { schema_version: 1, password: 'monos-browser-test-password' });
  release(); await expect.poll(() => responses.length).toBe(1); expect(responses).toEqual([401]);
  const history = await get<{ messages: { content: string }[] }>(other, `/v1/owner/tasks/${f.task}/conversation/messages`);
  expect(JSON.stringify(history)).not.toContain('Must never enter the new session');
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('monos:task-ui:')))).toEqual([]);
  await other.close();
});

test('long content and read errors retain a usable Task workspace', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'ready', 'A long readable task title — '.repeat(7)); await openTask(page, f);
  await page.getByLabel('Message to Planner', { exact: true }).fill('详细说明与长文本 '.repeat(100));
  await screenshots(page, info, 'task-long-content');
  await page.route(`**/v1/owner/tasks/${f.task}`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ schema_version: 1, status: 'error', error: { code: 'control_unavailable', message: 'Task read temporarily unavailable' } }) }));
  await page.reload(); await expect(page.getByText('Task read temporarily unavailable', { exact: true })).toBeVisible();
  await screenshots(page, info, 'task-read-error');
  await page.unroute(`**/v1/owner/tasks/${f.task}`); await page.reload();
  await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('详细说明与长文本 '.repeat(100));
});

test('queued and running work offer exact Stop and Continue; Cancel keeps terminal questions available', async ({ page }, info) => {
  await signIn(page);
  for (const kind of ['node_queued', 'running']) {
    const f = await scenario(page, kind); await openTask(page, f, 'execution');
    await page.getByRole('button', { name: 'Stop work', exact: true }).click();
    await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('BLOCKED');
    await post(page, '/__test__/execution-settle', { task_id: f.task });
    await page.getByRole('button', { name: 'Continue work', exact: true }).click();
    await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('RUNNING');
    await expect(page.getByRole('button', { name: 'Continue work', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop work', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel task', exact: true }).click();
    await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('CANCELLED');
    await post(page, '/__test__/execution-settle', { task_id: f.task });
    await page.getByRole('link', { name: 'Conversation', exact: true }).click();
    await expect(page.getByText(/Questions remain available/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Start task|Continue work|Retry work|Cancel task)$/ })).toHaveCount(0);
    await page.getByLabel('Message to Planner', { exact: true }).fill('What happened before cancellation?');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('');
    expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('CANCELLED');
    if (kind === 'running') await screenshots(page, info, 'task-terminal-conversation');
  }
});

test('completion recovery retains the exact local result while cleanup is retried', async ({ page }, info) => {
  await signIn(page); const f = await scenario(page, 'completion_recovery'); await openTask(page, f, 'execution');
  await expect(page.getByRole('button', { name: 'Retry completion cleanup', exact: true })).toBeEnabled();
  await screenshots(page, info, 'task-completion-recovery');
  await page.getByRole('button', { name: 'Retry completion cleanup', exact: true }).click();
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('RUNNING');
  await post(page, '/__test__/execution-settle', { task_id: f.task });
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('REVIEW');
  expect((await get<TaskResultPage>(page, `/v1/owner/tasks/${f.task}/results`)).items).toHaveLength(1);
});

test('input and guidance withdrawals preserve message history and do not start execution', async ({ page }) => {
  await signIn(page);
  for (const kind of ['guidance', 'input_issue']) {
    const f = await scenario(page, kind); await openTask(page, f);
    const operations = page.getByRole('region', { name: 'Inputs and guidance', exact: true });
    await expect(operations.getByRole('button', { name: 'Withdraw input', exact: true })).toHaveCount(1);
    await operations.getByRole('button', { name: 'Withdraw input', exact: true }).click();
    await expect(operations.getByRole('button', { name: 'Withdraw input', exact: true })).toHaveCount(0);
    await expect(page.getByText('Keep the requested output readable and verify the exact behavior.', { exact: true })).toBeVisible();
    expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('PLANNING');
  }
});

test('Replan issue answer retries its exact request and preserves independent dismissal', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'replan_issue'); await openTask(page, f);
  await expect(page.getByRole('button', { name: 'Retry Replan', exact: true })).toBeDisabled();
  await page.getByLabel('Replan answer', { exact: true }).fill('Keep the original safeguards and replace only the work definition.');
  await page.getByRole('button', { name: 'Retry Replan', exact: true }).click();
  await expect.poll(async () => (await get<TaskReplanStatus>(page, `/v1/owner/tasks/${f.task}/replan`)).current_request?.issue_id).toBeNull();
  await page.getByRole('button', { name: 'Dismiss Replan', exact: true }).click();
  await expect.poll(async () => (await get<TaskReplanStatus>(page, `/v1/owner/tasks/${f.task}/replan`)).current_request).toBeNull();
});

test('direct Owner edit retains original basis on reload and waits for running work settlement', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'running'); await openTask(page, f);
  await page.getByRole('button', { name: 'Edit requirements', exact: true }).click();
  await page.getByLabel('New requirements', { exact: true }).fill('# Revised running requirement\n\nPreserve the original safeguards and verify keyboard recovery.');
  await page.getByLabel('Change summary', { exact: true }).fill('Clarify exact keyboard recovery');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await page.getByRole('button', { name: 'Edit requirements', exact: true }).click();
  await expect(page.getByLabel('New requirements', { exact: true })).toHaveValue('# Revised running requirement\n\nPreserve the original safeguards and verify keyboard recovery.');
  await page.reload();
  await expect(page.getByLabel('New requirements', { exact: true })).toHaveValue('# Revised running requirement\n\nPreserve the original safeguards and verify keyboard recovery.');
  await page.getByRole('button', { name: 'Apply requirement change', exact: true }).click();
  await expect(page.getByText(/^Requirement change · Settling/)).toBeVisible();
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).specification_id).toBe(f.spec);
  await page.getByRole('button', { name: 'Retry requirement cleanup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry requirement cleanup', exact: true })).toBeEnabled();
  await post(page, '/__test__/execution-settle', { task_id: f.task });
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).specification_id).not.toBe(f.spec);
});

test('a later input must be explicitly deferred before the exact requirements can apply', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'specification'); await openTask(page, f);
  await page.getByRole('button', { name: 'Confirm requirements', exact: true }).click();
  await page.getByLabel('Message to Planner', { exact: true }).fill('A later independent question remains outside this exact change.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('');
  await page.getByText('Explicitly defer later inputs', { exact: true }).click();
  await page.getByRole('button', { name: 'Defer this input for the proposal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply confirmed requirements', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply confirmed requirements', exact: true }).click();
  await expect.poll(async () => (await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).specification_id).not.toBe(f.spec);
  await expect(page.getByText('A later independent question remains outside this exact change.', { exact: true }).first()).toBeVisible();
});

test('local storage failure blocks sending and safe retry keeps the newer in-memory draft', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'ready'); await openTask(page, f);
  await page.getByLabel('Message to Planner', { exact: true }).fill('Saved draft');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreTaskStorage: () => void }).restoreTaskStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('monos:task-ui:')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); return original.call(this, key, value); };
  });
  await page.getByLabel('Message to Planner', { exact: true }).fill('Newer draft retained only in memory');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  expect(JSON.stringify(await get(page, `/v1/owner/tasks/${f.task}/conversation/messages`))).not.toContain('Newer draft retained only in memory');
  await page.evaluate(() => (window as unknown as { restoreTaskStorage: () => void }).restoreTaskStorage());
  await page.getByRole('button', { name: 'Retry local recovery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Message to Planner', { exact: true })).toHaveValue('Newer draft retained only in memory');
});

test('all-execution history includes Planner after a Plan exists and formal cursor reset reloads current facts', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'review'); await openTask(page, f, 'execution');
  await page.getByText('Previous executions and Planner activity', { exact: true }).click();
  await page.getByLabel('Execution history scope', { exact: true }).selectOption('planner');
  await expect(page.getByRole('button', { name: /^Planner · Succeeded/ })).toHaveCount(1);
  await page.getByRole('button', { name: /^Planner · Succeeded/ }).click();
  await expect(page.getByRole('region', { name: 'Execution environment and workspace', exact: true })).toHaveCount(2);
  const overview = await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`);
  let reset = true;
  // Transport-level retained-history loss; fresh overview/cursor still comes from the real server.
  await page.route(`**/v1/owner/tasks/${f.task}/events*`, async route => {
    if (reset) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema_version: 1, task_id: f.task, events: [], cursor: overview.event_cursor, has_more: false, reset_required: true }) });
    else await route.continue();
  });
  await page.getByRole('link', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue from current state', exact: true })).toBeVisible();
  reset = false;
  const refreshed = page.waitForResponse(response => response.url().endsWith(`/v1/owner/tasks/${f.task}`));
  await page.getByRole('button', { name: 'Continue from current state', exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Continue from current state', exact: true })).toHaveCount(0);
  expect((await get<TaskOverview>(page, `/v1/owner/tasks/${f.task}`)).state).toBe('REVIEW');
});

test('real bounded message and input pages expose remaining records without duplicating loaded history', async ({ page }) => {
  test.setTimeout(240000);
  await signIn(page); const f = await scenario(page, 'ready');
  await page.evaluate(async taskId => {
    for (let i = 0; i < 65; i++) {
      const response = await fetch('/v1/owner/tasks/conversation/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: 1, request_id: crypto.randomUUID(), task_id: taskId, name: 'submit_task_message', payload: { message_id: crypto.randomUUID(), content: `Bounded history message ${String(i).padStart(2, '0')}` } }) });
      if (!response.ok) throw new Error(`Message fixture failed: ${response.status}`);
    }
  }, f.task);
  await openTask(page, f);
  await expect(page.locator('.task-messages > li')).toHaveCount(64);
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await expect(page.locator('.task-messages > li')).toHaveCount(65);
  await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toHaveCount(0);
  const operations = page.getByRole('region', { name: 'Inputs and guidance', exact: true });
  await expect(operations.getByRole('button', { name: 'Withdraw input', exact: true })).toHaveCount(64);
  await operations.getByRole('button', { name: 'Load more input operations', exact: true }).click();
  await expect(operations.getByRole('button', { name: 'Withdraw input', exact: true })).toHaveCount(65);
  await post(page, '/__test__/execution-reset');
});

test('Board keyset pagination reaches all canonical and explicitly legacy fixture records', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'board_pages');
  await page.goto(`/#board?project_id=${f.project}`);
  const ready = page.getByRole('region', { name: 'Ready to start', exact: true });
  await expect(ready.locator('.board-card')).toHaveCount(32);
  await ready.getByRole('button', { name: 'Load more ready to start', exact: true }).click();
  await expect(ready.locator('.board-card')).toHaveCount(f.total_tasks!);
  await expect(ready.getByRole('button', { name: 'Load more ready to start', exact: true })).toHaveCount(0);
  expect(new Set(await ready.locator('.board-task-title').evaluateAll(links => links.map(link => link.getAttribute('href')))).size).toBe(f.total_tasks);
  await post(page, '/__test__/execution-reset');
});

test('recorded Runtime and live workspace metadata stay distinct from the exact finalized Git result', async ({ page }, info) => {
  await signIn(page);
  const running = await scenario(page, 'running_workspace'); await openTask(page, running, 'execution');
  const environment = page.getByRole('region', { name: 'Execution environment and workspace', exact: true });
  await expect(environment).toContainText('opencode/longcat-2.5-preview-free');
  await expect(environment).toContainText('github.com/example/execution-ui');
  await expect(environment).toContainText('main');
  await screenshots(page, info, 'task-running-workspace');
  await post(page, '/__test__/execution-reset');
  const result = await scenario(page, 'review_git'); await openTask(page, result, 'overview');
  const results = page.getByRole('region', { name: 'Local results', exact: true });
  await expect(results.getByText(result.git_commit!, { exact: true })).toBeVisible();
  await expect(results.getByText(result.git_tree!, { exact: true })).toBeVisible();
  await expect(results.getByRole('heading', { name: 'Current result', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Accept|Merge|Prepare PR/ })).toHaveCount(0);
  await screenshots(page, info, 'task-finalized-git-result');
});

test('ordered log pages retain their cursor with the rendered entries and never enter formal Timeline', async ({ page }) => {
  await signIn(page); const f = await scenario(page, 'log_pages'); await openTask(page, f, 'execution');
  const output = page.locator('pre.task-log');
  await expect(output).toContainText('Synthetic log entry 064');
  await expect(output).not.toContainText('Synthetic log entry 065');
  await page.getByRole('button', { name: 'Load more log output', exact: true }).click();
  await expect(output).toContainText('Synthetic log entry 070');
  const text = await output.innerText(); expect(text.match(/Synthetic log entry /g)).toHaveLength(70);
  await expect(page.getByRole('button', { name: 'Load more log output', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.task-timeline > ol > li').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Formal timeline', exact: true })).not.toContainText('Synthetic log entry');
  await expect(output).toHaveCount(0);
});
