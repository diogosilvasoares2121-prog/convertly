import { useState } from 'preact/hooks';
import { makeOutput, type OutputFile } from '../../core/jobs';
import { AppError } from '../../core/errors';
import { openPdf } from '../../engines/pdf/render';
import type { ToolProps } from '../../registry/types';
import { useStore } from '../../core/store';
import { settingsStore } from '../../storage/settings';
import { t, tn, useI18n } from '../../i18n';
import { parsePageRanges } from '../../utils/ranges';
import { NameDeduper, splitName } from '../../utils/filename';
import { yieldToMain } from '../../utils/async';
import { Button, Segmented, Slider, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, qualityLabel } from '../image/common';
import { PdfThumb, usePdfDoc } from './thumbs';

type Which = 'all' | 'range' | 'select';
type Dpi = 72 | 150 | 300;

export default function PdfToImage({ tool }: ToolProps) {
  useI18n();
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [passwordInput, setPasswordInput] = useState('');
  const { doc, error, loading } = usePdfDoc(file?.file ?? null, password);
  const [format, setFormat] = useSession<'jpg' | 'png'>(tool.id, 'format', (tool.preset?.to as 'jpg' | 'png' | undefined) ?? 'jpg');
  const [dpi, setDpi] = useSession<Dpi>(tool.id, 'dpi', 150);
  const [quality, setQuality] = useSession<number>(tool.id, 'quality', settings.imageQuality);
  const [which, setWhich] = useSession<Which>(tool.id, 'which', 'all');
  const [range, setRange] = useSession<string>(tool.id, 'range', '1');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return (
      <JobGroupView
        groupId={groupId}
        zipName={`${splitName(file?.name ?? 'document').base}-images.zip`}
        onReset={() => {
          setGroupId(null);
          setPassword(undefined);
          files.clear();
        }}
      />
    );
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('pdf.dropOne')} buttonLabel={t('pdf.choosePdf')} icon="pdf-image" testId="dropzone" />;
  }

  const pageCount = doc?.handle.pageCount ?? 0;
  let pages: number[] = [];
  let rangeError: string | undefined;
  if (doc) {
    if (which === 'all') pages = Array.from({ length: pageCount }, (_, i) => i);
    else if (which === 'select') pages = [...picked].sort((a, b) => a - b);
    else {
      const parsed = parsePageRanges(range, pageCount);
      if (parsed.ok) pages = parsed.pages;
      else rangeError = parsed.invalid ? t('pdf.invalidRange', { part: parsed.invalid, max: pageCount }) : t('pdf.enterRanges');
    }
  }
  const needsPassword = error === 'pdf-encrypted' || error === 'pdf-wrong-password';

  const run = async () => {
    const selection = pages;
    const pw = password;
    const base = splitName(file.name).base || 'document';
    const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const id = await startCombinedJob(tool, [file], {
      pool: 'pdf',
      operation: `PDF → ${format.toUpperCase()} · ${dpi} DPI`,
      label: file.name,
      run: async (ctx) => {
        ctx.setState('preparing');
        const handle = await openPdf(file.file, pw);
        const outputs: OutputFile[] = [];
        const dedupe = new NameDeduper();
        try {
          ctx.setState('processing');
          for (const [i, index] of selection.entries()) {
            if (ctx.signal.aborted) throw new AppError('cancelled');
            const { blob, width, height } = await handle.renderPage(index, { scale: dpi / 72, type, quality: quality / 100, signal: ctx.signal });
            outputs.push(makeOutput(dedupe.unique(`${base}-page-${index + 1}.${format}`), blob, { [t('meta.dimensions')]: `${width}×${height}` }));
            ctx.progress((i + 1) / selection.length);
            await yieldToMain();
          }
        } finally {
          await handle.destroy();
        }
        return outputs;
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} extra={() => (doc ? <span>{tn('pdf.pages', pageCount)}</span> : null)} />
          {needsPassword ? (
            <div class="card card--pad stack">
              <div class="row">
                <Icon name="lock" />
                <h3>{t('pdf.passwordTitle')}</h3>
              </div>
              <p class="muted small">{t('pdf.passwordDesc')}</p>
              {error === 'pdf-wrong-password' ? <div class="field__error">{t('error.pdf-wrong-password.title')}</div> : null}
              <form
                class="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPassword(passwordInput);
                }}
              >
                <div class="grow">
                  <TextInput label={t('pdf.password')} type="password" value={passwordInput} onChange={setPasswordInput} autoFocus />
                </div>
                <Button type="submit" variant="primary" style={{ alignSelf: 'flex-end' }}>
                  {t('pdf.unlock')}
                </Button>
              </form>
            </div>
          ) : error ? (
            <ErrorNotice code={error} />
          ) : null}
          {loading ? <Spinner label={t('progress.reading')} /> : null}
          {doc && which === 'select' ? (
            <div class="page-grid" role="listbox" aria-multiselectable="true" aria-label={t('pages.grid')}>
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  class={`page-card${picked.has(i) ? ' page-card--selected' : ''}`}
                  role="option"
                  aria-selected={picked.has(i)}
                  tabIndex={0}
                  onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
                    }
                  }}
                >
                  <span class="page-card__check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                  <PdfThumb doc={doc} index={i} alt={t('pages.pageN', { n: i + 1 })} />
                  <div class="page-card__footer">
                    <span>{i + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('options.convertTo')}</div>
            <Segmented label={t('options.convertTo')} value={format} block onChange={setFormat} options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
          </div>
          <div class="field">
            <div class="field__label">{t('pdf.resolution')}</div>
            <Segmented label={t('pdf.resolution')} value={dpi} block onChange={setDpi} options={[{ value: 72, label: '72 DPI' }, { value: 150, label: '150 DPI' }, { value: 300, label: '300 DPI' }]} />
            <div class="field__hint">{t(`pdf.dpiHint.${dpi}` as never)}</div>
          </div>
          {format === 'jpg' ? <Slider label={t('options.quality')} value={quality} min={10} max={100} onChange={setQuality} format={qualityLabel} /> : null}
          <div class="field">
            <div class="field__label">{t('pdf.pagesLabel')}</div>
            <Segmented label={t('pdf.pagesLabel')} value={which} block onChange={setWhich} options={[{ value: 'all', label: t('pdf.allPages') }, { value: 'range', label: t('pdf.range') }, { value: 'select', label: t('pdf.select') }]} />
          </div>
          {which === 'range' ? <TextInput label={t('pdf.range')} value={range} onChange={setRange} placeholder="1-3, 5" hint={t('pdf.rangesHint', { max: pageCount || '…' })} error={rangeError} mono /> : null}
          {which === 'select' && !picked.size ? <Notice tone="info">{t('pdf.selectPagesHint')}</Notice> : null}
          {dpi === 300 && pages.length > 50 ? <Notice tone="warning">{t('pdf.manyPagesWarning')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="pdf-image" disabled={!doc || !pages.length} onClick={() => void run()} data-testid="run">
            {tn('pdf.toImagesRun', pages.length, { format: format.toUpperCase() })}
          </Button>
        </OptionsCard>
      }
    />
  );
}
