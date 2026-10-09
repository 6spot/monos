import { expect, test } from '@playwright/test';

// A non-localhost HTTP origin remains a real non-secure context. HTTP localhost
// is considered trustworthy and would not detect secure-context API regressions.
test.use({
  baseURL: 'http://monos-http.test:18555',
});

test('ordinary HTTP supports Owner login, Project creation, Todo capture and logout', async ({ page, context }) => {
  // Test-only transport bridge avoids external DNS and harness proxy resolution.
  // Preserve the browser Host/Origin so the actual backend still enforces them.
  await context.route('http://monos-http.test:18555/**', async route => {
    const url = new URL(route.request().url());
    const host = url.host;
    url.hostname = '127.0.0.1';
    await route.fulfill({ response: await route.fetch({ url: url.href, headers: { ...await route.request().allHeaders(), host } }) });
  });
  await page.goto('/#projects');
  expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, subtle: typeof crypto.subtle, random: typeof crypto.getRandomValues })))
    .toEqual({ secure: false, uuid: 'undefined', subtle: 'undefined', random: 'function' });
  await page.getByLabel('Password', { exact: true }).fill('monos-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'monos');
  expect(cookie).toMatchObject({ secure: false, httpOnly: true, sameSite: 'Strict', path: '/' });
  expect((await context.cookies()).some(cookie => cookie.name === '__Host-monos')).toBe(false);

  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Ordinary HTTP project');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Ordinary HTTP project');

  await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await page.getByLabel('Capture an idea', { exact: true }).fill('HTTP capture without certificates');
  await page.getByRole('button', { name: 'Capture Todo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'HTTP capture without certificates', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture an idea', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('button', { name: /^HTTP capture without certificates/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to monos' })).toBeVisible();
});
