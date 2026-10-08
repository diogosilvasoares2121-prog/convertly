import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Loads the built extension (dist/) into Chromium with:
 *  - the browser forced OFFLINE,
 *  - every non-extension request aborted and recorded (network audit),
 *  - console errors and page errors recorded.
 */
export interface Audit {
  external: string[];
  consoleErrors: string[];
}

/** Extension folder under test: dist/ by default, or e.g. an unzipped release package. */
export const DIST = resolve(process.env.CONVERTLY_DIST ?? 'dist');
export const FIXTURES = resolve('test-fixtures');

/**
 * Browser used for E2E. Default: the installed Google Chrome (new headless) with a
 * throw-away profile; the unpacked extension is loaded through the CDP
 * `Extensions.loadUnpacked` command (branded Chrome ignores --load-extension).
 * Set CONVERTLY_E2E_CHANNEL=chromium to use Playwright's Chromium instead.
 */
const CHANNEL = process.env.CONVERTLY_E2E_CHANNEL ?? 'chrome';

export const test = base.extend<{ context: BrowserContext; extensionId: string; audit: Audit; app: Page }>({
  audit: async ({}, use) => {
    await use({ external: [], consoleErrors: [] });
  },
  context: async ({ audit }, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'convertly-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: CHANNEL,
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1360, height: 900 },
      ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
      args:
        CHANNEL === 'chromium'
          ? [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
          : ['--enable-unsafe-extension-debugging'],
    });
    await context.setOffline(true);
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (/^(chrome-extension|blob|data|chrome|about):/.test(url)) return route.continue();
      audit.external.push(url);
      return route.abort();
    });
    context.on('request', (req) => {
      const url = req.url();
      if (!/^(chrome-extension|blob|data|chrome|about):/.test(url)) audit.external.push(url);
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    if (CHANNEL === 'chromium') {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent('serviceworker');
      await use(new URL(worker.url()).host);
      return;
    }
    const browser = context.browser();
    if (!browser) throw new Error('No browser handle');
    const cdp = await browser.newBrowserCDPSession();
    const { id } = (await cdp.send('Extensions.loadUnpacked' as never, { path: DIST } as never)) as unknown as { id: string };
    await use(id);
  },
  app: async ({ context, extensionId, audit }, use) => {
    // The install flow opens the welcome tab; close it and use a fresh, onboarded page.
    for (const p of context.pages()) if (p.url().includes(extensionId)) await p.close();
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') audit.consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => audit.consoleErrors.push(`pageerror: ${err.message}`));
    await page.goto(`chrome-extension://${extensionId}/app/index.html#/`);
    await page.evaluate(() => chrome.storage.local.set({ settings: { onboardingDone: true, confirmLargeFiles: false } }));
    await page.goto(`chrome-extension://${extensionId}/app/index.html#/`);
    await page.reload();
    await expect(page.getByTestId('home-dropzone')).toBeVisible();
    await use(page);
  },
});

export { expect };

export function fixture(name: string): string {
  return join(FIXTURES, name);
}

export function fixtureBytes(name: string): Buffer {
  return readFileSync(fixture(name));
}

/** Opens a tool, feeds files to its dropzone input and returns the page. */
export async function openTool(page: Page, extensionId: string, toolId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/app/index.html#/tool/${toolId}`);
  await expect(page.locator('.tool-header h1')).toBeVisible();
  // Wait until the lazily loaded tool UI is mounted.
  await page.locator('main [data-testid=dropzone], main [data-testid=data-input], main .tool-layout, main [data-testid=job-group]').first().waitFor();
}

export async function addFiles(page: Page, names: string[]): Promise<void> {
  await page.locator('[data-testid="dropzone-input"]').setInputFiles(names.map(fixture));
}

/** Waits for the job group to finish and returns its final status. */
export async function waitForResult(page: Page, timeout = 180_000): Promise<string> {
  const group = page.locator('[data-testid="job-group"]');
  await expect(group).toHaveAttribute('data-status', /completed|failed|cancelled|no-output/, { timeout });
  const status = (await group.getAttribute('data-status')) ?? '';
  if (status === 'failed') {
    await group.evaluate((el) => el.querySelector('details')?.setAttribute('open', ''));
    console.log('JOB FAILED:', (await group.innerText()).replace(/\s+/g, ' '));
  }
  return status;
}

/** Clicks a download button and returns the downloaded bytes. */
export async function captureDownload(page: Page, testId = 'download'): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFileSync(path);
}
