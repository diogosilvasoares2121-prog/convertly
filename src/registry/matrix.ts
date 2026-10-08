import { capabilitiesStore, type Capabilities } from '../core/capabilities';
import { FORMATS, type FormatId } from './formats';

/**
 * Central conversion matrix: answers "what can this format become?" using only
 * decoders/encoders that actually exist in this build and this browser.
 * The UI never offers a combination that is not listed here.
 */

/** Image formats Convertly can decode, and the engine responsible. */
export const IMAGE_DECODERS: Partial<Record<FormatId, 'native' | 'heic' | 'tiff'>> = {
  jpg: 'native',
  png: 'native',
  webp: 'native',
  gif: 'native',
  bmp: 'native',
  avif: 'native',
  ico: 'native',
  heic: 'heic',
  tiff: 'tiff',
};

export const IMAGE_ENCODERS: readonly FormatId[] = ['jpg', 'png', 'webp', 'avif'];

/** Video containers accepted as input by the bundled FFmpeg build (see docs/FFMPEG.md). */
export const VIDEO_INPUTS: readonly FormatId[] = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'mpeg', '3gp', 'wmv'];
/** Video outputs produced by the bundled FFmpeg build (H.264/AAC, VP8/Vorbis, GIF). */
export const VIDEO_OUTPUTS: readonly FormatId[] = ['mp4', 'webm', 'mov', 'mkv', 'gif'];
/** Audio inputs (also used for audio tracks extracted from video). */
export const AUDIO_INPUTS: readonly FormatId[] = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'weba', 'wma'];
/** Audio outputs: MP3 (LAME), WAV (PCM), M4A/AAC (native AAC), OGG (Vorbis), FLAC, OPUS. */
export const AUDIO_OUTPUTS: readonly FormatId[] = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'];

function imageEncoderAvailable(id: FormatId, caps: Capabilities): boolean {
  switch (id) {
    case 'jpg':
      return caps.encodeJpeg;
    case 'png':
      return caps.encodePng;
    case 'webp':
      return caps.encodeWebp;
    case 'avif':
      return caps.encodeAvif;
    default:
      return false;
  }
}

export function canDecodeImage(id: FormatId, caps: Capabilities = capabilitiesStore.get()): boolean {
  const engine = IMAGE_DECODERS[id];
  if (!engine) return false;
  if (!caps.worker || !caps.offscreenCanvas) return false;
  if (engine === 'heic') return caps.wasm;
  return true;
}

export function imageOutputs(from: FormatId | null, caps: Capabilities = capabilitiesStore.get()): FormatId[] {
  if (from && !canDecodeImage(from, caps)) return [];
  return IMAGE_ENCODERS.filter((to) => imageEncoderAvailable(to, caps));
}

export function ffmpegAvailable(caps: Capabilities = capabilitiesStore.get()): boolean {
  return caps.wasm && caps.worker;
}

export function videoOutputs(from: FormatId | null, caps: Capabilities = capabilitiesStore.get()): FormatId[] {
  if (!ffmpegAvailable(caps)) return [];
  // Animated GIFs can become real video files (much smaller, playable everywhere).
  if (from === 'gif') return VIDEO_OUTPUTS.filter((f) => f !== 'gif');
  if (from && !VIDEO_INPUTS.includes(from)) return [];
  return [...VIDEO_OUTPUTS];
}

export function audioOutputs(from: FormatId | null, caps: Capabilities = capabilitiesStore.get()): FormatId[] {
  if (!ffmpegAvailable(caps)) return [];
  if (from && !AUDIO_INPUTS.includes(from) && !VIDEO_INPUTS.includes(from)) return [];
  return [...AUDIO_OUTPUTS];
}

/** All formats a given input can be converted into (excluding itself). */
export function conversionTargets(from: FormatId, caps: Capabilities = capabilitiesStore.get()): FormatId[] {
  const category = FORMATS[from].category;
  let targets: FormatId[] = [];
  if (category === 'image') {
    targets = imageOutputs(from, caps);
    if (targets.length && (caps.encodeJpeg || caps.encodePng)) targets = [...targets, 'pdf'];
    if (from === 'gif') targets = [...targets, ...videoOutputs('gif', caps)];
    if (from === 'svg' && caps.offscreenCanvas) targets = ['png', 'jpg', 'webp'].filter((t) => imageEncoderAvailable(t as FormatId, caps)) as FormatId[];
    if (targets.length && from !== 'svg' && from !== 'ico') targets = [...targets, 'ico'];
  } else if (category === 'video') {
    targets = [...videoOutputs(from, caps), ...audioOutputs(from, caps)];
  } else if (category === 'audio') {
    targets = audioOutputs(from, caps);
  } else if (category === 'pdf') {
    targets = caps.encodeJpeg && caps.encodePng ? ['jpg', 'png'] : [];
  }
  return targets.filter((t) => t !== from);
}

export function canConvert(from: FormatId, to: FormatId, caps: Capabilities = capabilitiesStore.get()): boolean {
  return conversionTargets(from, caps).includes(to);
}
