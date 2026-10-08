import { WorkerPool } from '../../core/worker-pool';
import { poolLimits } from '../../core/capabilities';
import type { FormatId } from '../../registry/formats';
import type { CombineRequest, ImageInfo, ImageOps, ImageOutputFormat, OutputSpec, ProcessResult, StripResult } from './types';

/** Main-thread API for the image worker pool. */
const pool = new WorkerPool(
  () => new Worker(new URL('../../workers/image.worker.ts', import.meta.url), { type: 'module', name: 'convertly-image' }),
  { max: () => poolLimits().image + 1, idleMs: 30_000 },
);

// A separate single worker for previews so thumbnails never wait behind a batch.
const previewPool = new WorkerPool(
  () => new Worker(new URL('../../workers/image.worker.ts', import.meta.url), { type: 'module', name: 'convertly-preview' }),
  { max: () => 1, idleMs: 20_000 },
);

export function processImage(
  file: Blob,
  format: FormatId,
  ops: ImageOps,
  output: OutputSpec,
  options: { signal?: AbortSignal; onProgress?: (p: number | null) => void } = {},
): Promise<ProcessResult> {
  return pool.call<ProcessResult>('process', { file, format, ops, output }, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}

export function getImageInfo(file: Blob, format: FormatId, signal?: AbortSignal): Promise<ImageInfo> {
  return previewPool.call<ImageInfo>('info', { file, format }, signal ? { signal } : {});
}

export function makeThumbnail(file: Blob, format: FormatId, maxSize = 480, signal?: AbortSignal): Promise<Blob> {
  return previewPool.call<Blob>('thumbnail', { file, format, maxSize }, signal ? { signal } : {});
}

export function stripImageMetadata(
  file: Blob,
  format: FormatId,
  fallback: ImageOutputFormat,
  quality: number,
  signal?: AbortSignal,
): Promise<StripResult> {
  return pool.call<StripResult>('strip', { file, format, fallback, quality }, signal ? { signal } : {});
}

export function combineImages(req: CombineRequest, options: { signal?: AbortSignal; onProgress?: (p: number | null) => void } = {}): Promise<ProcessResult> {
  return pool.call<ProcessResult>('combine', req, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}

export function splitImage(
  file: Blob,
  format: FormatId,
  rows: number,
  cols: number,
  output: OutputSpec,
  options: { signal?: AbortSignal; onProgress?: (p: number | null) => void } = {},
): Promise<Array<{ blob: Blob; row: number; col: number; width: number; height: number }>> {
  return pool.call('split', { file, format, rows, cols, output }, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}

/** Formats an <img> element can show directly; others need a worker-generated preview. */
export const NATIVE_PREVIEW: ReadonlySet<FormatId> = new Set(['jpg', 'png', 'webp', 'gif', 'bmp', 'avif', 'ico', 'svg']);

export function terminateImageWorkers(): void {
  pool.terminateAll();
  previewPool.terminateAll();
}
