import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { test, expect, openTool, addFiles, waitForResult, captureDownload, fixture } from './fixtures';
import { downloadNamed } from './helpers';
import { readXlsx } from '../../src/engines/data/xlsx';

test.describe.configure({ timeout: 300_000 });

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

// ───────── Archives ─────────
const ARCHIVES: Array<[string, string, string[]]> = [
  ['sample.7z', 'archive-extract', ['readme.txt', 'docs/notes.md', 'docs/nested/data.json', 'image.png']],
  ['sample.tar.gz', 'extract-tar', ['readme.txt', 'docs/notes.md']],
  ['sample.tar.bz2', 'archive-extract', ['readme.txt', 'docs/nested/data.json']],
  ['sample.tar.xz', 'archive-extract', ['readme.txt', 'image.png']],
  ['sample.iso', 'archive-extract', ['readme.txt']],
  ['sample-rar5.rar', 'extract-rar', []],
  ['sample.rar', 'extract-rar', []],
  ['sample.zip', 'archive-extract', ['folder/nested/notes.md']],
];
for (const [file, tool, expected] of ARCHIVES) {
  test(`extract ${file} with ${tool}`, async ({ app, extensionId }) => {
    await openTool(app, extensionId, tool);
    await addFiles(app, [file]);
    const table = app.getByTestId('zip-entries');
    await expect(table).toBeVisible({ timeout: 30_000 });
    for (const name of expected) await expect(table).toContainText(name);
    await app.getByTestId('run').click();
    expect(await waitForResult(app)).toBe('completed');
    if (expected.includes('readme.txt')) {
      expect((await downloadNamed(app, 'readme.txt')).toString().trim()).toBe('Convertly archive fixture');
    }
  });
}

test('extract a plain .gz file', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'archive-extract');
  await addFiles(app, ['notes.txt.gz']);
  await expect(app.getByTestId('zip-entries')).toContainText('notes.txt');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect((await captureDownload(app)).equals(readFileSync(fixture('sample.txt')))).toBe(true);
});

test('password-protected ZIP: wrong password, then the right one', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'zip-extract');
  await addFiles(app, ['encrypted.zip']);
  await app.getByTestId('open-archive-extract').click();
  const form = app.getByTestId('archive-password');
  await expect(form).toBeVisible();
  await app.getByLabel('Password').fill('nope');
  await app.getByRole('button', { name: 'Unlock' }).click();
  // The password is checked immediately (the smallest entry is test-decrypted).
  await expect(form).toContainText('Wrong password');
  await expect(app.getByTestId('run')).toBeDisabled();
  await app.getByLabel('Password').fill('secret');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.getByTestId('zip-entries')).toContainText('readme.txt');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  expect((await downloadNamed(app, 'readme.txt')).toString().trim()).toBe('Convertly archive fixture');
});

test('encrypted RAR: honest "not supported" message', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'archive-extract');
  await addFiles(app, ['encrypted.rar']);
  await expect(app.getByTestId('archive-unsupported-encryption')).toBeVisible({ timeout: 30_000 });
  await expect(app.getByTestId('run')).toBeDisabled();
});

test('create TAR.GZ and GZ archives', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'archive-create');
  await addFiles(app, ['sample.txt', 'sample.json']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const tgz = await captureDownload(app);
  expect([tgz[0], tgz[1]]).toEqual([0x1f, 0x8b]);
  const tar = gunzipSync(new Uint8Array(tgz));
  expect(Buffer.from(tar.subarray(257, 262)).toString()).toBe('ustar');

  await app.getByRole('button', { name: 'Create another' }).click();
  await addFiles(app, ['sample.txt']);
  await app.getByRole('radio', { name: 'GZ', exact: true }).click();
  await expect(app.getByText('sample.txt.gz').first()).toBeVisible();
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const gz = await captureDownload(app);
  expect(Buffer.from(gunzipSync(new Uint8Array(gz))).equals(readFileSync(fixture('sample.txt')))).toBe(true);
});

// ───────── Data ─────────
test('YAML ↔ JSON', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'yaml-to-json');
  await app.locator('main input[type=file]').first().setInputFiles(fixture('sample.yaml'));
  await expect(app.getByTestId('data-output')).toHaveValue(/"maxFiles": 500/);
  const json = JSON.parse(await app.getByTestId('data-output').inputValue());
  expect(json).toEqual({ name: 'Convertly', private: true, version: 1.1, tools: ['pdf', 'image'], limits: { maxFiles: 500, locales: ['en', 'pt'] } });

  await app.getByTestId('data-input').fill('a: [1, 2\nb: 3');
  await expect(app.locator('.notice--danger')).toBeVisible();

  await openTool(app, extensionId, 'json-to-yaml');
  await app.getByTestId('data-input').fill('{"name":"Convertly","tools":["pdf","image"]}');
  await expect(app.getByTestId('data-output')).toHaveValue('name: Convertly\ntools:\n  - pdf\n  - image\n');
});

test('JSON → XML', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'json-to-xml');
  await app.getByTestId('data-input').fill('{"note":{"@lang":"pt","to":"Ana","items":[1,2]}}');
  await expect(app.getByTestId('data-output')).toHaveValue(/<note lang="pt">\n {2}<to>Ana<\/to>\n {2}<items>1<\/items>\n {2}<items>2<\/items>\n<\/note>/);
});

test('Markdown → HTML page', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'markdown-to-html');
  await app.locator('main input[type=file]').first().setInputFiles(fixture('sample.md'));
  await expect(app.getByTestId('data-output')).toHaveValue(/<title>Convertly notes<\/title>/);
  await expect(app.getByTestId('data-output')).toHaveValue(/<table>/);
  const html = (await captureDownload(app)).toString();
  expect(html).toContain('<strong>bold</strong>');
});

test('Excel: CSV → XLSX → CSV round trip', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'csv-to-xlsx');
  await app.getByTestId('data-input').fill('name,city,age\nAna,Lisboa,31\n"Rui, Jr.",Porto,27');
  await expect(app.getByTestId('sheet-preview')).toContainText('Rui, Jr.');
  const xlsx = await captureDownload(app);
  const sheets = readXlsx(new Uint8Array(xlsx));
  expect(sheets[0]!.rows).toEqual([
    ['name', 'city', 'age'],
    ['Ana', 'Lisboa', 31],
    ['Rui, Jr.', 'Porto', 27],
  ]);

  await openTool(app, extensionId, 'xlsx-to-csv');
  await app.getByTestId('dropzone-input').setInputFiles({ name: 'people.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await expect(app.getByTestId('sheet-preview')).toContainText('Lisboa');
  await app.getByRole('checkbox', { name: 'UTF-8 BOM' }).uncheck().catch(() => {});
  const csv = (await captureDownload(app)).toString('utf8').replace(/^﻿/, '');
  expect(csv).toBe('name,city,age\r\nAna,Lisboa,31\r\n"Rui, Jr.",Porto,27\r\n');
});

test('file checksum: SHA-256 and MD5 match Node, verify field', async ({ app, extensionId }) => {
  const bytes = readFileSync(fixture('sample.txt'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const md5 = createHash('md5').update(bytes).digest('hex');
  await openTool(app, extensionId, 'file-hash');
  await addFiles(app, ['sample.txt']);
  // Hashes are computed automatically when files are added.
  await expect(app.getByTestId('hash-sha256')).toHaveText(sha256);
  await expect(app.getByTestId('hash-md5')).toHaveText(md5);
  await app.getByLabel('Verify a checksum').fill(sha256.toUpperCase());
  await expect(app.getByText('Verified: sample.txt')).toBeVisible();
  await app.getByLabel('Verify a checksum').fill('0'.repeat(64));
  await expect(app.getByText('No file matches this checksum.')).toBeVisible();
});
