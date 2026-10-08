import { useStore } from '../../core/store';
import { capabilitiesStore, type Capabilities } from '../../core/capabilities';
import { settingsStore } from '../../storage/settings';
import type { ImageOps, ImageOutputFormat } from '../../engines/image/types';
import type { FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { Button, NumberInput, Segmented, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint, runImageJob } from './common';

const PRESETS: Array<{ id: string; w: number; h: number; label: string }> = [
  { id: '1920x1080', w: 1920, h: 1080, label: '1920×1080' },
  { id: '1280x720', w: 1280, h: 720, label: '1280×720' },
  { id: '1080x1080', w: 1080, h: 1080, label: '1080×1080' },
  { id: '1080x1350', w: 1080, h: 1350, label: '1080×1350' },
  { id: '1080x1920', w: 1080, h: 1920, label: '1080×1920' },
  { id: '1200x628', w: 1200, h: 628, label: '1200×628' },
];

/** Keeps the original format when the browser can encode it; otherwise a sensible fallback. */
export function sameOrFallback(from: FormatId | null, caps: Capabilities): ImageOutputFormat {
  if (from === 'jpg' || from === 'png') return from;
  if (from === 'webp' && caps.encodeWebp) return 'webp';
  if (from === 'avif' && caps.encodeAvif) return 'avif';
  if (from === 'heic' || from === 'tiff') return 'jpg';
  return 'png'; // gif, bmp, ico: lossless and keeps transparency
}

export default function ImageResize({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const [preset, setPreset] = useSession<string>(tool.id, 'preset', '1920x1080');
  const [unit, setUnit] = useSession<'px' | 'percent'>(tool.id, 'unit', 'px');
  const [width, setWidth] = useSession<number | ''>(tool.id, 'width', 1600);
  const [height, setHeight] = useSession<number | ''>(tool.id, 'height', '');
  const [percent, setPercent] = useSession<number | ''>(tool.id, 'percent', 50);
  const [keepAspect, setKeepAspect] = useSession<boolean>(tool.id, 'aspect', true);
  const [enlarge, setEnlarge] = useSession<boolean>(tool.id, 'enlarge', false);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="resized-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('image.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="resize" testId="dropzone" />;
  }

  const custom = preset === 'custom';
  let ops: ImageOps | null = null;
  let error: string | null = null;
  if (!custom) {
    const p = PRESETS.find((x) => x.id === preset)!;
    ops = keepAspect ? { fit: { maxWidth: p.w, maxHeight: p.h, allowEnlarge: enlarge } } : { resize: { width: p.w, height: p.h } };
  } else if (unit === 'percent') {
    if (typeof percent !== 'number' || percent < 1 || percent > 1000) error = t('resize.invalidPercent');
    else ops = { fit: { percent } };
  } else {
    const w = typeof width === 'number' && width > 0 ? Math.round(width) : undefined;
    const h = typeof height === 'number' && height > 0 ? Math.round(height) : undefined;
    if (!w && !h) error = t('resize.needSize');
    else if ((w ?? 0) > 32767 || (h ?? 0) > 32767) error = t('resize.tooLarge');
    else if (keepAspect || !w || !h) ops = { fit: { ...(w ? { maxWidth: w } : {}), ...(h ? { maxHeight: h } : {}), allowEnlarge: enlarge } };
    else ops = { resize: { width: w, height: h } };
  }

  const run = async () => {
    if (!ops) return;
    const finalOps = ops;
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-resize.title'),
      run: (f) => (ctx) => runImageJob(f, finalOps, { format: sameOrFallback(f.format, caps), quality: settings.imageQuality / 100 }, ctx, 'resized'),
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
          <div class="field">
            <div class="field__label">{t('resize.size')}</div>
            <Segmented
              label={t('resize.size')}
              value={preset}
              wrap
              onChange={setPreset}
              options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: t('compress.custom') }]}
            />
          </div>
          {custom ? (
            <>
              <div class="field">
                <div class="field__label">{t('resize.units')}</div>
                <Segmented label={t('resize.units')} value={unit} block onChange={setUnit} options={[{ value: 'px', label: 'px' }, { value: 'percent', label: '%' }]} />
              </div>
              {unit === 'px' ? (
                <div class="row" style={{ alignItems: 'flex-start' }}>
                  <div class="grow">
                    <NumberInput label={t('resize.width')} value={width} onChange={setWidth} min={1} max={32767} suffix="px" />
                  </div>
                  <div class="grow">
                    <NumberInput label={t('resize.height')} value={height} onChange={setHeight} min={1} max={32767} suffix="px" />
                  </div>
                </div>
              ) : (
                <NumberInput label={t('resize.percent')} value={percent} onChange={setPercent} min={1} max={1000} suffix="%" />
              )}
            </>
          ) : null}
          {!(custom && unit === 'percent') ? (
            <SwitchRow label={t('resize.keepAspect')} hint={keepAspect ? t('resize.keepAspectOn') : t('resize.keepAspectOff')} checked={keepAspect} onChange={setKeepAspect} />
          ) : null}
          {!(custom && unit === 'percent') && (keepAspect || custom) ? <SwitchRow label={t('resize.enlarge')} checked={enlarge} onChange={setEnlarge} /> : null}
          {error ? <div class="field__error">{error}</div> : null}
          <Button variant="primary" size="lg" block icon="resize" disabled={!ops} onClick={() => void run()} data-testid="run">
            {tn('resize.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
