import { expose } from './rpc';
import { combineImages, imageInfo, processImage, splitImage, stripMetadata, thumbnail } from '../engines/image/pipeline';
import type { CombineRequest, ProcessRequest, ImageOutputFormat, OutputSpec } from '../engines/image/types';
import type { FormatId } from '../registry/formats';

expose({
  process: (req: ProcessRequest, ctx) => processImage(req.file, req.format, req.ops, req.output, ctx.progress),
  info: (req: { file: Blob; format: FormatId }) => imageInfo(req.file, req.format),
  thumbnail: (req: { file: Blob; format: FormatId; maxSize: number }) => thumbnail(req.file, req.format, req.maxSize),
  strip: (req: { file: Blob; format: FormatId; fallback: ImageOutputFormat; quality: number }) =>
    stripMetadata(req.file, req.format, req.fallback, req.quality),
  combine: (req: CombineRequest, ctx) => combineImages(req, ctx.progress),
  split: (req: { file: Blob; format: FormatId; rows: number; cols: number; output: OutputSpec }, ctx) =>
    splitImage(req.file, req.format, req.rows, req.cols, req.output, ctx.progress),
});
