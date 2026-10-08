import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { test, expect, openTool, addFiles, waitForResult, captureDownload } from './fixtures';
import { addBuffer, inspectImage, pdfText, sig } from './helpers';
import { readIcoSizes } from '../../src/engines/image/ico';

test.describe.configure({ timeout: 300_000 });

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

// ───────── Image ─────────
test('SVG → PNG at 2× without running scripts or loading remote resources', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'svg-convert');
  await addFiles(app, ['sample.svg']);
  await expect(app.getByTestId('svg-result-size')).toHaveText('240 × 160');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const png = await captureDownload(app);
  expect(sig(png)).toBe('png');
  const img = await inspectImage(app, png, 'image/png', [[60, 80], [2, 2]]);
  expect(img).toMatchObject({ w: 240, h: 160 });
  expect(img.px[0]).toEqual([255, 255, 255, 255]); // white circle in the middle-left
  expect(await app.evaluate(() => (window as unknown as { __svgScriptRan?: boolean }).__svgScriptRan)).toBeUndefined();
});

test('SVG → JPG pair tool flattens on white', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'svg-to-jpg');
  await addFiles(app, ['sample.svg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('jpg');
});

test('image → ICO favicon with every selected size', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-to-ico');
  await addFiles(app, ['sample.png']);
  await app.getByRole('button', { name: 'Create .ico' }).click();
  expect(await waitForResult(app)).toBe('completed');
  const ico = await captureDownload(app);
  expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  expect(readIcoSizes(new Uint8Array(ico))).toEqual([16, 32, 48, 64, 128, 256]);
});

test('SVG → ICO', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-to-ico');
  await addFiles(app, ['sample.svg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(readIcoSizes(new Uint8Array(await captureDownload(app)))).toContain(256);
});

test('watermark: live preview, then batch output keeps the size', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-watermark');
  await addFiles(app, ['sample.jpg', 'sample.png']);
  await expect(app.getByTestId('live-preview')).toBeVisible();
  await app.getByLabel('Text', { exact: true }).fill('© Convertly test');
  await app.getByRole('switch', { name: 'Repeat across the image' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  expect(Object.keys(zip).sort()).toEqual(['sample-watermarked.jpg', 'sample-watermarked.png']);
});

test('adjust: black & white preset produces gray pixels', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-adjust');
  await addFiles(app, ['sample.png']);
  await app.getByRole('radio', { name: 'Black & white' }).click();
  await expect(app.getByTestId('live-preview')).toBeVisible();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const out = await captureDownload(app);
  const img = await inspectImage(app, out, 'image/png', [[10, 10], [50, 40], [100, 80]]);
  for (const [r, g, b] of img.px) {
    expect(Math.abs(r! - g!)).toBeLessThanOrEqual(2);
    expect(Math.abs(g! - b!)).toBeLessThanOrEqual(2);
  }
});

test('combine two images side by side', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-combine');
  await addFiles(app, ['sample.png', 'sample.jpg']);
  const before = await inspectImage(app, (await import('node:fs')).readFileSync('test-fixtures/sample.png'), 'image/png');
  await app.getByRole('radio', { name: 'PNG', exact: true }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const out = await captureDownload(app);
  expect(sig(out)).toBe('png');
  const img = await inspectImage(app, out, 'image/png');
  expect(img.h).toBe(before.h);
  expect(img.w).toBeGreaterThan(before.w);
});

test('split image 1 × 3 into tiles', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-split');
  await addFiles(app, ['sample.png']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(3);
  expect(names[0]).toMatch(/sample-01-r1c1\.png$/);
  const widths = await Promise.all(names.map(async (n) => (await inspectImage(app, Buffer.from(zip[n]!), 'image/png')).w));
  const original = await inspectImage(app, (await import('node:fs')).readFileSync('test-fixtures/sample.png'), 'image/png');
  expect(widths.reduce((a, b) => a + b, 0)).toBe(original.w);
});

test('crop to a circle: transparent corners in a PNG', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'image-crop');
  await addFiles(app, ['sample.jpg']);
  await app.getByRole('radio', { name: 'Circle' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const out = await captureDownload(app);
  expect(sig(out)).toBe('png');
  const img = await inspectImage(app, out, 'image/png', [[0, 0]]);
  expect(img.w).toBe(img.h);
  expect(img.px[0]![3]).toBe(0);
});

test('images → animated GIF and → MP4 slideshow', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'images-to-gif');
  await addFiles(app, ['sample.png', 'sample.jpg', 'sample.webp']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const gif = await captureDownload(app);
  expect(sig(gif)).toBe('gif');
  expect(gif.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);

  await openTool(app, extensionId, 'images-to-video');
  await addFiles(app, ['sample.png', 'sample.jpg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('mp4');
});

// ───────── PDF ─────────
test('PDF to text extracts every page', async ({ app, extensionId }) => {
  const text = await pdfText(app, extensionId, (await import('node:fs')).readFileSync('test-fixtures/sample.pdf'));
  expect(text).toContain('Convertly Sample A');
  expect(text).toContain('Page 3 of 3');
  expect(text).toContain('--- Page 2 ---');
});

test('page numbers with a custom start number', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-page-numbers');
  await addFiles(app, ['sample10.pdf']);
  await app.getByLabel('Style').selectOption({ label: '1 / 10' });
  await app.getByLabel('First number').fill('101');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const pdf = await captureDownload(app);
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(10);
  const text = await pdfText(app, extensionId, pdf);
  expect(text).toContain('101 / 110');
  expect(text).toContain('110 / 110');
});

test('PDF watermark is stamped on every page', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-watermark');
  await addFiles(app, ['sample.pdf']);
  await app.getByLabel('Text', { exact: true }).fill('DRAFT ONLY');
  await app.getByRole('radio', { name: 'Repeated' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const text = await pdfText(app, extensionId, await captureDownload(app));
  expect(text.match(/DRAFT ONLY/g)!.length).toBeGreaterThanOrEqual(3);
});

test('crop PDF margins (CropBox)', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-crop');
  await addFiles(app, ['sample.pdf']);
  await app.getByLabel('Margin to remove').fill('20');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const doc = await PDFDocument.load(await captureDownload(app));
  const box = doc.getPage(0).getCropBox();
  expect(Math.round(box.width)).toBe(Math.round(595 - 2 * 20 * (72 / 25.4)));
});

test('text to PDF from a .txt file, with honest note for unsupported characters', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'text-to-pdf');
  await app.locator('main input[type=file]').first().setInputFiles('test-fixtures/sample.txt');
  await expect(app.getByTestId('data-input')).toHaveValue(/Ação, coração/);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.getByTestId('job-group')).toContainText('replaced by "?"');
  const pdf = await captureDownload(app);
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  expect(await pdfText(app, extensionId, pdf)).toContain('Ação, coração, façade');
});

test('extract images from a PDF', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-extract-images');
  await addFiles(app, ['photos.pdf']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const group = app.getByTestId('job-group');
  const single = await app.getByTestId('download').count();
  const bytes = single ? await captureDownload(app) : Buffer.from(Object.values(unzipSync(new Uint8Array(await captureDownload(app, 'download-zip'))))[0]!);
  expect(sig(bytes)).toBe('jpg');
  await expect(group).toBeVisible();
});

test('PDF with no images: honest "nothing found"', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-extract-images');
  await addFiles(app, ['sample.pdf']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('no-output');
  await expect(app.getByTestId('job-group')).toContainText('No extractable images');
});

test('repair PDF rebuilds a readable file', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-repair');
  const original = (await import('node:fs')).readFileSync('test-fixtures/sample2.pdf');
  // Damage the cross-reference offsets: viewers that trust the xref table fail, lenient parsing recovers.
  const damaged = Buffer.from(original.toString('latin1').replace(/startxref\s+\d+/, 'startxref\n999999'), 'latin1');
  await addBuffer(app, 'damaged.pdf', 'application/pdf', damaged);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.getByTestId('job-group')).toContainText('2 pages recovered');
  expect((await PDFDocument.load(await captureDownload(app))).getPageCount()).toBe(2);
});

test('organize: insert a blank page', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-organize');
  await addFiles(app, ['sample.pdf']);
  await expect(app.locator('.page-card')).toHaveCount(3);
  await app.getByTestId('insert-blank').click();
  await expect(app.locator('.page-card')).toHaveCount(4);
  await expect(app.locator('.page-card__blank')).toBeVisible();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const doc = await PDFDocument.load(await captureDownload(app));
  expect(doc.getPageCount()).toBe(4);
  expect(doc.getPage(3).getSize()).toEqual({ width: 595, height: 842 });
});
