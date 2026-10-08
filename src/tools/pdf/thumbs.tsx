import { useEffect, useRef, useState } from 'preact/hooks';
import { openPdf, type PdfHandle } from '../../engines/pdf/render';
import { toAppError, type ErrorCode } from '../../core/errors';
import { objectUrlStats } from '../../core/download';
import { capabilitiesStore } from '../../core/capabilities';

/**
 * PDF.js document + thumbnail cache. Thumbnails render lazily (only when visible)
 * through a small queue so a 500-page PDF never renders 500 pages at once.
 */
export interface PdfDoc {
  handle: PdfHandle;
  thumbs: Map<number, Promise<string>>;
  closed: boolean;
}

const queue: Array<() => Promise<void>> = [];
let running = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => task().then(resolve, reject));
    pump();
  });
}

function pump(): void {
  const limit = capabilitiesStore.get().memoryGb !== null && capabilitiesStore.get().memoryGb! <= 4 ? 1 : 2;
  while (running < limit && queue.length) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}

export function thumbnailUrl(doc: PdfDoc, index: number, width = 220): Promise<string> {
  let p = doc.thumbs.get(index);
  if (!p) {
    p = schedule(async () => {
      if (doc.closed) throw new Error('closed');
      const size = await doc.handle.pageSize(index);
      const { blob } = await doc.handle.renderPage(index, { scale: Math.min(2, width / size.width), type: 'image/jpeg', quality: 0.8 });
      if (doc.closed) throw new Error('closed');
      objectUrlStats.live++;
      return URL.createObjectURL(blob);
    });
    doc.thumbs.set(index, p);
    p.catch(() => doc.thumbs.delete(index));
  }
  return p;
}

export async function closeDoc(doc: PdfDoc): Promise<void> {
  doc.closed = true;
  for (const p of doc.thumbs.values()) {
    void p.then(
      (url) => {
        URL.revokeObjectURL(url);
        objectUrlStats.live--;
      },
      () => {},
    );
  }
  doc.thumbs.clear();
  await doc.handle.destroy();
}

/** Opens a PDF with PDF.js for previews; closes it (and frees thumbnails) on change/unmount. */
export function usePdfDoc(file: Blob | null, password?: string): { doc: PdfDoc | null; error: ErrorCode | null; loading: boolean } {
  const [state, setState] = useState<{ doc: PdfDoc | null; error: ErrorCode | null; loading: boolean }>({ doc: null, error: null, loading: false });
  useEffect(() => {
    if (!file) {
      setState({ doc: null, error: null, loading: false });
      return;
    }
    let alive = true;
    let opened: PdfDoc | null = null;
    setState({ doc: null, error: null, loading: true });
    openPdf(file, password)
      .then((handle) => {
        opened = { handle, thumbs: new Map(), closed: false };
        if (alive) setState({ doc: opened, error: null, loading: false });
        else void closeDoc(opened);
      })
      .catch((err: unknown) => {
        if (alive) setState({ doc: null, error: toAppError(err).code, loading: false });
      });
    return () => {
      alive = false;
      if (opened) void closeDoc(opened);
    };
  }, [file, password]);
  return state;
}

export function PdfThumb({ doc, index, rotation = 0, alt }: { doc: PdfDoc; index: number; rotation?: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          thumbnailUrl(doc, index)
            .then((u) => alive && setUrl(u))
            .catch(() => {});
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [doc, index]);
  return (
    <div class="page-card__thumb" ref={ref}>
      {url ? <img src={url} alt={alt} draggable={false} style={{ transform: `rotate(${rotation}deg)${rotation % 180 !== 0 ? ' scale(0.72)' : ''}` }} /> : <span class="spinner" style={{ color: 'var(--text-3)', width: '16px', height: '16px' }} aria-hidden="true" />}
    </div>
  );
}
