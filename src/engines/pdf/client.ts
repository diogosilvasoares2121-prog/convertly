import { WorkerPool, type CallOptions } from '../../core/worker-pool';
import { poolLimits } from '../../core/capabilities';
import type { CompressPreset, CompressStats } from './compress';
import type { Fit, Margin, Orientation, PageRef, PageSize, PdfInspection, PdfMetadata } from './ops';
import type { PageNumberOptions, TextToPdfOptions, WatermarkOptions } from './edit';
import type { ExtractedImage } from './images';

/** Main-thread API for pdf-lib operations (executed in a worker). */
const pool = new WorkerPool(
  () => new Worker(new URL('../../workers/pdf.worker.ts', import.meta.url), { type: 'module', name: 'convertly-pdf' }),
  { max: () => poolLimits().pdf + 1, idleMs: 30_000 },
);

type Opts = Pick<CallOptions, 'signal' | 'onProgress'>;

export const inspectPdf = (file: Blob, opts: Opts = {}) => pool.call<PdfInspection>('inspect', { file }, opts);
export const mergePdfs = (files: Blob[], opts: Opts = {}) => pool.call<Blob>('merge', { files }, opts);
export const assemblePdf = (files: Blob[], pages: PageRef[], opts: Opts = {}) => pool.call<Blob>('assemble', { files, pages }, opts);
export const splitPdf = (file: Blob, groups: number[][], opts: Opts = {}) => pool.call<Blob[]>('split', { file, groups }, opts);
export const writePdfMetadata = (file: Blob, metadata: Partial<PdfMetadata>, removeAll: boolean, opts: Opts = {}) =>
  pool.call<Blob>('metadata', { file, metadata, removeAll }, opts);
export const imagesToPdf = (
  images: Array<{ blob: Blob; type: 'jpg' | 'png' }>,
  options: { pageSize: PageSize; orientation: Orientation; margin: Margin; fit: Fit },
  opts: Opts = {},
) => pool.call<Blob>('images', { images, options }, opts);
export const compressPdf = (file: Blob, preset: CompressPreset, removeMetadata: boolean, opts: Opts = {}) =>
  pool.call<{ blob: Blob; stats: CompressStats }>('compress', { file, preset, removeMetadata }, opts);

export const addPageNumbers = (file: Blob, options: PageNumberOptions, opts: Opts = {}) => pool.call<Blob>('pageNumbers', { file, options }, opts);
export const addPdfWatermark = (file: Blob, options: WatermarkOptions, opts: Opts = {}) =>
  pool.call<{ blob: Blob; replaced: number }>('watermark', { file, options }, opts);
export const cropPdf = (file: Blob, margins: { top: number; right: number; bottom: number; left: number }, opts: Opts = {}) =>
  pool.call<Blob>('crop', { file, margins }, opts);
export const repairPdf = (file: Blob, opts: Opts = {}) => pool.call<{ blob: Blob; pages: number }>('repair', { file }, opts);
export const textToPdf = (text: string, options: TextToPdfOptions, opts: Opts = {}) =>
  pool.call<{ blob: Blob; pages: number; replaced: number }>('fromText', { text, options }, opts);
export const extractPdfImages = (file: Blob, baseName: string, minSize: number, opts: Opts = {}) =>
  pool.call<{ images: ExtractedImage[]; skipped: number; total: number }>('extractImages', { file, baseName, minSize }, opts);

export function terminatePdfWorkers(): void {
  pool.terminateAll();
}
