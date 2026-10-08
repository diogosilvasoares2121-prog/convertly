import { AppError } from '../../core/errors';
import { makeOutput, type OutputFile } from '../../core/jobs';
import { extractPdfImages, repairPdf } from '../../engines/pdf/client';
import { openPdf } from '../../engines/pdf/render';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension, splitName } from '../../utils/filename';
import { Button, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor } from '../image/common';

type Mode = 'text' | 'images' | 'repair';

/** One-click PDF tools: extract text, extract embedded images, repair a damaged file. */
export default function PdfSimple({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as Mode | undefined) ?? 'text';
  const files = useToolFiles(tool, { multiple: true });
  const [separators, setSeparators] = useSession<boolean>(tool.id, 'separators', true);
  const [skipSmall, setSkipSmall] = useSession<boolean>(tool.id, 'skipSmall', true);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={mode === 'images' ? 'pdf-images.zip' : mode === 'text' ? 'pdf-text.zip' : 'repaired-pdfs.zip'} onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropMany')} buttonLabel={t('pdf.choosePdfs')} icon={tool.icon} testId="dropzone" />;
  }

  const run = async () => {
    const opts = { separators, minSize: skipSmall ? 64 : 1 };
    const id = await startJobs(tool, files.files, {
      pool: 'pdf',
      operation: t(`tool.${tool.id}.title` as never),
      run: (f) => async (ctx): Promise<OutputFile[]> => {
        ctx.setState('processing');
        if (mode === 'repair') {
          const r = await repairPdf(f.file, { signal: ctx.signal });
          ctx.note(tn('pdfRepair.pages', r.pages));
          return [makeOutput(renameWithExtension(f.name, 'pdf', 'repaired'), r.blob, { [t('meta.pages')]: r.pages })];
        }
        if (mode === 'images') {
          const base = splitName(f.name).base || 'pdf';
          const r = await extractPdfImages(f.file, base, opts.minSize, { signal: ctx.signal, onProgress: ctx.progress });
          if (r.skipped) ctx.note(tn('pdfImages.skipped', r.skipped));
          if (!r.images.length) {
            ctx.note(t('pdfImages.none'));
            return [];
          }
          return r.images.map((img) => makeOutput(img.name, img.blob, { [t('meta.dimensions')]: `${img.width}×${img.height}` }));
        }
        const pdf = await openPdf(f.file);
        try {
          const parts: string[] = [];
          let chars = 0;
          for (let i = 0; i < pdf.pageCount; i++) {
            if (ctx.signal.aborted) throw new AppError('cancelled');
            const text = await pdf.pageText(i);
            chars += text.length;
            parts.push(opts.separators ? `--- ${t('pdfText.page', { n: i + 1 })} ---\n${text}` : text);
            ctx.progress((i + 1) / pdf.pageCount);
          }
          if (!chars) {
            ctx.note(t('pdfText.empty'));
            return [];
          }
          return [makeOutput(renameWithExtension(f.name, 'txt'), new Blob([parts.join('\n\n') + '\n'], { type: 'text/plain;charset=utf-8' }), { [t('meta.pages')]: pdf.pageCount, [t('pdfText.chars')]: chars })];
        } finally {
          await pdf.destroy();
        }
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          {mode === 'text' ? (
            <>
              <SwitchRow label={t('pdfText.separators')} hint={t('pdfText.separatorsHint')} checked={separators} onChange={setSeparators} />
              <Notice tone="neutral" icon="info">
                {t('pdfText.ocrNote')}
              </Notice>
            </>
          ) : null}
          {mode === 'images' ? (
            <>
              <SwitchRow label={t('pdfImages.skipSmall')} hint={t('pdfImages.skipSmallHint')} checked={skipSmall} onChange={setSkipSmall} />
              <p class="small muted">{t('pdfImages.help')}</p>
            </>
          ) : null}
          {mode === 'repair' ? <p class="small muted">{t('pdfRepair.help')}</p> : null}
          <Button variant="primary" size="lg" block icon={tool.icon} onClick={() => void run()} data-testid="run">
            {mode === 'text' ? t('pdfText.run') : mode === 'images' ? t('pdfImages.run') : t('pdfRepair.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
