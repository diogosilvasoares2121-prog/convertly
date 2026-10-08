import { unzipSync } from 'fflate';
import { test, expect, openTool, addFiles, waitForResult, captureDownload, fixture } from './fixtures';
import { sig, videoSize } from './helpers';

test.describe.configure({ timeout: 600_000 });

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

const wavInfo = (b: Buffer) => ({ channels: b.readUInt16LE(22), rate: b.readUInt32LE(24) });

test('video → frames every second (JPG)', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'video-to-frames');
  await addFiles(app, ['sample.mp4']);
  await expect(app.getByText(/About \d+ images/)).toBeVisible({ timeout: 60_000 });
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  const zip = unzipSync(new Uint8Array(await captureDownload(app, 'download-zip')));
  const names = Object.keys(zip);
  expect(names.length).toBeGreaterThanOrEqual(2);
  for (const n of names) expect(sig(zip[n]!), n).toBe('jpg');
});

test('video speed 2× halves the duration', async ({ app, extensionId }) => {
  const before = await videoSize(app, (await import('node:fs')).readFileSync(fixture('sample.mp4')));
  await openTool(app, extensionId, 'video-speed');
  await addFiles(app, ['sample.mp4']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  const out = await captureDownload(app);
  expect(sig(out)).toBe('mp4');
  const after = await videoSize(app, out);
  expect(after.duration).toBeGreaterThan(before.duration / 2 - 0.3);
  expect(after.duration).toBeLessThan(before.duration / 2 + 0.3);
});

test('crop video to 1:1', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'video-crop');
  await addFiles(app, ['sample.mp4']);
  await app.getByRole('radio', { name: '1:1 square' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  const size = await videoSize(app, await captureDownload(app));
  expect(size.w).toBe(size.h);
});

test('merge videos (one without audio) into one MP4', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'video-merge');
  await addFiles(app, ['sample.mp4', 'silent.mp4']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  const out = await captureDownload(app);
  expect(sig(out)).toBe('mp4');
  const merged = await videoSize(app, out);
  const a = await videoSize(app, (await import('node:fs')).readFileSync(fixture('sample.mp4')));
  const b = await videoSize(app, (await import('node:fs')).readFileSync(fixture('silent.mp4')));
  expect(merged.duration).toBeGreaterThan(a.duration + b.duration - 0.6);
});

test('add music to a video (replace and loop)', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'video-add-audio');
  await addFiles(app, ['silent.mp4']);
  await app.getByTestId('music-dropzone-input').setInputFiles(fixture('sample.mp3'));
  await expect(app.getByTestId('music-file')).toContainText('sample.mp3');
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('mp4');
});

test('GIF → MP4 and GIF → WEBM', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'gif-to-mp4');
  await addFiles(app, ['animated.gif']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('mp4');

  await openTool(app, extensionId, 'gif-to-webm');
  await addFiles(app, ['animated.gif']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('webm');
});

test('audio: normalize volume, fade, reverse and speed', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'audio-volume');
  await addFiles(app, ['sample.mp3']);
  await app.getByRole('radio', { name: 'Normalize' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('mp3');

  await openTool(app, extensionId, 'audio-fade');
  await addFiles(app, ['sample.wav']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  const faded = await captureDownload(app);
  expect(sig(faded)).toBe('wav');
  // The first samples are (almost) silent after a 2 s fade-in.
  const data = faded.indexOf('data', 12) + 8;
  for (let i = 0; i < 8; i++) expect(Math.abs(faded.readInt16LE(data + i * 2))).toBeLessThan(50);

  await openTool(app, extensionId, 'audio-reverse');
  await addFiles(app, ['sample.ogg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('ogg');

  await openTool(app, extensionId, 'audio-speed');
  await addFiles(app, ['sample.flac']);
  await app.getByRole('radio', { name: '1.5×' }).click();
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('flac');
});

test('merge audio files into one MP3', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'audio-merge');
  await addFiles(app, ['sample.mp3', 'sample.wav', 'sample.ogg']);
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  expect(sig(await captureDownload(app))).toBe('mp3');
});

test('audio convert to mono 22.05 kHz WAV', async ({ app, extensionId }) => {
  await openTool(app, extensionId, 'mp3-to-wav');
  await addFiles(app, ['sample.mp3']);
  await app.getByLabel('Channels').selectOption('1');
  await app.getByLabel('Sample rate').selectOption('22050');
  await app.getByTestId('run').click();
  expect(await waitForResult(app, 540_000)).toBe('completed');
  const wav = await captureDownload(app);
  expect(wavInfo(wav)).toEqual({ channels: 1, rate: 22050 });
});
