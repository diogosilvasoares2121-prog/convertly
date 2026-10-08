import { useEffect, useRef, useState } from 'preact/hooks';
import { makeOutput } from '../../core/jobs';
import { toAppError, type ErrorCode } from '../../core/errors';
import { openPdf } from '../../engines/pdf/render';
import { assemblePdf } from '../../engines/pdf/client';
import type { PageRef } from '../../engines/pdf/ops';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { uid } from '../../utils/id';
import { NameDeduper, splitName } from '../../utils/filename';
import { Button, IconButton, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles, type ToolFile } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { closeDoc, PdfThumb, type PdfDoc } from './thumbs';
import { getPdfInfo } from './info';

type Mode = 'organize' | 'rotate' | 'delete' | 'extract';

interface PageItem {
  key: string;
  src: string; // ToolFile id, or BLANK for an inserted blank page
  index: number;
  rotate: number;
  /** Size in points of an inserted blank page. */
  size?: [number, number];
}

const BLANK = '__blank';
const A4: [number, number] = [595.28, 841.89];

/** Opens every source PDF with PDF.js (thumbnails) and pdf-lib (validation/encryption). */
function useSources(files: ToolFile[]) {
  const [docs, setDocs] = useState<Record<string, PdfDoc | { error: ErrorCode } | undefined>>({});
  const opened = useRef(new Map<string, PdfDoc>());
  const attempted = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    const ids = new Set(files.map((f) => f.id));
    for (const [id, doc] of opened.current) {
      if (!ids.has(id)) {
        void closeDoc(doc);
        opened.current.delete(id);
      }
    }
    for (const id of [...attempted.current]) if (!ids.has(id)) attempted.current.delete(id);
    for (const f of files) {
      if (attempted.current.has(f.id)) continue;
      attempted.current.add(f.id);
      setDocs((d) => ({ ...d, [f.id]: undefined }));
      void (async () => {
        try {
          await getPdfInfo(f.file); // pdf-lib must be able to edit it (fails for encrypted PDFs)
          const handle = await openPdf(f.file);
          const doc: PdfDoc = { handle, thumbs: new Map(), closed: false };
          if (!alive.current) {
            void closeDoc(doc);
            return;
          }
          opened.current.set(f.id, doc);
          setDocs((d) => ({ ...d, [f.id]: doc }));
        } catch (err) {
          setDocs((d) => ({ ...d, [f.id]: { error: toAppError(err).code } }));
        }
      })();
    }
  }, [files]);
  useEffect(
    () => () => {
      alive.current = false;
      for (const doc of opened.current.values()) void closeDoc(doc);
      opened.current.clear();
    },
    [],
  );
  return docs;
}

function isDoc(v: PdfDoc | { error: ErrorCode } | undefined): v is PdfDoc {
  return !!v && 'handle' in v;
}

export default function PdfPages({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const mode = (tool.preset?.mode as Mode | undefined) ?? 'organize';
  const docs = useSources(files.files);
  const [pages, setPages] = useSession<PageItem[]>(tool.id, 'pages', []);
  const [history, setHistory] = useState<PageItem[][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [extractAs, setExtractAs] = useSession<'single' | 'separate'>(tool.id, 'extractAs', 'single');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Add the pages of newly opened sources.
  useEffect(() => {
    const known = new Set(pages.map((p) => p.src));
    const additions: PageItem[] = [];
    for (const f of files.files) {
      const doc = docs[f.id];
      if (known.has(f.id) || !isDoc(doc)) continue;
      for (let i = 0; i < doc.handle.pageCount; i++) additions.push({ key: uid('pg'), src: f.id, index: i, rotate: 0 });
    }
    const ids = new Set(files.files.map((f) => f.id));
    const kept = pages.filter((p) => p.src === BLANK || ids.has(p.src));
    if (additions.length || kept.length !== pages.length) setPages([...kept, ...additions]);
  }, [docs, files.files]);

  const commit = (next: PageItem[]) => {
    setHistory((h) => [...h.slice(-49), pages]);
    setPages(next);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setPages(prev);
  };

  const sourceIndex = new Map(files.files.map((f, i) => [f.id, i]));
  const targets = (key?: string) => (key ? [key] : selected.size ? [...selected] : pages.map((p) => p.key));
  const rotate = (delta: number, key?: string) => {
    const keys = new Set(targets(key));
    commit(pages.map((p) => (keys.has(p.key) ? { ...p, rotate: (((p.rotate + delta) % 360) + 360) % 360 } : p)));
  };
  const remove = (key?: string) => {
    const keys = new Set(key ? [key] : [...selected]);
    if (!keys.size) return;
    commit(pages.filter((p) => !keys.has(p.key)));
    setSelected(new Set());
  };
  const duplicate = (key?: string) => {
    const keys = new Set(key ? [key] : [...selected]);
    const next: PageItem[] = [];
    for (const p of pages) {
      next.push(p);
      if (keys.has(p.key)) next.push({ ...p, key: uid('pg') });
    }
    commit(next);
  };
  /** Inserts a blank page after the last selected page (or at the end), sized like its neighbour. */
  const insertBlank = async () => {
    const lastSelected = pages.reduce((n, p, i) => (selected.has(p.key) ? i : n), -1);
    const at = lastSelected >= 0 ? lastSelected + 1 : pages.length;
    const ref = pages[at - 1] ?? pages[at];
    let size: [number, number] = A4;
    const doc = ref && ref.src !== BLANK ? docs[ref.src] : undefined;
    if (ref?.src === BLANK && ref.size) size = ref.size;
    else if (ref && isDoc(doc)) {
      try {
        const s = await doc.handle.pageSize(ref.index);
        size = ref.rotate % 180 ? [s.height, s.width] : [s.width, s.height];
      } catch {
        /* keep A4 */
      }
    }
    const next = [...pages];
    next.splice(at, 0, { key: uid('pg'), src: BLANK, index: 0, rotate: 0, size });
    commit(next);
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= pages.length) return;
    const next = [...pages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(next);
  };
  const toggle = (key: string, e: MouseEvent | KeyboardEvent) => {
    const next = new Set(selected);
    if (e.shiftKey && anchor) {
      const a = pages.findIndex((p) => p.key === anchor);
      const b = pages.findIndex((p) => p.key === key);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(pages[i]!.key);
    } else if (next.has(key)) next.delete(key);
    else next.add(key);
    setAnchor(key);
    setSelected(next);
  };

  if (groupId) {
    return (
      <JobGroupView
        groupId={groupId}
        zipName="pages.zip"
        onReset={() => {
          setGroupId(null);
          setPages([]);
          setSelected(new Set());
          setHistory([]);
          files.clear();
        }}
      />
    );
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropOne')} buttonLabel={t('pdf.choosePdf')} icon="pages" testId="dropzone" />;
  }

  const errors = files.files.filter((f) => docs[f.id] && !isDoc(docs[f.id]));
  const loading = files.files.some((f) => docs[f.id] === undefined);
  const exportPages = mode === 'extract' ? pages.filter((p) => selected.has(p.key)) : pages;
  const base = splitName(files.files[0]!.name).base || 'document';

  const run = async () => {
    const sources = files.files.map((f) => f.file);
    const refs: PageRef[] = exportPages.map((p) => (p.src === BLANK ? { src: -1, index: 0, rotate: p.rotate, size: p.size ?? A4 } : { src: sourceIndex.get(p.src)!, index: p.index, rotate: p.rotate }));
    const separate = mode === 'extract' && extractAs === 'separate';
    const id = await startCombinedJob(tool, files.files, {
      pool: 'pdf',
      operation: t(`tool.${tool.id}.title` as never),
      label: files.files.length === 1 ? files.files[0]!.name : tn('files.count', files.files.length),
      run: async (ctx) => {
        ctx.setState('processing');
        const dedupe = new NameDeduper();
        if (separate) {
          const outs = [];
          for (const [i, ref] of refs.entries()) {
            const blob = await assemblePdf(sources, [ref], { signal: ctx.signal });
            outs.push(makeOutput(dedupe.unique(ref.src < 0 ? `${base}-blank.pdf` : `${base}-page-${ref.index + 1}.pdf`), blob));
            ctx.progress((i + 1) / refs.length);
          }
          return outs;
        }
        const blob = await assemblePdf(sources, refs, { signal: ctx.signal, onProgress: ctx.progress });
        const suffix = mode === 'extract' ? 'extracted' : mode === 'rotate' ? 'rotated' : mode === 'delete' ? 'edited' : 'organized';
        return [makeOutput(`${base}-${suffix}.pdf`, blob, { [t('meta.pages')]: refs.length })];
      },
    });
    if (id) setGroupId(id);
  };

  const onGridKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const key = target.dataset.key;
    if (!key) return;
    const i = pages.findIndex((p) => p.key === key);
    const focusAt = (j: number) => (gridRef.current?.querySelector<HTMLElement>(`[data-index="${j}"]`))?.focus();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const j = i + (e.key === 'ArrowRight' ? 1 : -1);
      if (e.altKey) {
        move(i, j);
        requestAnimationFrame(() => focusAt(j));
      } else focusAt(j);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle(key, e);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(selected.size ? undefined : key);
    }
  };

  return (
    <ToolWorkspace
      main={
        <>
          <div class="toolbar" role="toolbar" aria-label={t('pages.toolbar')}>
            <Button variant="ghost" size="sm" icon="check" onClick={() => setSelected(selected.size === pages.length ? new Set() : new Set(pages.map((p) => p.key)))}>
              {selected.size === pages.length && pages.length ? t('pages.selectNone') : t('pages.selectAll')}
            </Button>
            <span class="toolbar__sep" />
            <IconButton icon="rotate-left" label={selected.size ? t('pages.rotateSelectedLeft') : t('pages.rotateAllLeft')} onClick={() => rotate(-90)} />
            <IconButton icon="rotate-right" label={selected.size ? t('pages.rotateSelectedRight') : t('pages.rotateAllRight')} onClick={() => rotate(90)} />
            <Button variant="ghost" size="sm" onClick={() => rotate(180)}>
              180°
            </Button>
            {mode !== 'extract' ? (
              <>
                <IconButton icon="duplicate" label={t('pages.duplicate')} disabled={!selected.size} onClick={() => duplicate()} />
                <IconButton icon="trash" danger label={t('pages.deleteSelected')} disabled={!selected.size} onClick={() => remove()} />
                <IconButton icon="reverse" label={t('pages.reverse')} onClick={() => commit([...pages].reverse())} />
                <IconButton icon="file-plus" label={t('pages.insertBlank')} onClick={() => void insertBlank()} data-testid="insert-blank" />
              </>
            ) : null}
            <IconButton icon="undo" label={t('action.undo')} disabled={!history.length} onClick={undo} />
            <span class="grow" />
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => {
                setPages([]);
                setSelected(new Set());
                setHistory([]);
                files.clear();
              }}
            >
              {t('action.clearAll')}
            </Button>
            <span class="small muted">
              {selected.size ? t('pages.selectedOf', { selected: selected.size, total: pages.length }) : tn('pdf.pages', pages.length)}
            </span>
          </div>
          {errors.map((f) => (
            <ErrorNotice key={f.id} code={(docs[f.id] as { error: ErrorCode }).error} />
          ))}
          {loading ? (
            <div class="row">
              <Spinner label={t('progress.reading')} />
              <span class="muted">{t('progress.reading')}</span>
            </div>
          ) : null}
          <div class="page-grid" ref={gridRef} onKeyDown={onGridKey as unknown as (e: Event) => void} role="listbox" aria-multiselectable="true" aria-label={t('pages.grid')}>
            {pages.map((p, i) => {
              const doc = docs[p.src];
              const isSel = selected.has(p.key);
              return (
                <div
                  key={p.key}
                  class={['page-card', isSel && 'page-card--selected', dragKey === p.key && 'page-card--dragging', overKey === p.key && dragKey !== p.key && 'page-card--over'].filter(Boolean).join(' ')}
                  role="option"
                  aria-selected={isSel}
                  tabIndex={0}
                  data-key={p.key}
                  data-index={i}
                  draggable
                  onClick={(e) => toggle(p.key, e)}
                  onDragStart={(e) => {
                    setDragKey(p.key);
                    e.dataTransfer?.setData('text/plain', p.key);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    setOverKey(p.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDrop={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    move(pages.findIndex((x) => x.key === dragKey), i);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                >
                  <span class="page-card__check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                  <div class="page-card__tools" onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="rotate-left" label={t('pages.rotateLeft', { n: i + 1 })} onClick={() => rotate(-90, p.key)} />
                    <IconButton icon="rotate-right" label={t('pages.rotateRight', { n: i + 1 })} onClick={() => rotate(90, p.key)} />
                    {mode !== 'extract' ? (
                      <>
                        <IconButton icon="duplicate" label={t('pages.duplicateOne', { n: i + 1 })} onClick={() => duplicate(p.key)} />
                        <IconButton icon="trash" danger label={t('pages.deleteOne', { n: i + 1 })} onClick={() => remove(p.key)} />
                      </>
                    ) : null}
                  </div>
                  {p.src === BLANK ? (
                    <div class="page-card__thumb page-card__blank" style={{ aspectRatio: `${(p.rotate % 180 ? p.size?.[1] : p.size?.[0]) ?? 595} / ${(p.rotate % 180 ? p.size?.[0] : p.size?.[1]) ?? 842}` }}>
                      <span>{t('pages.blank')}</span>
                    </div>
                  ) : isDoc(doc) ? (
                    <PdfThumb doc={doc} index={p.index} rotation={p.rotate} alt={t('pages.pageN', { n: p.index + 1 })} />
                  ) : (
                    <div class="page-card__thumb" />
                  )}
                  {files.files.length > 1 && p.src !== BLANK ? (
                    <span class="page-card__source">
                      <Badge>{String.fromCharCode(65 + (sourceIndex.get(p.src) ?? 0))}</Badge>
                    </span>
                  ) : null}
                  <div class="page-card__footer">
                    <span>{i + 1}</span>
                    {p.rotate ? <span>{p.rotate}°</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('pages.addPdf')} buttonLabel={t('pdf.addPdfs')} icon="plus" />
        </>
      }
      panel={
        <OptionsCard title={t(`pages.mode.${mode}` as never)}>
          <p class="small muted">{t(`pages.help.${mode}` as never)}</p>
          <p class="small muted">
            <Icon name="keyboard" size={14} /> {t('pages.keyboardHelp')}
          </p>
          {mode === 'extract' ? (
            <div class="field">
              <div class="field__label">{t('pages.extractAs')}</div>
              <Segmented label={t('pages.extractAs')} value={extractAs} block onChange={setExtractAs} options={[{ value: 'single', label: t('pages.singlePdf') }, { value: 'separate', label: t('pages.onePerPage') }]} />
            </div>
          ) : null}
          {mode === 'extract' && !selected.size ? <Notice tone="info">{t('pages.selectToExtract')}</Notice> : null}
          {mode === 'delete' && !selected.size ? <Notice tone="info">{t('pages.selectToDelete')}</Notice> : null}
          {mode === 'delete' && selected.size ? (
            <Button variant="danger" block icon="trash" onClick={() => remove()}>
              {tn('pages.deleteN', selected.size)}
            </Button>
          ) : null}
          <Button variant="primary" size="lg" block icon="download" disabled={!exportPages.length || loading || errors.length > 0} onClick={() => void run()} data-testid="run">
            {mode === 'extract' ? tn('pages.extractN', exportPages.length) : t('pages.export')}
          </Button>
          <p class="small muted">{tn('pages.resultCount', exportPages.length)}</p>
        </OptionsCard>
      }
    />
  );
}
