import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openTool, waitForResult, captureDownload } from './fixtures';
import { detectFromSignature } from '../../src/core/detect';

export const sig = (b: Buffer | Uint8Array) => detectFromSignature(new Uint8Array(b).subarray(0, 4096));

/** Decodes an image in the page and returns its size and the RGBA of a few pixels. */
export async function inspectImage(app: Page, bytes: Buffer | Uint8Array, type: string, points: Array<[number, number]> = []): Promise<{ w: number; h: number; px: number[][] }> {
  return app.evaluate(
    async ({ data, type, points }) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const px = points.map(([x, y]) => [...ctx.getImageData(Math.min(bmp.width - 1, x), Math.min(bmp.height - 1, y), 1, 1).data]);
      return { w: bmp.width, h: bmp.height, px };
    },
    { data: [...bytes], type, points },
  );
}

/** Size of a video in the page (via a <video> element). */
export async function videoSize(app: Page, bytes: Buffer | Uint8Array): Promise<{ w: number; h: number; duration: number }> {
  return app.evaluate(async (data) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'video/mp4' }));
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error('video decode failed'));
    });
    const out = { w: v.videoWidth, h: v.videoHeight, duration: v.duration };
    URL.revokeObjectURL(url);
    return out;
  }, [...bytes]);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Clicks the per-file download button in a multi-output result list (name with or without its folder). */
export async function downloadNamed(app: Page, name: string): Promise<Buffer> {
  const button = app.getByRole('button', { name: new RegExp(`^Download (.+/)?${escapeRegExp(name)}$`) });
  const [download] = await Promise.all([app.waitForEvent('download'), button.click()]);
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFileSync(path);
}

/** Runs the app's own "PDF to text" tool on a PDF and returns the extracted text. */
export async function pdfText(app: Page, extensionId: string, pdf: Buffer): Promise<string> {
  await openTool(app, extensionId, 'pdf-to-text');
  // Tools keep their last result while the tab is open: reload for a clean session.
  await app.reload();
  await app.locator('[data-testid="dropzone-input"]').waitFor({ state: 'attached' });
  await app.locator('[data-testid="dropzone-input"]').setInputFiles({ name: 'check.pdf', mimeType: 'application/pdf', buffer: pdf });
  await app.getByTestId('run').click();
  expect(await waitForResult(app)).toBe('completed');
  return (await captureDownload(app)).toString('utf8');
}

/** Feeds an in-memory file to the tool's dropzone. */
export async function addBuffer(app: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await app.locator('[data-testid="dropzone-input"]').setInputFiles({ name, mimeType, buffer });
}
