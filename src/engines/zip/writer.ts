import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { AppError } from '../../core/errors';
import { NameDeduper, sanitizeRelativePath } from '../../utils/filename';

/**
 * Streaming ZIP writer built on fflate's synchronous streams (no hidden workers,
 * no blob-URL scripts). Files are read in chunks so memory stays bounded by the
 * size of the output, not twice the input.
 */
export type ZipLevel = 'store' | 'normal' | 'max';

export interface ZipInput {
  path: string;
  blob: Blob;
  lastModified?: number;
}

// Already-compressed formats gain nothing from deflate: store them (much faster).
const STORE_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac',
  'zip', '7z', 'rar', 'gz', 'bz2', 'xz', 'zst', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub', 'jar', 'apk', 'woff', 'woff2',
]);

const MAX_ZIP_SIZE = 4 * 1024 * 1024 * 1024 - 1; // no ZIP64 output: stay below 4 GB

export async function createZip(
  inputs: ZipInput[],
  level: ZipLevel,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  if (!inputs.length) throw new AppError('invalid-input', 'No files to add');
  const total = inputs.reduce((n, f) => n + f.blob.size, 0);
  if (total > MAX_ZIP_SIZE) throw new AppError('archive-too-large', 'ZIP files larger than 4 GB are not supported');

  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else chunks.push(chunk);
  });
  const deduper = new NameDeduper();
  let processed = 0;

  for (const input of inputs) {
    const path = deduper.unique(sanitizeRelativePath(input.path) || 'file');
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const store = level === 'store' || (level === 'normal' && STORE_EXT.has(ext));
    const entry = store ? new ZipPassThrough(path) : new ZipDeflate(path, { level: level === 'max' ? 9 : 6 });
    if (input.lastModified) entry.mtime = new Date(Math.max(input.lastModified, Date.UTC(1980, 0, 2)));
    zip.add(entry);
    if (input.blob.size === 0) {
      entry.push(new Uint8Array(0), true);
      continue;
    }
    const reader = input.blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        entry.push(new Uint8Array(0), true);
        break;
      }
      entry.push(value, false);
      processed += value.length;
      onProgress?.(total ? processed / total : 1);
      if (failure) throw new AppError('conversion-failed', String(failure));
    }
  }
  zip.end();
  if (failure) throw new AppError('conversion-failed', String(failure));
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
