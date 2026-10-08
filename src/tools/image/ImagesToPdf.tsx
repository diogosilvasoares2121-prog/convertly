import { makeOutput } from '../../core/jobs';
import { imagesToPdf } from '../../engines/pdf/client';
import type { Fit, Margin, Orientation, PageSize } from '../../engines/pdf/ops';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from './common';
import { prepareImagesForPdf } from './pdf-images';

export default function ImagesToPdf({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [pageSize, setPageSize] = useSession<PageSize>(tool.id, 'pageSize', 'a4');
  const [orientation, setOrientation] = useSession<Orientation>(tool.id, 'orientation', 'auto');
  const [margin, setMargin] = useSession<Margin>(tool.id, 'margin', 'small');
  const [fit, setFit] = useSession<Fit>(tool.id, 'fit', 'contain');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="images.zip" onReset={() => { setGroupId(null); files.clear(); }} resetLabel={t('action.createAnother')} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('imagePdf.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="image-pdf" testId="dropzone" />;
  }

  const run = async () => {
    const inputs = files.files.map((f) => ({ file: f.file, format: f.format!, name: f.name, size: f.size }));
    const name = inputs.length === 1 ? renameWithExtension(inputs[0]!.name, 'pdf') : 'images.pdf';
    const id = await startCombinedJob(tool, inputs, {
      pool: 'pdf',
      operation: t('tool.images-to-pdf.title'),
      label: inputs.length === 1 ? inputs[0]!.name : tn('files.count', inputs.length),
      run: async (ctx) => {
        ctx.setState('processing');
        const prepared = await prepareImagesForPdf(inputs, ctx.signal, (p) => ctx.progress(p * 0.6));
        const blob = await imagesToPdf(prepared, { pageSize, orientation, margin, fit }, { signal: ctx.signal, onProgress: (p) => ctx.progress(0.6 + (p ?? 0) * 0.4) });
        ctx.setState('finalizing');
        return [makeOutput(name, blob, { [t('meta.pages')]: inputs.length })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} onMove={files.move} />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('pdf.pageSize')}</div>
            <Segmented label={t('pdf.pageSize')} value={pageSize} block onChange={setPageSize} options={[{ value: 'auto', label: t('pdf.auto') }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
          </div>
          <div class="field">
            <div class="field__label">{t('pdf.orientation')}</div>
            <Segmented label={t('pdf.orientation')} value={orientation} block onChange={setOrientation} options={[{ value: 'auto', label: t('pdf.auto') }, { value: 'portrait', label: t('pdf.portrait') }, { value: 'landscape', label: t('pdf.landscape') }]} />
          </div>
          <div class="field">
            <div class="field__label">{t('pdf.margins')}</div>
            <Segmented label={t('pdf.margins')} value={margin} block onChange={setMargin} options={[{ value: 'none', label: t('pdf.none') }, { value: 'small', label: t('pdf.small') }, { value: 'medium', label: t('pdf.medium') }]} />
          </div>
          <div class="field">
            <div class="field__label">{t('pdf.fit')}</div>
            <Segmented label={t('pdf.fit')} value={fit} block onChange={setFit} options={[{ value: 'contain', label: t('pdf.contain') }, { value: 'cover', label: t('pdf.cover') }, { value: 'original', label: t('pdf.original') }]} />
          </div>
          <Button variant="primary" size="lg" block icon="image-pdf" onClick={() => void run()} data-testid="run">
            {t('imagePdf.create')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
