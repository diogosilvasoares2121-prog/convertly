const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// Characters not allowed in file names on at least one major OS, plus control characters.
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
export const MAX_NAME_LENGTH = 150;

/** Splits "photo.final.JPG" into { base: "photo.final", ext: "jpg" }. */
export function splitName(name: string): { base: string; ext: string } {
  const clean = name.split(/[\\/]/).pop() ?? name;
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return { base: clean, ext: '' };
  return { base: clean.slice(0, dot), ext: clean.slice(dot + 1).toLowerCase() };
}

/** Truncates to `max` UTF-16 units without splitting surrogate pairs (emoji safe). */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of Array.from(text)) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * Makes a single path segment safe for downloads on Windows, macOS and Linux.
 * Keeps unicode and emoji; removes illegal characters, reserved names and trailing dots/spaces.
 */
export function sanitizeFilename(name: string, fallback = 'file'): string {
  let out = name.normalize('NFC').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim();
  out = out.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!out) out = fallback;
  if (WINDOWS_RESERVED.test(splitName(out).base)) out = `_${out}`;
  if (out.length > MAX_NAME_LENGTH) {
    const { base, ext } = splitName(out);
    const suffix = ext && ext.length <= 10 ? `.${ext}` : '';
    const stem = suffix ? base : out;
    out = truncate(stem, MAX_NAME_LENGTH - suffix.length).trim() + suffix;
  }
  return out;
}

/**
 * Sanitises a relative path such as "folder/sub/file.txt".
 * Drops "..", "." and empty segments, drive letters and leading slashes, so the
 * result can never escape the destination folder (zip-slip protection).
 */
export function sanitizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeFilename(s, '_'))
    .join('/');
}

/** "photo.heic" + "jpg" → "photo.jpg"; with suffix → "photo-compressed.jpg". */
export function renameWithExtension(original: string, ext: string, suffix = ''): string {
  const { base } = splitName(original);
  const stem = base || 'file';
  return sanitizeFilename(`${stem}${suffix ? `-${suffix}` : ''}${ext ? `.${ext}` : ''}`);
}

/** Ensures unique names inside a batch or ZIP: "photo.jpg", "photo (1).jpg", … */
export class NameDeduper {
  private used = new Set<string>();

  unique(name: string): string {
    const key = name.toLowerCase();
    if (!this.used.has(key)) {
      this.used.add(key);
      return name;
    }
    const slash = name.lastIndexOf('/');
    const dir = slash >= 0 ? name.slice(0, slash + 1) : '';
    const { base, ext } = splitName(name.slice(slash + 1));
    for (let i = 1; ; i++) {
      const candidate = `${dir}${base} (${i})${ext ? `.${ext}` : ''}`;
      if (!this.used.has(candidate.toLowerCase())) {
        this.used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  }
}
