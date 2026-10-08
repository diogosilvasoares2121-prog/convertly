import { makeOutput } from '../../core/jobs';
import { compressPdf } from '../../engines/pdf/client';
import type { CompressPreset } from '../../engines/pdf/compress';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatBytes, savedPercent } from '../../utils/bytes';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { usePdfInfo } from './info';

/** Results smaller than this ratio are not worth a new file: the user is told honestly. */
const MIN_GAIN = 0.97;

export default function PdfCompress({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const first = files.files[0] ?? null;
  const { error } = usePdfInfo(first?.file ?? null);
  const [preset, setPreset] = useSession<CompressPreset>(tool.id, 'preset', 'balanced');
  const [stripMeta, setStripMeta] = useSession<boolean>(tool.id, 'meta', false);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="compressed-pdfs.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropMany')} buttonLabel={t('pdf.choosePdfs')} icon="compress" testId="dropzone" />;
  }

  const run = async () => {
    const id = await startJobs(tool, files.files, {
      pool: 'pdf',
      operation: t(`pdfCompress.${preset}` as never),
      run: (f) => async (ctx) => {
        ctx.setState('processing');
        const { blob, stats } = await compressPdf(f.file, preset, stripMeta, { signal: ctx.signal, onProgress: ctx.progress });
        ctx.setState('finalizing');
        ctx.note(t('pdfCompress.stats', { recompressed: stats.imagesRecompressed, found: stats.imagesFound }));
        if (stats.resultSize >= stats.originalSize * MIN_GAIN) {
          // Honest result: no fake numbers, no useless bigger file.
          ctx.note(t('pdfCompress.noGain', { size: formatBytes(stats.originalSize) }));
          return [];
        }
        ctx.note(t('pdfCompress.saved', { percent: savedPercent(stats.originalSize, stats.resultSize) }));
        return [makeOutput(renameWithExtension(f.name, 'pdf', 'compressed'), blob)];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('pdf.addPdfs')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
          {error ? <ErrorNotice code={error} /> : null}
          <Notice tone="info" title={t('pdfCompress.howTitle')}>
            {t('pdfCompress.how')}
          </Notice>
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('compress.preset')}</div>
            <Segmented
              label={t('compress.preset')}
              value={preset}
              block
              onChange={setPreset}
              options={[
                { value: 'low', label: t('pdfCompress.low') },
                { value: 'balanced', label: t('pdfCompress.balanced') },
                { value: 'strong', label: t('pdfCompress.strong') },
              ]}
            />
            <div class="field__hint">{t(`pdfCompress.hint.${preset}` as never)}</div>
          </div>
          <SwitchRow label={t('pdfCompress.removeMeta')} checked={stripMeta} onChange={setStripMeta} />
          <Button variant="primary" size="lg" block icon="compress" onClick={() => void run()} data-testid="run">
            {t('pdfCompress.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
