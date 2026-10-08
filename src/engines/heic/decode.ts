import type { LibHeif } from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import { AppError } from '../../core/errors';
import { quietAsync } from '../../utils/quiet';

/**
 * HEIC/HEIF decoding with libheif (LGPL-3.0) compiled to WebAssembly.
 * Runs inside the image worker only. The WASM binary is bundled with the
 * extension; nothing is fetched from the network.
 */
let libPromise: Promise<LibHeif> | null = null;

function loadLib(): Promise<LibHeif> {
  if (!libPromise) {
    libPromise = (async () => {
      const { default: factory } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
      return new Promise<LibHeif>((resolve, reject) => {
        let instance: LibHeif | null = null;
        const timer = setTimeout(() => reject(new AppError('browser-limitation', 'libheif failed to initialise')), 30_000);
        instance = factory({
          print: () => {},
          printErr: () => {},
          onRuntimeInitialized: () => {
            clearTimeout(timer);
            queueMicrotask(() => (instance ? resolve(instance) : reject(new AppError('browser-limitation', 'libheif unavailable'))));
          },
        });
      });
    })().catch((err: unknown) => {
      libPromise = null;
      throw err;
    });
  }
  return libPromise;
}

export interface HeicDecodeResult {
  image: ImageData;
  /** Number of top-level images (bursts/live photos contain several; we use the primary one). */
  imageCount: number;
}

export async function decodeHeic(bytes: Uint8Array): Promise<HeicDecodeResult> {
  const lib = await loadLib();
  return quietAsync(async () => {
    const decoder = new lib.HeifDecoder();
    const images = decoder.decode(bytes);
    try {
      if (!images.length) throw new AppError('corrupted-file', 'No image found in HEIF container');
      const primary = images.find((i) => i.is_primary()) ?? images[0]!;
      const width = primary.get_width();
      const height = primary.get_height();
      if (!width || !height) throw new AppError('corrupted-file', 'Invalid HEIF dimensions');
      if (width * height > 268_000_000) throw new AppError('browser-limitation', 'Image too large');
      const target = new ImageData(width, height);
      const image = await new Promise<ImageData>((resolve, reject) => {
        primary.display(target, (result) => (result ? resolve(result) : reject(new AppError('corrupted-file', 'HEIF decode failed'))));
      });
      return { image, imageCount: images.length };
    } finally {
      for (const img of images) img.free();
      if (decoder.decoder) lib.heif_context_free(decoder.decoder);
      decoder.decoder = null;
    }
  });
}
