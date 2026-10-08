import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { AppError } from '../../core/errors';
import { loadPdf } from './ops';

/**
 * PDF editing operations (pdf-lib, run in the PDF worker): page numbers, text
 * watermarks, margin cropping, structural repair and text → PDF.
 */

// Characters the standard PDF fonts (WinAnsiEncoding) can draw in addition to Latin-1.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Replaces characters the standard fonts cannot encode (emoji, CJK…) with "?". */
export function toWinAnsi(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\t') out += '    ';
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else {
      out += '?';
      replaced++;
    }
  }
  return { text: out, replaced };
}

function hexColor(hex: string): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });

/** Visible page size taking /Rotate into account. */
function visualSize(page: PDFPage): { width: number; height: number; rotation: number } {
  const { width, height } = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  return rotation % 180 === 0 ? { width, height, rotation } : { width: height, height: width, rotation };
}

/**
 * Draws text at a position given in *visual* coordinates (as the reader sees the page),
 * converting to the page's own coordinate system when the page is rotated.
 */
function drawVisualText(page: PDFPage, text: string, font: PDFFont, size: number, vx: number, vy: number, color: ReturnType<typeof rgb>, opacity: number, extraAngle = 0): void {
  const { width, height } = page.getSize();
  const { rotation } = visualSize(page);
  let x = vx;
  let y = vy;
  if (rotation === 90) {
    x = width - vy;
    y = vx;
  } else if (rotation === 180) {
    x = width - vx;
    y = height - vy;
  } else if (rotation === 270) {
    x = vy;
    y = height - vx;
  }
  page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(rotation + extraAngle) });
}

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
export type NumberFormat = 'n' | 'page-n' | 'n-of-total' | 'page-n-of-total';

export interface PageNumberOptions {
  position: NumberPosition;
  format: NumberFormat;
  start: number;
  fontSize: number;
  margin: number;
  skipFirst: boolean;
  color: string;
  /** Localised word for "Page" and "of". */
  pageWord: string;
  ofWord: string;
}

export async function addPageNumbers(source: Uint8Array, o: PageNumberOptions): Promise<Uint8Array> {
  const doc = await loadPdf(source);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const numbered = o.skipFirst ? pages.length - 1 : pages.length;
  const total = numbered + Math.max(1, Math.round(o.start)) - 1;
  const color = hexColor(o.color);
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const n = Math.max(1, Math.round(o.start)) + i - (o.skipFirst ? 1 : 0);
    const label = toWinAnsi(
      o.format === 'n' ? `${n}` : o.format === 'page-n' ? `${o.pageWord} ${n}` : o.format === 'n-of-total' ? `${n} / ${total}` : `${o.pageWord} ${n} ${o.ofWord} ${total}`,
    ).text;
    const { width, height } = visualSize(page);
    const textW = font.widthOfTextAtSize(label, o.fontSize);
    const x = o.position.endsWith('left') ? o.margin : o.position.endsWith('right') ? width - o.margin - textW : (width - textW) / 2;
    const y = o.position.startsWith('top') ? height - o.margin - o.fontSize : o.margin;
    drawVisualText(page, label, font, o.fontSize, x, y, color, 1);
  });
  return save(doc);
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  opacity: number;
  color: string;
  /** 'diagonal' across the page, 'center' horizontal, or 'tile' repeated. */
  layout: 'diagonal' | 'center' | 'tile';
}

export async function addPdfWatermark(source: Uint8Array, o: WatermarkOptions): Promise<{ bytes: Uint8Array; replaced: number }> {
  const { text, replaced } = toWinAnsi(o.text.trim());
  if (!text) throw new AppError('invalid-input', 'Enter the watermark text');
  const doc = await loadPdf(source);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const color = hexColor(o.color);
  for (const page of doc.getPages()) {
    const { width, height } = visualSize(page);
    const textW = font.widthOfTextAtSize(text, o.fontSize);
    if (o.layout === 'tile') {
      const stepX = textW + o.fontSize * 3;
      const stepY = o.fontSize * 5;
      for (let y = -height; y < height * 2; y += stepY) {
        for (let x = -width; x < width * 2; x += stepX) drawVisualText(page, text, font, o.fontSize, x, y, color, o.opacity, 30);
      }
    } else {
      const angle = o.layout === 'diagonal' ? (Math.atan2(height, width) * 180) / Math.PI : 0;
      const rad = (angle * Math.PI) / 180;
      // Center the rotated text box on the page.
      const x = width / 2 - (Math.cos(rad) * textW) / 2 + (Math.sin(rad) * o.fontSize) / 3;
      const y = height / 2 - (Math.sin(rad) * textW) / 2 - (Math.cos(rad) * o.fontSize) / 3;
      drawVisualText(page, text, font, o.fontSize, x, y, color, o.opacity, angle);
    }
  }
  return { bytes: await save(doc), replaced };
}

/** Crops every page by the given margins (in PDF points), via the CropBox. */
export async function cropPdf(source: Uint8Array, margins: { top: number; right: number; bottom: number; left: number }): Promise<Uint8Array> {
  const doc = await loadPdf(source);
  for (const page of doc.getPages()) {
    const box = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    // Margins are given as the reader sees the page; map them to the unrotated box.
    const m =
      rotation === 90
        ? { left: margins.bottom, bottom: margins.right, right: margins.top, top: margins.left }
        : rotation === 180
          ? { left: margins.right, bottom: margins.top, right: margins.left, top: margins.bottom }
          : rotation === 270
            ? { left: margins.top, bottom: margins.left, right: margins.bottom, top: margins.right }
            : margins;
    const width = box.width - m.left - m.right;
    const height = box.height - m.top - m.bottom;
    if (width < 10 || height < 10) throw new AppError('invalid-input', 'The margins are larger than the page');
    page.setCropBox(box.x + m.left, box.y + m.bottom, width, height);
    page.setTrimBox(box.x + m.left, box.y + m.bottom, width, height);
  }
  return save(doc);
}

/** Re-parses a damaged PDF leniently and writes a clean file with a rebuilt cross-reference table. */
export async function repairPdf(source: Uint8Array): Promise<{ bytes: Uint8Array; pages: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) throw new AppError('pdf-encrypted');
    throw new AppError('corrupted-file', err instanceof Error ? err.message : String(err));
  }
  let pages = 0;
  try {
    pages = doc.getPageCount();
  } catch {
    pages = 0;
  }
  if (!pages) throw new AppError('corrupted-file', 'No readable pages were found');
  // Copy readable pages into a fresh document: drops broken objects and orphans.
  const out = await PDFDocument.create({ updateMetadata: false });
  const indices: number[] = [];
  for (let i = 0; i < pages; i++) indices.push(i);
  const copied = await out.copyPages(doc, indices);
  for (const p of copied) out.addPage(p);
  out.setProducer('Convertly');
  return { bytes: await save(out), pages };
}

export interface TextToPdfOptions {
  pageSize: 'a4' | 'letter';
  fontSize: number;
  margin: number;
  font: 'sans' | 'serif' | 'mono';
  title: string;
}

/** Lays out plain text on pages with word wrapping. */
export async function textToPdf(text: string, o: TextToPdfOptions): Promise<{ bytes: Uint8Array; pages: number; replaced: number }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(o.font === 'serif' ? StandardFonts.TimesRoman : o.font === 'mono' ? StandardFonts.Courier : StandardFonts.Helvetica);
  const [pw, ph] = o.pageSize === 'letter' ? [612, 792] : [595.28, 841.89];
  const size = Math.max(6, Math.min(36, o.fontSize));
  const lineHeight = size * 1.35;
  const maxW = pw - o.margin * 2;
  const { text: safe, replaced } = toWinAnsi(text.replace(/\r\n?/g, '\n'));
  const lines: string[] = [];
  for (const paragraph of safe.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) {
        line = candidate;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      // Very long words are broken by characters.
      let rest = word.trimStart();
      while (font.widthOfTextAtSize(rest, size) > maxW) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxW) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line.trimEnd());
  }
  const perPage = Math.max(1, Math.floor((ph - o.margin * 2) / lineHeight));
  let pages = 0;
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
    const page = doc.addPage([pw, ph]);
    pages++;
    lines.slice(i, i + perPage).forEach((l, k) => {
      if (l) page.drawText(l, { x: o.margin, y: ph - o.margin - size - k * lineHeight, size, font, color: rgb(0.08, 0.1, 0.13) });
    });
  }
  if (o.title) doc.setTitle(o.title);
  doc.setProducer('Convertly');
  doc.setCreator('Convertly');
  return { bytes: await save(doc), pages, replaced };
}
