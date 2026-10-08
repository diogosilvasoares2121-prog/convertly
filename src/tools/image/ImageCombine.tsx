import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { makeOutput } from '../../core/jobs';
import { settingsStore } from '../../storage/settings';
import { combineImages } from '../../engines/image/client';
import type { ImageOutputFormat } from '../../engines/image/types';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { splitName } from '../../utils/filename';
import { Button, ColorField, Segmented, Slider, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { useImagePreview } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles, type ToolFile } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { EXT, acceptFor, formatsHint } from './common';

type Layout = 'horizontal' | 'vertical' | 'grid';
type Background = 'transparent' | 'color';

function Tile({ file }: { file: ToolFile }) {
  const url = useImagePreview(file.file, file.format, 240);
  return <div class="combine-preview__tile">{url ? <img src={url} alt="" /> : null}</div>;
}

/** Joins images side by side, stacked or in a grid (collages, before/after, receipts). */
export default function ImageCombine({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const [layout, setLayout] = useSession<Layout>(tool.id, 'layout', 'horizontal');
  const [columns, setColumns] = useSession<number>(tool.id, 'columns', 2);
  const [gap, setGap] = useSession<number>(tool.id, 'gap', 0);
  const [bgMode, setBgMode] = useSession<Background>(tool.id, 'bgMode', 'color');
  const [bg, setBg] = useSession<string>(tool.id, 'bg', '#ffffff');
  const [equalize, setEqualize] = useSession<boolean>(tool.id, 'equalize', true);
  const [format, setFormat] = useSession<ImageOutputFormat>(tool.id, 'format', 'jpg');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="combined.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('combine.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="combine" testId="dropzone" />;
  }

  const outputs: ImageOutputFormat[] = ['jpg', 'png', ...(caps.encodeWebp ? (['webp'] as const) : [])];
  const cols = layout === 'horizontal' ? files.files.length : layout === 'vertical' ? 1 : Math.min(columns, files.files.length);
  const transparent = bgMode === 'transparent' && format !== 'jpg';

  const run = async () => {
    const list = files.files.map((f) => ({ file: f.file, format: f.format! }));
    const out = format;
    const name = `${splitName(files.files[0]!.name).base || 'image'}-combined.${EXT[out]}`;
    const req = { layout, columns, gap, background: transparent ? 'transparent' : bg, equalize, output: { format: out, quality: settings.imageQuality / 100 } };
    const id = await startCombinedJob(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-combine.title'),
      label: tn('files.count', list.length),
      run: async (ctx) => {
        ctx.setState('processing');
        const r = await combineImages({ files: list, ...req }, { signal: ctx.signal, onProgress: ctx.progress });
        return [makeOutput(name, r.blob, { [t('meta.dimensions')]: `${r.width}×${r.height}` })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <div class="card card--pad">
            <div
              class={`combine-preview combine-preview--${layout}${transparent ? ' preview-pane--checker' : ''}`}
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${Math.min(16, gap / 4)}px`, padding: `${Math.min(16, gap / 4)}px`, background: transparent ? undefined : bg }}
              aria-label={t('combine.preview')}
              role="img"
            >
              {files.files.slice(0, 24).map((f) => (
                <Tile key={f.id} file={f} />
              ))}
            </div>
          </div>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} onMove={files.move} />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('combine.layout')}</div>
            <Segmented
              label={t('combine.layout')}
              value={layout}
              block
              onChange={setLayout}
              options={[
                { value: 'horizontal', label: t('combine.horizontal') },
                { value: 'vertical', label: t('combine.vertical') },
                { value: 'grid', label: t('combine.grid') },
              ]}
            />
          </div>
          {layout === 'grid' ? <Slider label={t('combine.columns')} value={columns} min={2} max={6} onChange={setColumns} /> : null}
          <Slider label={t('combine.gap')} value={gap} min={0} max={100} step={2} onChange={setGap} format={(v) => `${v} px`} />
          <SwitchRow label={t('combine.equalize')} hint={t('combine.equalizeHint')} checked={equalize} onChange={setEqualize} />
          <div class="field">
            <div class="field__label">{t('combine.background')}</div>
            <Segmented
              label={t('combine.background')}
              value={format === 'jpg' ? 'color' : bgMode}
              block
              onChange={setBgMode}
              options={[
                { value: 'color', label: t('combine.color') },
                { value: 'transparent', label: t('svg.transparent'), disabled: format === 'jpg' },
              ]}
            />
          </div>
          {!transparent ? <ColorField label={t('combine.color')} value={bg} onChange={setBg} /> : null}
          <div class="field">
            <div class="field__label">{t('options.convertTo')}</div>
            <Segmented label={t('options.convertTo')} value={format} block onChange={setFormat} options={outputs.map((f) => ({ value: f, label: f.toUpperCase() }))} />
          </div>
          {files.files.length < 2 ? <Notice tone="info">{t('combine.needTwo')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="combine" disabled={files.files.length < 2} onClick={() => void run()} data-testid="run">
            {tn('combine.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
