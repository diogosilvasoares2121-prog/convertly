import { useEffect, useState } from 'preact/hooks';
import { objectUrlStats } from '../../core/download';
import { makeThumbnail, NATIVE_PREVIEW } from '../../engines/image/client';
import type { FormatId } from '../../registry/formats';

/** Creates an object URL for a blob and revokes it automatically on change/unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    objectUrlStats.live++;
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      objectUrlStats.live--;
    };
  }, [blob]);
  return url;
}

// Generated previews (HEIC/TIFF) are cached per File so lists don't re-decode on re-render.
const thumbCache = new WeakMap<Blob, Promise<Blob | null>>();

/** Preview URL for an image file; HEIC/TIFF previews are generated in a worker. */
export function useImagePreview(file: Blob | null, format: FormatId | null, maxSize = 240): string | null {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    setBlob(null);
    if (!file || !format) return;
    if (NATIVE_PREVIEW.has(format)) {
      setBlob(file);
      return;
    }
    if (format !== 'heic' && format !== 'tiff') return;
    let promise = thumbCache.get(file);
    if (!promise) {
      promise = makeThumbnail(file, format, maxSize).catch(() => null);
      thumbCache.set(file, promise);
    }
    void promise.then((b) => {
      if (alive) setBlob(b);
    });
    return () => {
      alive = false;
    };
  }, [file, format, maxSize]);
  return useObjectUrl(blob);
}
