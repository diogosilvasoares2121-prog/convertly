import { makeOutput } from '../../core/jobs';
import { addPageNumbers } from '../../engines/pdf/client';
import type { NumberFormat, NumberPosition } from '../../engines/pdf/edit';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, ColorField, NumberInput, PositionPicker, Select, Slider, SwitchRow, type GridPosition } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { positionLabels } from '../image/ImageWatermark';
import { PagePreview, cqw } from './PagePreview';

type Pos = 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right';
const ALLOWED: readonly Pos[] = ['top-left', 'top', 'top-right', 'bottom-left', 'bottom', 'bottom-right'];
const TO_ENGINE: Record<Pos, NumberPosition> = {
  'top-left': 'top-left',
  top: 'top-center',
  'top-right': 'top-right',
  'bottom-left': 'bottom-left',
  bottom: 'bottom-center',
  'bottom-right': 'bottom-right',
};

export function numberLabel(format: NumberFormat, n: number, total: number): string {
  if (format === 'n') return `${n}`;
  if (format === 'page-n') return `${t('pageNum.page')} ${n}`;
  if (format === 'n-of-total') return `${n} / ${total}`;
  return `${t('pageNum.page')} ${n} ${t('pageNum.of')} ${total}`;
}

/** Adds page numbers (position, style, start number, skip cover page). */
export default function PdfPageNumbers({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [position, setPosition] = useSession<Pos>(tool.id, 'position', 'bottom');
  const [format, setFormat] = useSession<NumberFormat>(tool.id, 'format', 'n');
  const [start, setStart] = useSession<number | ''>(tool.id, 'start', 1);
  const [fontSize, setFontSize] = useSession<number>(tool.id, 'fontSize', 11);
  const [margin, setMargin] = useSession<number>(tool.id, 'margin', 28);
  const [skipFirst, setSkipFirst] = useSession<boolean>(tool.id, 'skipFirst', false);
  const [color, setColor] = useSession<string>(tool.id, 'color', '#000000');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="numbered-pdfs.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropMany')} buttonLabel={t('pdf.choosePdfs')} icon="numbers" testId="dropzone" />;
  }

  const startN = typeof start === 'number' && start >= 1 ? Math.round(start) : 1;
  const run = async () => {
    const options = { position: TO_ENGINE[position], format, start: startN, fontSize, margin, skipFirst, color, pageWord: t('pageNum.page'), ofWord: t('pageNum.of') };
    const id = await startJobs(tool, files.files, {
      pool: 'pdf',
      operation: t('tool.pdf-page-numbers.title'),
      run: (f) => async (ctx) => {
        ctx.setState('processing');
        const blob = await addPageNumbers(f.file, options, { signal: ctx.signal });
        return [makeOutput(renameWithExtension(f.name, 'pdf', 'numbered'), blob)];
      },
    });
    if (id) setGroupId(id);
  };

  const vertical = position.startsWith('top') ? 'top' : 'bottom';
  const align = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center';

  return (
    <ToolWorkspace
      main={
        <>
          {first ? (
            <PagePreview
              file={first.file}
              overlay={(page) => skipFirst ? null : (
                <span
                  class="page-preview__mark"
                  style={{
                    [vertical]: cqw(margin, page),
                    ...(align === 'center' ? { left: '50%', transform: 'translateX(-50%)' } : { [align]: cqw(margin, page) }),
                    fontSize: cqw(fontSize, page),
                    color,
                  }}
                >
                  {numberLabel(format, startN, startN + 9)}
                </span>
              )}
            />
          ) : null}
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <PositionPicker<Pos> label={t('pageNum.position')} value={position} onChange={setPosition} labels={positionLabels() as Record<GridPosition, string>} allowed={ALLOWED} />
          <Select
            label={t('pageNum.format')}
            value={format}
            onChange={setFormat}
            options={(['n', 'page-n', 'n-of-total', 'page-n-of-total'] as const).map((f) => ({ value: f, label: numberLabel(f, 1, 10) }))}
          />
          <NumberInput label={t('pageNum.start')} value={start} onChange={setStart} min={1} max={99999} />
          <Slider label={t('pageNum.fontSize')} value={fontSize} min={6} max={36} onChange={setFontSize} format={(v) => `${v} pt`} />
          <Slider label={t('pageNum.margin')} value={margin} min={8} max={96} step={2} onChange={setMargin} format={(v) => `${v} pt`} />
          <SwitchRow label={t('pageNum.skipFirst')} hint={t('pageNum.skipFirstHint')} checked={skipFirst} onChange={setSkipFirst} />
          <ColorField label={t('pageNum.color')} value={color} onChange={setColor} swatches={['#000000', '#4b5563', '#9ca3af', '#ffffff', '#1d4ed8', '#b91c1c']} />
          <Button variant="primary" size="lg" block icon="numbers" onClick={() => void run()} data-testid="run">
            {tn('pageNum.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
