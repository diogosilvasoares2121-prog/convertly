import { useEffect, useState } from 'preact/hooks';
import { inspectPdf } from '../../engines/pdf/client';
import type { PdfInspection } from '../../engines/pdf/ops';
import { toAppError, type ErrorCode } from '../../core/errors';

const cache = new WeakMap<Blob, Promise<PdfInspection>>();

export function getPdfInfo(file: Blob): Promise<PdfInspection> {
  let p = cache.get(file);
  if (!p) {
    p = inspectPdf(file);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

/** Page count, metadata and encryption status of a PDF (parsed in the PDF worker). */
export function usePdfInfo(file: Blob | null): { info: PdfInspection | null; error: ErrorCode | null } {
  const [state, setState] = useState<{ info: PdfInspection | null; error: ErrorCode | null }>({ info: null, error: null });
  useEffect(() => {
    let alive = true;
    setState({ info: null, error: null });
    if (!file) return;
    getPdfInfo(file)
      .then((info) => alive && setState({ info, error: null }))
      .catch((err: unknown) => alive && setState({ info: null, error: toAppError(err).code }));
    return () => {
      alive = false;
    };
  }, [file]);
  return state;
}
