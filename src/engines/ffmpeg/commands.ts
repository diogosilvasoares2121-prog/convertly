import type { FormatId } from '../../registry/formats';
import type { MediaInfo } from './probe';

/**
 * Pure FFmpeg argument builders. Each returns the arguments (input is always
 * `/input/<name>`), the output file name inside the FFmpeg FS, and the duration
 * of the produced media (used for real progress reporting).
 */
export interface FfmpegCommand {
  args: string[];
  output: string;
  /** Duration in seconds of the output, when known (progress denominator). */
  duration: number | null;
  /** True when streams are copied without re-encoding (fast, lossless). */
  streamCopy: boolean;
  /** Collect all output files starting with this prefix (multi-file results). */
  collect?: string;
}

export type VideoOut = 'mp4' | 'webm' | 'mov' | 'mkv';
export type AudioOut = 'mp3' | 'wav' | 'm4a' | 'aac' | 'ogg' | 'flac' | 'opus' | 'weba' | 'wma';
export type VideoQuality = 'high' | 'balanced' | 'small';

export const INPUT_DIR = '/input';
export const inputPath = (name: string) => `${INPUT_DIR}/${name}`;

const CRF: Record<VideoQuality, number> = { high: 20, balanced: 24, small: 30 };
const VP8_BITRATE: Record<VideoQuality, string> = { high: '3M', balanced: '1500k', small: '700k' };
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/** Audio encoder arguments for a target format. */
export function audioCodecArgs(target: AudioOut, bitrateKbps: number): string[] {
  const b = `${Math.round(bitrateKbps)}k`;
  switch (target) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', b];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', b, '-movflags', '+faststart'];
    case 'aac':
      return ['-c:a', 'aac', '-b:a', b, '-f', 'adts'];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', b];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'opus':
    case 'weba':
      return ['-c:a', 'libopus', '-b:a', b, ...(target === 'weba' ? ['-f', 'webm'] : [])];
    case 'wma':
      return ['-c:a', 'wmav2', '-b:a', b, '-f', 'asf'];
  }
}

/** Source audio codec that can be copied into the target container without re-encoding. */
const COPYABLE_AUDIO: Partial<Record<AudioOut, string[]>> = {
  mp3: ['mp3'],
  m4a: ['aac', 'alac'],
  aac: ['aac'],
  ogg: ['vorbis'],
  opus: ['opus'],
  flac: ['flac'],
};

/** Encoder arguments (video + audio + container flags) without filters. */
function videoEncoderArgs(target: VideoOut, quality: VideoQuality): string[] {
  if (target === 'webm') {
    // yuv420p explicitly: sources with alpha (GIF, PNG sequences) would otherwise pick yuva420p.
    return ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '6', '-b:v', VP8_BITRATE[quality], '-qmin', '4', '-qmax', '50', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k'];
  }
  const container = target === 'mkv' ? [] : ['-movflags', '+faststart'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(CRF[quality]), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', ...container];
}

function videoCodecArgs(target: VideoOut, quality: VideoQuality, filters: string[]): string[] {
  return ['-vf', [...filters, EVEN].join(','), ...videoEncoderArgs(target, quality)];
}

function canCopyVideo(info: MediaInfo, target: VideoOut): boolean {
  const v = info.video?.codec;
  const a = info.audio?.codec;
  if (!v) return false;
  if (target === 'webm') return (v === 'vp8' || v === 'vp9') && (!a || a === 'opus' || a === 'vorbis');
  if (target === 'mkv') {
    // Only copy codecs with well-defined Matroska mappings and reliable timestamps.
    const mkvVideo = ['h264', 'hevc', 'vp8', 'vp9', 'mpeg4'];
    const mkvAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'alac'];
    return mkvVideo.includes(v) && (!a || mkvAudio.includes(a) || a.startsWith('pcm_'));
  }
  // MP4/MOV: H.264 (+ AAC/MP3/ALAC audio) is universally playable when copied.
  const videoOk = v === 'h264' || (target === 'mov' && v === 'hevc');
  const audioOk = !a || a === 'aac' || a === 'mp3' || (target === 'mov' && a === 'alac');
  return videoOk && audioOk;
}

export interface ConvertVideoOptions {
  input: string;
  info: MediaInfo;
  target: VideoOut;
  quality: VideoQuality;
  /** Allow lossless stream copy when codecs are compatible with the target container. */
  allowCopy: boolean;
  baseName: string;
}

export function convertVideo(o: ConvertVideoOptions): FfmpegCommand {
  const output = `${o.baseName}.${o.target}`;
  const copy = o.allowCopy && canCopyVideo(o.info, o.target);
  const codec = copy ? ['-c', 'copy', ...(o.target === 'mkv' ? [] : ['-movflags', '+faststart'])] : videoCodecArgs(o.target, o.quality, []);
  return {
    args: ['-i', inputPath(o.input), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...codec, output],
    output,
    duration: o.info.duration,
    streamCopy: copy,
  };
}

export interface ExtractAudioOptions {
  input: string;
  info: MediaInfo;
  target: AudioOut;
  bitrateKbps: number;
  /** Copy the audio stream when it already has the target codec and no bitrate change is required. */
  allowCopy: boolean;
  baseName: string;
  start?: number;
  end?: number;
  /** Force mono (1) or stereo (2); undefined keeps the source layout. */
  channels?: 1 | 2;
  /** Output sample rate in Hz; undefined keeps the source rate. */
  sampleRate?: number;
}

export function convertAudio(o: ExtractAudioOptions): FfmpegCommand {
  const ext = o.target === 'weba' ? 'weba' : o.target;
  const output = `${o.baseName}.${ext}`;
  const resample = [...(o.channels ? ['-ac', String(o.channels)] : []), ...(o.sampleRate ? ['-ar', String(o.sampleRate)] : [])];
  const copy = !resample.length && o.allowCopy && !!o.info.audio && (COPYABLE_AUDIO[o.target] ?? []).includes(o.info.audio.codec);
  const seek = o.start !== undefined && o.start > 0 ? ['-ss', o.start.toFixed(3)] : [];
  const span = o.end !== undefined ? ['-t', Math.max(0.01, o.end - (o.start ?? 0)).toFixed(3)] : [];
  const codec = copy ? ['-c:a', 'copy', ...(o.target === 'm4a' ? ['-movflags', '+faststart'] : o.target === 'aac' ? ['-f', 'adts'] : [])] : audioCodecArgs(o.target, o.bitrateKbps);
  const duration = o.end !== undefined ? o.end - (o.start ?? 0) : o.info.duration;
  return {
    args: [...seek, '-i', inputPath(o.input), ...span, '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '0', ...resample, ...codec, output],
    output,
    duration,
    streamCopy: copy,
  };
}

/** Container used when re-encoding a video "in its own format". */
export function sameVideoContainer(format: FormatId): VideoOut {
  if (format === 'webm') return 'webm';
  if (format === 'mov') return 'mov';
  if (format === 'mkv') return 'mkv';
  return 'mp4';
}

export function sameAudioContainer(format: FormatId): AudioOut {
  switch (format) {
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'aac':
    case 'ogg':
    case 'flac':
    case 'opus':
    case 'weba':
    case 'wma':
      return format;
    default:
      return 'mp3';
  }
}

export interface TrimOptions {
  input: string;
  info: MediaInfo;
  format: FormatId;
  start: number;
  end: number;
  precise: boolean;
  baseName: string;
  kind: 'video' | 'audio';
}

/**
 * Fast trim copies streams and cuts at the nearest keyframe (instant, lossless).
 * Precise trim re-encodes for frame-accurate cuts.
 */
export function trimMedia(o: TrimOptions): FfmpegCommand {
  const duration = Math.max(0.01, o.end - o.start);
  const seek = ['-ss', o.start.toFixed(3)];
  const span = ['-t', duration.toFixed(3)];
  if (o.kind === 'audio') {
    const target = sameAudioContainer(o.format);
    const output = `${o.baseName}.${target}`;
    const bitrate = Math.min(320, Math.max(96, Math.round((o.info.audio?.bitrate ?? 192_000) / 1000)));
    const codec = o.precise || target === 'wav' || target === 'flac' ? audioCodecArgs(target, bitrate) : ['-c:a', 'copy', ...(target === 'aac' ? ['-f', 'adts'] : [])];
    return { args: [...seek, '-i', inputPath(o.input), ...span, '-map', '0:a:0', '-vn', '-sn', '-dn', ...codec, output], output, duration, streamCopy: !o.precise };
  }
  if (!o.precise) {
    const ext = o.format === 'mpeg' ? 'mpg' : o.format === 'wmv' ? 'wmv' : o.format === '3gp' ? '3gp' : o.format === 'avi' ? 'avi' : sameVideoContainer(o.format);
    const output = `${o.baseName}.${ext}`;
    return {
      args: [...seek, '-i', inputPath(o.input), ...span, '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn', '-c', 'copy', '-avoid_negative_ts', 'make_zero', output],
      output,
      duration,
      streamCopy: true,
    };
  }
  const target = sameVideoContainer(o.format);
  const output = `${o.baseName}.${target}`;
  return {
    args: [...seek, '-i', inputPath(o.input), ...span, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...videoCodecArgs(target, 'high', []), output],
    output,
    duration,
    streamCopy: false,
  };
}

export interface ResizeOptions {
  input: string;
  info: MediaInfo;
  format: FormatId;
  /** Target height preset (keeps aspect) or explicit box. */
  height?: number;
  box?: { width: number; height: number; keepAspect: boolean };
  baseName: string;
}

export function resizeVideo(o: ResizeOptions): FfmpegCommand {
  let filter: string;
  if (o.box) {
    filter = o.box.keepAspect
      ? `scale=w=${o.box.width}:h=${o.box.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`
      : `scale=${o.box.width}:${o.box.height},setsar=1`;
  } else {
    filter = `scale=-2:${o.height ?? 720}`;
  }
  const target = sameVideoContainer(o.format);
  const output = `${o.baseName}.${target}`;
  return {
    args: ['-i', inputPath(o.input), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...videoCodecArgs(target, 'high', [filter]), output],
    output,
    duration: o.info.duration,
    streamCopy: false,
  };
}

export function muteVideo(o: { input: string; info: MediaInfo; format: FormatId; baseName: string }): FfmpegCommand {
  const ext = o.format === 'mpeg' ? 'mpg' : o.format === 'wmv' ? 'wmv' : o.format === '3gp' ? '3gp' : o.format === 'avi' ? 'avi' : sameVideoContainer(o.format);
  const output = `${o.baseName}.${ext}`;
  return {
    args: ['-i', inputPath(o.input), '-map', '0:v:0', '-an', '-sn', '-dn', '-c:v', 'copy', ...(ext === 'mp4' || ext === 'mov' ? ['-movflags', '+faststart'] : []), output],
    output,
    duration: o.info.duration,
    streamCopy: true,
  };
}

export type RotateMode = 'cw' | 'ccw' | '180' | 'hflip' | 'vflip';
const ROTATE_FILTER: Record<RotateMode, string> = {
  cw: 'transpose=1',
  ccw: 'transpose=2',
  '180': 'transpose=1,transpose=1',
  hflip: 'hflip',
  vflip: 'vflip',
};

export function rotateVideo(o: { input: string; info: MediaInfo; format: FormatId; mode: RotateMode; baseName: string }): FfmpegCommand {
  const target = sameVideoContainer(o.format);
  const output = `${o.baseName}.${target}`;
  return {
    args: ['-i', inputPath(o.input), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...videoCodecArgs(target, 'high', [ROTATE_FILTER[o.mode]]), output],
    output,
    duration: o.info.duration,
    streamCopy: false,
  };
}

export interface CompressVideoOptions {
  input: string;
  info: MediaInfo;
  /** Constant Rate Factor 18 (best) … 36 (smallest). */
  crf: number;
  /** Optional max height (keeps aspect). */
  maxHeight: number | null;
  /** Optional target video bitrate in kbps (overrides CRF). */
  videoBitrateKbps: number | null;
  audioBitrateKbps: number;
  baseName: string;
}

export function compressVideo(o: CompressVideoOptions): FfmpegCommand {
  const filters: string[] = [];
  if (o.maxHeight && o.info.video && Math.min(o.info.video.height, o.info.video.width) > o.maxHeight) {
    // Scale the shorter side so portrait videos are handled correctly.
    filters.push(o.info.video.width >= o.info.video.height ? `scale=-2:${o.maxHeight}` : `scale=${o.maxHeight}:-2`);
  }
  filters.push(EVEN);
  const rate = o.videoBitrateKbps
    ? ['-b:v', `${o.videoBitrateKbps}k`, '-maxrate', `${Math.round(o.videoBitrateKbps * 1.5)}k`, '-bufsize', `${o.videoBitrateKbps * 2}k`]
    : ['-crf', String(Math.round(o.crf))];
  const output = `${o.baseName}-compressed.mp4`;
  return {
    args: [
      '-i', inputPath(o.input), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', ...rate, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', `${o.audioBitrateKbps}k`, '-movflags', '+faststart', output,
    ],
    output,
    duration: o.info.duration,
    streamCopy: false,
  };
}

export interface GifOptions {
  input: string;
  start: number;
  end: number;
  fps: number;
  /** Output width in px (height keeps aspect); 0 = source width (capped at 800). */
  width: number;
  loop: boolean;
  baseName: string;
  sourceWidth: number;
}

export function videoToGif(o: GifOptions): FfmpegCommand {
  const width = o.width > 0 ? o.width : Math.min(800, o.sourceWidth || 480);
  const duration = Math.max(0.1, o.end - o.start);
  const graph = `fps=${o.fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  const output = `${o.baseName}.gif`;
  return {
    args: ['-ss', o.start.toFixed(3), '-t', duration.toFixed(3), '-i', inputPath(o.input), '-filter_complex', graph, '-loop', o.loop ? '0' : '-1', output],
    output,
    duration,
    streamCopy: false,
  };
}

// ───────────────────────── Additional tools ─────────────────────────

/** atempo only accepts 0.5–2.0 per instance: chain several for larger factors. */
export function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  parts.push(`atempo=${Number(s.toFixed(6))}`);
  return parts.join(',');
}

export interface FramesOptions {
  input: string;
  info: MediaInfo;
  /** Seconds between frames (0 = every frame, capped by maxFrames). */
  everySeconds: number;
  format: 'jpg' | 'png';
  maxWidth: number | null;
  maxFrames: number;
}

/** Extracts still frames; outputs frame-0001.jpg, frame-0002.jpg… (collected by prefix). */
export function videoFrames(o: FramesOptions): FfmpegCommand {
  const filters: string[] = [];
  if (o.everySeconds > 0) filters.push(`fps=1/${o.everySeconds}`);
  if (o.maxWidth) filters.push(`scale='min(${o.maxWidth},iw)':-2`);
  const quality = o.format === 'jpg' ? ['-q:v', '2'] : [];
  return {
    args: ['-i', inputPath(o.input), ...(filters.length ? ['-vf', filters.join(',')] : []), '-frames:v', String(o.maxFrames), ...quality, `frame-%04d.${o.format}`],
    output: `frame-0001.${o.format}`,
    collect: 'frame-',
    duration: o.info.duration,
    streamCopy: false,
  };
}

export function changeSpeed(o: { input: string; info: MediaInfo; format: FormatId; speed: number; kind: 'video' | 'audio'; keepAudio: boolean; baseName: string }): FfmpegCommand {
  const duration = o.info.duration ? o.info.duration / o.speed : null;
  if (o.kind === 'audio') {
    const target = sameAudioContainer(o.format);
    const bitrate = Math.min(320, Math.max(96, Math.round((o.info.audio?.bitrate ?? 192_000) / 1000)));
    return {
      args: ['-i', inputPath(o.input), '-map', '0:a:0', '-vn', '-af', atempoChain(o.speed), ...audioCodecArgs(target, bitrate), `${o.baseName}.${target}`],
      output: `${o.baseName}.${target}`,
      duration,
      streamCopy: false,
    };
  }
  const target = sameVideoContainer(o.format);
  const withAudio = o.keepAudio && !!o.info.audio;
  const graph = withAudio ? `[0:v]setpts=PTS/${o.speed}[v];[0:a]${atempoChain(o.speed)}[a]` : `[0:v]setpts=PTS/${o.speed}[v]`;
  return {
    args: ['-i', inputPath(o.input), '-filter_complex', `${graph};[v]${EVEN}[vo]`, '-map', '[vo]', ...(withAudio ? ['-map', '[a]'] : ['-an']), ...videoEncoderArgs(target, 'high'), `${o.baseName}.${target}`],
    output: `${o.baseName}.${target}`,
    duration,
    streamCopy: false,
  };
}

/** Center-crops a video to an aspect ratio (dimensions computed from the probed display size). */
export function cropVideoToRatio(o: { input: string; info: MediaInfo; format: FormatId; ratio: number; baseName: string }): FfmpegCommand {
  const v = o.info.video;
  const swap = v && (v.rotation === 90 || v.rotation === 270);
  const w = v ? (swap ? v.height : v.width) : 0;
  const h = v ? (swap ? v.width : v.height) : 0;
  let cw = w;
  let ch = Math.round(w / o.ratio);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * o.ratio);
  }
  cw -= cw % 2;
  ch -= ch % 2;
  const target = sameVideoContainer(o.format);
  return {
    args: ['-i', inputPath(o.input), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...videoCodecArgs(target, 'high', [`crop=${cw}:${ch}:${Math.floor((w - cw) / 2)}:${Math.floor((h - ch) / 2)}`]), `${o.baseName}.${target}`],
    output: `${o.baseName}.${target}`,
    duration: o.info.duration,
    streamCopy: false,
  };
}

export interface MergeInput {
  name: string;
  info: MediaInfo;
}

/** Joins videos into one MP4 (scaled/padded to the first video's size, 30 fps, stereo 44.1 kHz). */
export function mergeVideos(inputs: MergeInput[], o: { maxHeight: number; baseName: string }): FfmpegCommand {
  const first = inputs[0]!.info.video;
  const swap = first && (first.rotation === 90 || first.rotation === 270);
  let w = first ? (swap ? first.height : first.width) : 1280;
  let h = first ? (swap ? first.width : first.height) : 720;
  if (h > o.maxHeight) {
    w = Math.round((w * o.maxHeight) / h);
    h = o.maxHeight;
  }
  w -= w % 2;
  h -= h % 2;
  const args: string[] = [];
  for (const i of inputs) args.push('-i', inputPath(i.name));
  const parts: string[] = [];
  const labels: string[] = [];
  inputs.forEach((input, k) => {
    parts.push(`[${k}:v:0]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${k}]`);
    if (input.info.audio) parts.push(`[${k}:a:0]aformat=sample_rates=44100:channel_layouts=stereo,aresample=async=1[a${k}]`);
    // Silent clips get generated silence (a source filter, so no lavfi input device is needed).
    else parts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${Math.max(0.1, input.info.duration ?? 1).toFixed(3)},asetpts=PTS-STARTPTS[a${k}]`);
    labels.push(`[v${k}][a${k}]`);
  });
  parts.push(`${labels.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`);
  const duration = inputs.reduce((n, i) => n + (i.info.duration ?? 0), 0) || null;
  const output = `${o.baseName}.mp4`;
  return {
    args: [...args, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output],
    output,
    duration,
    streamCopy: false,
  };
}

/** Joins audio files one after another. */
export function mergeAudio(inputs: MergeInput[], o: { target: AudioOut; bitrateKbps: number; baseName: string }): FfmpegCommand {
  const args: string[] = [];
  for (const i of inputs) args.push('-i', inputPath(i.name));
  const parts = inputs.map((_, k) => `[${k}:a:0]aformat=sample_rates=44100:channel_layouts=stereo[a${k}]`);
  parts.push(`${inputs.map((_, k) => `[a${k}]`).join('')}concat=n=${inputs.length}:v=0:a=1[a]`);
  const output = `${o.baseName}.${o.target}`;
  return {
    args: [...args, '-filter_complex', parts.join(';'), '-map', '[a]', ...audioCodecArgs(o.target, o.bitrateKbps), output],
    output,
    duration: inputs.reduce((n, i) => n + (i.info.duration ?? 0), 0) || null,
    streamCopy: false,
  };
}

/** Adds (replace) or mixes an audio track into a video. */
export function addAudioToVideo(o: {
  video: MergeInput;
  audio: MergeInput;
  mode: 'replace' | 'mix';
  musicVolume: number;
  loop: boolean;
  shortest: boolean;
  baseName: string;
}): FfmpegCommand {
  const v = o.video.info.video?.codec;
  const copyVideo = v === 'h264' || v === 'hevc';
  const audioIn = o.loop ? ['-stream_loop', '-1', '-i', inputPath(o.audio.name)] : ['-i', inputPath(o.audio.name)];
  const mix = o.mode === 'mix' && !!o.video.info.audio;
  const graph = mix
    ? ['-filter_complex', `[1:a:0]volume=${o.musicVolume.toFixed(2)}[m];[0:a:0][m]amix=inputs=2:duration=first:dropout_transition=0[a]`, '-map', '0:v:0', '-map', '[a]']
    : ['-filter_complex', `[1:a:0]volume=${o.musicVolume.toFixed(2)}[a]`, '-map', '0:v:0', '-map', '[a]'];
  const videoCodec = copyVideo ? ['-c:v', 'copy'] : ['-vf', EVEN, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
  const output = `${o.baseName}.mp4`;
  return {
    args: ['-i', inputPath(o.video.name), ...audioIn, ...graph, ...videoCodec, '-c:a', 'aac', '-b:a', '192k', ...(o.shortest || o.loop ? ['-shortest'] : []), '-movflags', '+faststart', output],
    output,
    duration: o.video.info.duration,
    streamCopy: false,
  };
}

export type AudioEffect =
  | { kind: 'volume'; db: number }
  | { kind: 'normalize' }
  | { kind: 'fade'; fadeIn: number; fadeOut: number }
  | { kind: 'reverse' };

export function audioEffect(o: { input: string; info: MediaInfo; format: FormatId; effect: AudioEffect; baseName: string }): FfmpegCommand {
  const target = sameAudioContainer(o.format);
  const bitrate = Math.min(320, Math.max(128, Math.round((o.info.audio?.bitrate ?? 192_000) / 1000)));
  const dur = o.info.duration ?? 0;
  let filter: string;
  switch (o.effect.kind) {
    case 'volume':
      filter = `volume=${o.effect.db}dB`;
      break;
    case 'normalize':
      filter = 'loudnorm=I=-16:TP=-1.5:LRA=11';
      break;
    case 'fade': {
      const parts: string[] = [];
      if (o.effect.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${o.effect.fadeIn}`);
      if (o.effect.fadeOut > 0) parts.push(`afade=t=out:st=${Math.max(0, dur - o.effect.fadeOut).toFixed(3)}:d=${o.effect.fadeOut}`);
      filter = parts.join(',') || 'anull';
      break;
    }
    case 'reverse':
      filter = 'areverse';
      break;
  }
  const output = `${o.baseName}.${target}`;
  return {
    args: ['-i', inputPath(o.input), '-map', '0:a:0', '-vn', '-af', filter, ...(o.effect.kind === 'normalize' ? ['-ar', '48000'] : []), ...audioCodecArgs(target, bitrate), output],
    output,
    duration: o.info.duration,
    streamCopy: false,
  };
}

/** Image sequence (img0001.png…, all the same size) → animated GIF or MP4 slideshow. */
export function imagesToMotion(o: { count: number; secondsPerImage: number; format: 'gif' | 'mp4'; loop: boolean; baseName: string }): FfmpegCommand {
  const rate = `1/${o.secondsPerImage}`;
  const duration = o.count * o.secondsPerImage;
  const output = `${o.baseName}.${o.format}`;
  if (o.format === 'gif') {
    const graph = 'fps=10,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a';
    return {
      args: ['-framerate', rate, '-i', `${INPUT_DIR}/img%04d.png`, '-filter_complex', graph, '-loop', o.loop ? '0' : '-1', output],
      output,
      duration,
      streamCopy: false,
    };
  }
  return {
    args: ['-framerate', rate, '-i', `${INPUT_DIR}/img%04d.png`, '-vf', `fps=30,${EVEN},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-tune', 'stillimage', '-movflags', '+faststart', output],
    output,
    duration,
    streamCopy: false,
  };
}

/** `ffprobe` arguments writing JSON into a file inside the FFmpeg FS. */
export function probeArgs(input: string, out: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-o', out, inputPath(input)];
}
