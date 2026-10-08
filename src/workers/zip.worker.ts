import { Gzip, gunzipSync } from 'fflate';
import { expose } from './rpc';
import { createZip, type ZipInput, type ZipLevel } from '../engines/zip/writer';
import { extractEntry, listZip, type ZipEntry } from '../engines/zip/reader';
import { createTar } from '../engines/archive/tar';
import { AppError } from '../core/errors';
import { hashBlob, type HashAlgorithm } from '../engines/data/hash';

/** Streams a Blob through fflate's gzip compressor without holding two full copies. */
async function gzipBlob(blob: Blob, level: 6 | 9, onProgress: (p: number) => void): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const gz = new Gzip({ level }, (chunk) => chunks.push(chunk));
  const reader = blob.stream().getReader();
  let done = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) {
      gz.push(new Uint8Array(0), true);
      break;
    }
    gz.push(value, false);
    done += value.length;
    onProgress(blob.size ? done / blob.size : 1);
  }
  return new Blob(chunks as BlobPart[], { type: 'application/gzip' });
}

expose({
  create: (req: { inputs: ZipInput[]; level: ZipLevel }, ctx) => createZip(req.inputs, req.level, (p) => ctx.progress(p)),
  list: (req: { file: Blob }) => listZip(req.file),
  extract: async (req: { file: Blob; entries: ZipEntry[] }, ctx) => {
    const out: Array<{ path: string; blob: Blob }> = [];
    const total = req.entries.reduce((n, e) => n + e.size, 0) || 1;
    let done = 0;
    for (const entry of req.entries) {
      const data = await extractEntry(req.file, entry);
      out.push({ path: entry.path, blob: new Blob([data as BlobPart]) });
      done += entry.size;
      ctx.progress(done / total);
    }
    return out;
  },
  tar: async (req: { inputs: ZipInput[]; gzip: boolean; level: ZipLevel }, ctx) => {
    const tar = await createTar(req.inputs, (p) => ctx.progress(req.gzip ? p * 0.3 : p));
    if (!req.gzip) return tar;
    return gzipBlob(tar, req.level === 'max' ? 9 : 6, (p) => ctx.progress(0.3 + p * 0.7));
  },
  hash: (req: { file: Blob; algorithms: HashAlgorithm[] }, ctx) => hashBlob(req.file, req.algorithms, (p) => ctx.progress(p)),
  gzip: (req: { file: Blob; level: ZipLevel }, ctx) => gzipBlob(req.file, req.level === 'max' ? 9 : 6, (p) => ctx.progress(p)),
  gunzip: async (req: { file: Blob }) => {
    try {
      return new Blob([gunzipSync(new Uint8Array(await req.file.arrayBuffer())) as BlobPart]);
    } catch {
      throw new AppError('invalid-archive', 'Not a valid GZIP file');
    }
  },
});
