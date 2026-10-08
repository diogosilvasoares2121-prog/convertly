/**
 * Helpers to read files from drag & drop / inputs, including whole folders.
 * Files are only referenced (File objects); nothing is copied or uploaded.
 */
export interface PickedFile {
  file: File;
  /** Relative path inside a dropped/selected folder ("" for loose files). */
  path: string;
}

const MAX_FILES = 5000;

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, prefix: string, out: PickedFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    out.push({ file, path: prefix + file.name });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await readEntries(reader);
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === 'file');
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null));
  if (entries.some((e) => e?.isDirectory)) {
    for (const [k, entry] of entries.entries()) {
      if (entry) await walk(entry, '', out);
      else {
        const f = items[k]?.getAsFile();
        if (f) out.push({ file: f, path: f.name });
      }
    }
    return out;
  }
  return Array.from(dt.files ?? []).map((file) => ({ file, path: file.name }));
}

export function filesFromInput(input: HTMLInputElement): PickedFile[] {
  return Array.from(input.files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files');
}
