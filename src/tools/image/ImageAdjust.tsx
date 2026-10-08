import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { settingsStore } from '../../storage/settings';
import { NEUTRAL, adjustmentOps as toOps, type Adjustments } from '../../engines/image/filters';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { Button, Segmented, Slider } from '../../ui/components/controls';
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

type Preset = 'none' | 'bw' | 'sepia' | 'vivid' | 'muted' | 'contrast' | 'invert' | 'custom';
const PRESETS: Record<Exclude<Preset, 'custom'>, Adjustments> = {
  none: NEUTRAL,
  bw: { ...NEUTRAL, grayscale: 100, contrast: 110 },
  sepia: { ...NEUTRAL, sepia: 80, contrast: 95, brightness: 105 },
  vivid: { ...NEUTRAL, saturation: 150, contrast: 115 },
  muted: { ...NEUTRAL, saturation: 60, contrast: 90, brightness: 105 },
  contrast: { ...NEUTRAL, contrast: 150 },
  invert: { ...NEUTRAL, invert: 100 },
};

/** Brightness, contrast, saturation, hue, black & white, sepia, invert and blur — in batch. */
export default function ImageAdjust({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const [adj, setAdj] = useSession<Adjustments>(tool.id, 'adj', NEUTRAL);
  const [preset, setPreset] = useSession<Preset>(tool.id, 'preset', 'none');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;
  const preview = useLivePreview(first?.file ?? null, first?.format ?? null, toOps(adj));

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="edited-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('image.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="adjust" testId="dropzone" />;
  }

  const set = (key: keyof Adjustments) => (v: number) => {
    setAdj((a) => ({ ...a, [key]: v }));
    setPreset('custom');
  };
  const neutral = JSON.stringify(adj) === JSON.stringify(NEUTRAL);

  const run = async () => {
    const ops = toOps(adj);
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-adjust.title'),
      run: (f) => (ctx) => runImageJob(f, ops, { format: sameOrFallback(f.format, caps), quality: settings.imageQuality / 100 }, ctx, preset === 'bw' ? 'bw' : 'edited'),
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <div class="preview-pane preview-pane--checker" style={{ minHeight: '300px' }}>
            {preview.url ? <img src={preview.url} alt={t('adjust.preview')} data-testid="live-preview" style={{ maxHeight: '420px', maxWidth: '100%' }} /> : <Spinner label={t('progress.loading')} />}
          </div>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('adjust.presets')}</div>
            <Segmented
              label={t('adjust.presets')}
              value={preset}
              wrap
              onChange={(p) => {
                setPreset(p);
                if (p !== 'custom') setAdj(PRESETS[p]);
              }}
              options={[
                { value: 'none', label: t('adjust.p.none') },
                { value: 'bw', label: t('adjust.p.bw') },
                { value: 'sepia', label: t('adjust.p.sepia') },
                { value: 'vivid', label: t('adjust.p.vivid') },
                { value: 'muted', label: t('adjust.p.muted') },
                { value: 'contrast', label: t('adjust.p.contrast') },
                { value: 'invert', label: t('adjust.p.invert') },
              ]}
            />
          </div>
          <Slider label={t('adjust.brightness')} value={adj.brightness} min={0} max={200} onChange={set('brightness')} format={(v) => `${v}%`} />
          <Slider label={t('adjust.contrast')} value={adj.contrast} min={0} max={200} onChange={set('contrast')} format={(v) => `${v}%`} />
          <Slider label={t('adjust.saturation')} value={adj.saturation} min={0} max={200} onChange={set('saturation')} format={(v) => `${v}%`} />
          <Slider label={t('adjust.hue')} value={adj.hue} min={-180} max={180} onChange={set('hue')} format={(v) => `${v}°`} />
          <Slider label={t('adjust.grayscale')} value={adj.grayscale} min={0} max={100} onChange={set('grayscale')} format={(v) => `${v}%`} />
          <Slider label={t('adjust.sepia')} value={adj.sepia} min={0} max={100} onChange={set('sepia')} format={(v) => `${v}%`} />
          <Slider label={t('adjust.blur')} value={adj.blur} min={0} max={20} onChange={set('blur')} format={(v) => (v ? `${v}` : t('adjust.off'))} />
          <Button variant="ghost" size="sm" icon="undo" disabled={neutral} onClick={() => { setAdj(NEUTRAL); setPreset('none'); }}>
            {t('action.reset')}
          </Button>
          <Button variant="primary" size="lg" block icon="adjust" disabled={neutral} onClick={() => void run()} data-testid="run">
            {tn('adjust.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
