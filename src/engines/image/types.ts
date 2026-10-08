import type { FormatId } from '../../registry/formats';

export type ImageOutputFormat = 'jpg' | 'png' | 'webp' | 'avif';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Geometric operations, applied in this order: rotate/flip → crop → resize. */
export interface ImageOps {
  /** Clockwise degrees. Multiples of 90 are lossless re-orientations; others expand the canvas. */
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** Crop rectangle in the coordinates of the rotated/flipped image. */
  crop?: CropRect;
  /** Final output size in pixels (exact; may change the aspect ratio). */
  resize?: { width: number; height: number };
  /**
   * Aspect-preserving resize computed from the source size inside the worker:
   * scale by percent, or fit inside maxWidth × maxHeight (either may be omitted).
   */
  fit?: { maxWidth?: number; maxHeight?: number; percent?: number; allowEnlarge?: boolean };
  /** Background used when flattening transparency (JPG output, rotated corners). */
  background?: string;
  /** CSS filter string applied while drawing (brightness, contrast, grayscale…). */
  filter?: string;
  /** Blur radius as a percentage of the output's shorter side (resolution independent). */
  blurPct?: number;
  /** Text watermark drawn on top of the final image. */
  watermark?: WatermarkSpec;
  /** Output shape: circle or rounded rectangle (corners become transparent / background). */
  shape?: { kind: 'circle' | 'rounded'; radiusPct?: number };
  /** Place the result centered in a fixed-size frame (favicons, slideshows). */
  frame?: { width: number; height: number; fit: 'contain' | 'cover'; background?: string };
}

export type WatermarkPosition = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right' | 'tile';

export interface WatermarkSpec {
  text: string;
  /** Font size as a percentage of the shorter image side (1–30). */
  sizePct: number;
  /** 0..1 */
  opacity: number;
  color: string;
  position: WatermarkPosition;
  /** Rotation in degrees (used for tiled and centered marks). */
  angle?: number;
}

export interface CombineRequest {
  files: Array<{ file: Blob; format: FormatId }>;
  layout: 'horizontal' | 'vertical' | 'grid';
  columns: number;
  gap: number;
  background: string;
  /** Scale images so they share the same height (horizontal) / width (vertical, grid). */
  equalize: boolean;
  output: OutputSpec;
}

export interface OutputSpec {
  format: ImageOutputFormat;
  /** 0..1 for lossy formats. */
  quality: number;
  /** Optional target file size in bytes (lossy formats only). */
  targetBytes?: number;
  /** Allow reducing dimensions if quality alone cannot reach the target size. */
  allowDownscale?: boolean;
}

export interface ProcessRequest {
  file: Blob;
  format: FormatId;
  ops: ImageOps;
  output: OutputSpec;
}

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
  /** Quality actually used (after target-size search). */
  quality: number;
  /** True when a target size was requested and reached. */
  targetReached?: boolean;
  /** Animated input where only the first frame could be processed. */
  firstFrameOnly?: boolean;
  /** Multi-page TIFF where only the first page was processed. */
  firstPageOnly?: boolean;
}

export interface ImageInfo {
  width: number;
  height: number;
  animated: boolean;
  metadata: MetadataReport;
}

export interface MetadataEntry {
  group: 'exif' | 'gps' | 'camera' | 'image' | 'text';
  key: string;
  value: string;
}

export interface MetadataReport {
  hasExif: boolean;
  hasGps: boolean;
  hasXmp: boolean;
  hasIptc: boolean;
  hasIcc: boolean;
  hasComments: boolean;
  orientation: number | null;
  colorSpace: string | null;
  bitDepth: number | null;
  entries: MetadataEntry[];
}

export interface StripResult {
  blob: Blob;
  /** True when pixels were untouched (metadata removed at the byte level). */
  lossless: boolean;
  removed: string[];
  outputFormat: FormatId;
}
