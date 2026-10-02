import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Actual built-SPA images and route metadata; no network/credential payloads.
export async function captureView(page: Page, info: TestInfo, name: string) {
  const previous = page.viewportSize();
  const metadata = await page.evaluate(() => ({
    route: location.hash,
    assets: [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src],link[rel="stylesheet"]')].map((element) => element instanceof HTMLScriptElement ? new URL(element.src).pathname : new URL(element.href).pathname),
  }));
  for (const size of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    await page.setViewportSize(size); await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${size.label} page overflow`).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}-${size.label}.png`) });
    await page.screenshot({ path: info.outputPath(`${name}-${size.label}-full.png`), fullPage: true });
  }
  const metadataPath = info.outputPath(`${name}-route.json`);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  await info.attach(`${name}-route`, { path: metadataPath, contentType: 'application/json' });
  if (previous) await page.setViewportSize(previous);
}
