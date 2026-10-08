import { useEffect, useState } from 'preact/hooks';
import { makeOutput } from '../../core/jobs';
import type { PdfInspection } from '../../engines/pdf/ops';
import { mergePdfs } from '../../engines/pdf/client';
import type { ErrorCode } from '../../core/errors';
import { toAppError } from '../../core/errors';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { Button } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { getPdfInfo } from './info';

type InfoState = Record<string, { info?: PdfInspection; error?: ErrorCode }>;

export default function PdfMerge({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [infos, setInfos] = useState<InfoState>({});
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  useEffect(() => {
    let alive = true;
    for (const f of files.files) {
      if (infos[f.id]) continue;
      getPdfInfo(f.file)
        .then((info) => alive && setInfos((s) => ({ ...s, [f.id]: { info } })))
        .catch((err: unknown) => alive && setInfos((s) => ({ ...s, [f.id]: { error: toAppError(err).code } })));
    }
    return () => {
      alive = false;
    };
  }, [files.files]); // infos intentionally omitted: each file is inspected once

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="merged.zip" onReset={() => { setGroupId(null); files.clear(); }} resetLabel={t('pdf.mergeAnother')} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropMany')} buttonLabel={t('pdf.choosePdfs')} icon="merge" testId="dropzone" />;
  }

  const totalPages = files.files.reduce((n, f) => n + (infos[f.id]?.info?.pageCount ?? 0), 0);
  const pending = files.files.some((f) => !infos[f.id]);
  const broken = files.files.filter((f) => infos[f.id]?.error);

  const run = async () => {
    const inputs = files.files.map((f) => ({ name: f.name, size: f.size, file: f.file }));
    const id = await startCombinedJob(tool, inputs, {
      pool: 'pdf',
      operation: t('tool.pdf-merge.title'),
      label: tn('files.count', inputs.length),
      run: async (ctx) => {
        ctx.setState('processing');
        const blob = await mergePdfs(inputs.map((i) => i.file), { signal: ctx.signal, onProgress: ctx.progress });
        ctx.setState('finalizing');
        return [makeOutput('merged.pdf', blob, { [t('meta.pages')]: totalPages })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('pdf.addPdfs')} icon="plus" />
          <FileList
            files={files.files}
            onRemove={files.remove}
            onMove={files.move}
            extra={(f) => {
              const s = infos[f.id];
              if (!s) return <span class="muted">{t('progress.reading')}</span>;
              if (s.error) return <Badge tone="danger">{t(`error.${s.error}.title` as MessageKey)}</Badge>;
              return <Badge tone="brand">{tn('pdf.pages', s.info!.pageCount)}</Badge>;
            }}
          />
        </>
      }
      panel={
        <OptionsCard title={t('pdf.mergeSummary')}>
          <dl class="kv">
            <dt>{t('pdf.documents')}</dt>
            <dd>{files.files.length}</dd>
            <dt>{t('pdf.result')}</dt>
            <dd data-testid="total-pages">{pending ? '…' : tn('pdf.pages', totalPages)}</dd>
          </dl>
          {broken.length ? <Notice tone="danger">{t('pdf.mergeBroken', { names: broken.map((b) => b.name).join(', ') })}</Notice> : null}
          {files.files.length < 2 ? <Notice tone="info">{t('pdf.mergeNeedTwo')}</Notice> : null}
          <p class="small muted">{t('pdf.mergeOrderHint')}</p>
          <Button variant="primary" size="lg" block icon="merge" disabled={files.files.length < 2 || pending || broken.length > 0} onClick={() => void run()} data-testid="run">
            {t('pdf.mergeRun')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
