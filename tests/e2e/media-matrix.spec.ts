import { unzipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { test, expect, openTool, addFiles, waitForResult, captureDownload } from './fixtures';
import { detectFromSignature } from '../../src/core/detect';

/**
 * Codec/container matrix for the bundled FFmpeg build (spec §66).
 * Every input container the UI accepts is converted to every output it offers,
 * and each result is verified by its real file signature.
 */
const VIDEO_INPUTS = ['sample.mp4', 'sample.mov', 'sample.webm', 'sample.avi', 'sample.mkv', 'sample.mpg', 'sample.3gp', 'sample.wmv'];
const AUDIO_INPUTS = ['sample.wav', 'sample.mp3', 'sample.m4a', 'sample.ogg', 'sample.flac', 'sample.aac', 'sample.opus', 'sample.wma'];

test.describe.configure({ timeout: 600_000 });

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

async function runBatch(app: Page, extensionId: string, toolId: string, files: string[], target: string): Promise<Record<string, Uint8Array>> {
  await openTool(app, extensionId, toolId);
  await addFiles(app, files);
  await app.getByRole('radio', { name: target, exact: true }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  if (files.length === 1) return { single: new Uint8Array(await captureDownload(app)) };
  const failed = app.locator('.job-row[data-state="failed"]');
  if (await failed.count()) console.log('FAILED IN BATCH:', (await failed.allInnerTexts()).join(' || ').replace(/\s+/g, ' '));
  await expect(app.locator('.stat__value--good').first()).toHaveText(String(files.length));
  return unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
}

function expectFormat(outputs: Record<string, Uint8Array>, expected: string, count: number) {
  const entries = Object.entries(outputs);
  expect(entries).toHaveLength(count);
  for (const [name, bytes] of entries) {
    expect(bytes.length, name).toBeGreaterThan(1000);
    expect(detectFromSignature(bytes.subarray(0, 4096)), name).toBe(expected);
  }
}

for (const target of ['MP4', 'WEBM', 'MOV', 'MKV']) {
  test(`all video inputs → ${target}`, async ({ app, extensionId }) => {
    const out = await runBatch(app, extensionId, 'video-convert', VIDEO_INPUTS, target);
    expectFormat(out, target.toLowerCase(), VIDEO_INPUTS.length);
  });
}

test('all video inputs → MP3 (extract audio)', async ({ app, extensionId }) => {
  const out = await runBatch(app, extensionId, 'video-to-audio', VIDEO_INPUTS, 'MP3');
  expectFormat(out, 'mp3', VIDEO_INPUTS.length);
});

for (const [target, sig] of [['WAV', 'wav'], ['M4A', 'm4a'], ['AAC', 'aac'], ['OGG', 'ogg'], ['FLAC', 'flac'], ['OPUS', 'opus']] as const) {
  test(`MP4 → ${target}`, async ({ app, extensionId }) => {
    const out = await runBatch(app, extensionId, 'video-to-audio', ['sample.mp4'], target);
    expectFormat(out, sig, 1);
  });
}

test('all audio inputs → MP3', async ({ app, extensionId }) => {
  const out = await runBatch(app, extensionId, 'audio-convert', AUDIO_INPUTS, 'MP3');
  expectFormat(out, 'mp3', AUDIO_INPUTS.length);
});

for (const [target, sig] of [['WAV', 'wav'], ['M4A', 'm4a'], ['OGG', 'ogg'], ['FLAC', 'flac'], ['OPUS', 'opus'], ['AAC', 'aac']] as const) {
  test(`all audio inputs → ${target}`, async ({ app, extensionId }) => {
    const out = await runBatch(app, extensionId, 'audio-convert', AUDIO_INPUTS, target);
    expectFormat(out, sig, AUDIO_INPUTS.length);
  });
}

test('silent video → MP3 fails with a clear "no audio" error', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'mp4-to-mp3');
  await addFiles(app, ['silent.mp4']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('failed');
  await expect(app.getByTestId('job-group')).toContainText('No audio track');
});

test('MOV → GIF', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'mov-to-gif');
  await addFiles(app, ['sample.mov']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const gif = await captureDownload(app);
  expect(gif.subarray(0, 4).toString()).toBe('GIF8');
});

for (const mode of ['Fast', 'Precise']) {
  test(`video trim (${mode})`, async ({ app, extensionId }) => {
    await openTool(app, extensionId, 'video-trim');
    await addFiles(app, ['sample.mp4']);
    await expect(app.getByTestId('final-duration')).toHaveText('00:00:03.000');
    await app.getByRole('textbox', { name: 'Start' }).fill('00:00:01');
    await app.getByRole('textbox', { name: 'End' }).fill('00:00:02.500');
    await expect(app.getByTestId('final-duration')).toHaveText('00:00:01.500');
    await app.getByRole('radio', { name: mode }).click();
    await app.getByTestId('run').click();
    expect(await waitForResult(app)).toBe('completed');
    const mp4 = await captureDownload(app);
    expect(detectFromSignature(new Uint8Array(mp4).subarray(0, 4096))).toBe('mp4');
  });
}

test('audio trim (WAV)', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'audio-trim');
  await addFiles(app, ['sample.wav']);
  await app.getByRole('textbox', { name: 'End' }).fill('00:00:01');
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  const wav = await captureDownload(app);
  expect(wav.subarray(8, 12).toString()).toBe('WAVE');
  expect(wav.length).toBeLessThan(150_000); // ~1 s of 44.1 kHz mono PCM instead of 3 s
});

for (const [toolId, option] of [['video-resize', '480p'], ['video-mute', null], ['video-rotate', '90° right'], ['video-compress', 'Small file']] as const) {
  test(`${toolId}`, async ({ app, extensionId }) => {
    await openTool(app, extensionId, toolId);
    await addFiles(app, ['sample.mp4']);
    if (option) await app.getByRole('radio', { name: option }).click();
    await app.getByTestId('run').click();
    expect(await waitForResult(app)).toBe('completed');
    const out = await captureDownload(app);
    expect(detectFromSignature(new Uint8Array(out).subarray(0, 4096))).toBe('mp4');
  });
}

test('cancel stops a running transcode and retry works', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'video-convert');
  await addFiles(app, ['sample.avi', 'sample.wmv', 'sample.mpg']);
  await app.getByRole('radio', { name: 'WEBM', exact: true }).click();
  await app.getByTestId('run').click();
  await expect(app.getByTestId('job-group')).toHaveAttribute('data-status', 'running');
  await app.getByRole('button', { name: 'Cancel all' }).click();
  expect(await waitForResult(app)).toBe('completed');
  await expect(app.getByTestId('job-group')).toContainText('Cancelled');
  // Every job ended up cancelled, none completed and nothing is offered for download.
  await expect(app.locator('.stat__value--good').first()).toHaveText('0');
  await expect(app.locator('.stat', { hasText: 'Cancelled' }).locator('.stat__value')).toHaveText('3');
  await expect(app.getByTestId('download-zip')).toHaveCount(0);
  // Retry one job from the jobs drawer: it runs again and completes.
  await app.getByTestId('open-jobs').click();
  await app.getByTestId('jobs-drawer').getByRole('button', { name: 'Retry' }).first().click();
  await expect(app.getByTestId('jobs-drawer').locator('[data-testid="job-row"][data-state="completed"]')).toHaveCount(1, { timeout: 240_000 });
});
