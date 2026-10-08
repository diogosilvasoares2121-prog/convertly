import { GlobalWorkerOptions, getDocument, PasswordResponses, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { AppError, toAppError } from '../../core/errors';

/**
 * PDF rendering with PDF.js (Apache-2.0), bundled locally.
 * Parsing happens in PDF.js's own worker; fonts, CMaps and WASM decoders are
 * served from the extension (vendor/pdfjs). Scripting and XFA are disabled.
 */
GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfHandle {
  pageCount: number;
  /** Renders a page to an image blob. `scale` 1 = 72 DPI. */
  renderPage(index: number, options: { scale: number; type: 'image/jpeg' | 'image/png'; quality?: number; signal?: AbortSignal }): Promise<{ blob: Blob; width: number; height: number }>;
  /** Page size in PDF points (rotation applied). */
  pageSize(index: number): Promise<{ width: number; height: number }>;
  /** Plain text of a page in reading order (empty for scanned pages without a text layer). */
  pageText(index: number): Promise<string>;
  destroy(): Promise<void>;
}

const MAX_RENDER_PIXELS = 60_000_000;

export async function openPdf(file: Blob, password?: string): Promise<PdfHandle> {
  if (file.size === 0) throw new AppError('empty-file');
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({
    data,
    ...(password !== undefined ? { password } : {}),
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    wasmUrl: '/vendor/pdfjs/wasm/',
    iccUrl: '/vendor/pdfjs/iccs/',
    enableXfa: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  let taskError: AppError | null = null;
  task.onPassword = (_update: (pw: string) => void, reason: number) => {
    taskError = new AppError(reason === PasswordResponses.INCORRECT_PASSWORD ? 'pdf-wrong-password' : 'pdf-encrypted');
    void task.destroy();
  };
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    if (taskError) throw taskError;
    throw toAppError(err);
  }

  return {
    pageCount: doc.numPages,
    async pageSize(index) {
      const page = await doc.getPage(index + 1);
      const vp = page.getViewport({ scale: 1 });
      page.cleanup();
      return { width: vp.width, height: vp.height };
    },
    async pageText(index) {
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      page.cleanup();
      return text.replace(/[ \t]+\n/g, '\n').trim();
    },
    async renderPage(index, { scale, type, quality = 0.92, signal }) {
      if (signal?.aborted) throw new AppError('cancelled');
      const page = await doc.getPage(index + 1);
      let viewport = page.getViewport({ scale });
      const pixels = viewport.width * viewport.height;
      if (pixels > MAX_RENDER_PIXELS) viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_RENDER_PIXELS / pixels) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new AppError('browser-limitation', 'Canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const renderTask = page.render({ canvas, canvasContext: ctx, viewport });
      const abort = () => renderTask.cancel();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        await renderTask.promise;
      } catch (err) {
        if (signal?.aborted) throw new AppError('cancelled');
        throw toAppError(err);
      } finally {
        signal?.removeEventListener('abort', abort);
        page.cleanup();
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      const width = canvas.width;
      const height = canvas.height;
      canvas.width = canvas.height = 0; // release the bitmap memory immediately
      if (!blob) throw new AppError('out-of-memory', 'Canvas export failed');
      return { blob, width, height };
    },
    async destroy() {
      await task.destroy();
    },
  };
}
