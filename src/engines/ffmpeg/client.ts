import { WorkerPool } from '../../core/worker-pool';
import { AppError } from '../../core/errors';
import { probeArgs, type FfmpegCommand } from './commands';
import { parseProbe, videoDecodable, type MediaInfo } from './probe';

/**
 * Main-thread API for FFmpeg. Heavy transcodes run on ONE worker at a time
 * (the job scheduler's "media" pool enforces this). Probing uses its own
 * short-lived worker so the UI can inspect files while a transcode runs.
 */
const factory = () => new Worker(new URL('../../workers/ffmpeg.worker.ts', import.meta.url), { type: 'module', name: 'convertly-ffmpeg' });

const transcodePool = new WorkerPool(factory, { max: () => 1, idleMs: 45_000 });
const probePool = new WorkerPool(factory, { max: () => 1, idleMs: 15_000 });

/** Extension origin (e.g. chrome-extension://<id>/). Workers cannot call chrome.runtime. */
function baseUrl(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL('/');
  } catch {
    /* fall through */
  }
  return new URL('/', location.href).href;
}

/** FFmpeg's virtual FS needs a plain ASCII file name. */
export function safeInputName(name: string): string {
  const ext = (name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  return `input.${ext}`;
}

const probeCache = new WeakMap<Blob, Promise<MediaInfo>>();

/** Reads streams/codecs/duration with ffprobe. Results are cached per file object. */
export function probeMedia(file: Blob, name: string, signal?: AbortSignal): Promise<MediaInfo> {
  const cached = probeCache.get(file);
  if (cached) return cached;
  const promise = probePool
    .call<string>(
      'run',
      { baseUrl: baseUrl(), input: { name: safeInputName(name), blob: file }, args: probeArgs(safeInputName(name), 'probe.json'), output: 'probe.json', duration: null, probe: true },
      signal ? { signal } : {},
    )
    .then(parseProbe);
  probeCache.set(file, promise);
  promise.catch(() => probeCache.delete(file));
  return promise;
}

/** Throws a clear error when the build cannot decode the input's video codec. */
export function assertDecodable(info: MediaInfo): void {
  if (!videoDecodable(info)) {
    throw new AppError('unsupported-codec', `Video codec "${info.video?.codec}" is not supported by Convertly's FFmpeg build`);
  }
}

export async function runFfmpeg(
  file: Blob,
  inputName: string,
  command: FfmpegCommand,
  options: { signal?: AbortSignal; onProgress?: (p: number | null) => void; kind?: 'convert' | 'audio' } = {},
): Promise<Blob> {
  return transcodePool.call<Blob>(
    'run',
    { baseUrl: baseUrl(), input: { name: inputName, blob: file }, args: command.args, output: command.output, duration: command.duration, kind: options.kind ?? 'convert' },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    },
  );
}

/** Runs FFmpeg over several inputs (merge, add audio, slideshows). */
export async function runFfmpegInputs(
  inputs: Array<{ name: string; blob: Blob }>,
  command: FfmpegCommand,
  options: { signal?: AbortSignal; onProgress?: (p: number | null) => void; kind?: 'convert' | 'audio' } = {},
): Promise<Blob> {
  return transcodePool.call<Blob>(
    'run',
    { baseUrl: baseUrl(), inputs, args: command.args, output: command.output, duration: command.duration, kind: options.kind ?? 'convert' },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    },
  );
}

/** Runs FFmpeg and returns every output file matching the command's `collect` prefix. */
export async function runFfmpegCollect(
  file: Blob,
  inputName: string,
  command: FfmpegCommand,
  options: { signal?: AbortSignal; onProgress?: (p: number | null) => void } = {},
): Promise<Array<{ name: string; blob: Blob }>> {
  return transcodePool.call(
    'run',
    { baseUrl: baseUrl(), input: { name: inputName, blob: file }, args: command.args, output: command.output, collect: command.collect, duration: command.duration },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    },
  );
}

/** Lists the build's encoders/decoders/muxers (used by tests and diagnostics). */
export function ffmpegCapabilities(): Promise<Record<string, string>> {
  return probePool.call('capabilities', { baseUrl: baseUrl() });
}

export function terminateFfmpegWorkers(): void {
  transcodePool.terminateAll();
  probePool.terminateAll();
}
