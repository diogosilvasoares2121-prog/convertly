import { expose } from './rpc';
import {
  assemblePdf,
  imagesToPdf,
  inspectPdf,
  mergePdfs,
  splitPdf,
  writePdfMetadata,
  type Fit,
  type Margin,
  type Orientation,
  type PageRef,
  type PageSize,
  type PdfMetadata,
} from '../engines/pdf/ops';
import { compressPdf, type CompressPreset } from '../engines/pdf/compress';
import {
  addPageNumbers,
  addPdfWatermark,
  cropPdf,
  repairPdf,
  textToPdf,
  type PageNumberOptions,
  type TextToPdfOptions,
  type WatermarkOptions,
} from '../engines/pdf/edit';
import { extractPdfImages } from '../engines/pdf/images';

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });

expose({
  inspect: async (req: { file: Blob }) => inspectPdf(await bytesOf(req.file)),

  merge: async (req: { files: Blob[] }, ctx) => {
    const sources: Uint8Array[] = [];
    for (const f of req.files) sources.push(await bytesOf(f));
    return pdfBlob(await mergePdfs(sources, (p) => ctx.progress(p)));
  },

  assemble: async (req: { files: Blob[]; pages: PageRef[] }, ctx) => {
    const sources: Uint8Array[] = [];
    for (const f of req.files) sources.push(await bytesOf(f));
    return pdfBlob(await assemblePdf(sources, req.pages, (p) => ctx.progress(p)));
  },

  split: async (req: { file: Blob; groups: number[][] }, ctx) => {
    const parts = await splitPdf(await bytesOf(req.file), req.groups, (p) => ctx.progress(p));
    return parts.map(pdfBlob);
  },

  metadata: async (req: { file: Blob; metadata: Partial<PdfMetadata>; removeAll: boolean }) =>
    pdfBlob(await writePdfMetadata(await bytesOf(req.file), req.metadata, req.removeAll)),

  images: async (
    req: {
      images: Array<{ blob: Blob; type: 'jpg' | 'png' }>;
      options: { pageSize: PageSize; orientation: Orientation; margin: Margin; fit: Fit };
    },
    ctx,
  ) => {
    const images = [];
    for (const img of req.images) images.push({ bytes: await bytesOf(img.blob), type: img.type });
    return pdfBlob(await imagesToPdf(images, req.options, (p) => ctx.progress(p)));
  },

  pageNumbers: async (req: { file: Blob; options: PageNumberOptions }) => pdfBlob(await addPageNumbers(await bytesOf(req.file), req.options)),

  watermark: async (req: { file: Blob; options: WatermarkOptions }) => {
    const { bytes, replaced } = await addPdfWatermark(await bytesOf(req.file), req.options);
    return { blob: pdfBlob(bytes), replaced };
  },

  crop: async (req: { file: Blob; margins: { top: number; right: number; bottom: number; left: number } }) => pdfBlob(await cropPdf(await bytesOf(req.file), req.margins)),

  repair: async (req: { file: Blob }) => {
    const { bytes, pages } = await repairPdf(await bytesOf(req.file));
    return { blob: pdfBlob(bytes), pages };
  },

  fromText: async (req: { text: string; options: TextToPdfOptions }) => {
    const { bytes, pages, replaced } = await textToPdf(req.text, req.options);
    return { blob: pdfBlob(bytes), pages, replaced };
  },

  extractImages: async (req: { file: Blob; baseName: string; minSize: number }, ctx) =>
    extractPdfImages(await bytesOf(req.file), req.baseName, req.minSize, (p) => ctx.progress(p)),

  compress: async (req: { file: Blob; preset: CompressPreset; removeMetadata: boolean }, ctx) => {
    const { bytes, stats } = await compressPdf(await bytesOf(req.file), req.preset, req.removeMetadata, (p) => ctx.progress(p));
    return { blob: pdfBlob(bytes), stats };
  },
});
