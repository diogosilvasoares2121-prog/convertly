import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { settingsStore } from '../../storage/settings';
import type { WatermarkPosition } from '../../engines/image/types';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { Button, ColorField, PositionPicker, Slider, SwitchRow, TextInput, type GridPosition } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint, runImageJob } from './common';
import { sameOrFallback } from './ImageResize';
import { useLivePreview } from './live-preview';

export function positionLabels(): Record<GridPosition, string> {
  return {
    'top-left': t('pos.top-left'),
    top: t('pos.top'),
    'top-right': t('pos.top-right'),
    left: t('pos.left'),
    center: t('pos.center'),
    right: t('pos.right'),
    'bottom-left': t('pos.bottom-left'),
    bottom: t('pos.bottom'),
    'bottom-right': t('pos.bottom-right'),
  };
}

/** Text watermark for images: position, tiling, size, opacity, colour and angle — previewed live. */
export default function ImageWatermark({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const [text, setText] = useSession<string>(tool.id, 'text', `© ${new Date().getFullYear()}`);
  const [position, setPosition] = useSession<GridPosition>(tool.id, 'position', 'bottom-right');
  const [tile, setTile] = useSession<boolean>(tool.id, 'tile', false);
  const [size, setSize] = useSession<number>(tool.id, 'size', 6);
  const [opacity, setOpacity] = useSession<number>(tool.id, 'opacity', 60);
  const [color, setColor] = useSession<string>(tool.id, 'color', '#ffffff');
  const [angle, setAngle] = useSession<number>(tool.id, 'angle', 0);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;

  const watermark = {
    text,
    sizePct: size,
    opacity: opacity / 100,
    color,
    position: (tile ? 'tile' : position) as WatermarkPosition,
    angle,
  };
  const preview = useLivePreview(first?.file ?? null, first?.format ?? null, { watermark });

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="watermarked-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('image.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="watermark" testId="dropzone" />;
  }

  const run = async () => {
    const wm = { ...watermark };
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-watermark.title'),
      run: (f) => (ctx) => runImageJob(f, { watermark: wm }, { format: sameOrFallback(f.format, caps), quality: settings.imageQuality / 100 }, ctx, 'watermarked'),
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <div class="preview-pane preview-pane--checker" style={{ minHeight: '300px' }}>
            {preview.url ? <img src={preview.url} alt={t('watermark.preview')} data-testid="live-preview" style={{ maxHeight: '420px', maxWidth: '100%' }} /> : <Spinner label={t('progress.loading')} />}
          </div>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <TextInput label={t('watermark.text')} value={text} onChange={setText} placeholder="© Convertly" error={!text.trim() ? t('watermark.textRequired') : undefined} />
          <SwitchRow label={t('watermark.tile')} hint={t('watermark.tileHint')} checked={tile} onChange={(v) => {
            setTile(v);
            if (v && angle === 0) setAngle(-30);
            if (!v && angle === -30) setAngle(0);
          }} />
          {!tile ? <PositionPicker label={t('watermark.position')} value={position} onChange={setPosition} labels={positionLabels()} /> : null}
          <Slider label={t('watermark.size')} value={size} min={2} max={25} onChange={setSize} format={(v) => `${v}%`} />
          <Slider label={t('watermark.opacity')} value={opacity} min={10} max={100} step={5} onChange={setOpacity} format={(v) => `${v}%`} />
          <Slider label={t('watermark.angle')} value={angle} min={-90} max={90} step={5} onChange={setAngle} format={(v) => `${v}°`} />
          <ColorField label={t('watermark.color')} value={color} onChange={setColor} />
          <Button variant="primary" size="lg" block icon="watermark" disabled={!text.trim()} onClick={() => void run()} data-testid="run">
            {tn('watermark.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
