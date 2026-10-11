import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { NodeReworkStatus, OwnerCommand, OwnerCommandResult } from '../../../packages/protocol/generated/types.ts';

// UI authority/recovery fixtures; database/physical Rework is exercised separately.
async function setup(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  const response = await page.evaluate(async () => {
    const value = await fetch('/__test__/execution-scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'running', title: 'Correct upstream behavior' }) });
    if (!value.ok) throw new Error('Fixture failed');
    return value.json();
  }) as { task: string; node: string };
  const status: NodeReworkStatus = { schema_version: 1, task_id: response.task, automatic_requests_used: 3, limit: 3, current: {
    rework_request_id: 'saved-rework', status: 'limit_blocked', version: 1, target_node_id: 'upstream', affected_node_ids: ['upstream', response.node], automatic_requests_used: 3, limit: 3,
    requester_node_id: response.node, requester_node_activation: 1,
    reason: 'The upstream parser loses empty fields. Correct its contract and repeat downstream validation before delivery.',
    stop_operation_id: 'saved-stop', waiting_reason: null, can_apply: true, can_continue: true,
  } };
  await page.route(`**/v1/owner/tasks/${response.task}/rework`, route => route.fulfill({ json: status }));
  await page.goto(`/#task?task_id=${response.task}&section=execution`);
  await expect(page.getByRole('region', { name: 'Upstream rework', exact: true })).toBeVisible();
  return { ...response, status };
}

async function capture(page: Page, info: TestInfo, name: string) {
  for (const size of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    await page.setViewportSize(size);
    await page.getByRole('region', { name: 'Upstream rework', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}-${size.label}.png`) });
  }
}

test('preserved Rework blocks generic controls and recovers a lost exact Owner decision after reload', async ({ page }, info) => {
  const f = await setup(page), writes: OwnerCommand[] = [];
  const panel = page.getByRole('region', { name: 'Upstream rework', exact: true });
  await expect(page.getByRole('button', { name: 'Stop work', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry work', exact: true })).toHaveCount(0);
  await page.getByLabel('Rework direction').fill('Keep upstream results; adapt this consumer.');
  await capture(page, info, 'rework-limit');
  let saved: OwnerCommandResult | undefined;
  await page.route('**/v1/owner/commands', async route => {
    const command = route.request().postDataJSON() as OwnerCommand; writes.push(command);
    saved = { schema_version: 1, request_id: command.request_id, task_id: f.task, control_version: command.expected_control_version + 1, status: 'committed',
      rework_outcome: { rework_request_id: 'saved-rework', status: 'continued', version: 2, target_node_id: 'upstream', affected_node_ids: ['upstream', f.node], automatic_requests_used: 3, limit: 3 } };
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Continue without rework', exact: true }).click();
  await expect(page.getByText(/The result is not confirmed/)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ scope_id: f.task, name: 'continue_without_rework', payload: { rework_request_id: 'saved-rework', expected_version: 1, answer: 'Keep upstream results; adapt this consumer.' } });
  await expect(panel.getByRole('button', { name: 'Apply rework', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Rework direction')).toHaveValue('Keep upstream results; adapt this consumer.');
  await page.route(`**/v1/owner/scopes/${f.task}/commands/*`, async route => {
    f.status.current = null;
    await route.fulfill({ json: saved });
  });
  await page.getByRole('button', { name: 'Check request result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check request result', exact: true })).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

test('settlement and changed upstream evidence expose only the current Rework choices', async ({ page }, info) => {
  const f = await setup(page), writes: OwnerCommand[] = [];
  f.status.current = { ...f.status.current!, status: 'settling', automatic_requests_used: 1, can_apply: false, can_continue: false, waiting_reason: 'waiting_for_physical_settlement' };
  f.status.automatic_requests_used = 1;
  await expect(page.getByRole('heading', { name: 'Preparing upstream rework', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply rework', exact: true })).toHaveCount(0);
  await capture(page, info, 'rework-settling');
  f.status.current = { ...f.status.current, status: 'limit_blocked', automatic_requests_used: 3, can_apply: false, can_continue: true, waiting_reason: 'Rework target completion evidence changed' };
  f.status.automatic_requests_used = 3;
  await expect(page.getByRole('button', { name: 'Apply rework', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Continue without rework', exact: true })).toBeEnabled();
  await expect(page.getByText('The saved upstream result has changed. You can still continue the requesting work.')).toBeVisible();
  f.status.current = { ...f.status.current, can_apply: true, waiting_reason: null };
  await expect(page.getByRole('button', { name: 'Apply rework', exact: true })).toBeEnabled();
  await page.route('**/v1/owner/commands', async route => {
    const command = route.request().postDataJSON() as OwnerCommand; writes.push(command);
    f.status.current = null; f.status.automatic_requests_used = 0;
    await route.fulfill({ json: { schema_version: 1, request_id: command.request_id, task_id: f.task, control_version: command.expected_control_version + 1, status: 'committed',
      rework_outcome: { rework_request_id: 'saved-rework', status: 'applied', version: 3, target_node_id: 'upstream', affected_node_ids: ['upstream', f.node], automatic_requests_used: 0, limit: 3 } } });
  });
  await page.getByRole('button', { name: 'Apply rework', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Upstream rework', exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ name: 'apply_rework', payload: { rework_request_id: 'saved-rework', expected_version: 1 } });
});
