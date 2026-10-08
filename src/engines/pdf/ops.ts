import {
  PDFDict,
  PDFDocument,
  PDFName,
  clip,
  degrees,
  endPath,
  EncryptedPDFError,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFPage,
} from 'pdf-lib';
import { AppError } from '../../core/errors';

/**
 * Structural PDF operations with pdf-lib (MIT). Pure functions over bytes:
 * they run inside the PDF worker and in unit tests (Node).
 */

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string | null;
  modificationDate: string | null;
}

export interface PdfInspection {
  pageCount: number;
  metadata: PdfMetadata;
  hasXmpMetadata: boolean;
  pageSizes: Array<{ width: number; height: number }>;
}

export interface PageRef {
  /** Index into the `sources` array, or -1 for a new blank page. */
  src: number;
  /** Size of a blank page in points (defaults to A4). */
  size?: [number, number];
  /** Zero-based page index in that source. */
  index: number;
  /** Additional clockwise rotation in degrees (multiple of 90). */
  rotate?: number;
}

const PRODUCER = 'Convertly';

export async function loadPdf(bytes: Uint8Array | ArrayBuffer): Promise<PDFDocument> {
  if ((bytes as ArrayBuffer).byteLength === 0) throw new AppError('empty-file');
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    // A readable catalog and page tree is required; broken files fail here, not later.
    if (doc.getPageCount() < 1) throw new AppError('corrupted-file', 'The PDF has no pages');
    return doc;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof EncryptedPDFError || (err instanceof Error && /encrypt/i.test(err.message))) {
      throw new AppError('pdf-encrypted');
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('corrupted-file', message);
  }
}

function newDocument(): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false });
}

function stamp(doc: PDFDocument): void {
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

function iso(date: Date | undefined): string | null {
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export async function inspectPdf(bytes: Uint8Array | ArrayBuffer): Promise<PdfInspection> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  return {
    pageCount: pages.length,
    metadata: {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: doc.getKeywords() ?? '',
      creator: doc.getCreator() ?? '',
      producer: doc.getProducer() ?? '',
      creationDate: iso(doc.getCreationDate()),
      modificationDate: iso(doc.getModificationDate()),
    },
    hasXmpMetadata: doc.catalog.has(PDFName.of('Metadata')),
    pageSizes: pages.slice(0, 1000).map((p) => {
      const { width, height } = p.getSize();
      const rotation = p.getRotation().angle % 180 !== 0;
      return rotation ? { width: height, height: width } : { width, height };
    }),
  };
}

function rotatePage(page: PDFPage, extra: number): void {
  if (!extra) return;
  const current = page.getRotation().angle;
  page.setRotation(degrees((((current + extra) % 360) + 360) % 360));
}

/** Builds a new PDF from an ordered list of pages taken from one or more sources. */
export async function assemblePdf(
  sources: Array<Uint8Array | ArrayBuffer>,
  pages: PageRef[],
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  if (!pages.length) throw new AppError('invalid-input', 'No pages selected');
  const out = await newDocument();
  const loaded = new Map<number, PDFDocument>();
  const needed = [...new Set(pages.filter((p) => p.src >= 0).map((p) => p.src))];
  for (const [i, src] of needed.entries()) {
    const bytes = sources[src];
    if (!bytes) throw new AppError('invalid-input', `Missing source ${src}`);
    loaded.set(src, await loadPdf(bytes));
    onProgress?.(((i + 1) / needed.length) * 0.4);
  }
  // Copy pages per source in one call (shared resources are copied once), then order them.
  const copies = new Map<string, PDFPage>();
  for (const src of needed) {
    const doc = loaded.get(src)!;
    const indexes = [...new Set(pages.filter((p) => p.src === src).map((p) => p.index))];
    for (const index of indexes) {
      if (index < 0 || index >= doc.getPageCount()) throw new AppError('invalid-input', `Page ${index + 1} does not exist`);
    }
    const copied = await out.copyPages(doc, indexes);
    indexes.forEach((index, k) => copies.set(`${src}:${index}`, copied[k]!));
  }
  const used = new Set<string>();
  for (const [k, ref] of pages.entries()) {
    if (ref.src < 0) {
      const blank = out.addPage(ref.size ?? [595.28, 841.89]);
      rotatePage(blank, ref.rotate ?? 0);
      continue;
    }
    const key = `${ref.src}:${ref.index}`;
    let page = copies.get(key)!;
    if (used.has(key)) {
      // Duplicated page: copy again so each instance can have its own rotation.
      [page] = await out.copyPages(loaded.get(ref.src)!, [ref.index]) as [PDFPage];
    }
    used.add(key);
    out.addPage(page);
    rotatePage(page, ref.rotate ?? 0);
    if (k % 20 === 0) onProgress?.(0.4 + (k / pages.length) * 0.4);
  }
  stamp(out);
  onProgress?.(0.85);
  const bytes = await save(out);
  onProgress?.(1);
  return bytes;
}

export async function mergePdfs(sources: Array<Uint8Array | ArrayBuffer>, onProgress?: (p: number) => void): Promise<Uint8Array> {
  if (sources.length < 1) throw new AppError('invalid-input', 'No PDFs to merge');
  const out = await newDocument();
  for (const [i, bytes] of sources.entries()) {
    const doc = await loadPdf(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const p of pages) out.addPage(p);
    onProgress?.(((i + 1) / sources.length) * 0.85);
  }
  stamp(out);
  const result = await save(out);
  onProgress?.(1);
  return result;
}

/** Splits one PDF into several, one per group of zero-based page indexes. */
export async function splitPdf(
  source: Uint8Array | ArrayBuffer,
  groups: number[][],
  onProgress?: (p: number) => void,
): Promise<Uint8Array[]> {
  const doc = await loadPdf(source);
  const count = doc.getPageCount();
  const results: Uint8Array[] = [];
  for (const [i, group] of groups.entries()) {
    if (!group.length) continue;
    for (const index of group) {
      if (index < 0 || index >= count) throw new AppError('invalid-input', `Page ${index + 1} does not exist`);
    }
    const out = await newDocument();
    const pages = await out.copyPages(doc, group);
    for (const p of pages) out.addPage(p);
    stamp(out);
    results.push(await save(out));
    onProgress?.((i + 1) / groups.length);
  }
  return results;
}

/** Updates or removes document metadata (Info dictionary + XMP stream). */
export async function writePdfMetadata(
  source: Uint8Array | ArrayBuffer,
  metadata: Partial<Pick<PdfMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>>,
  removeAll: boolean,
): Promise<Uint8Array> {
  const doc = await loadPdf(source);
  if (removeAll) {
    const infoRef = doc.context.trailerInfo.Info;
    const info = infoRef ? doc.context.lookupMaybe(infoRef, PDFDict) : undefined;
    if (info) for (const key of info.keys()) info.delete(key);
    doc.catalog.delete(PDFName.of('Metadata'));
    // Page-level and image-level XMP metadata streams.
    for (const page of doc.getPages()) page.node.delete(PDFName.of('Metadata'));
  } else {
    if (metadata.title !== undefined) doc.setTitle(metadata.title);
    if (metadata.author !== undefined) doc.setAuthor(metadata.author);
    if (metadata.subject !== undefined) doc.setSubject(metadata.subject);
    if (metadata.keywords !== undefined) doc.setKeywords(metadata.keywords ? metadata.keywords.split(/\s*[,;]\s*/).filter(Boolean) : []);
    if (metadata.creator !== undefined) doc.setCreator(metadata.creator);
    if (metadata.producer !== undefined) doc.setProducer(metadata.producer);
    doc.setModificationDate(new Date());
  }
  return save(doc);
}

export type PageSize = 'auto' | 'a4' | 'letter';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type Margin = 'none' | 'small' | 'medium';
export type Fit = 'contain' | 'cover' | 'original';

export interface PdfImage {
  bytes: Uint8Array;
  type: 'jpg' | 'png';
  width?: number;
  height?: number;
}

const SIZES: Record<Exclude<PageSize, 'auto'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const MARGINS: Record<Margin, number> = { none: 0, small: 18, medium: 36 };

/** Creates a PDF with one image per page. Images are embedded as-is (no re-compression). */
export async function imagesToPdf(
  images: PdfImage[],
  options: { pageSize: PageSize; orientation: Orientation; margin: Margin; fit: Fit },
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  if (!images.length) throw new AppError('invalid-input', 'No images');
  const doc = await newDocument();
  for (const [i, img] of images.entries()) {
    const embedded = img.type === 'jpg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
    // Image pixels → points at 96 DPI so "original" size looks natural on screen and paper.
    const imgW = (embedded.width * 72) / 96;
    const imgH = (embedded.height * 72) / 96;
    const margin = MARGINS[options.margin];
    let pageW: number;
    let pageH: number;
    if (options.pageSize === 'auto') {
      pageW = imgW + margin * 2;
      pageH = imgH + margin * 2;
      if (options.orientation === 'portrait' && pageW > pageH) [pageW, pageH] = [pageH, pageW];
      if (options.orientation === 'landscape' && pageH > pageW) [pageW, pageH] = [pageH, pageW];
    } else {
      [pageW, pageH] = SIZES[options.pageSize];
      const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && embedded.width > embedded.height);
      if (landscape) [pageW, pageH] = [pageH, pageW];
    }
    const page = doc.addPage([pageW, pageH]);
    const boxW = Math.max(1, pageW - margin * 2);
    const boxH = Math.max(1, pageH - margin * 2);
    let drawW: number;
    let drawH: number;
    if (options.fit === 'original') {
      const shrink = Math.min(1, boxW / imgW, boxH / imgH);
      drawW = imgW * shrink;
      drawH = imgH * shrink;
    } else {
      const ratio = options.fit === 'cover' ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH);
      drawW = imgW * ratio;
      drawH = imgH * ratio;
    }
    const x = margin + (boxW - drawW) / 2;
    const y = margin + (boxH - drawH) / 2;
    if (options.fit === 'cover') {
      // Clip to the margin box so "cover" never bleeds into the margins.
      page.pushOperators(pushGraphicsState(), rectangle(margin, margin, boxW, boxH), clip(), endPath());
      page.drawImage(embedded, { x, y, width: drawW, height: drawH });
      page.pushOperators(popGraphicsState());
    } else {
      page.drawImage(embedded, { x, y, width: drawW, height: drawH });
    }
    onProgress?.((i + 1) / images.length);
  }
  stamp(doc);
  return save(doc);
}
