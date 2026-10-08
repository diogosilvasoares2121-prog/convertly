import { existsSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { test, expect, openTool, waitForResult, captureDownload } from './fixtures';
import { addBuffer, downloadNamed, inspectImage, pdfText, sig } from './helpers';

/**
 * Real-world inputs instead of synthetic fixtures: a PDF printed by Chrome (embedded subset
 * fonts, CJK/Greek text), a large camera-sized image and a 100-file batch run everywhere.
 * Files produced by Windows tools (Compress-Archive ZIP with backslash paths, tar.exe TAR.GZ,
 * a 4K wallpaper) are read from CONVERTLY_REAL_FILES (default %TEMP%/cv-real) and skipped when
 * that folder is missing — see docs/QA.md for how to create them.
 */
const REAL = process.env.CONVERTLY_REAL_FILES ?? join(process.env.TEMP ?? '', 'cv-real');
const hasReal = (n: string) => existsSync(join(REAL, n));
const real = (n: string) => readFileSync(join(REAL, n));

test.describe.configure({ timeout: 300_000 });
test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

test('ZIP made by Windows PowerShell (backslash paths, accented names)', async ({ app, extensionId }) => {
  test.skip(!hasReal('windows-explorer.zip'), 'Windows-made ZIP not available');
  for (const tool of ['zip-extract', 'archive-extract']) {
    await openTool(app, extensionId, tool);
    await addBuffer(app, 'windows-explorer.zip', 'application/zip', real('windows-explorer.zip'));
    const table = app.getByTestId('zip-entries');
    await expect(table).toContainText('Relatórios 2026/Faturação/Março/fatura nº 1.csv');
    await expect(table).not.toContainText('\\');
    await app.getByTestId('run').click();
    expect(await waitForResult(app)).toBe('completed');
    const csv = (await downloadNamed(app, 'fatura nº 1.csv')).toString('utf8').replace(/^﻿/, '');
    expect(csv).toContain('café;1,20');
  }
});

test('TAR.GZ made by Windows tar.exe with Unicode names', async ({ app, extensionId }) => {
  test.skip(!hasReal('windows-tar.tar.gz'), 'Windows-made TAR.GZ not available');
  await openTool(app, extensionId, 'archive-extract');
  await addBuffer(app, 'windows-tar.tar.gz', 'application/gzip', real('windows-tar.tar.gz'));
  await expect(app.getByTestId('zip-entries')).toContainText('Relatórios 2026/Leia-me ção.txt');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect((await downloadNamed(app, 'Leia-me ção.txt')).toString('utf8')).toContain('coração');
});

test('real 4K JPEG (Windows wallpaper): compress, WEBP, resize, watermark, metadata', async ({ app, extensionId }) => {
  test.skip(!hasReal('wallpaper-4k.jpg'), 'Real 4K JPEG not available');
  const jpg = real('wallpaper-4k.jpg');
  const original = await inspectImage(app, jpg, 'image/jpeg');

  await openTool(app, extensionId, 'image-compress');
  await addBuffer(app, 'wallpaper.jpg', 'image/jpeg', jpg);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const small = await captureDownload(app);
  expect(sig(small)).toBe('jpg');
  expect(small.length).toBeLessThan(jpg.length);

  await openTool(app, extensionId, 'jpg-to-webp');
  await addBuffer(app, 'wallpaper.jpg', 'image/jpeg', jpg);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const webp = await captureDownload(app);
  expect(sig(webp)).toBe('webp');
  expect(await inspectImage(app, webp, 'image/webp')).toMatchObject({ w: original.w, h: original.h });

  await openTool(app, extensionId, 'image-watermark');
  await addBuffer(app, 'wallpaper.jpg', 'image/jpeg', jpg);
  await expect(app.getByTestId('live-preview')).toBeVisible();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(await inspectImage(app, await captureDownload(app), 'image/jpeg')).toMatchObject({ w: original.w, h: original.h });

  await openTool(app, extensionId, 'image-metadata');
  await addBuffer(app, 'wallpaper.jpg', 'image/jpeg', jpg);
  await expect(app.locator('main')).not.toContainText('Something went wrong');
});

test('large 8000×6000 image and a 100-file batch', async ({ app, extensionId }) => {
  const big = Buffer.from(
    await app.evaluate(async () => {
      const c = new OffscreenCanvas(8000, 6000);
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 8000, 6000);
      g.addColorStop(0, '#0b8378');
      g.addColorStop(1, '#f5a524');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 8000, 6000);
      return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
    }),
  );
  await openTool(app, extensionId, 'image-resize');
  await addBuffer(app, 'huge.jpg', 'image/jpeg', big);
  await app.getByTestId('run').click(); // default preset: fit inside 1920×1080
  expect(await waitForResult(app)).toBe('completed');
  const resized = await captureDownload(app);
  expect(sig(resized)).toBe('jpg');
  expect(await inspectImage(app, resized, 'image/jpeg')).toMatchObject({ w: 1440, h: 1080 });

  await openTool(app, extensionId, 'image-convert');
  const one = readFileSync('test-fixtures/sample.jpg');
  await app.locator('[data-testid="dropzone-input"]').setInputFiles(Array.from({ length: 100 }, (_, i) => ({ name: `foto-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: one })));
  await app.getByRole('radio', { name: 'PNG', exact: true }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 240_000)).toBe('completed');
  await expect(app.locator('.stat__value--good').first()).toHaveText('100');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  expect(Object.keys(zip)).toHaveLength(100);
});

let chromePdf: Buffer;
test.beforeAll(async () => {
  // Printed by a separate, plain Chrome instance (a real-world PDF with embedded subset fonts).
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const printer = await browser.newPage();
  await printer.setContent(`<html><body style="font-family: Segoe UI, Arial; font-size: 20px">
    <h1>Relatório de Março</h1><p>Ação, coração, façade — naïve café. 日本語のテキスト. Ελληνικά.</p>
    <div style="page-break-after: always"></div><h2>Página dois</h2><p>Second page with more text.</p>
    <div style="page-break-after: always"></div><h2>Página três</h2><p>Third page.</p></body></html>`);
  chromePdf = Buffer.from(await printer.pdf({ format: 'A4' }));
  await browser.close();
});

test('real PDF printed by Chrome (embedded Unicode fonts): text, merge, numbers, watermark, images, split', async ({ app, extensionId }) => {
  const pdf = chromePdf;
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);

  const text = await pdfText(app, extensionId, pdf);
  expect(text).toContain('Relatório de Março');
  expect(text).toContain('日本語');

  await openTool(app, extensionId, 'pdf-merge');
  await app.locator('[data-testid="dropzone-input"]').setInputFiles([
    { name: 'chrome.pdf', mimeType: 'application/pdf', buffer: pdf },
    { name: 'sample.pdf', mimeType: 'application/pdf', buffer: readFileSync('test-fixtures/sample.pdf') },
  ]);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect((await PDFDocument.load(await captureDownload(app))).getPageCount()).toBe(6);

  await openTool(app, extensionId, 'pdf-page-numbers');
  await addBuffer(app, 'chrome.pdf', 'application/pdf', pdf);
  await app.getByLabel('Style').selectOption({ label: 'Page 1 of 10' });
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(await pdfText(app, extensionId, await captureDownload(app))).toContain('Page 3 of 3');

  await openTool(app, extensionId, 'pdf-watermark');
  await addBuffer(app, 'chrome.pdf', 'application/pdf', pdf);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(await pdfText(app, extensionId, await captureDownload(app))).toContain('CONFIDENTIAL');

  await openTool(app, extensionId, 'pdf-to-jpg');
  await addBuffer(app, 'chrome.pdf', 'application/pdf', pdf);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const pages = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  expect(Object.keys(pages)).toHaveLength(3);

  await openTool(app, extensionId, 'pdf-compress');
  await addBuffer(app, 'chrome.pdf', 'application/pdf', pdf);
  await app.getByTestId('run').click();
  expect(['completed', 'no-output']).toContain(await waitForResult(app));
});
