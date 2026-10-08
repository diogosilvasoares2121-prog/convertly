import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { FORMATS } from '../../registry/formats';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { formatBytes } from '../../utils/bytes';
import { Icon, type AnyIcon } from '../../ui/components/Icon';
import { Badge } from '../../ui/components/feedback';
import { IconButton } from '../../ui/components/controls';
import { useImagePreview } from './preview';
import type { ToolFile } from './useToolFiles';

const CATEGORY_ICON: Record<string, AnyIcon> = {
  image: 'image',
  pdf: 'pdf',
  video: 'video',
  audio: 'audio',
  archive: 'archive',
  data: 'json',
};

function Thumb({ file }: { file: ToolFile }) {
  const url = useImagePreview(file.category === 'image' ? file.file : null, file.format, 120);
  return (
    <div class="file-row__thumb">
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <Icon name={CATEGORY_ICON[file.category ?? ''] ?? 'file'} />}
    </div>
  );
}

/**
 * List of selected input files. Supports drag & drop reordering and
 * keyboard reordering (move up/down buttons) when `onMove` is provided.
 */
export function FileList({
  files,
  onRemove,
  onMove,
  extra,
  showPath,
}: {
  files: ToolFile[];
  onRemove?: (id: string) => void;
  onMove?: (from: number, to: number) => void;
  extra?: (file: ToolFile, index: number) => ComponentChildren;
  showPath?: boolean;
}) {
  useI18n();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const total = files.reduce((n, f) => n + f.size, 0);

  return (
    <div class="stack" style={{ '--gap': '10px' }}>
      <div class="file-list__summary">
        <span>
          {tn('files.count', files.length)} · {formatBytes(total)}
        </span>
        {onMove && files.length > 1 ? <span>{t('files.reorderHint')}</span> : null}
      </div>
      <ul class="file-list" role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {files.map((f, i) => (
          <li
            key={f.id}
            class={['file-row', dragIndex === i && 'file-row--dragging', overIndex === i && dragIndex !== i && 'file-row--over'].filter(Boolean).join(' ')}
            draggable={!!onMove}
            onDragStart={(e) => {
              if (!onMove) return;
              setDragIndex(i);
              e.dataTransfer?.setData('text/plain', String(i));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              setOverIndex(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              if (dragIndex === null || !onMove) return;
              e.preventDefault();
              e.stopPropagation();
              onMove(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            {onMove ? (
              <span class="file-row__handle" aria-hidden="true">
                <Icon name="grip" />
              </span>
            ) : null}
            <Thumb file={f} />
            <div class="grow">
              <div class="file-row__name truncate" title={f.name}>
                {showPath ? f.path : f.name}
              </div>
              <div class="file-row__meta">
                {f.format ? <Badge format>{FORMATS[f.format].label}</Badge> : null}
                <span>{formatBytes(f.size)}</span>
                {f.extensionMismatch ? (
                  <Badge tone="warning" icon="warning">
                    {t('files.mismatch', { real: f.format ? FORMATS[f.format].label : '?' })}
                  </Badge>
                ) : null}
                {f.sizeClass !== 'light' ? <Badge tone={f.sizeClass === 'medium' ? 'warning' : 'danger'}>{t(`size.${f.sizeClass}` as MessageKey)}</Badge> : null}
                {extra ? extra(f, i) : null}
              </div>
            </div>
            <div class="file-row__actions">
              {onMove ? (
                <>
                  <IconButton icon="arrow-up" label={t('files.moveUp', { name: f.name })} disabled={i === 0} onClick={() => onMove(i, i - 1)} />
                  <IconButton icon="arrow-down" label={t('files.moveDown', { name: f.name })} disabled={i === files.length - 1} onClick={() => onMove(i, i + 1)} />
                </>
              ) : null}
              {onRemove ? <IconButton icon="close" danger label={t('files.remove', { name: f.name })} onClick={() => onRemove(f.id)} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
