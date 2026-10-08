import { throwIfCancelled } from '../../core/errors';
import { processImage } from '../../engines/image/client';
import { readMetadata } from '../../engines/image/metadata';
import type { FormatId } from '../../registry/formats';

export interface PdfImageInput {
  file: Blob;
  format: FormatId;
}

/**
 * Prepares images for embedding: JPEG/PNG are embedded byte-for-byte (no quality loss);
 * other formats — and JPEGs with an EXIF rotation PDF viewers would ignore — are
 * converted in the image worker first.
 */
export async function prepareImagesForPdf(
  inputs: PdfImageInput[],
  signal: AbortSignal,
  onProgress: (p: number) => void,
): Promise<Array<{ blob: Blob; type: 'jpg' | 'png' }>> {
  const out: Array<{ blob: Blob; type: 'jpg' | 'png' }> = [];
  for (const [i, input] of inputs.entries()) {
    throwIfCancelled(signal);
    if (input.format === 'jpg') {
      const head = new Uint8Array(await input.file.slice(0, 256 * 1024).arrayBuffer());
      const orientation = readMetadata(head, 'jpg').orientation;
      if (!orientation || orientation === 1) {
        out.push({ blob: input.file, type: 'jpg' });
        onProgress((i + 1) / inputs.length);
        continue;
      }
    } else if (input.format === 'png') {
      out.push({ blob: input.file, type: 'png' });
      onProgress((i + 1) / inputs.length);
      continue;
    }
    const lossless = input.format === 'gif' || input.format === 'bmp';
    const result = await processImage(input.file, input.format, {}, { format: lossless ? 'png' : 'jpg', quality: 0.92 }, { signal });
    out.push({ blob: result.blob, type: lossless ? 'png' : 'jpg' });
    onProgress((i + 1) / inputs.length);
  }
  return out;
}
