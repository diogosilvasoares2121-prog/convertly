import { AppError } from '../../core/errors';

/** Normalised media information parsed from `ffprobe -print_format json`. */
export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number | null;
  rotation: number;
  bitrate: number | null;
}

export interface AudioStreamInfo {
  codec: string;
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
}

export interface MediaInfo {
  container: string;
  duration: number | null;
  bitrate: number | null;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  audioStreams: number;
  videoStreams: number;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number }>;
  disposition?: { attached_pic?: number };
}

interface ProbeJson {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

function rate(value: string | undefined): number | null {
  if (!value) return null;
  const [n, d] = value.split('/').map(Number);
  if (!n || !d) return null;
  const fps = n / d;
  return Number.isFinite(fps) && fps > 0 && fps < 1000 ? fps : null;
}

function int(value: string | number | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseProbe(json: string): MediaInfo {
  let data: ProbeJson;
  try {
    data = JSON.parse(json) as ProbeJson;
  } catch {
    throw new AppError('corrupted-file', 'Could not read media information');
  }
  const streams = data.streams ?? [];
  // Cover art in audio files is exposed as a video stream with attached_pic=1: ignore it.
  const videos = streams.filter((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const v = videos[0];
  const a = audios[0];
  const rotationRaw = v?.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation ?? Number(v?.tags?.rotate ?? 0);
  return {
    container: data.format?.format_name ?? '',
    duration: int(data.format?.duration),
    bitrate: int(data.format?.bit_rate),
    video: v
      ? {
          codec: v.codec_name ?? 'unknown',
          width: v.width ?? 0,
          height: v.height ?? 0,
          fps: rate(v.avg_frame_rate) ?? rate(v.r_frame_rate),
          rotation: ((Math.round(rotationRaw) % 360) + 360) % 360,
          bitrate: int(v.bit_rate),
        }
      : null,
    audio: a
      ? { codec: a.codec_name ?? 'unknown', sampleRate: int(a.sample_rate), channels: a.channels ?? null, bitrate: int(a.bit_rate) }
      : null,
    audioStreams: audios.length,
    videoStreams: videos.length,
  };
}

/**
 * Codecs the bundled FFmpeg build can DECODE (verified with `ffmpeg -decoders`, see docs/FFMPEG.md).
 * Notably absent: AV1 (FFmpeg 5.1's native AV1 decoder needs hardware acceleration).
 */
export const DECODABLE_VIDEO = new Set([
  'h264', 'hevc', 'mpeg4', 'mpeg1video', 'mpeg2video', 'vp8', 'vp9', 'mjpeg', 'prores', 'theora', 'h263', 'h263p', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3',
  'wmv1', 'wmv2', 'wmv3', 'vc1', 'flv1', 'dvvideo', 'gif', 'png', 'rawvideo', 'qtrle', 'svq1', 'svq3', 'cinepak', 'mpeg4v3',
]);

export function videoDecodable(info: MediaInfo): boolean {
  return !info.video || DECODABLE_VIDEO.has(info.video.codec);
}

/** Effective display size (after the rotation stored in the container). */
export function displaySize(info: MediaInfo): { width: number; height: number } | null {
  if (!info.video) return null;
  const swap = info.video.rotation === 90 || info.video.rotation === 270;
  return swap ? { width: info.video.height, height: info.video.width } : { width: info.video.width, height: info.video.height };
}
