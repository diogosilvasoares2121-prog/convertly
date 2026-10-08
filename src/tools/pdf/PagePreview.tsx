import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t, useI18n } from '../../i18n';
import { ErrorNotice, Spinner } from '../../ui/components/feedback';
import { thumbnailUrl, usePdfDoc } from './thumbs';

export interface PageBox {
  width: number;
  height: number;
}

/**
 * First-page preview with an overlay drawn in page units: the page element is a CSS
 * size container, so overlays can use `cqw` lengths computed from PDF points.
 */
export function PagePreview({ file, overlay }: { file: Blob; overlay?: (page: PageBox) => ComponentChildren }) {
  useI18n();
  const { doc, error } = usePdfDoc(file);
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<PageBox | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setBox(null);
    if (!doc) return;
    void doc.handle.pageSize(0).then((s) => alive && setBox(s), () => {});
    thumbnailUrl(doc, 0, 520)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [doc]);
  if (error) return <ErrorNotice code={error} />;
  return (
    <div class="page-preview">
      {url && box ? (
        <div class="page-preview__page" style={{ aspectRatio: `${box.width} / ${box.height}` }}>
          <img src={url} alt={t('pages.pageN', { n: 1 })} draggable={false} />
          {overlay ? overlay(box) : null}
        </div>
      ) : (
        <Spinner label={t('progress.loading')} />
      )}
    </div>
  );
}

/** Converts PDF points to a CSS length relative to the preview page width. */
export const cqw = (points: number, page: PageBox): string => `${((points / page.width) * 100).toFixed(3)}cqw`;
