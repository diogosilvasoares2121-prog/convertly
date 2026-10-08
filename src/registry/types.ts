import type { CapabilityKey } from '../core/capabilities';
import type { MessageKey } from '../i18n';
import type { Category, FormatId } from './formats';

export type ToolEngine = 'canvas' | 'heic' | 'pdf-lib' | 'pdfjs' | 'ffmpeg' | 'zip' | 'js';

/** Component implementations; each is lazy-loaded (see src/tools/index.ts). */
export type ToolComponentKey =
  | 'image-convert'
  | 'image-compress'
  | 'image-resize'
  | 'image-crop'
  | 'image-rotate'
  | 'image-metadata'
  | 'images-to-pdf'
  | 'pdf-merge'
  | 'pdf-split'
  | 'pdf-pages'
  | 'pdf-to-image'
  | 'pdf-metadata'
  | 'pdf-compress'
  | 'media-convert'
  | 'media-trim'
  | 'video-edit'
  | 'video-compress'
  | 'video-gif'
  | 'zip-create'
  | 'zip-extract'
  | 'data-json'
  | 'data-csv'
  | 'data-xml'
  | 'data-base64'
  | 'data-url'
  | 'svg-convert'
  | 'image-ico'
  | 'image-watermark'
  | 'image-adjust'
  | 'image-combine'
  | 'image-split'
  | 'images-motion'
  | 'pdf-page-numbers'
  | 'pdf-watermark'
  | 'pdf-crop'
  | 'pdf-simple'
  | 'text-to-pdf'
  | 'video-frames'
  | 'media-speed'
  | 'media-merge'
  | 'video-add-audio'
  | 'audio-effect'
  | 'archive-extract'
  | 'data-yaml'
  | 'data-xlsx'
  | 'data-hash'
  | 'data-markdown';

export type IconName =
  | 'image'
  | 'images'
  | 'compress'
  | 'resize'
  | 'crop'
  | 'rotate'
  | 'metadata'
  | 'pdf'
  | 'merge'
  | 'split'
  | 'pages'
  | 'pdf-image'
  | 'image-pdf'
  | 'video'
  | 'audio'
  | 'music'
  | 'trim'
  | 'mute'
  | 'gif'
  | 'archive'
  | 'extract'
  | 'json'
  | 'csv'
  | 'xml'
  | 'base64'
  | 'link'
  | 'convert'
  | 'watermark'
  | 'adjust'
  | 'combine'
  | 'grid'
  | 'favicon'
  | 'frames'
  | 'speed'
  | 'text'
  | 'numbers'
  | 'repair'
  | 'hash'
  | 'yaml'
  | 'markdown'
  | 'table'
  | 'music-plus'
  | 'volume'
  | 'fade'
  | 'reverse-audio'
  | 'package'
  | 'shapes'
  | 'slideshow'
  | 'ratio'
  | 'join';

/** Sub-sections used to organise each category page. */
export type ToolGroup = 'convert' | 'optimize' | 'edit' | 'organize' | 'create' | 'extract' | 'security' | 'format';

export interface ToolPreset {
  /** Input format this preset is for (pair tools such as "HEIC → JPG"). */
  from?: FormatId;
  /** Pre-selected output format. */
  to?: FormatId;
  /** Component specific mode (e.g. 'rotate' for the PDF page manager). */
  mode?: string;
}

export interface ToolDef {
  id: string;
  category: Category;
  /** Either a translation key or a literal label (format pairs such as "JPG → PNG"). */
  title: { key: MessageKey } | { text: string };
  description: { key: MessageKey; params?: Record<string, string> };
  /** Optional "Compress {format}" style title used in search results for a format query. */
  formatTitleKey?: MessageKey;
  keywords: string[];
  icon: IconName;
  /** Accepted input formats, or '*' for any file. */
  accepts: FormatId[] | '*';
  outputs?: FormatId[];
  engine: ToolEngine;
  requires: CapabilityKey[];
  /** Whether the tool takes several files at once. */
  multiple: boolean;
  component: ToolComponentKey;
  preset?: ToolPreset;
  /** Generated format-pair tools: searchable and suggested, but not listed in the sidebar. */
  pair?: boolean;
  /** Search-only shortcut (e.g. "Extract RAR"); not listed on category pages. */
  hidden?: boolean;
  /** Section on the category page. */
  group?: ToolGroup;
  popular?: boolean;
  /** Heavy tools show the CPU/memory notice before running. */
  heavy?: boolean;
}

export interface ToolProps {
  tool: ToolDef;
}
