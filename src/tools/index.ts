import type { ComponentType } from 'preact';
import type { ToolComponentKey, ToolProps } from '../registry/types';

type Loader = () => Promise<ComponentType<ToolProps>>;

/**
 * Tool UI implementations, code-split per tool so the app shell loads fast and
 * heavy engines (PDF.js, FFmpeg client, HEIC) are only fetched when used.
 */
export const TOOL_COMPONENTS: Record<ToolComponentKey, Loader> = {
  'image-convert': () => import('./image/ImageConvert').then((m) => m.default),
  'image-compress': () => import('./image/ImageCompress').then((m) => m.default),
  'image-resize': () => import('./image/ImageResize').then((m) => m.default),
  'image-crop': () => import('./image/ImageCrop').then((m) => m.default),
  'image-rotate': () => import('./image/ImageRotate').then((m) => m.default),
  'image-metadata': () => import('./image/ImageMetadata').then((m) => m.default),
  'images-to-pdf': () => import('./image/ImagesToPdf').then((m) => m.default),
  'pdf-merge': () => import('./pdf/PdfMerge').then((m) => m.default),
  'pdf-split': () => import('./pdf/PdfSplit').then((m) => m.default),
  'pdf-pages': () => import('./pdf/PdfPages').then((m) => m.default),
  'pdf-to-image': () => import('./pdf/PdfToImage').then((m) => m.default),
  'pdf-metadata': () => import('./pdf/PdfMetadata').then((m) => m.default),
  'pdf-compress': () => import('./pdf/PdfCompress').then((m) => m.default),
  'media-convert': () => import('./media/MediaConvert').then((m) => m.default),
  'media-trim': () => import('./media/MediaTrim').then((m) => m.default),
  'video-edit': () => import('./media/VideoEdit').then((m) => m.default),
  'video-compress': () => import('./media/VideoCompress').then((m) => m.default),
  'video-gif': () => import('./media/VideoGif').then((m) => m.default),
  'zip-create': () => import('./archive/ZipCreate').then((m) => m.default),
  'zip-extract': () => import('./archive/ZipExtract').then((m) => m.default),
  'data-json': () => import('./data/DataTools').then((m) => m.JsonTool),
  'data-csv': () => import('./data/DataTools').then((m) => m.CsvTool),
  'data-xml': () => import('./data/DataTools').then((m) => m.XmlTool),
  'data-base64': () => import('./data/Base64Tool').then((m) => m.default),
  'data-url': () => import('./data/DataTools').then((m) => m.UrlTool),
  'data-yaml': () => import('./data/DataExtra').then((m) => m.YamlTool),
  'data-markdown': () => import('./data/DataExtra').then((m) => m.MarkdownTool),
  'data-xlsx': () => import('./data/XlsxTool').then((m) => m.default),
  'data-hash': () => import('./data/HashTool').then((m) => m.default),
  'svg-convert': () => import('./image/SvgConvert').then((m) => m.default),
  'image-ico': () => import('./image/ImageIco').then((m) => m.default),
  'image-watermark': () => import('./image/ImageWatermark').then((m) => m.default),
  'image-adjust': () => import('./image/ImageAdjust').then((m) => m.default),
  'image-combine': () => import('./image/ImageCombine').then((m) => m.default),
  'image-split': () => import('./image/ImageSplit').then((m) => m.default),
  'images-motion': () => import('./image/ImagesMotion').then((m) => m.default),
  'pdf-page-numbers': () => import('./pdf/PdfPageNumbers').then((m) => m.default),
  'pdf-watermark': () => import('./pdf/PdfWatermark').then((m) => m.default),
  'pdf-crop': () => import('./pdf/PdfCrop').then((m) => m.default),
  'pdf-simple': () => import('./pdf/PdfSimple').then((m) => m.default),
  'text-to-pdf': () => import('./pdf/TextToPdf').then((m) => m.default),
  'video-frames': () => import('./media/VideoFrames').then((m) => m.default),
  'media-speed': () => import('./media/MediaSpeed').then((m) => m.default),
  'media-merge': () => import('./media/MediaMerge').then((m) => m.default),
  'video-add-audio': () => import('./media/VideoAddAudio').then((m) => m.default),
  'audio-effect': () => import('./media/AudioEffect').then((m) => m.default),
  'archive-extract': () => import('./archive/ArchiveExtract').then((m) => m.default),
};
