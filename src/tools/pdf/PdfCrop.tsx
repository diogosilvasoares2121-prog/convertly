import { makeOutput } from '../../core/jobs';
import { cropPdf } from '../../engines/pdf/client';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, NumberInput, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { PagePreview } from './PagePreview';

const MM = 72 / 25.4;
type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Trims page margins on every page (non-destructive CropBox, like Acrobat's crop). */
export default function PdfCrop({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [linked, setLinked] = useSession<boolean>(tool.id, 'linked', true);
  const [margins, setMargins] = useSession<Record<Side, number | ''>>(tool.id, 'margins', { top: 10, right: 10, bottom: 10, left: 10 });
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="cropped-pdfs.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropMany')} buttonLabel={t('pdf.choosePdfs')} icon="crop" testId="dropzone" />;
  }

  const value = (s: Side) => (typeof margins[s] === 'number' ? (margins[s] as number) : 0);
  const setSide = (side: Side) => (v: number | '') => setMargins((m) => (linked ? { top: v, right: v, bottom: v, left: v } : { ...m, [side]: v }));
  const invalid = SIDES.some((s) => value(s) < 0 || value(s) > 200);
  const nothing = SIDES.every((s) => value(s) === 0);

  const run = async () => {
    const pts = { top: value('top') * MM, right: value('right') * MM, bottom: value('bottom') * MM, left: value('left') * MM };
    const id = await startJobs(tool, files.files, {
      pool: 'pdf',
      operation: t('tool.pdf-crop.title'),
      run: (f) => async (ctx) => {
        ctx.setState('processing');
        const blob = await cropPdf(f.file, pts, { signal: ctx.signal });
        return [makeOutput(renameWithExtension(f.name, 'pdf', 'cropped'), blob)];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          {first ? (
            <PagePreview
              file={first.file}
              overlay={(page) => {
                const pct = (mm: number, total: number) => `${Math.min(50, ((mm * MM) / total) * 100)}%`;
                return (
                  <div
                    class="page-preview__crop"
                    aria-hidden="true"
                    style={{ top: pct(value('top'), page.height), bottom: pct(value('bottom'), page.height), left: pct(value('left'), page.width), right: pct(value('right'), page.width) }}
                  />
                );
              }}
            />
          ) : null}
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <SwitchRow label={t('pdfCrop.linked')} checked={linked} onChange={setLinked} />
          {linked ? (
            <NumberInput label={t('pdfCrop.all')} value={margins.top} onChange={setSide('top')} min={0} max={200} suffix="mm" />
          ) : (
            <div class="grid-2">
              {SIDES.map((s) => (
                <NumberInput key={s} label={t(`pdfCrop.${s}` as never)} value={margins[s]} onChange={setSide(s)} min={0} max={200} suffix="mm" />
              ))}
            </div>
          )}
          {invalid ? <div class="field__error">{t('pdfCrop.invalid')}</div> : null}
          <p class="small muted">{t('pdfCrop.help')}</p>
          <Button variant="primary" size="lg" block icon="crop" disabled={invalid || nothing} onClick={() => void run()} data-testid="run">
            {t('pdfCrop.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
