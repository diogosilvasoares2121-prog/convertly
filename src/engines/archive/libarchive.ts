import { Archive } from 'libarchive.js';
import { AppError, toAppError } from '../../core/errors';
import { sanitizeRelativePath } from '../../utils/filename';

/**
 * Reading 7Z, RAR (v4/v5), TAR, GZ/BZ2/XZ, ISO, CAB… with libarchive compiled to
 * WebAssembly. Each opened archive gets its own worker (vendor/libarchive), which is
 * terminated when the archive is closed (or the job is cancelled).
 * Entry dates are not shown: libarchive.js only exposes archive_entry_mtime_nsec (the
 * nanosecond fraction), not the actual modification time.
 */
let initialised = false;

function init(): void {
  if (initialised) return;
  initialised = true;
  const base = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('/') : new URL('/', location.href).href;
  Archive.init({ getWorker: () => new Worker(`${base}vendor/libarchive/worker.js`, { type: 'module', name: 'convertly-archive' }) });
}

export interface ArchiveItem {
  /** Path inside the archive as stored. */
  rawPath: string;
  /** Sanitised path used for saving (zip-slip safe). */
  path: string;
  size: number;
  unsafePath: boolean;
}

export interface OpenedArchive {
  items: ArchiveItem[];
  encrypted: boolean;
  extract(item: ArchiveItem): Promise<Blob>;
  close(): Promise<void>;
}

type LibArchive = Awaited<ReturnType<typeof Archive.open>>;
type CompressedLike = { name: string; size: number; lastModified: number; extract(): Promise<File> };

function mapError(err: unknown, encrypted: boolean): AppError {
  const message = err instanceof Error ? err.message : String(err);
  if (/passphrase|password|decrypt|Prefix found|encrypt/i.test(message)) return new AppError(encrypted ? 'archive-wrong-password' : 'archive-encrypted', message);
  if (/unrecognized archive|truncated|damaged|invalid|error reading/i.test(message)) return new AppError('invalid-archive', message);
  return toAppError(err);
}

export async function openArchive(file: Blob, name: string, password?: string): Promise<OpenedArchive> {
  init();
  let archive: LibArchive;
  try {
    archive = await Archive.open(new File([file], name));
  } catch (err) {
    throw mapError(err, false);
  }
  try {
    const encrypted = (await archive.hasEncryptedData()) === true;
    if (password) await archive.usePassword(password);
    const list = (await archive.getFilesArray()) as Array<{ file: CompressedLike; path: string }>;
    if (!list.length && file.size > 0) throw new AppError('invalid-archive', 'No files found in the archive');
    const map = new Map<ArchiveItem, CompressedLike>();
    const items = list.map(({ file: f, path }) => {
      const rawPath = `${path}${f.name}`;
      const item: ArchiveItem = {
        rawPath,
        path: sanitizeRelativePath(rawPath) || f.name || 'file',
        size: f.size,
        unsafePath: rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath) || rawPath.split(/[\\/]/).includes('..'),
      };
      map.set(item, f);
      return item;
    });
    return {
      items,
      encrypted,
      async extract(item) {
        const entry = map.get(item);
        if (!entry) throw new AppError('invalid-input', 'Unknown entry');
        try {
          const out = await entry.extract();
          if (out.size !== item.size && item.size > 0) throw new AppError('invalid-archive', `Size mismatch for ${item.path}`);
          return out;
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw mapError(err, encrypted);
        }
      },
      close: () => archive.close(),
    };
  } catch (err) {
    await archive.close();
    throw err instanceof AppError ? err : mapError(err, false);
  }
}
