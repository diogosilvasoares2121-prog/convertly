import { readFileSync } from 'node:fs';
import { test, expect, openTool, addFiles, waitForResult, captureDownload, fixture, fixtureBytes } from './fixtures';

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

// ───────── Archive ─────────
test('extract ZIP: lists entries and saves every file', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'zip-extract');
  await addFiles(app, ['sample.zip']);
  const table = app.getByTestId('zip-entries');
  await expect(table).toContainText('folder/nested/notes.md');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const downloads: string[] = [];
  app.on('download', (d) => downloads.push(d.url()));
  await app.getByTestId('download-zip').click(); // "Save 4 files to Downloads/sample"
  await expect.poll(() => downloads.length, { timeout: 15_000 }).toBe(4);
});

test('extract ZIP with zip-slip paths: paths are neutralised and executables flagged', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'zip-extract');
  await addFiles(app, ['zip-slip.zip']);
  await expect(app.getByText('Unsafe paths were neutralized')).toBeVisible();
  await expect(app.getByText('Executable files inside')).toBeVisible();
  const table = app.getByTestId('zip-entries');
  await expect(table).toContainText('evil.txt');
  await expect(table).not.toContainText('../');
});

// ───────── Data ─────────
test('JSON formatter shows exact error position, then formats', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'json-format');
  const input = app.getByTestId('data-input');
  await input.fill('{\n  "a": 1,\n  "b": }');
  await expect(app.getByText('Line 3, column 8')).toBeVisible();
  await input.fill('{"name":"Convertly","n":12345678901234567890}');
  await expect(app.getByTestId('data-output')).toHaveValue('{\n  "name": "Convertly",\n  "n": 12345678901234567890\n}');
});

test('JSON → CSV and CSV → JSON with files', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'json-to-csv');
  await app.getByTestId('data-input').fill('[{"a":1,"b":"x,y"},{"a":2,"b":"z"}]');
  // <textarea> normalises CRLF to LF for display; the downloaded file keeps RFC 4180 CRLF.
  await expect(app.getByTestId('data-output')).toHaveValue('a,b\n1,"x,y"\n2,z\n');
  const csv = await captureDownload(app);
  expect(csv.toString()).toBe('a,b\r\n1,"x,y"\r\n2,z\r\n');

  await openTool(app, extensionId, 'csv-to-json');
  await app.locator('input[type=file]').first().setInputFiles(fixture('sample.csv'));
  await expect(app.getByTestId('data-output')).toHaveValue(/"name": "Rui; Jr\."/);
});

test('XML, Base64 and URL tools', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'xml-to-json');
  await app.getByTestId('data-input').fill('<a x="1"><b>t</b></a>');
  await expect(app.getByTestId('data-output')).toHaveValue(/"@x": "1"/);

  await openTool(app, extensionId, 'base64-encode');
  await app.getByTestId('data-input').fill('Olá 🎉');
  await expect(app.getByTestId('data-output')).toHaveValue('T2zDoSDwn46J');

  await openTool(app, extensionId, 'base64-to-file');
  await app.getByTestId('data-input').fill(`data:image/png;base64,${fixtureBytes('sample.png').toString('base64')}`);
  await expect(app.locator('.badge', { hasText: 'PNG' })).toBeVisible();
  const png = await captureDownload(app);
  expect(png.equals(fixtureBytes('sample.png'))).toBe(true);

  await openTool(app, extensionId, 'url-decode');
  await app.getByTestId('data-input').fill('caf%C3%A9%20%26');
  await expect(app.getByTestId('data-output')).toHaveValue('café &');
});

// ───────── Detection, search, shortcuts, edge cases ─────────
test('universal detection: HEIC suggests JPG/PNG/WEBP and opens the converter', async ({ app }) => {
  await app.getByTestId('home-dropzone-input').setInputFiles(fixture('sample.heic'));
  const card = app.getByTestId('detect-card');
  await expect(card).toContainText('HEIC image detected');
  for (const f of ['jpg', 'png', 'webp', 'pdf']) await expect(app.getByTestId(`convert-${f}`)).toBeVisible();
  await expect(card).toContainText('Compress image');
  await app.getByTestId('convert-jpg').click();
  await expect(app.locator('.tool-header h1')).toHaveText('HEIC → JPG');
  await expect(app.locator('.file-row')).toContainText('sample.heic');
});

test('detection: wrong extension, PDF and video suggestions, empty file', async ({ app }) => {
  await app.getByTestId('home-dropzone-input').setInputFiles([fixture('png-named.jpg'), fixture('sample.pdf'), fixture('sample.mov'), fixture('empty.bin')]);
  const cards = app.getByTestId('detect-card');
  await expect(cards).toHaveCount(4);
  await expect(app.locator('[data-format=png]')).toContainText('Actually a PNG file');
  await expect(app.locator('[data-format=pdf]')).toContainText('Organize PDF');
  await expect(app.locator('[data-format=mov]')).toContainText('Trim video');
  await expect(app.locator('[data-format=mov]')).toContainText('MP3');
  await expect(app.locator('[data-format=unknown]')).toContainText('Empty file');
});

test('global drop target: files dropped on a tool go to that tool', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'pdf-merge');
  await app.getByTestId('global-file-input').setInputFiles([fixture('sample.pdf'), fixture('sample2.pdf')]);
  await expect(app.getByTestId('total-pages')).toHaveText('5 pages');
});

test('command palette (Ctrl+K) with keyboard navigation and aliases', async ({ app }) => {
  await app.keyboard.press('Control+K');
  const input = app.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await input.fill('combine pdf');
  await app.keyboard.press('Enter');
  await expect(app.locator('.tool-header h1')).toHaveText('Merge PDF');
  await app.keyboard.press('Control+K');
  await app.getByTestId('palette-input').fill('jpg');
  await expect(app.locator('.palette__list')).toContainText('JPG → Base64');
  await app.keyboard.press('Escape');
  await expect(app.getByTestId('palette-input')).toBeHidden();
});

test('clipboard paste: image detected with Save-as actions', async ({ app }) => {
  await app.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, [...fixtureBytes('sample.png')]);
  await expect(app.getByText('Clipboard image detected')).toBeVisible();
  await app.getByTestId('save-jpg').click();
  expect(await waitForResult(app)).toBe('completed');
  const jpg = await captureDownload(app);
  expect(jpg[0]).toBe(0xff);
});

test('settings: theme, language and recent activity', async ({ app, extensionId }) => {
  await app.goto(`chrome-extension://${extensionId}/app/index.html#/settings`);
  await app.getByRole('radio', { name: 'Dark' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.getByRole('radio', { name: 'Português' }).click();
  await expect(app.locator('h1')).toHaveText('Definições');
  const stored = await app.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(stored)).not.toMatch(/\.(png|jpg|pdf|mp4)/); // never file names
  await app.getByRole('radio', { name: 'English' }).click();
  await expect(app.locator('h1')).toHaveText('Settings');
});

test('jobs drawer lists jobs and frees memory on clear', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'png-to-jpg');
  await addFiles(app, ['sample.png']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  await app.getByTestId('open-jobs').click();
  const drawer = app.getByTestId('jobs-drawer');
  await expect(drawer.getByTestId('job-row')).toHaveCount(1);
  await drawer.getByRole('button', { name: 'Clear finished' }).click();
  await expect(drawer).toContainText('No jobs yet');
  await app.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('popup shows the toolbox button and suggested tools', async ({ app, extensionId }) => {
  await app.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(app.getByTestId('open-toolbox')).toBeVisible();
  await expect(app.locator('.popup__tools .result-item')).toHaveCount(3);
});

test('about page lists third-party licenses from the local file', async ({ app, extensionId }) => {
  await app.goto(`chrome-extension://${extensionId}/app/index.html#/about`);
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  await expect(app.getByTestId('version')).toContainText(version);
  await app.getByRole('button', { name: 'Show full license texts' }).click();
  await expect(app.locator('.license-text')).toContainText('GNU GENERAL PUBLIC LICENSE');
});

test('mobile width: sidebar collapses, no horizontal overflow', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 800 });
  await expect(app.locator('.sidebar')).not.toBeInViewport();
  await app.getByRole('button', { name: 'Open menu' }).click();
  await expect(app.locator('.sidebar')).toBeInViewport();
  const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
