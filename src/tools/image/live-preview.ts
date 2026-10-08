import { useEffect, useRef, useState } from 'preact/hooks';
import { objectUrlStats } from '../../core/download';
import { makeThumbnail, processImage } from '../../engines/image/client';
import type { ImageOps } from '../../engines/image/types';
import type { FormatId } from '../../registry/formats';

const thumbs = new WeakMap<Blob, Promise<Blob | null>>();

function thumbnailOf(file: Blob, format: FormatId, maxSize: number): Promise<Blob | null> {
  let p = thumbs.get(file);
  if (!p) {
    p = makeThumbnail(file, format, maxSize).catch(() => null);
    thumbs.set(file, p);
  }
  return p;
}

/**
 * Live preview that runs the real image pipeline (same worker code as the final
 * export) on a small thumbnail, so what you see is what you get.
 * The previous preview stays visible until the next one is ready (no flicker).
 */
export function useLivePreview(file: Blob | null, format: FormatId | null, ops: ImageOps, maxSize = 640): { url: string | null; busy: boolean } {
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setThumb(null);
    if (!file || !format) return;
    void thumbnailOf(file, format, maxSize).then((b) => alive && setThumb(b));
    return () => {
      alive = false;
    };
  }, [file, format, maxSize]);

  const key = JSON.stringify(ops);
  useEffect(() => {
    if (!thumb) return;
    let alive = true;
    setBusy(true);
    const timer = setTimeout(() => {
      // Stale results are ignored rather than aborted: aborting would terminate the worker.
      processImage(thumb, 'webp', ops, { format: 'png', quality: 1 })
        .then((r) => {
          if (!alive) return;
          const next = URL.createObjectURL(r.blob);
          objectUrlStats.live++;
          if (current.current) {
            URL.revokeObjectURL(current.current);
            objectUrlStats.live--;
          }
          current.current = next;
          setUrl(next);
          setBusy(false);
        })
        .catch(() => alive && setBusy(false));
    }, 140);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [thumb, key]);

  useEffect(
    () => () => {
      if (current.current) {
        URL.revokeObjectURL(current.current);
        objectUrlStats.live--;
        current.current = null;
      }
    },
    [],
  );

  return { url: thumb ? url : null, busy };
}
