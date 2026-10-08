#!/usr/bin/env node
/**
 * Captures 1280×800 Chrome Web Store screenshots of the built extension (dist/)
 * into store/screenshots/. Uses the installed Chrome with a temporary profile,
 * offline. Run after `npm run build`. The store accepts up to 5: upload 1–5.
 */
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const out = join(root, 'store/screenshots');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.png')) rmSync(join(out, f));
const fixture = (n) => resolve(root, 'test-fixtures', n);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'convertly-shots-')), {
  channel: process.env.CONVERTLY_E2E_CHANNEL ?? 'chrome',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--lang=en'],
});
await context.setOffline(true);
const cdp = await context.browser().newBrowserCDPSession();
const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve(root, 'dist') });
const page = await context.newPage();
const base = `chrome-extension://${id}/app/index.html`;
await page.goto(`${base}#/`);
await page.evaluate(() => chrome.storage.local.set({ settings: { onboardingDone: true, confirmLargeFiles: false, language: 'en', theme: 'light' }, favoriteTools: ['heic-to-jpg', 'pdf-merge'] }));
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('screenshot:', name);
};
const run = async (tool, files) => {
  await page.goto(`${base}#/tool/${tool}`);
  await page.reload();
  await page.locator('[data-testid="dropzone-input"]').setInputFiles(files.map(fixture));
};
const done = (timeout = 60_000) => page.locator('[data-testid="job-group"][data-status="completed"]').waitFor({ timeout });

await page.goto(`${base}#/`);
await page.reload();
await shot('1-home');

await page.goto(`${base}#/tools`);
await shot('2-all-tools');

await run('image-convert', ['sample.heic', 'sample.png', 'sample.jpg', 'sample.webp', 'sample.bmp']);
await page.getByTestId('run').click();
await done();
await shot('3-batch-result');

await run('pdf-watermark', ['sample.pdf']);
await page.locator('.page-preview__page img').waitFor();
await shot('4-pdf-watermark');

await run('archive-extract', ['sample.7z']);
await page.getByTestId('zip-entries').waitFor();
await shot('5-extract-archive');

await run('image-watermark', ['sample.jpg']);
await page.getByTestId('live-preview').waitFor();
await page.getByRole('switch', { name: 'Repeat across the image' }).click();
await shot('6-image-watermark');

await run('pdf-organize', ['sample10.pdf']);
await page.locator('.page-card img').nth(5).waitFor();
await page.locator('.page-card').nth(2).click();
await page.locator('.page-card').nth(3).click();
await shot('7-pdf-organize');

await run('mp4-to-mp3', ['sample.mp4']);
await page.getByTestId('run').click();
await done(120_000);
await shot('8-video-to-mp3');

await page.evaluate(() => chrome.storage.local.set({ settings: { onboardingDone: true, language: 'en', theme: 'dark' } }));
await page.goto(`${base}#/`);
await page.reload();
await page.locator('[data-testid="home-dropzone-input"]').setInputFiles(fixture('sample.heic'));
await page.getByTestId('detect-card').waitFor();
await shot('9-detection-dark');

await context.close();
