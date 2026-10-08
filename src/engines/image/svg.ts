import { AppError } from '../../core/errors';
import type { ImageOutputFormat } from './types';

/**
 * SVG rasterization (main thread: SVG decoding needs the DOM image loader).
 * SVGs are loaded through an <img> from a local blob URL, so embedded scripts never
 * run and external resources are never fetched (also blocked by the CSP).
 */
export interface SvgSize {
  width: number;
  height: number;
}

const UNIT = /^([\d.]+)(px|pt|pc|mm|cm|in)?$/;
const TO_PX: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

function length(value: string | null): number | null {
  if (!value) return null;
  const m = UNIT.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]) * TO_PX[m[2] ?? 'px']!;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Intrinsic size from width/height attributes or the viewBox (default 300×150 like browsers). */
export function svgSize(source: string): SvgSize {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? null;
  const w = length(attr('width'));
  const h = length(attr('height'));
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const vbW = vb && vb.length === 4 && vb[2]! > 0 ? vb[2]! : null;
  const vbH = vb && vb.length === 4 && vb[3]! > 0 ? vb[3]! : null;
  if (w && h) return { width: w, height: h };
  if (w && vbW && vbH) return { width: w, height: (w * vbH) / vbW };
  if (h && vbW && vbH) return { width: (h * vbW) / vbH, height: h };
  if (vbW && vbH) return { width: vbW, height: vbH };
  return { width: 300, height: 150 };
}

/** Ensures the root <svg> has explicit width/height so the browser rasterizes it at the requested size. */
function withSize(source: string, width: number, height: number): string {
  return source.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
    const hasViewBox = /\sviewBox\s*=/i.test(cleaned);
    const size = svgSize(source);
    const viewBox = hasViewBox ? '' : ` viewBox="0 0 ${size.width} ${size.height}"`;
    return `<svg${cleaned} width="${width}" height="${height}"${viewBox}>`;
  });
}

export async function rasterizeSvg(
  file: Blob,
  options: { width: number; height: number; format: ImageOutputFormat; quality: number; background: string | null },
): Promise<Blob> {
  const source = await file.text();
  if (!/<svg[\s>]/i.test(source)) throw new AppError('corrupted-file', 'Not an SVG document');
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  if (width > 16384 || height > 16384) throw new AppError('browser-limitation', 'Maximum size is 16384 px');
  const blob = new Blob([withSize(source, width, height)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new AppError('corrupted-file', 'The SVG could not be rendered');
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    const bg = options.background ?? (options.format === 'jpg' ? '#ffffff' : null);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[options.format];
    const out = await canvas.convertToBlob(options.format === 'png' ? { type } : { type, quality: options.quality });
    canvas.width = canvas.height = 0;
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
