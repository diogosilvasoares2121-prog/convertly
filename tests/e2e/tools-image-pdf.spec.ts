import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { test, expect, openTool, addFiles, waitForResult, captureDownload } from './fixtures';
import { detectFromSignature } from '../../src/core/detect';
import { readMetadata } from '../../src/engines/image/metadata';

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

const sig = (b: Buffer | Uint8Array) => detectFromSignature(new Uint8Array(b).subarray(0, 4096));

async function dims(app: Page, bytes: Buffer, type: string): Promise<{ w: number; h: number }> {
  return app.evaluate(
    async ({ data, type }) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
      return { w: bmp.width, h: bmp.height };
    },
    { data: [...bytes], type },
  );
}

// ───────── Images ─────────
const IMAGE_PAIRS: Array<[string, string, string]> = [
  ['png-to-jpg', 'sample.png', 'jpg'],
  ['png-to-webp', 'sample.png', 'webp'],
  ['jpg-to-webp', 'sample.jpg', 'webp'],
  ['webp-to-jpg', 'sample.webp', 'jpg'],
  ['webp-to-png', 'sample.webp', 'png'],
  ['heic-to-png', 'sample.heic', 'png'],
  ['heic-to-webp', 'sample.heic', 'webp'],
  ['bmp-to-jpg', 'sample.bmp', 'jpg'],
  ['bmp-to-png', 'sample.bmp', 'png'],
  ['tiff-to-jpg', 'sample.tiff', 'jpg'],
  ['tiff-to-png', 'sample.tiff', 'png'],
  ['gif-to-png', 'static.gif', 'png'],
];
for (const [tool, input, expected] of IMAGE_PAIRS) {
  test(`image ${tool}`, async ({ app, extensionId }) => {
    await openTool(app, extensionId, tool);
    await addFiles(app, [input]);
    await app.getByTestId('run').click();
    expect(await waitForResult(app)).toBe('completed');
    expect(sig(await captureDownload(app))).toBe(expected);
  });
}

test('animated GIF: honest note that only the first frame is converted', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'gif-to-png');
  await addFiles(app, ['animated.gif']);
  await expect(app.locator('.badge', { hasText: 'Animated' })).toBeVisible();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.getByTestId('job-group')).toContainText('only the first frame');
});

test('batch convert with unicode, emoji and long names → ZIP', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-convert');
  const names = ['sample.png', 'fotografia-ação-日本.png', '🎉 party.png', `${'very-long-file-name-'.repeat(8)}end.png`, 'sample.heic', 'sample.bmp'];
  await addFiles(app, names);
  await app.getByRole('radio', { name: 'JPG', exact: true }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.locator('.stat__value--good').first()).toHaveText('6');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  const outNames = Object.keys(zip);
  expect(outNames).toContain('fotografia-ação-日本.jpg');
  expect(outNames).toContain('🎉 party.jpg');
  expect(outNames.every((n) => n.endsWith('.jpg') && n.length <= 150)).toBe(true);
  for (const n of outNames) expect(sig(zip[n]!)).toBe('jpg');
});

test('batch with a corrupt file: one fails with a reason, others succeed', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-convert');
  await addFiles(app, ['sample.png', 'corrupt.jpg']);
  await app.getByRole('radio', { name: 'PNG', exact: true }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.getByTestId('job-group')).toContainText('Files that failed');
  await expect(app.getByTestId('job-group')).toContainText('Corrupted or unreadable file');
});

test('compress to a target size', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-compress');
  await addFiles(app, ['large.jpg']);
  await app.getByRole('radio', { name: '100 KB' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect((await captureDownload(app)).length).toBeLessThanOrEqual(100 * 1024);
});

test('resize to 1280×720 preset keeping aspect', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-resize');
  await addFiles(app, ['large.jpg']);
  await app.getByRole('radio', { name: '1280×720' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(await dims(app, await captureDownload(app), 'image/jpeg')).toEqual({ w: 1080, h: 720 });
});

test('rotate 90° right swaps dimensions', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-rotate');
  await addFiles(app, ['sample.png']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(await dims(app, await captureDownload(app), 'image/png')).toEqual({ w: 300, h: 400 });
});

test('crop with 1:1 ratio', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-crop');
  await addFiles(app, ['sample.jpg']);
  await expect(app.locator('.crop-box')).toBeVisible();
  await app.getByRole('radio', { name: '1:1' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(await dims(app, await captureDownload(app), 'image/jpeg')).toEqual({ w: 427, h: 427 });
});

test('EXIF rotated JPEG metadata removal keeps the visual orientation', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-metadata');
  await addFiles(app, ['rotated.jpg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.getByTestId('job-group')).toContainText('re-encoded');
  const out = await captureDownload(app);
  expect(readMetadata(new Uint8Array(out), 'jpg').hasExif).toBe(false);
  expect(await dims(app, out, 'image/jpeg')).toEqual({ w: 427, h: 640 });
});

test('images → PDF with reordering', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'images-to-pdf');
  await addFiles(app, ['sample.jpg', 'sample.png', 'sample.heic', 'rotated.jpg']);
  await app.getByRole('button', { name: 'Move sample.png up' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const doc = await PDFDocument.load(await captureDownload(app));
  expect(doc.getPageCount()).toBe(4);
});

// ───────── PDF ─────────
test('split PDF by ranges → ZIP of 2 PDFs', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-split');
  await addFiles(app, ['sample10.pdf']);
  await app.getByLabel('Pages').fill('1-3, 5');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  const counts = await Promise.all(Object.values(zip).map(async (b) => (await PDFDocument.load(b)).getPageCount()));
  expect(counts.sort()).toEqual([1, 3]);
  expect(Object.keys(zip).sort()).toEqual(['sample10-p1-3.pdf', 'sample10-page-5.pdf']);
});

test('organize: reverse + delete + rotate, then export', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-organize');
  await addFiles(app, ['sample.pdf']);
  await expect(app.locator('.page-card')).toHaveCount(3);
  await expect(app.locator('.page-card img').first()).toBeVisible();
  await app.getByRole('button', { name: 'Reverse order' }).click();
  await app.getByRole('button', { name: 'Delete page 3' }).click();
  await app.getByRole('button', { name: 'Rotate page 1 right' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const doc = await PDFDocument.load(await captureDownload(app));
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getPage(0).getRotation().angle).toBe(90);
});

test('extract selected pages into one PDF', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-extract-pages');
  await addFiles(app, ['sample10.pdf']);
  await expect(app.locator('.page-card')).toHaveCount(10);
  await app.locator('.page-card').nth(1).click();
  await app.locator('.page-card').nth(4).click({ modifiers: ['Shift'] });
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect((await PDFDocument.load(await captureDownload(app))).getPageCount()).toBe(4);
});

test('PDF metadata removal', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-metadata');
  await addFiles(app, ['sample.pdf']);
  await expect(app.getByLabel('Title')).toHaveValue('Convertly Sample A');
  await app.getByTestId('remove-all').click();
  expect(await waitForResult(app)).toBe('completed');
  const doc = await PDFDocument.load(await captureDownload(app), { updateMetadata: false });
  expect(doc.getTitle()).toBeUndefined();
  expect(doc.getAuthor()).toBeUndefined();
});

test('PDF compression: real reduction for photo PDFs', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-compress');
  await addFiles(app, ['photos.pdf']);
  await app.getByRole('radio', { name: 'Strong' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const out = await captureDownload(app);
  expect(out.length).toBeLessThan(136_898);
  expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
});

test('PDF compression: honest "cannot reduce" for text PDFs', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-compress');
  await addFiles(app, ['sample.pdf']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('no-output');
  await expect(app.getByTestId('job-group')).toContainText('already well optimized');
});

test('password-protected PDF: structural tools refuse, PDF → image unlocks with password', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-merge');
  await addFiles(app, ['sample-encrypted.pdf', 'sample.pdf']);
  await expect(app.getByText('This PDF is password protected').first()).toBeVisible();
  await expect(app.getByTestId('run')).toBeDisabled();

  await openTool(app, extensionId, 'pdf-to-png');
  await addFiles(app, ['sample-encrypted.pdf']);
  await expect(app.getByText('This PDF is password protected').first()).toBeVisible();
  await app.getByLabel('Password').fill('wrong');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.getByText('Incorrect password')).toBeVisible();
  await app.getByLabel('Password').fill('test');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('png');
});

test('corrupt and empty PDFs show clear errors', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-split');
  await addFiles(app, ['corrupt.pdf']);
  await expect(app.getByText('Corrupted or unreadable file')).toBeVisible();
  await openTool(app, extensionId, 'pdf-merge');
  await addFiles(app, ['empty.pdf']);
  await expect(app.getByText('1 empty file was skipped.')).toBeVisible();
});
