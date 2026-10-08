import { WorkerPool, type CallOptions } from '../../core/worker-pool';
import type { ZipEntry } from './reader';
import type { ZipInput, ZipLevel } from './writer';
import type { HashAlgorithm } from '../data/hash';

const pool = new WorkerPool(
  () => new Worker(new URL('../../workers/zip.worker.ts', import.meta.url), { type: 'module', name: 'convertly-zip' }),
  { max: () => 2, idleMs: 20_000 },
);

type Opts = Pick<CallOptions, 'signal' | 'onProgress'>;

export const createZip = (inputs: ZipInput[], level: ZipLevel, opts: Opts = {}) => pool.call<Blob>('create', { inputs, level }, opts);
export const listZip = (file: Blob, opts: Opts = {}) => pool.call<ZipEntry[]>('list', { file }, opts);
export const extractZipEntries = (file: Blob, entries: ZipEntry[], opts: Opts = {}) =>
  pool.call<Array<{ path: string; blob: Blob }>>('extract', { file, entries }, opts);

export const createTar = (inputs: ZipInput[], gzip: boolean, level: ZipLevel, opts: Opts = {}) => pool.call<Blob>('tar', { inputs, gzip, level }, opts);
export const hashFile = (file: Blob, algorithms: HashAlgorithm[], opts: Opts = {}) => pool.call<Record<HashAlgorithm, string>>('hash', { file, algorithms }, opts);
export const gzipFile = (file: Blob, level: ZipLevel, opts: Opts = {}) => pool.call<Blob>('gzip', { file, level }, opts);
export const gunzipFile = (file: Blob, opts: Opts = {}) => pool.call<Blob>('gunzip', { file }, opts);

export function terminateZipWorkers(): void {
  pool.terminateAll();
}
