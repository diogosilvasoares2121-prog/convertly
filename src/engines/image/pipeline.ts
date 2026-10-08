import { AppError } from '../../core/errors';
import { isAnimatedImage } from '../../core/detect';
import type { FormatId } from '../../registry/formats';
import { decodeHeic } from '../heic/decode';
import { decodeTiff } from './tiff';
import { readMetadata, stripJpeg, stripPng, stripWebp } from './metadata';
import { rotatedSize } from './geometry';
import type { CombineRequest, ImageInfo, ImageOps, ImageOutputFormat, OutputSpec, ProcessResult, StripResult, WatermarkSpec } from './types';

/**
 * Image pipeline executed inside a Web Worker:
 * decode → (rotate/flip → crop → resize) → encode.
 * Uses OffscreenCanvas so the UI thread is never blocked.
 */

const MAX_DIMENSION = 32_767;
const MAX_PIXELS = 268_000_000; // Chrome canvas area limit

export const MIME: Record<ImageOutputFormat, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export interface DecodedImage {
  source: ImageBitmap | OffscreenCanvas;
  width: number;
  height: number;
  firstFrameOnly: boolean;
  firstPageOnly: boolean;
  close(): void;
}

function imageDataToCanvas(image: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('browser-limitation', 'Canvas 2D unavailable');
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function decodeImage(file: Blob, format: FormatId): Promise<DecodedImage> {
  if (file.size === 0) throw new AppError('empty-file');
  if (format === 'heic') {
    const { image } = await decodeHeic(new Uint8Array(await file.arrayBuffer()));
    const canvas = imageDataToCanvas(image);
    return {
      source: canvas,
      width: canvas.width,
      height: canvas.height,
      firstFrameOnly: false,
      firstPageOnly: false,
      close: () => {
        canvas.width = canvas.height = 0;
      },
    };
  }
  if (format === 'tiff') {
    const { image, pages } = decodeTiff(await file.arrayBuffer());
    const canvas = imageDataToCanvas(image);
    return {
      source: canvas,
      width: canvas.width,
      height: canvas.height,
      firstFrameOnly: false,
      firstPageOnly: pages > 1,
      close: () => {
        canvas.width = canvas.height = 0;
      },
    };
  }
  let bitmap: ImageBitmap;
  try {
    // 'from-image' applies the EXIF orientation so photos come out upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    throw new AppError('corrupted-file', err instanceof Error ? err.message : 'decode failed');
  }
  const animated = format === 'gif' || format === 'webp' || format === 'png' ? await isAnimatedImage(file, format) : false;
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    firstFrameOnly: animated,
    firstPageOnly: false,
    close: () => bitmap.close(),
  };
}

function assertCanvasSize(width: number, height: number): void {
  if (width < 1 || height < 1) throw new AppError('invalid-input', 'Output size must be at least 1×1 px');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new AppError('browser-limitation', `Output of ${width}×${height} px exceeds the browser canvas limit`);
  }
}

/** Applies rotate/flip → crop → resize and returns a canvas ready for encoding. */
export function render(decoded: DecodedImage, ops: ImageOps, opaque: boolean): OffscreenCanvas {
  const degrees = ops.rotate ?? 0;
  const oriented = rotatedSize(decoded.width, decoded.height, degrees);
  const crop = ops.crop
    ? {
        x: Math.max(0, Math.round(ops.crop.x)),
        y: Math.max(0, Math.round(ops.crop.y)),
        width: Math.round(Math.min(ops.crop.width, oriented.width - Math.max(0, ops.crop.x))),
        height: Math.round(Math.min(ops.crop.height, oriented.height - Math.max(0, ops.crop.y))),
      }
    : { x: 0, y: 0, width: oriented.width, height: oriented.height };
  let outW = Math.round(ops.resize?.width ?? crop.width);
  let outH = Math.round(ops.resize?.height ?? crop.height);
  if (!ops.resize && ops.fit) {
    let s = 1;
    if (ops.fit.percent) s = ops.fit.percent / 100;
    else {
      const sx = ops.fit.maxWidth ? ops.fit.maxWidth / crop.width : Infinity;
      const sy = ops.fit.maxHeight ? ops.fit.maxHeight / crop.height : Infinity;
      s = Math.min(sx, sy);
      if (!Number.isFinite(s)) s = 1;
      if (!ops.fit.allowEnlarge) s = Math.min(1, s);
    }
    outW = Math.max(1, Math.round(crop.width * s));
    outH = Math.max(1, Math.round(crop.height * s));
  }
  assertCanvasSize(outW, outH);
  assertCanvasSize(crop.width, crop.height);

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('browser-limitation', 'Canvas 2D unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Large downscales look better when done in steps of at most 2×.
  let source: ImageBitmap | OffscreenCanvas = decoded.source;
  let srcW = decoded.width;
  let srcH = decoded.height;
  const scale = Math.min(outW / crop.width, outH / crop.height);
  let temp: OffscreenCanvas | null = null;
  if (scale < 0.5 && !ops.crop && degrees === 0 && !ops.flipH && !ops.flipV) {
    while (srcW * 0.5 > outW * 1.01 && srcH * 0.5 > outH * 1.01) {
      const w = Math.max(1, Math.round(srcW * 0.5));
      const h = Math.max(1, Math.round(srcH * 0.5));
      const step = new OffscreenCanvas(w, h);
      const sctx = step.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(source, 0, 0, w, h);
      if (temp) temp.width = temp.height = 0;
      temp = step;
      source = step;
      srcW = w;
      srcH = h;
    }
  }

  ctx.save();
  const blur = ops.blurPct ? ` blur(${((Math.min(outW, outH) * Math.min(10, ops.blurPct)) / 100).toFixed(2)}px)` : '';
  if (ops.filter || blur) ctx.filter = `${ops.filter ?? ''}${blur}`.trim();
  ctx.scale(outW / crop.width, outH / crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(oriented.width / 2, oriented.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.scale(ops.flipH ? -1 : 1, ops.flipV ? -1 : 1);
  ctx.drawImage(source, -decoded.width / 2, -decoded.height / 2, decoded.width, decoded.height);
  ctx.restore();
  if (temp) temp.width = temp.height = 0;

  if (ops.watermark?.text.trim()) drawWatermark(ctx, outW, outH, ops.watermark);
  if (ops.shape) applyShape(ctx, outW, outH, ops.shape);
  if (opaque || ops.background) {
    // Fill behind the image: transparent areas (PNG alpha, rotated corners, shapes) get the background.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = ops.background ?? '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.restore();
  }
  if (ops.frame) return placeInFrame(canvas, ops.frame, opaque);
  return canvas;
}

function applyShape(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, shape: NonNullable<ImageOps['shape']>): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  if (shape.kind === 'circle') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    const r = (Math.min(w, h) * Math.min(50, Math.max(0, shape.radiusPct ?? 12))) / 100;
    ctx.roundRect(0, 0, w, h, r);
  }
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

const POSITIONS: Record<Exclude<WatermarkSpec['position'], 'tile'>, [number, number]> = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
};

export function drawWatermark(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, wm: WatermarkSpec): void {
  const size = Math.max(8, Math.round((Math.min(w, h) * Math.min(30, Math.max(1, wm.sizePct))) / 100));
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0.05, wm.opacity));
  ctx.fillStyle = wm.color;
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // A thin contrasting outline keeps the mark readable on any background.
  ctx.lineWidth = Math.max(1, size / 24);
  ctx.strokeStyle = wm.color.toLowerCase() === '#000000' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
  const text = wm.text.trim();
  const textW = ctx.measureText(text).width;
  const angle = ((wm.angle ?? (wm.position === 'tile' ? -30 : 0)) * Math.PI) / 180;
  if (wm.position === 'tile') {
    const stepX = textW + size * 3;
    const stepY = size * 4;
    const diag = Math.hypot(w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    for (let y = -diag; y <= diag; y += stepY) {
      const offset = (Math.round(y / stepY) % 2) * (stepX / 2);
      for (let x = -diag; x <= diag; x += stepX) {
        ctx.strokeText(text, x + offset, y);
        ctx.fillText(text, x + offset, y);
      }
    }
  } else {
    const [fx, fy] = POSITIONS[wm.position];
    const margin = size * 0.9;
    const x = fx === 0 ? margin + textW / 2 : fx === 1 ? w - margin - textW / 2 : w / 2;
    const y = fy === 0 ? margin + size / 2 : fy === 1 ? h - margin - size / 2 : h / 2;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

function placeInFrame(image: OffscreenCanvas, frame: NonNullable<ImageOps['frame']>, opaque: boolean): OffscreenCanvas {
  assertCanvasSize(frame.width, frame.height);
  const out = new OffscreenCanvas(frame.width, frame.height);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (frame.background || opaque) {
    ctx.fillStyle = frame.background ?? '#ffffff';
    ctx.fillRect(0, 0, frame.width, frame.height);
  }
  const ratio = frame.fit === 'cover' ? Math.max(frame.width / image.width, frame.height / image.height) : Math.min(frame.width / image.width, frame.height / image.height);
  const w = image.width * ratio;
  const h = image.height * ratio;
  ctx.drawImage(image, (frame.width - w) / 2, (frame.height - h) / 2, w, h);
  image.width = image.height = 0;
  return out;
}

/** Combines several images into one (side by side, stacked or in a grid). */
export async function combineImages(req: CombineRequest, onProgress: (p: number | null) => void): Promise<ProcessResult> {
  if (req.files.length < 2) throw new AppError('invalid-input', 'Add at least two images');
  const decoded: DecodedImage[] = [];
  try {
    for (const [i, f] of req.files.entries()) {
      decoded.push(await decodeImage(f.file, f.format));
      onProgress(((i + 1) / req.files.length) * 0.6);
    }
    const cols = req.layout === 'horizontal' ? decoded.length : req.layout === 'vertical' ? 1 : Math.max(1, Math.min(decoded.length, Math.round(req.columns)));
    const rows = Math.ceil(decoded.length / cols);
    // Target cell size: equalize to the median-ish reference (first image) dimension.
    const ref = decoded[0]!;
    const sizes = decoded.map((d) => {
      if (!req.equalize) return { w: d.width, h: d.height };
      if (req.layout === 'horizontal') return { w: Math.round((d.width * ref.height) / d.height), h: ref.height };
      return { w: ref.width, h: Math.round((d.height * ref.width) / d.width) };
    });
    const colW = Array.from({ length: cols }, (_, c) => Math.max(...sizes.filter((_, i) => i % cols === c).map((s) => s.w)));
    const rowH = Array.from({ length: rows }, (_, r) => Math.max(...sizes.slice(r * cols, r * cols + cols).map((s) => s.h)));
    const gap = Math.max(0, Math.round(req.gap));
    const width = colW.reduce((a, b) => a + b, 0) + gap * (cols + 1);
    const height = rowH.reduce((a, b) => a + b, 0) + gap * (rows + 1);
    assertCanvasSize(width, height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    if (req.background !== 'transparent' || req.output.format === 'jpg') {
      ctx.fillStyle = req.background === 'transparent' ? '#ffffff' : req.background;
      ctx.fillRect(0, 0, width, height);
    }
    let y = gap;
    for (let r = 0; r < rows; r++) {
      let x = gap;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const d = decoded[i];
        if (d) {
          const s = sizes[i]!;
          ctx.drawImage(d.source, x + (colW[c]! - s.w) / 2, y + (rowH[r]! - s.h) / 2, s.w, s.h);
        }
        x += colW[c]! + gap;
      }
      y += rowH[r]! + gap;
    }
    onProgress(0.8);
    const result = await encodeWithTarget(canvas, req.output);
    canvas.width = canvas.height = 0;
    onProgress(1);
    return { blob: result.blob, width: result.width, height: result.height, quality: result.quality };
  } finally {
    for (const d of decoded) d.close();
  }
}

/** Splits an image into a rows × cols grid of tiles. */
export async function splitImage(
  file: Blob,
  format: FormatId,
  rows: number,
  cols: number,
  output: OutputSpec,
  onProgress: (p: number | null) => void,
): Promise<Array<{ blob: Blob; row: number; col: number; width: number; height: number }>> {
  const r = Math.max(1, Math.min(20, Math.round(rows)));
  const c = Math.max(1, Math.min(20, Math.round(cols)));
  const decoded = await decodeImage(file, format);
  try {
    const out: Array<{ blob: Blob; row: number; col: number; width: number; height: number }> = [];
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < c; x++) {
        const x0 = Math.round((x * decoded.width) / c);
        const y0 = Math.round((y * decoded.height) / r);
        const x1 = Math.round(((x + 1) * decoded.width) / c);
        const y1 = Math.round(((y + 1) * decoded.height) / r);
        const canvas = new OffscreenCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        const ctx = canvas.getContext('2d')!;
        if (output.format === 'jpg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(decoded.source, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        const blob = await encode(canvas, output.format, output.quality);
        out.push({ blob, row: y + 1, col: x + 1, width: canvas.width, height: canvas.height });
        canvas.width = canvas.height = 0;
        onProgress(out.length / (r * c));
      }
    }
    return out;
  } finally {
    decoded.close();
  }
}

async function encode(canvas: OffscreenCanvas, format: ImageOutputFormat, quality: number): Promise<Blob> {
  const type = MIME[format];
  const blob = await canvas.convertToBlob(format === 'png' ? { type } : { type, quality });
  if (blob.type !== type) throw new AppError('unsupported-format', `This browser cannot encode ${format.toUpperCase()}`);
  return blob;
}

/** Encodes with an optional target size: binary-searches quality, then (optionally) dimensions. */
export async function encodeWithTarget(
  canvas: OffscreenCanvas,
  spec: OutputSpec,
  onProgress?: (p: number) => void,
): Promise<{ blob: Blob; quality: number; targetReached?: boolean; width: number; height: number }> {
  const lossy = spec.format !== 'png';
  if (!spec.targetBytes || !lossy) {
    const blob = await encode(canvas, spec.format, spec.quality);
    return { blob, quality: spec.quality, width: canvas.width, height: canvas.height };
  }
  const target = spec.targetBytes;
  let current = canvas;
  for (let attempt = 0; attempt < 6; attempt++) {
    let lo = 0.05;
    let hi = Math.max(lo, Math.min(1, spec.quality));
    let best: { blob: Blob; quality: number } | null = null;
    const first = await encode(current, spec.format, hi);
    if (first.size <= target) return { blob: first, quality: hi, targetReached: true, width: current.width, height: current.height };
    let smallest = first;
    let smallestQ = hi;
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      const blob = await encode(current, spec.format, q);
      onProgress?.(0.5 + (attempt * 7 + i) / 84);
      if (blob.size < smallest.size) {
        smallest = blob;
        smallestQ = q;
      }
      if (blob.size <= target) {
        best = { blob, quality: q };
        lo = q;
      } else hi = q;
    }
    if (best) return { ...best, targetReached: true, width: current.width, height: current.height };
    if (!spec.allowDownscale) {
      return { blob: smallest, quality: smallestQ, targetReached: false, width: current.width, height: current.height };
    }
    // Shrink dimensions proportionally to the overshoot and try again.
    const factor = Math.max(0.3, Math.min(0.9, Math.sqrt(target / smallest.size) * 0.95));
    const w = Math.max(1, Math.round(current.width * factor));
    const h = Math.max(1, Math.round(current.height * factor));
    const next = new OffscreenCanvas(w, h);
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, w, h);
    if (current !== canvas) current.width = current.height = 0;
    current = next;
    if (attempt === 5) {
      const blob = await encode(current, spec.format, 0.05);
      return { blob, quality: 0.05, targetReached: blob.size <= target, width: w, height: h };
    }
  }
  throw new AppError('target-unreachable');
}

export async function processImage(
  file: Blob,
  format: FormatId,
  ops: ImageOps,
  output: OutputSpec,
  onProgress: (p: number | null) => void,
): Promise<ProcessResult> {
  onProgress(0.05);
  const decoded = await decodeImage(file, format);
  onProgress(0.35);
  try {
    const canvas = render(decoded, ops, output.format === 'jpg');
    onProgress(0.55);
    const result = await encodeWithTarget(canvas, output, (p) => onProgress(p));
    canvas.width = canvas.height = 0;
    onProgress(1);
    return {
      blob: result.blob,
      width: result.width,
      height: result.height,
      quality: result.quality,
      ...(result.targetReached !== undefined ? { targetReached: result.targetReached } : {}),
      ...(decoded.firstFrameOnly ? { firstFrameOnly: true } : {}),
      ...(decoded.firstPageOnly ? { firstPageOnly: true } : {}),
    };
  } finally {
    decoded.close();
  }
}

/** Dimensions, animation flag and metadata (EXIF/GPS/XMP/ICC…). */
export async function imageInfo(file: Blob, format: FormatId): Promise<ImageInfo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = readMetadata(bytes, format);
  const decoded = await decodeImage(file, format);
  try {
    return { width: decoded.width, height: decoded.height, animated: decoded.firstFrameOnly, metadata };
  } finally {
    decoded.close();
  }
}

/** Small preview for formats <img> cannot display (HEIC, TIFF). */
export async function thumbnail(file: Blob, format: FormatId, maxSize: number): Promise<Blob> {
  const decoded = await decodeImage(file, format);
  try {
    const scale = Math.min(1, maxSize / Math.max(decoded.width, decoded.height));
    const canvas = render(decoded, { resize: { width: Math.max(1, Math.round(decoded.width * scale)), height: Math.max(1, Math.round(decoded.height * scale)) } }, false);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    canvas.width = canvas.height = 0;
    return blob;
  } finally {
    decoded.close();
  }
}

/**
 * Removes metadata. JPEG/PNG/WebP are cleaned byte-for-byte (no quality loss);
 * other formats are re-encoded, which inherently drops all metadata.
 */
export async function stripMetadata(file: Blob, format: FormatId, fallback: ImageOutputFormat, quality: number): Promise<StripResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const report = readMetadata(bytes, format);
  const orientationMatters = report.orientation !== null && report.orientation !== 1;
  if (!orientationMatters) {
    const stripped = format === 'jpg' ? stripJpeg(bytes) : format === 'png' ? stripPng(bytes) : format === 'webp' ? stripWebp(bytes) : null;
    if (stripped) {
      const type = format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp';
      return { blob: new Blob([stripped.data as BlobPart], { type }), lossless: true, removed: stripped.removed, outputFormat: format };
    }
  }
  // Re-encode: keeps the visual orientation, drops every metadata block.
  const outFormat: ImageOutputFormat = format === 'jpg' || format === 'png' || format === 'webp' ? format : fallback;
  const decoded = await decodeImage(file, format);
  try {
    const canvas = render(decoded, {}, outFormat === 'jpg');
    const blob = await encode(canvas, outFormat, quality);
    canvas.width = canvas.height = 0;
    const removed = [
      report.hasExif ? 'EXIF' : '',
      report.hasGps ? 'GPS' : '',
      report.hasXmp ? 'XMP' : '',
      report.hasIptc ? 'IPTC' : '',
      report.hasComments ? 'Comments' : '',
    ].filter(Boolean);
    return { blob, lossless: false, removed, outputFormat: outFormat };
  } finally {
    decoded.close();
  }
}
