export type Category = 'image' | 'pdf' | 'video' | 'audio' | 'archive' | 'data';

export const CATEGORIES: readonly Category[] = ['image', 'pdf', 'video', 'audio', 'archive', 'data'];

export type FormatId =
  // images
  | 'jpg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'heic'
  | 'avif'
  | 'tiff'
  | 'ico'
  | 'svg'
  // documents
  | 'pdf'
  // video
  | 'mp4'
  | 'mov'
  | 'webm'
  | 'avi'
  | 'mkv'
  | 'mpeg'
  | '3gp'
  | 'wmv'
  // audio
  | 'mp3'
  | 'wav'
  | 'aac'
  | 'm4a'
  | 'ogg'
  | 'opus'
  | 'flac'
  | 'weba'
  | 'wma'
  // archive
  | 'zip'
  | '7z'
  | 'rar'
  | 'tar'
  | 'gz'
  | 'bz2'
  | 'xz'
  | 'iso'
  // data
  | 'json'
  | 'csv'
  | 'xml'
  | 'txt'
  | 'yaml'
  | 'md'
  | 'html'
  | 'xlsx';

export interface FormatInfo {
  id: FormatId;
  label: string;
  category: Category;
  /** Lower-case extensions without dot; the first one is used for output files. */
  extensions: string[];
  /** MIME types; the first one is used for output blobs. */
  mimes: string[];
}

const F = (id: FormatId, label: string, category: Category, extensions: string[], mimes: string[]): FormatInfo => ({
  id,
  label,
  category,
  extensions,
  mimes,
});

export const FORMATS: Record<FormatId, FormatInfo> = {
  jpg: F('jpg', 'JPG', 'image', ['jpg', 'jpeg', 'jpe', 'jfif'], ['image/jpeg', 'image/pjpeg']),
  png: F('png', 'PNG', 'image', ['png', 'apng'], ['image/png', 'image/apng']),
  webp: F('webp', 'WEBP', 'image', ['webp'], ['image/webp']),
  gif: F('gif', 'GIF', 'image', ['gif'], ['image/gif']),
  bmp: F('bmp', 'BMP', 'image', ['bmp', 'dib'], ['image/bmp', 'image/x-ms-bmp']),
  heic: F('heic', 'HEIC', 'image', ['heic', 'heif', 'hif'], ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']),
  avif: F('avif', 'AVIF', 'image', ['avif'], ['image/avif']),
  tiff: F('tiff', 'TIFF', 'image', ['tif', 'tiff'], ['image/tiff']),
  ico: F('ico', 'ICO', 'image', ['ico', 'cur'], ['image/x-icon', 'image/vnd.microsoft.icon']),
  svg: F('svg', 'SVG', 'image', ['svg'], ['image/svg+xml']),
  pdf: F('pdf', 'PDF', 'pdf', ['pdf'], ['application/pdf']),
  mp4: F('mp4', 'MP4', 'video', ['mp4', 'm4v'], ['video/mp4', 'video/x-m4v']),
  mov: F('mov', 'MOV', 'video', ['mov', 'qt'], ['video/quicktime']),
  webm: F('webm', 'WEBM', 'video', ['webm'], ['video/webm']),
  avi: F('avi', 'AVI', 'video', ['avi'], ['video/x-msvideo', 'video/avi', 'video/msvideo']),
  mkv: F('mkv', 'MKV', 'video', ['mkv'], ['video/x-matroska', 'video/matroska']),
  mpeg: F('mpeg', 'MPEG', 'video', ['mpg', 'mpeg', 'mpe', 'm1v', 'm2v', 'vob'], ['video/mpeg']),
  '3gp': F('3gp', '3GP', 'video', ['3gp', '3g2', '3gpp'], ['video/3gpp', 'video/3gpp2']),
  wmv: F('wmv', 'WMV', 'video', ['wmv', 'asf'], ['video/x-ms-wmv', 'video/x-ms-asf']),
  mp3: F('mp3', 'MP3', 'audio', ['mp3'], ['audio/mpeg', 'audio/mp3']),
  wav: F('wav', 'WAV', 'audio', ['wav', 'wave'], ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']),
  aac: F('aac', 'AAC', 'audio', ['aac', 'adts'], ['audio/aac', 'audio/x-aac']),
  m4a: F('m4a', 'M4A', 'audio', ['m4a', 'm4b'], ['audio/mp4', 'audio/x-m4a', 'audio/m4a']),
  ogg: F('ogg', 'OGG', 'audio', ['ogg', 'oga'], ['audio/ogg', 'application/ogg']),
  opus: F('opus', 'OPUS', 'audio', ['opus'], ['audio/opus']),
  flac: F('flac', 'FLAC', 'audio', ['flac'], ['audio/flac', 'audio/x-flac']),
  weba: F('weba', 'WEBM audio', 'audio', ['weba'], ['audio/webm']),
  wma: F('wma', 'WMA', 'audio', ['wma'], ['audio/x-ms-wma']),
  zip: F('zip', 'ZIP', 'archive', ['zip'], ['application/zip', 'application/x-zip-compressed']),
  '7z': F('7z', '7Z', 'archive', ['7z'], ['application/x-7z-compressed']),
  rar: F('rar', 'RAR', 'archive', ['rar'], ['application/vnd.rar', 'application/x-rar-compressed']),
  tar: F('tar', 'TAR', 'archive', ['tar'], ['application/x-tar']),
  gz: F('gz', 'GZ', 'archive', ['gz', 'tgz', 'gzip'], ['application/gzip', 'application/x-gzip']),
  bz2: F('bz2', 'BZ2', 'archive', ['bz2', 'tbz2', 'tbz'], ['application/x-bzip2']),
  xz: F('xz', 'XZ', 'archive', ['xz', 'txz'], ['application/x-xz']),
  iso: F('iso', 'ISO', 'archive', ['iso'], ['application/x-iso9660-image']),
  json: F('json', 'JSON', 'data', ['json', 'geojson', 'webmanifest'], ['application/json', 'text/json']),
  csv: F('csv', 'CSV', 'data', ['csv', 'tsv'], ['text/csv', 'text/tab-separated-values']),
  xml: F('xml', 'XML', 'data', ['xml', 'rss', 'atom', 'xsd', 'xsl', 'gpx', 'kml', 'plist'], ['application/xml', 'text/xml']),
  txt: F('txt', 'TXT', 'data', ['txt', 'text', 'log', 'ini', 'cfg'], ['text/plain']),
  yaml: F('yaml', 'YAML', 'data', ['yaml', 'yml'], ['application/yaml', 'text/yaml', 'application/x-yaml']),
  md: F('md', 'Markdown', 'data', ['md', 'markdown'], ['text/markdown']),
  html: F('html', 'HTML', 'data', ['html', 'htm'], ['text/html']),
  xlsx: F('xlsx', 'XLSX', 'data', ['xlsx'], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
};

export const ALL_FORMATS = Object.values(FORMATS);

export function formatLabel(id: FormatId): string {
  return FORMATS[id].label;
}

export function outputExtension(id: FormatId): string {
  return FORMATS[id].extensions[0]!;
}

export function outputMime(id: FormatId): string {
  return FORMATS[id].mimes[0]!;
}

const byExtension = new Map<string, FormatId>();
const byMime = new Map<string, FormatId>();
for (const f of ALL_FORMATS) {
  for (const e of f.extensions) if (!byExtension.has(e)) byExtension.set(e, f.id);
  for (const m of f.mimes) if (!byMime.has(m)) byMime.set(m, f.id);
}

export function formatFromExtension(ext: string): FormatId | null {
  return byExtension.get(ext.toLowerCase().replace(/^\./, '')) ?? null;
}

export function formatFromMime(mime: string): FormatId | null {
  return byMime.get(mime.toLowerCase().split(';')[0]!.trim()) ?? null;
}

/** `accept` attribute value for <input type=file> for a list of formats. */
export function acceptAttribute(formats: readonly FormatId[] | '*'): string {
  if (formats === '*') return '';
  const parts = new Set<string>();
  for (const id of formats) {
    for (const e of FORMATS[id].extensions) parts.add(`.${e}`);
    for (const m of FORMATS[id].mimes) parts.add(m);
  }
  return [...parts].join(',');
}
