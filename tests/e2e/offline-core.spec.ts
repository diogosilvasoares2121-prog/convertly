import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { test, expect, openTool, addFiles, waitForResult, captureDownload } from './fixtures';
import { readMetadata } from '../../src/engines/image/metadata';

/**
 * Spec §50/§103 "Zero network mode": every core tool must work with the browser
 * offline and must not issue a single external request.
 */
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Buffer) => b.subarray(1, 4).toString() === 'PNG';
const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-';
const isMp3 = (b: Buffer) => b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0);

test.afterEach(({ audit }) => {
  expect(audit.external, 'external network requests').toEqual([]);
  expect(audit.consoleErrors, 'console errors').toEqual([]);
});

test('JPG → PNG', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'jpg-to-png');
  await addFiles(app, ['sample.jpg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.locator('.result-flow')).toContainText('sample.png');
  expect(isPng(await captureDownload(app))).toBe(true);
});

test('HEIC → JPG', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'heic-to-jpg');
  await addFiles(app, ['sample.heic']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.locator('.result-flow')).toContainText('sample.jpg');
  const jpg = await captureDownload(app);
  expect(isJpeg(jpg)).toBe(true);
  // Decode the result in the page and check dimensions + the red top-left marker.
  const info = await app.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const [r, g, b] = ctx.getImageData(5, 5, 1, 1).data;
    return { w: bmp.width, h: bmp.height, r, g, b };
  }, [...jpg]);
  expect(info).toMatchObject({ w: 320, h: 240 });
  expect(info.r).toBeGreaterThan(170);
  expect(info.g).toBeLessThan(60);
});

test('Merge two PDFs', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-merge');
  await addFiles(app, ['sample.pdf', 'sample2.pdf']);
  await expect(app.getByTestId('total-pages')).toHaveText('5 pages');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const pdf = await captureDownload(app);
  expect(isPdf(pdf)).toBe(true);
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(5);
});

test('PDF → JPG (all pages, ZIP)', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-to-jpg');
  await addFiles(app, ['sample.pdf']);
  await expect(app.getByTestId('run')).toBeEnabled();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  const names = Object.keys(zip).sort();
  expect(names).toEqual(['sample-page-1.jpg', 'sample-page-2.jpg', 'sample-page-3.jpg']);
  for (const n of names) expect(isJpeg(Buffer.from(zip[n]!))).toBe(true);
});

test('MP4 → MP3', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'mp4-to-mp3');
  await addFiles(app, ['sample.mp4']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.locator('.result-flow')).toContainText('sample.mp3');
  const mp3 = await captureDownload(app);
  expect(isMp3(mp3)).toBe(true);
  expect(mp3.length).toBeGreaterThan(20_000);
});

test('Compress image', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-compress');
  await addFiles(app, ['large.jpg']);
  await app.getByRole('radio', { name: 'Small file' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const out = await captureDownload(app);
  expect(isJpeg(out)).toBe(true);
  expect(out.length).toBeLessThan(135_779);
  await expect(app.locator('.stat__value--good')).toBeVisible();
});

test('Create ZIP', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'zip-create');
  await addFiles(app, ['sample.png', 'sample.json', 'fotografia-ação-日本.png']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const zip = unzipSync(new Uint8Array(await captureDownload(app)));
  expect(Object.keys(zip).sort()).toEqual(['fotografia-ação-日本.png', 'sample.json', 'sample.png'].sort());
  expect(new TextDecoder().decode(zip['sample.json'])).toContain('Lisboa');
});

test('Remove image metadata (lossless JPEG)', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-metadata');
  await addFiles(app, ['sample.jpg']);
  await expect(app.getByTestId('metadata-card')).toContainText('Convertly Test');
  await expect(app.getByTestId('metadata-card')).toContainText('GPS');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const clean = await captureDownload(app);
  const meta = readMetadata(new Uint8Array(clean), 'jpg');
  expect(meta.hasExif).toBe(false);
  expect(meta.hasGps).toBe(false);
});
