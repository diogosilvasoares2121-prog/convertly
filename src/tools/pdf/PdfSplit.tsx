import { makeOutput } from '../../core/jobs';
import { assemblePdf, splitPdf } from '../../engines/pdf/client';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { chunkPages, formatPageRanges, parsePageRanges } from '../../utils/ranges';
import { NameDeduper, splitName, sanitizeFilename } from '../../utils/filename';
import { Button, NumberInput, Segmented, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { usePdfInfo } from './info';

type Mode = 'every' | 'ranges' | 'extract' | 'chunks';

function groupName(base: string, group: number[]): string {
  const label = group.length === 1 ? `page-${group[0]! + 1}` : `p${formatPageRanges(group).replace(/, /g, '_')}`;
  return sanitizeFilename(`${base}-${label}.pdf`);
}

export default function PdfSplit({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const { info, error } = usePdfInfo(file?.file ?? null);
  const [mode, setMode] = useSession<Mode>(tool.id, 'mode', 'ranges');
  const [ranges, setRanges] = useSession<string>(tool.id, 'ranges', '1-3, 5');
  const [chunk, setChunk] = useSession<number | ''>(tool.id, 'chunk', 2);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={`${splitName(file?.name ?? 'document').base}-split.zip`} onReset={() => { setGroupId(null); files.clear(); }} resetLabel={t('pdf.splitAnother')} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('pdf.dropOne')} buttonLabel={t('pdf.choosePdf')} icon="split" testId="dropzone" />;
  }

  const pageCount = info?.pageCount ?? 0;
  let groups: number[][] = [];
  let rangeError: string | null = null;
  if (info) {
    if (mode === 'every') groups = chunkPages(pageCount, 1);
    else if (mode === 'chunks') groups = typeof chunk === 'number' && chunk >= 1 ? chunkPages(pageCount, chunk) : [];
    else {
      const parsed = parsePageRanges(ranges, pageCount);
      if (!parsed.ok) rangeError = parsed.invalid ? t('pdf.invalidRange', { part: parsed.invalid, max: pageCount }) : t('pdf.enterRanges');
      else groups = mode === 'extract' ? [parsed.pages] : parsed.groups;
    }
  }

  const run = async () => {
    const base = splitName(file.name).base || 'document';
    const finalGroups = groups;
    const id = await startCombinedJob(tool, [file], {
      pool: 'pdf',
      operation: t(`pdf.mode.${mode}` as MessageKey),
      label: file.name,
      run: async (ctx) => {
        ctx.setState('processing');
        const dedupe = new NameDeduper();
        if (mode === 'extract') {
          const blob = await assemblePdf([file.file], finalGroups[0]!.map((index) => ({ src: 0, index })), { signal: ctx.signal, onProgress: ctx.progress });
          return [makeOutput(dedupe.unique(`${base}-extracted.pdf`), blob, { [t('meta.pages')]: finalGroups[0]!.length })];
        }
        const parts = await splitPdf(file.file, finalGroups, { signal: ctx.signal, onProgress: ctx.progress });
        ctx.setState('finalizing');
        return parts.map((blob, i) => makeOutput(dedupe.unique(groupName(base, finalGroups[i]!)), blob, { [t('meta.pages')]: finalGroups[i]!.length }));
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} extra={() => (info ? <span>{tn('pdf.pages', pageCount)}</span> : null)} />
          {error ? <ErrorNotice code={error} /> : null}
          {!info && !error ? <Spinner label={t('progress.reading')} /> : null}
          {info && groups.length ? (
            <div class="card card--pad stack" style={{ '--gap': '10px' }}>
              <h3>{t('pdf.preview')}</h3>
              <p class="muted small">{mode === 'extract' ? t('pdf.extractPreview', { pages: formatPageRanges(groups[0] ?? []) }) : tn('pdf.willCreate', groups.length)}</p>
              <div class="chips">
                {groups.slice(0, 40).map((g, i) => (
                  <span key={i} class="chip chip--format">
                    {formatPageRanges(g)}
                  </span>
                ))}
                {groups.length > 40 ? <span class="chip">+{groups.length - 40}</span> : null}
              </div>
            </div>
          ) : null}
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('pdf.splitMode')}</div>
            <Segmented
              label={t('pdf.splitMode')}
              value={mode}
              wrap
              onChange={setMode}
              options={[
                { value: 'ranges', label: t('pdf.mode.ranges') },
                { value: 'every', label: t('pdf.mode.every') },
                { value: 'chunks', label: t('pdf.mode.chunks') },
                { value: 'extract', label: t('pdf.mode.extract') },
              ]}
            />
          </div>
          {mode === 'ranges' || mode === 'extract' ? (
            <TextInput label={t('pdf.pagesLabel')} value={ranges} onChange={setRanges} placeholder="1-3, 5, 8-12" hint={t('pdf.rangesHint', { max: pageCount || '…' })} error={rangeError ?? undefined} mono />
          ) : null}
          {mode === 'chunks' ? <NumberInput label={t('pdf.everyX')} value={chunk} onChange={setChunk} min={1} max={pageCount || undefined} suffix={t('pdf.pagesUnit')} /> : null}
          {mode !== 'extract' && groups.length > 1 ? <Notice tone="info">{t('pdf.splitZipHint')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="split" disabled={!info || !groups.length} onClick={() => void run()} data-testid="run">
            {mode === 'extract' ? t('pdf.extractRun') : tn('pdf.splitRun', groups.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
