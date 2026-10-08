import { hasCapabilities } from '../core/capabilities';
import type { MessageKey } from '../i18n';
import { FORMATS, type Category, type FormatId } from './formats';
import { AUDIO_INPUTS, VIDEO_INPUTS, canConvert } from './matrix';
import type { IconName, ToolComponentKey, ToolDef, ToolEngine, ToolGroup } from './types';
import type { CapabilityKey } from '../core/capabilities';

const IMAGE_INPUTS: FormatId[] = ['jpg', 'png', 'webp', 'gif', 'bmp', 'heic', 'avif', 'tiff', 'ico'];
const IMAGE_EDITABLE: FormatId[] = ['jpg', 'png', 'webp', 'gif', 'bmp', 'heic', 'avif', 'tiff'];
const ARCHIVE_INPUTS: FormatId[] = ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'iso'];
const IMAGE_CAPS: CapabilityKey[] = ['worker', 'offscreenCanvas'];
const MEDIA_CAPS: CapabilityKey[] = ['wasm', 'worker'];
const VIDEO_WITH_GIF: FormatId[] = [...VIDEO_INPUTS, 'gif'];

interface BaseSpec {
  id: string;
  category: Category;
  group: ToolGroup;
  icon: IconName;
  component: ToolComponentKey;
  engine: ToolEngine;
  accepts: FormatId[] | '*';
  outputs?: FormatId[];
  multiple?: boolean;
  requires?: CapabilityKey[];
  keywords?: string[];
  preset?: ToolDef['preset'];
  popular?: boolean;
  heavy?: boolean;
  formatTitle?: boolean;
  hidden?: boolean;
}

function tool(spec: BaseSpec): ToolDef {
  return {
    id: spec.id,
    category: spec.category,
    group: spec.group,
    title: { key: `tool.${spec.id}.title` as MessageKey },
    description: { key: `tool.${spec.id}.desc` as MessageKey },
    ...(spec.formatTitle ? { formatTitleKey: `tool.${spec.id}.withFormat` as MessageKey } : {}),
    keywords: spec.keywords ?? [],
    icon: spec.icon,
    accepts: spec.accepts,
    ...(spec.outputs ? { outputs: spec.outputs } : {}),
    engine: spec.engine,
    requires: spec.requires ?? [],
    multiple: spec.multiple ?? false,
    component: spec.component,
    ...(spec.preset ? { preset: spec.preset } : {}),
    ...(spec.popular ? { popular: true } : {}),
    ...(spec.heavy ? { heavy: true } : {}),
    ...(spec.hidden ? { hidden: true } : {}),
  };
}

interface PairSpec {
  from: FormatId;
  to: FormatId;
  component: ToolComponentKey;
  category: Category;
  icon: IconName;
  engine: ToolEngine;
  requires: CapabilityKey[];
  multiple: boolean;
  fromLabel?: string;
  id?: string;
  popular?: boolean;
  heavy?: boolean;
  descKey: MessageKey;
}

/** Generates a format-pair tool such as "HEIC → JPG" that opens a generic tool with a preset. */
function pair(spec: PairSpec): ToolDef {
  const fromLabel = spec.fromLabel ?? FORMATS[spec.from].label;
  const toLabel = FORMATS[spec.to].label;
  const id = spec.id ?? `${spec.from}-to-${spec.to}`;
  return {
    id,
    category: spec.category,
    group: 'convert',
    title: { text: `${fromLabel} → ${toLabel}` },
    description: { key: spec.descKey, params: { from: fromLabel, to: toLabel } },
    keywords: [fromLabel.toLowerCase(), toLabel.toLowerCase(), 'convert'],
    icon: spec.icon,
    accepts: [spec.from],
    outputs: [spec.to],
    engine: spec.engine,
    requires: spec.requires,
    multiple: spec.multiple,
    component: spec.component,
    preset: { from: spec.from, to: spec.to },
    pair: true,
    ...(spec.popular ? { popular: true } : {}),
    ...(spec.heavy ? { heavy: true } : {}),
  };
}

const imagePair = (from: FormatId, to: FormatId, extra: Partial<PairSpec> = {}): ToolDef =>
  pair({
    from,
    to,
    component: 'image-convert',
    category: 'image',
    icon: 'convert',
    engine: from === 'heic' ? 'heic' : 'canvas',
    requires: from === 'heic' ? [...IMAGE_CAPS, 'wasm'] : to === 'avif' ? [...IMAGE_CAPS, 'encodeAvif'] : to === 'webp' ? [...IMAGE_CAPS, 'encodeWebp'] : IMAGE_CAPS,
    multiple: true,
    descKey: 'pair.image.desc',
    ...extra,
  });

const imageToPdfPair = (from: FormatId, extra: Partial<PairSpec> = {}): ToolDef =>
  pair({ from, to: 'pdf', component: 'images-to-pdf', category: 'pdf', icon: 'image-pdf', engine: 'pdf-lib', requires: from === 'heic' ? [...IMAGE_CAPS, 'wasm'] : IMAGE_CAPS, multiple: true, descKey: 'pair.imagePdf.desc', ...extra });

const pdfToImagePair = (to: FormatId, extra: Partial<PairSpec> = {}): ToolDef =>
  pair({ from: 'pdf', to, component: 'pdf-to-image', category: 'pdf', icon: 'pdf-image', engine: 'pdfjs', requires: ['worker'], multiple: false, descKey: 'pair.pdfImage.desc', ...extra });

const videoPair = (from: FormatId, to: FormatId, extra: Partial<PairSpec> = {}): ToolDef =>
  pair({
    from,
    to,
    component: to === 'gif' ? 'video-gif' : 'media-convert',
    category: 'video',
    icon: to === 'gif' ? 'gif' : 'video',
    engine: 'ffmpeg',
    requires: MEDIA_CAPS,
    multiple: to !== 'gif',
    heavy: true,
    descKey: to === 'gif' ? 'pair.videoGif.desc' : 'pair.video.desc',
    ...extra,
  });

const videoAudioPair = (from: FormatId, to: FormatId, extra: Partial<PairSpec> = {}): ToolDef =>
  pair({ from, to, component: 'media-convert', category: 'video', icon: 'music', engine: 'ffmpeg', requires: MEDIA_CAPS, multiple: true, heavy: true, descKey: 'pair.videoAudio.desc', ...extra });

const audioPair = (from: FormatId, to: FormatId, extra: Partial<PairSpec> = {}): ToolDef =>
  pair({ from, to, component: 'media-convert', category: 'audio', icon: 'audio', engine: 'ffmpeg', requires: MEDIA_CAPS, multiple: true, descKey: 'pair.audio.desc', ...extra });

const dataPair = (from: FormatId, to: FormatId, component: ToolComponentKey, mode: string): ToolDef => ({
  ...pair({ from, to, component, category: 'data', icon: 'table', engine: 'js', requires: [], multiple: false, descKey: 'pair.data.desc' }),
  preset: { from, to, mode },
});

export const TOOLS: ToolDef[] = [
  // ───────────── Image ─────────────
  tool({ id: 'image-convert', category: 'image', group: 'convert', icon: 'convert', component: 'image-convert', engine: 'canvas', accepts: IMAGE_INPUTS, outputs: ['jpg', 'png', 'webp', 'avif'], multiple: true, requires: IMAGE_CAPS, keywords: ['convert', 'format', 'batch', 'jpg', 'png', 'webp', 'heic', 'avif', 'bmp', 'tiff', 'gif'] }),
  tool({ id: 'svg-convert', category: 'image', group: 'convert', icon: 'shapes', component: 'svg-convert', engine: 'canvas', accepts: ['svg'], outputs: ['png', 'jpg', 'webp'], multiple: true, requires: ['offscreenCanvas'], keywords: ['svg', 'vector', 'rasterize', 'png', 'logo', 'icon'] }),
  tool({ id: 'image-to-ico', category: 'image', group: 'convert', icon: 'favicon', component: 'image-ico', engine: 'canvas', accepts: [...IMAGE_EDITABLE, 'svg'], outputs: ['ico'], requires: IMAGE_CAPS, keywords: ['ico', 'favicon', 'icon', 'website', 'windows'] }),
  tool({ id: 'image-compress', category: 'image', group: 'optimize', icon: 'compress', component: 'image-compress', engine: 'canvas', accepts: ['jpg', 'png', 'webp', 'heic', 'avif', 'bmp', 'tiff'], multiple: true, requires: IMAGE_CAPS, keywords: ['compress', 'reduce', 'optimize', 'quality', 'smaller'], popular: true, formatTitle: true }),
  tool({ id: 'image-resize', category: 'image', group: 'optimize', icon: 'resize', component: 'image-resize', engine: 'canvas', accepts: IMAGE_EDITABLE, multiple: true, requires: IMAGE_CAPS, keywords: ['resize', 'scale', 'dimensions', 'width', 'height', 'instagram', 'batch'], formatTitle: true }),
  tool({ id: 'image-crop', category: 'image', group: 'edit', icon: 'crop', component: 'image-crop', engine: 'canvas', accepts: IMAGE_EDITABLE, requires: IMAGE_CAPS, keywords: ['crop', 'cut', 'aspect', 'ratio', 'zoom', 'flip', 'rotate', 'circle', 'round', 'profile', 'avatar'], formatTitle: true }),
  tool({ id: 'image-rotate', category: 'image', group: 'edit', icon: 'rotate', component: 'image-rotate', engine: 'canvas', accepts: IMAGE_EDITABLE, multiple: true, requires: IMAGE_CAPS, keywords: ['rotate', 'flip', 'mirror', 'turn', 'orientation'], formatTitle: true }),
  tool({ id: 'image-adjust', category: 'image', group: 'edit', icon: 'adjust', component: 'image-adjust', engine: 'canvas', accepts: IMAGE_EDITABLE, multiple: true, requires: IMAGE_CAPS, keywords: ['filter', 'brightness', 'contrast', 'saturation', 'grayscale', 'black and white', 'sepia', 'blur', 'invert', 'effects', 'preto e branco'] }),
  tool({ id: 'image-watermark', category: 'image', group: 'edit', icon: 'watermark', component: 'image-watermark', engine: 'canvas', accepts: IMAGE_EDITABLE, multiple: true, requires: IMAGE_CAPS, keywords: ['watermark', 'text', 'copyright', 'logo', 'protect', 'stamp'] }),
  tool({ id: 'image-combine', category: 'image', group: 'create', icon: 'combine', component: 'image-combine', engine: 'canvas', accepts: IMAGE_EDITABLE, outputs: ['jpg', 'png', 'webp'], multiple: true, requires: IMAGE_CAPS, keywords: ['combine', 'merge', 'collage', 'join', 'side by side', 'stitch', 'grid'] }),
  tool({ id: 'image-split', category: 'image', group: 'create', icon: 'grid', component: 'image-split', engine: 'canvas', accepts: IMAGE_EDITABLE, requires: IMAGE_CAPS, keywords: ['split', 'grid', 'tiles', 'slice', 'instagram', 'carousel', 'puzzle'] }),
  tool({ id: 'images-to-gif', category: 'image', group: 'create', icon: 'gif', component: 'images-motion', engine: 'ffmpeg', accepts: IMAGE_EDITABLE, outputs: ['gif'], multiple: true, requires: [...IMAGE_CAPS, ...MEDIA_CAPS], keywords: ['gif', 'animated', 'animation', 'maker', 'frames'], preset: { mode: 'gif' } }),
  tool({ id: 'images-to-video', category: 'image', group: 'create', icon: 'slideshow', component: 'images-motion', engine: 'ffmpeg', accepts: IMAGE_EDITABLE, outputs: ['mp4'], multiple: true, requires: [...IMAGE_CAPS, ...MEDIA_CAPS], keywords: ['slideshow', 'video', 'mp4', 'photos', 'montage'], preset: { mode: 'mp4' }, heavy: true }),
  tool({ id: 'image-metadata', category: 'image', group: 'security', icon: 'metadata', component: 'image-metadata', engine: 'canvas', accepts: ['jpg', 'png', 'webp', 'heic', 'avif', 'tiff'], multiple: true, requires: IMAGE_CAPS, keywords: ['metadata', 'exif', 'gps', 'location', 'privacy', 'remove', 'strip', 'clean'], formatTitle: true }),
  tool({ id: 'images-to-pdf', category: 'image', group: 'convert', icon: 'image-pdf', component: 'images-to-pdf', engine: 'pdf-lib', accepts: ['jpg', 'png', 'webp', 'heic', 'gif', 'bmp', 'avif', 'tiff'], outputs: ['pdf'], multiple: true, requires: IMAGE_CAPS, keywords: ['pdf', 'image to pdf', 'photo to pdf', 'scan', 'document'] }),

  // ───────────── PDF ─────────────
  tool({ id: 'pdf-merge', category: 'pdf', group: 'organize', icon: 'merge', component: 'pdf-merge', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], multiple: true, requires: ['worker'], keywords: ['merge', 'combine', 'join'], popular: true }),
  tool({ id: 'pdf-split', category: 'pdf', group: 'organize', icon: 'split', component: 'pdf-split', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['split', 'separate', 'divide', 'ranges', 'extract'] }),
  tool({ id: 'pdf-organize', category: 'pdf', group: 'organize', icon: 'pages', component: 'pdf-pages', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['organize', 'reorder', 'sort', 'pages', 'arrange', 'duplicate', 'reverse', 'blank page', 'insert'], preset: { mode: 'organize' } }),
  tool({ id: 'pdf-rotate', category: 'pdf', group: 'organize', icon: 'rotate', component: 'pdf-pages', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['rotate', 'turn', 'orientation', 'pages'], preset: { mode: 'rotate' } }),
  tool({ id: 'pdf-delete-pages', category: 'pdf', group: 'organize', icon: 'pages', component: 'pdf-pages', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['delete', 'remove', 'pages'], preset: { mode: 'delete' } }),
  tool({ id: 'pdf-extract-pages', category: 'pdf', group: 'organize', icon: 'split', component: 'pdf-pages', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['extract', 'select', 'pages', 'save pages'], preset: { mode: 'extract' } }),
  tool({ id: 'pdf-to-image', category: 'pdf', group: 'convert', icon: 'pdf-image', component: 'pdf-to-image', engine: 'pdfjs', accepts: ['pdf'], outputs: ['jpg', 'png'], requires: ['worker'], keywords: ['pdf to image', 'render', 'jpg', 'png', 'dpi', 'export pages'] }),
  tool({ id: 'pdf-to-text', category: 'pdf', group: 'convert', icon: 'text', component: 'pdf-simple', engine: 'pdfjs', accepts: ['pdf'], outputs: ['txt'], requires: ['worker'], keywords: ['text', 'extract text', 'txt', 'copy', 'words'], preset: { mode: 'text' } }),
  tool({ id: 'text-to-pdf', category: 'pdf', group: 'convert', icon: 'text', component: 'text-to-pdf', engine: 'pdf-lib', accepts: ['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'html'], outputs: ['pdf'], requires: ['worker'], keywords: ['text to pdf', 'txt', 'notes', 'create pdf'] }),
  tool({ id: 'pdf-extract-images', category: 'pdf', group: 'convert', icon: 'images', component: 'pdf-simple', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['jpg', 'png'], requires: ['worker', 'offscreenCanvas'], keywords: ['extract images', 'photos', 'pictures', 'embedded'], preset: { mode: 'images' } }),
  tool({ id: 'pdf-page-numbers', category: 'pdf', group: 'edit', icon: 'numbers', component: 'pdf-page-numbers', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['page numbers', 'numbering', 'paginate', 'footer'] }),
  tool({ id: 'pdf-watermark', category: 'pdf', group: 'edit', icon: 'watermark', component: 'pdf-watermark', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['watermark', 'stamp', 'confidential', 'draft', 'text'] }),
  tool({ id: 'pdf-crop', category: 'pdf', group: 'edit', icon: 'crop', component: 'pdf-crop', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['crop', 'margins', 'trim', 'cut'] }),
  tool({ id: 'pdf-compress', category: 'pdf', group: 'optimize', icon: 'compress', component: 'pdf-compress', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker', 'offscreenCanvas'], keywords: ['compress', 'reduce', 'optimize', 'smaller'] }),
  tool({ id: 'pdf-repair', category: 'pdf', group: 'optimize', icon: 'repair', component: 'pdf-simple', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['repair', 'fix', 'broken', 'damaged', 'corrupt', 'recover'], preset: { mode: 'repair' } }),
  tool({ id: 'pdf-metadata', category: 'pdf', group: 'security', icon: 'metadata', component: 'pdf-metadata', engine: 'pdf-lib', accepts: ['pdf'], outputs: ['pdf'], requires: ['worker'], keywords: ['metadata', 'properties', 'title', 'author', 'remove', 'privacy'] }),

  // ───────────── Video ─────────────
  tool({ id: 'video-convert', category: 'video', group: 'convert', icon: 'video', component: 'media-convert', engine: 'ffmpeg', accepts: VIDEO_WITH_GIF, outputs: ['mp4', 'webm', 'mov', 'mkv'], multiple: true, requires: MEDIA_CAPS, heavy: true, keywords: ['convert', 'mp4', 'webm', 'mov', 'mkv', 'avi', 'format'] }),
  tool({ id: 'video-to-audio', category: 'video', group: 'convert', icon: 'music', component: 'media-convert', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], outputs: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'], multiple: true, requires: MEDIA_CAPS, heavy: true, keywords: ['audio', 'extract audio', 'mp3', 'wav', 'sound', 'music'], preset: { mode: 'audio', to: 'mp3' } }),
  tool({ id: 'video-to-gif', category: 'video', group: 'convert', icon: 'gif', component: 'video-gif', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], outputs: ['gif'], requires: MEDIA_CAPS, heavy: true, keywords: ['gif', 'animated', 'animation'] }),
  tool({ id: 'video-to-frames', category: 'video', group: 'convert', icon: 'frames', component: 'video-frames', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], outputs: ['jpg', 'png'], requires: MEDIA_CAPS, heavy: true, keywords: ['frames', 'screenshots', 'thumbnails', 'images', 'stills', 'jpg'] }),
  tool({ id: 'video-compress', category: 'video', group: 'optimize', icon: 'compress', component: 'video-compress', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], outputs: ['mp4'], requires: MEDIA_CAPS, heavy: true, keywords: ['compress', 'reduce', 'smaller', 'bitrate', 'optimize'] }),
  tool({ id: 'video-resize', category: 'video', group: 'optimize', icon: 'resize', component: 'video-edit', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['resize', 'scale', '1080p', '720p', '480p', 'resolution'], preset: { mode: 'resize' } }),
  tool({ id: 'video-trim', category: 'video', group: 'edit', icon: 'trim', component: 'media-trim', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['trim', 'cut', 'clip', 'shorten', 'segment'], preset: { mode: 'video' } }),
  tool({ id: 'video-crop', category: 'video', group: 'edit', icon: 'ratio', component: 'video-edit', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['crop', 'aspect ratio', 'square', 'vertical', '9:16', 'reels', 'tiktok', 'shorts'], preset: { mode: 'crop' } }),
  tool({ id: 'video-rotate', category: 'video', group: 'edit', icon: 'rotate', component: 'video-edit', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['rotate', 'turn', 'orientation', 'flip'], preset: { mode: 'rotate' } }),
  tool({ id: 'video-speed', category: 'video', group: 'edit', icon: 'speed', component: 'media-speed', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['speed', 'fast', 'slow motion', 'timelapse', 'accelerate'], preset: { mode: 'video' } }),
  tool({ id: 'video-mute', category: 'video', group: 'edit', icon: 'mute', component: 'video-edit', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['mute', 'remove audio', 'silent', 'no sound'], preset: { mode: 'mute' } }),
  tool({ id: 'video-add-audio', category: 'video', group: 'edit', icon: 'music-plus', component: 'video-add-audio', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], requires: MEDIA_CAPS, heavy: true, keywords: ['add music', 'replace audio', 'soundtrack', 'background music', 'audio to video'] }),
  tool({ id: 'video-merge', category: 'video', group: 'create', icon: 'join', component: 'media-merge', engine: 'ffmpeg', accepts: [...VIDEO_INPUTS], outputs: ['mp4'], multiple: true, requires: MEDIA_CAPS, heavy: true, keywords: ['merge', 'join', 'combine', 'concatenate', 'append'], preset: { mode: 'video' } }),

  // ───────────── Audio ─────────────
  tool({ id: 'audio-convert', category: 'audio', group: 'convert', icon: 'audio', component: 'media-convert', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], outputs: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'], multiple: true, requires: MEDIA_CAPS, keywords: ['convert', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'music', 'mono', 'stereo', 'sample rate'], preset: { mode: 'audio' } }),
  tool({ id: 'audio-bitrate', category: 'audio', group: 'optimize', icon: 'compress', component: 'media-convert', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], outputs: ['mp3', 'm4a', 'aac', 'ogg', 'opus'], multiple: true, requires: MEDIA_CAPS, keywords: ['bitrate', 'compress', 'kbps', 'quality', 'reduce'], preset: { mode: 'bitrate' } }),
  tool({ id: 'audio-volume', category: 'audio', group: 'optimize', icon: 'volume', component: 'audio-effect', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], multiple: true, requires: MEDIA_CAPS, keywords: ['volume', 'louder', 'quieter', 'normalize', 'gain', 'boost', 'loudness'], preset: { mode: 'volume' } }),
  tool({ id: 'audio-trim', category: 'audio', group: 'edit', icon: 'trim', component: 'media-trim', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], requires: MEDIA_CAPS, keywords: ['trim', 'cut', 'segment', 'extract', 'ringtone', 'waveform'], preset: { mode: 'audio' } }),
  tool({ id: 'audio-fade', category: 'audio', group: 'edit', icon: 'fade', component: 'audio-effect', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], multiple: true, requires: MEDIA_CAPS, keywords: ['fade', 'fade in', 'fade out', 'smooth'], preset: { mode: 'fade' } }),
  tool({ id: 'audio-speed', category: 'audio', group: 'edit', icon: 'speed', component: 'media-speed', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], requires: MEDIA_CAPS, keywords: ['speed', 'tempo', 'faster', 'slower', 'podcast'], preset: { mode: 'audio' } }),
  tool({ id: 'audio-reverse', category: 'audio', group: 'edit', icon: 'reverse-audio', component: 'audio-effect', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], multiple: true, requires: MEDIA_CAPS, keywords: ['reverse', 'backwards'], preset: { mode: 'reverse' } }),
  tool({ id: 'audio-merge', category: 'audio', group: 'create', icon: 'join', component: 'media-merge', engine: 'ffmpeg', accepts: [...AUDIO_INPUTS], outputs: ['mp3', 'wav', 'm4a', 'ogg', 'flac'], multiple: true, requires: MEDIA_CAPS, keywords: ['merge', 'join', 'combine', 'concatenate', 'mix tape'], preset: { mode: 'audio' } }),

  // ───────────── Archive ─────────────
  tool({ id: 'zip-create', category: 'archive', group: 'create', icon: 'archive', component: 'zip-create', engine: 'zip', accepts: '*', outputs: ['zip'], multiple: true, requires: ['worker'], keywords: ['zip', 'compress', 'archive', 'folder', 'bundle', 'pack'], preset: { to: 'zip' } }),
  tool({ id: 'archive-create', category: 'archive', group: 'create', icon: 'package', component: 'zip-create', engine: 'zip', accepts: '*', outputs: ['zip', 'tar', 'gz'], multiple: true, requires: ['worker'], keywords: ['tar', 'tar.gz', 'tgz', 'gzip', 'gz', 'archive', 'compress'], preset: { to: 'tar' } }),
  tool({ id: 'zip-extract', category: 'archive', group: 'extract', icon: 'extract', component: 'zip-extract', engine: 'zip', accepts: ['zip'], requires: ['worker'], keywords: ['unzip', 'extract', 'open', 'decompress'] }),
  tool({ id: 'archive-extract', category: 'archive', group: 'extract', icon: 'extract', component: 'archive-extract', engine: 'zip', accepts: ARCHIVE_INPUTS, requires: ['worker', 'wasm'], keywords: ['extract', 'unpack', '7z', '7zip', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'password', 'unrar', 'decompress'], popular: true }),
  tool({ id: 'extract-rar', category: 'archive', group: 'extract', icon: 'extract', component: 'archive-extract', engine: 'zip', accepts: ['rar'], requires: ['worker', 'wasm'], keywords: ['rar', 'unrar', 'extract'], hidden: true }),
  tool({ id: 'extract-7z', category: 'archive', group: 'extract', icon: 'extract', component: 'archive-extract', engine: 'zip', accepts: ['7z'], requires: ['worker', 'wasm'], keywords: ['7z', '7zip', 'extract'], hidden: true }),
  tool({ id: 'extract-tar', category: 'archive', group: 'extract', icon: 'extract', component: 'archive-extract', engine: 'zip', accepts: ['tar', 'gz', 'bz2', 'xz'], requires: ['worker', 'wasm'], keywords: ['tar', 'tgz', 'tar.gz', 'gz', 'gzip', 'bz2', 'xz', 'extract'], hidden: true }),

  // ───────────── Data ─────────────
  tool({ id: 'json-format', category: 'data', group: 'format', icon: 'json', component: 'data-json', engine: 'js', accepts: ['json', 'txt'], keywords: ['json', 'format', 'beautify', 'pretty', 'validate', 'indent'], preset: { mode: 'format' } }),
  tool({ id: 'json-minify', category: 'data', group: 'format', icon: 'json', component: 'data-json', engine: 'js', accepts: ['json', 'txt'], keywords: ['json', 'minify', 'compact', 'compress'], preset: { mode: 'minify' } }),
  tool({ id: 'xml-format', category: 'data', group: 'format', icon: 'xml', component: 'data-xml', engine: 'js', accepts: ['xml', 'svg', 'html', 'txt'], keywords: ['xml', 'format', 'beautify', 'pretty', 'validate', 'svg'], preset: { mode: 'format' } }),
  tool({ id: 'json-to-csv', category: 'data', group: 'convert', icon: 'csv', component: 'data-csv', engine: 'js', accepts: ['json', 'txt'], outputs: ['csv'], keywords: ['json', 'csv', 'spreadsheet', 'table'], preset: { mode: 'json-to-csv' } }),
  tool({ id: 'csv-to-json', category: 'data', group: 'convert', icon: 'csv', component: 'data-csv', engine: 'js', accepts: ['csv', 'txt'], outputs: ['json'], keywords: ['csv', 'json', 'spreadsheet', 'table', 'tsv'], preset: { mode: 'csv-to-json' } }),
  tool({ id: 'xlsx-convert', category: 'data', group: 'convert', icon: 'table', component: 'data-xlsx', engine: 'js', accepts: ['xlsx', 'csv', 'json', 'txt'], outputs: ['xlsx', 'csv', 'json'], keywords: ['excel', 'xlsx', 'spreadsheet', 'csv', 'json', 'sheets', 'folha de calculo'], popular: true }),
  tool({ id: 'xml-to-json', category: 'data', group: 'convert', icon: 'xml', component: 'data-xml', engine: 'js', accepts: ['xml', 'svg', 'txt'], outputs: ['json'], keywords: ['xml', 'json', 'convert'], preset: { mode: 'to-json' } }),
  tool({ id: 'json-to-xml', category: 'data', group: 'convert', icon: 'xml', component: 'data-xml', engine: 'js', accepts: ['json', 'txt'], outputs: ['xml'], keywords: ['json', 'xml', 'convert'], preset: { mode: 'from-json' } }),
  tool({ id: 'yaml-to-json', category: 'data', group: 'convert', icon: 'yaml', component: 'data-yaml', engine: 'js', accepts: ['yaml', 'txt'], outputs: ['json'], keywords: ['yaml', 'yml', 'json', 'config', 'kubernetes'], preset: { mode: 'to-json' } }),
  tool({ id: 'json-to-yaml', category: 'data', group: 'convert', icon: 'yaml', component: 'data-yaml', engine: 'js', accepts: ['json', 'txt'], outputs: ['yaml'], keywords: ['yaml', 'yml', 'json', 'config'], preset: { mode: 'from-json' } }),
  tool({ id: 'markdown-to-html', category: 'data', group: 'convert', icon: 'markdown', component: 'data-markdown', engine: 'js', accepts: ['md', 'txt'], outputs: ['html'], keywords: ['markdown', 'md', 'html', 'readme', 'docs'] }),
  tool({ id: 'base64-encode', category: 'data', group: 'format', icon: 'base64', component: 'data-base64', engine: 'js', accepts: ['txt', 'json', 'csv', 'xml'], keywords: ['base64', 'encode', 'text'], preset: { mode: 'encode' } }),
  tool({ id: 'base64-decode', category: 'data', group: 'format', icon: 'base64', component: 'data-base64', engine: 'js', accepts: ['txt'], keywords: ['base64', 'decode', 'text'], preset: { mode: 'decode' } }),
  tool({ id: 'file-to-base64', category: 'data', group: 'format', icon: 'base64', component: 'data-base64', engine: 'js', accepts: '*', keywords: ['base64', 'data url', 'data uri', 'embed', 'file'], preset: { mode: 'file-encode' }, formatTitle: true }),
  tool({ id: 'base64-to-file', category: 'data', group: 'format', icon: 'base64', component: 'data-base64', engine: 'js', accepts: ['txt'], keywords: ['base64', 'data url', 'decode', 'file', 'download'], preset: { mode: 'file-decode' } }),
  tool({ id: 'url-encode', category: 'data', group: 'format', icon: 'link', component: 'data-url', engine: 'js', accepts: ['txt'], keywords: ['url', 'encode', 'percent', 'uri', 'escape'], preset: { mode: 'encode' } }),
  tool({ id: 'url-decode', category: 'data', group: 'format', icon: 'link', component: 'data-url', engine: 'js', accepts: ['txt'], keywords: ['url', 'decode', 'percent', 'uri', 'unescape'], preset: { mode: 'decode' } }),
  tool({ id: 'file-hash', category: 'data', group: 'security', icon: 'hash', component: 'data-hash', engine: 'js', accepts: '*', multiple: true, requires: ['worker'], keywords: ['hash', 'checksum', 'md5', 'sha1', 'sha256', 'verify', 'integrity'] }),

  // ───────────── Format pairs (search + detection shortcuts) ─────────────
  imagePair('jpg', 'png'),
  imagePair('jpg', 'webp'),
  imagePair('jpg', 'avif'),
  imagePair('png', 'jpg'),
  imagePair('png', 'webp'),
  imagePair('png', 'avif'),
  imagePair('webp', 'jpg'),
  imagePair('webp', 'png'),
  imagePair('heic', 'jpg', { popular: true }),
  imagePair('heic', 'png'),
  imagePair('heic', 'webp'),
  imagePair('heic', 'jpg', { id: 'heif-to-jpg', fromLabel: 'HEIF' }),
  imagePair('heic', 'png', { id: 'heif-to-png', fromLabel: 'HEIF' }),
  imagePair('bmp', 'jpg'),
  imagePair('bmp', 'png'),
  imagePair('bmp', 'webp'),
  imagePair('tiff', 'jpg'),
  imagePair('tiff', 'png'),
  imagePair('gif', 'png'),
  imagePair('gif', 'jpg'),
  imagePair('avif', 'jpg'),
  imagePair('avif', 'png'),
  imagePair('ico', 'png'),
  pair({ from: 'svg', to: 'png', component: 'svg-convert', category: 'image', icon: 'shapes', engine: 'canvas', requires: ['offscreenCanvas'], multiple: true, descKey: 'pair.image.desc' }),
  pair({ from: 'svg', to: 'jpg', component: 'svg-convert', category: 'image', icon: 'shapes', engine: 'canvas', requires: ['offscreenCanvas'], multiple: true, descKey: 'pair.image.desc' }),
  pair({ from: 'png', to: 'ico', component: 'image-ico', category: 'image', icon: 'favicon', engine: 'canvas', requires: IMAGE_CAPS, multiple: false, descKey: 'pair.image.desc' }),
  pair({ from: 'jpg', to: 'ico', component: 'image-ico', category: 'image', icon: 'favicon', engine: 'canvas', requires: IMAGE_CAPS, multiple: false, descKey: 'pair.image.desc' }),
  imageToPdfPair('jpg', { popular: true }),
  imageToPdfPair('png'),
  imageToPdfPair('webp'),
  imageToPdfPair('heic'),
  pdfToImagePair('jpg', { popular: true }),
  pdfToImagePair('png'),
  pair({ from: 'txt', to: 'pdf', component: 'text-to-pdf', category: 'pdf', icon: 'text', engine: 'pdf-lib', requires: ['worker'], multiple: false, descKey: 'pair.data.desc' }),
  pair({ from: 'pdf', to: 'txt', component: 'pdf-simple', category: 'pdf', icon: 'text', engine: 'pdfjs', requires: ['worker'], multiple: false, descKey: 'pair.data.desc' }),
  videoPair('mov', 'mp4'),
  videoPair('avi', 'mp4'),
  videoPair('mkv', 'mp4'),
  videoPair('webm', 'mp4'),
  videoPair('mpeg', 'mp4'),
  videoPair('3gp', 'mp4'),
  videoPair('wmv', 'mp4'),
  videoPair('gif', 'mp4'),
  videoPair('gif', 'webm'),
  videoPair('mp4', 'webm'),
  videoPair('mp4', 'mov'),
  videoPair('mp4', 'gif'),
  videoPair('mov', 'gif'),
  videoPair('webm', 'gif'),
  videoAudioPair('mp4', 'mp3', { popular: true }),
  videoAudioPair('mp4', 'wav'),
  videoAudioPair('mp4', 'm4a'),
  videoAudioPair('mov', 'mp3'),
  videoAudioPair('webm', 'mp3'),
  videoAudioPair('mkv', 'mp3'),
  videoAudioPair('avi', 'mp3'),
  audioPair('wav', 'mp3'),
  audioPair('mp3', 'wav'),
  audioPair('m4a', 'mp3'),
  audioPair('flac', 'mp3'),
  audioPair('ogg', 'mp3'),
  audioPair('aac', 'mp3'),
  audioPair('opus', 'mp3'),
  audioPair('wma', 'mp3'),
  audioPair('mp3', 'ogg'),
  audioPair('mp3', 'm4a'),
  audioPair('wav', 'flac'),
  audioPair('flac', 'wav'),
  dataPair('xlsx', 'csv', 'data-xlsx', 'xlsx-to-csv'),
  dataPair('xlsx', 'json', 'data-xlsx', 'xlsx-to-json'),
  dataPair('csv', 'xlsx', 'data-xlsx', 'csv-to-xlsx'),
  dataPair('json', 'xlsx', 'data-xlsx', 'json-to-xlsx'),
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDef | undefined {
  return byId.get(id);
}

/** True when the browser supports everything the tool needs and the matrix allows the pair. */
export function isToolAvailable(tool: ToolDef): boolean {
  if (!hasCapabilities(tool.requires)) return false;
  if (tool.pair && tool.preset?.from && tool.preset.to) {
    if (tool.component === 'image-convert' || tool.component === 'media-convert' || tool.component === 'video-gif') {
      return canConvert(tool.preset.from, tool.preset.to);
    }
  }
  return true;
}

export function availableTools(): ToolDef[] {
  return TOOLS.filter(isToolAvailable);
}

/** Tools listed on a category page / the "All tools" page (no pairs, no hidden shortcuts). */
export function toolsByCategory(category: Category): ToolDef[] {
  return availableTools().filter((t) => t.category === category && !t.pair && !t.hidden);
}

export function listedTools(): ToolDef[] {
  return availableTools().filter((t) => !t.pair && !t.hidden);
}

/** Tools that can take a file of this format as input (used by universal detection). */
export function toolsAccepting(format: FormatId): ToolDef[] {
  return availableTools().filter((t) => {
    if (t.pair || t.hidden) return false;
    return t.accepts === '*' ? false : t.accepts.includes(format);
  });
}

/** The pair tool for a given conversion, if one exists. */
export function pairTool(from: FormatId, to: FormatId): ToolDef | undefined {
  return availableTools().find((t) => t.pair && t.preset?.from === from && t.preset.to === to && !t.id.startsWith('heif-'));
}

export function popularTools(): ToolDef[] {
  const order = ['pdf-merge', 'image-compress', 'pdf-to-jpg', 'jpg-to-pdf', 'heic-to-jpg', 'mp4-to-mp3', 'archive-extract', 'video-compress'];
  return order.map((id) => byId.get(id)).filter((t): t is ToolDef => !!t && isToolAvailable(t));
}

/** Sidebar structure: the most used tools per category + a link to the full category page. */
export const SIDEBAR: Array<{ category: Category; items: Array<{ toolId: string; labelKey: MessageKey }> }> = [
  {
    category: 'image',
    items: [
      { toolId: 'image-convert', labelKey: 'nav.convert' },
      { toolId: 'image-compress', labelKey: 'nav.compress' },
      { toolId: 'image-resize', labelKey: 'nav.resize' },
      { toolId: 'image-crop', labelKey: 'nav.crop' },
      { toolId: 'images-to-pdf', labelKey: 'nav.imageToPdf' },
    ],
  },
  {
    category: 'pdf',
    items: [
      { toolId: 'pdf-merge', labelKey: 'nav.merge' },
      { toolId: 'pdf-split', labelKey: 'nav.split' },
      { toolId: 'pdf-organize', labelKey: 'nav.organize' },
      { toolId: 'pdf-to-image', labelKey: 'nav.pdfToImage' },
      { toolId: 'images-to-pdf', labelKey: 'nav.imageToPdf' },
      { toolId: 'pdf-compress', labelKey: 'nav.compress' },
    ],
  },
  {
    category: 'video',
    items: [
      { toolId: 'video-convert', labelKey: 'nav.convert' },
      { toolId: 'video-compress', labelKey: 'nav.compress' },
      { toolId: 'video-to-audio', labelKey: 'nav.videoToAudio' },
      { toolId: 'video-trim', labelKey: 'nav.trim' },
    ],
  },
  {
    category: 'audio',
    items: [
      { toolId: 'audio-convert', labelKey: 'nav.convert' },
      { toolId: 'audio-trim', labelKey: 'nav.trim' },
    ],
  },
  {
    category: 'archive',
    items: [
      { toolId: 'zip-create', labelKey: 'nav.createZip' },
      { toolId: 'zip-extract', labelKey: 'nav.extractZip' },
      { toolId: 'archive-extract', labelKey: 'nav.extractAny' },
    ],
  },
  {
    category: 'data',
    items: [
      { toolId: 'json-format', labelKey: 'nav.json' },
      { toolId: 'json-to-csv', labelKey: 'nav.csv' },
      { toolId: 'xlsx-convert', labelKey: 'nav.excel' },
      { toolId: 'base64-encode', labelKey: 'nav.base64' },
    ],
  },
];
