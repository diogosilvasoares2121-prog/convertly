import type { ImageOps } from './types';

/** Colour adjustments (percentages / degrees), applied as a canvas filter in the worker. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  grayscale: number;
  sepia: number;
  invert: number;
  blur: number;
}

export const NEUTRAL: Adjustments = { brightness: 100, contrast: 100, saturation: 100, hue: 0, grayscale: 0, sepia: 0, invert: 0, blur: 0 };

/** CSS/canvas filter string for a set of adjustments (neutral values are omitted). */
export function filterString(a: Adjustments): string {
  const parts: string[] = [];
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness / 100})`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast / 100})`);
  if (a.saturation !== 100) parts.push(`saturate(${a.saturation / 100})`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale / 100})`);
  if (a.sepia) parts.push(`sepia(${a.sepia / 100})`);
  if (a.invert) parts.push(`invert(${a.invert / 100})`);
  return parts.join(' ');
}

/** Image operations for the adjustments (blur is resolution independent: % of the shorter side). */
export function adjustmentOps(a: Adjustments): ImageOps {
  const filter = filterString(a);
  return { ...(filter ? { filter } : {}), ...(a.blur ? { blurPct: a.blur / 10 } : {}) };
}

export type FrameAspect = 'first' | '1:1' | '16:9' | '9:16' | '4:5';
const RATIO: Record<Exclude<FrameAspect, 'first'>, number> = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5 };
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Slideshow/GIF frame: the longest side equals `maxSide`, shape from the aspect (or the first image); even sizes for H.264. */
export function frameSize(aspect: FrameAspect, maxSide: number, first: { width: number; height: number }): { width: number; height: number } {
  const ratio = aspect === 'first' ? first.width / first.height : RATIO[aspect];
  return ratio >= 1 ? { width: even(maxSide), height: even(maxSide / ratio) } : { width: even(maxSide * ratio), height: even(maxSide) };
}
