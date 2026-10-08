import { expose } from './rpc';
import { AppError } from '../core/errors';
import { INPUT_DIR } from '../engines/ffmpeg/commands';
import { ProgressTracker, errorFromLogs } from '../engines/ffmpeg/logs';

/**
 * FFmpeg (WebAssembly, single-threaded build of FFmpeg 5.1) running in a
 * dedicated worker. The core JS/WASM is loaded from the extension package
 * (vendor/ffmpeg) — never from a CDN.
 *
 * Inputs are mounted with WORKERFS so large files are read lazily from the
 * Blob instead of being copied into WASM memory.
 */
interface EmscriptenFS {
  mkdir(path: string): void;
  rmdir(path: string): void;
  mount(type: unknown, opts: unknown, mountpoint: string): void;
  unmount(mountpoint: string): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
  readdir(path: string): string[];
  filesystems: { WORKERFS: unknown; MEMFS: unknown };
}

interface FFmpegCore {
  FS: EmscriptenFS;
  exec(...args: string[]): number;
  ffprobe(...args: string[]): number;
  reset(): void;
  setLogger(fn: (entry: { type: string; message: string }) => void): void;
  setProgress(fn: (entry: { progress: number; time: number }) => void): void;
  setTimeout(ms: number): void;
}

let corePromise: Promise<FFmpegCore> | null = null;

function loadCore(baseUrl: string): Promise<FFmpegCore> {
  if (!corePromise) {
    corePromise = (async () => {
      const coreUrl = `${baseUrl}vendor/ffmpeg/ffmpeg-core.js`;
      const mod = (await import(/* @vite-ignore */ coreUrl)) as { default: (opts: Record<string, unknown>) => Promise<FFmpegCore> };
      return mod.default({
        locateFile: (path: string) => `${baseUrl}vendor/ffmpeg/${path}`,
      });
    })().catch((err: unknown) => {
      corePromise = null;
      throw new AppError('browser-limitation', `FFmpeg could not start: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  return corePromise;
}

interface RunRequest {
  baseUrl: string;
  /** One input (legacy) or several (merge, add audio, slideshows). */
  input?: { name: string; blob: Blob };
  inputs?: Array<{ name: string; blob: Blob }>;
  args: string[];
  output: string;
  /** Collect every output file whose name starts with this prefix (frame extraction). */
  collect?: string;
  duration: number | null;
  kind?: 'convert' | 'audio';
  probe?: boolean;
}

function mountInputs(core: FFmpegCore, inputs: Array<{ name: string; blob: Blob }>): void {
  if (!core.FS.analyzePath(INPUT_DIR).exists) core.FS.mkdir(INPUT_DIR);
  core.FS.mount(core.FS.filesystems.WORKERFS, { blobs: inputs.map((i) => ({ name: i.name, data: i.blob })) }, INPUT_DIR);
}

function collected(core: FFmpegCore, prefix: string): string[] {
  return core.FS.readdir('/')
    .filter((n) => n.startsWith(prefix))
    .sort();
}

function unmountInput(core: FFmpegCore): void {
  try {
    core.FS.unmount(INPUT_DIR);
  } catch {
    /* already unmounted */
  }
}

function removeFile(core: FFmpegCore, path: string): void {
  try {
    if (core.FS.analyzePath(path).exists) core.FS.unlink(path);
  } catch {
    /* ignore */
  }
}

expose({
  /** Runs FFmpeg (or ffprobe) and returns the output file as a Blob. */
  run: async (req: RunRequest, ctx) => {
    const core = await loadCore(req.baseUrl);
    const logs: string[] = [];
    const tracker = new ProgressTracker(req.duration);
    let lastSent = -1;
    core.setLogger(({ message }) => {
      logs.push(message);
      if (logs.length > 200) logs.splice(0, logs.length - 200);
      const p = tracker.update(message);
      if (p !== undefined && p - lastSent >= 0.005) {
        lastSent = p;
        ctx.progress(p);
      }
    });
    core.setProgress(() => {});
    ctx.progress(req.duration ? 0 : null);

    const inputs = req.inputs ?? (req.input ? [req.input] : []);
    mountInputs(core, inputs);
    removeFile(core, req.output);
    if (req.collect) for (const n of collected(core, req.collect)) removeFile(core, n);
    let ret: number;
    try {
      ret = req.probe ? core.ffprobe(...req.args) : core.exec('-hide_banner', '-stats', '-loglevel', 'info', ...req.args);
    } catch (err) {
      unmountInput(core);
      removeFile(core, req.output);
      if (req.collect) for (const n of collected(core, req.collect)) removeFile(core, n);
      throw errorFromLogs([...logs, err instanceof Error ? err.message : String(err)], req.kind);
    } finally {
      core.reset();
    }
    unmountInput(core);
    if (req.collect) {
      const names = collected(core, req.collect);
      if (ret !== 0 || !names.length) {
        for (const n of names) removeFile(core, n);
        throw errorFromLogs(logs.length ? logs : [`ffmpeg exited with code ${ret}; no output files`], req.kind);
      }
      const files = names.map((name) => {
        const data = core.FS.readFile(name);
        removeFile(core, name);
        return { name, blob: new Blob([data as BlobPart]) };
      });
      ctx.progress(1);
      return files;
    }
    const exists = core.FS.analyzePath(req.output).exists;
    // ffprobe in this core never sets its exit code (always -1): success = output written.
    const ok = exists && (ret === 0 || (req.probe === true && ret === -1));
    if (!ok) {
      removeFile(core, req.output);
      throw errorFromLogs(logs.length ? logs : [`${req.probe ? 'ffprobe' : 'ffmpeg'} exited with code ${ret}; output ${exists ? 'present' : 'missing'}`], req.kind);
    }
    const data = core.FS.readFile(req.output);
    removeFile(core, req.output);
    if (req.probe) return new TextDecoder().decode(data);
    if (!data.length) throw errorFromLogs(logs, req.kind);
    ctx.progress(1);
    return new Blob([data as BlobPart]);
  },

  /** Lists encoders/decoders/muxers of this FFmpeg build (feature detection & tests). */
  capabilities: async (req: { baseUrl: string }) => {
    const core = await loadCore(req.baseUrl);
    const out: Record<string, string> = {};
    for (const flag of ['-encoders', '-decoders', '-muxers', '-demuxers']) {
      const lines: string[] = [];
      core.setLogger(({ message }) => lines.push(message));
      core.exec('-hide_banner', flag);
      core.reset();
      out[flag.slice(1)] = lines.join('\n');
    }
    return out;
  },
});
