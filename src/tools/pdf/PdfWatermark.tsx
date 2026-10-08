import { makeOutput } from '../../core/jobs';
import { addPdfWatermark } from '../../engines/pdf/client';
import type { WatermarkOptions } from '../../engines/pdf/edit';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, ColorField, Segmented, Slider, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { PagePreview, cqw } from './PagePreview';

type Layout = WatermarkOptions['layout'];

/** Stamps a text watermark (diagonal, centered or tiled) on every page. */
export default function PdfWatermark({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [text, setText] = useSession<string>(tool.id, 'text', t('pdfWatermark.default'));
  const [layout, setLayout] = useSession<Layout>(tool.id, 'layout', 'diagonal');
  const [fontSize, setFontSize] = useSession<number>(tool.id, 'fontSize', 60);
  const [opacity, setOpacity] = useSession<number>(tool.id, 'opacity', 20);
  const [color, setColor] = useSession<string>(tool.id, 'color', '#e5484d');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="watermarked-pdfs.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('pdf.dropMany')} buttonLabel={t('pdf.choosePdfs')} icon="watermark" testId="dropzone" />;
  }

  const run = async () => {
    const options: WatermarkOptions = { text, layout, fontSize, opacity: opacity / 100, color };
    const id = await startJobs(tool, files.files, {
      pool: 'pdf',
      operation: t('tool.pdf-watermark.title'),
      run: (f) => async (ctx) => {
        ctx.setState('processing');
        const r = await addPdfWatermark(f.file, options, { signal: ctx.signal });
        if (r.replaced) ctx.note(tn('pdfWatermark.replaced', r.replaced));
        return [makeOutput(renameWithExtension(f.name, 'pdf', 'watermarked'), r.blob)];
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
                const angle = layout === 'diagonal' ? -(Math.atan2(page.height, page.width) * 180) / Math.PI : layout === 'tile' ? -30 : 0;
                const style = { fontSize: cqw(fontSize, page), color, opacity: opacity / 100, transform: `rotate(${angle}deg)` };
                return layout === 'tile' ? (
                  <div class="page-preview__tiles" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, i) => (
                      <span key={i} style={style}>
                        {text}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div class="page-preview__center" aria-hidden="true">
                    <span style={{ ...style, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>
                  </div>
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
          <TextInput label={t('watermark.text')} value={text} onChange={setText} error={!text.trim() ? t('watermark.textRequired') : undefined} />
          <div class="field">
            <div class="field__label">{t('pdfWatermark.layout')}</div>
            <Segmented
              label={t('pdfWatermark.layout')}
              value={layout}
              block
              onChange={setLayout}
              options={[
                { value: 'diagonal', label: t('pdfWatermark.diagonal') },
                { value: 'center', label: t('pdfWatermark.center') },
                { value: 'tile', label: t('pdfWatermark.tile') },
              ]}
            />
          </div>
          <Slider label={t('pageNum.fontSize')} value={fontSize} min={12} max={160} step={2} onChange={setFontSize} format={(v) => `${v} pt`} />
          <Slider label={t('watermark.opacity')} value={opacity} min={5} max={100} step={5} onChange={setOpacity} format={(v) => `${v}%`} />
          <ColorField label={t('watermark.color')} value={color} onChange={setColor} swatches={['#e5484d', '#000000', '#6b7280', '#1d4ed8', '#30a46c', '#f5a524']} />
          <p class="small muted">{t('pdfWatermark.note')}</p>
          <Button variant="primary" size="lg" block icon="watermark" disabled={!text.trim()} onClick={() => void run()} data-testid="run">
            {tn('pdfWatermark.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
