import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { settingsStore } from '../../storage/settings';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { Button, Segmented, Slider, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { useImagePreview } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint, runImageJob } from './common';
import { sameOrFallback } from './ImageResize';

type Mode = 'left' | 'right' | '180' | 'custom';
const ANGLE: Record<Exclude<Mode, 'custom'>, number> = { left: -90, right: 90, '180': 180 };

export default function ImageRotate({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const [mode, setMode] = useSession<Mode>(tool.id, 'mode', 'right');
  const [angle, setAngle] = useSession<number>(tool.id, 'angle', 15);
  const [flipH, setFlipH] = useSession<boolean>(tool.id, 'flipH', false);
  const [flipV, setFlipV] = useSession<boolean>(tool.id, 'flipV', false);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0];
  const previewUrl = useImagePreview(first?.file ?? null, first?.format ?? null, 480);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="rotated-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('image.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="rotate" testId="dropzone" />;
  }

  const degrees = mode === 'custom' ? angle : ANGLE[mode];
  const transform = `rotate(${degrees}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`;

  const run = async () => {
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-rotate.title'),
      run: (f) => (ctx) => {
        const format = sameOrFallback(f.format, caps);
        // Custom angles expand the canvas; JPG corners become white, PNG/WEBP corners transparent.
        return runImageJob(f, { rotate: degrees, flipH, flipV }, { format, quality: settings.imageQuality / 100 }, ctx, 'rotated');
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          {previewUrl ? (
            <div class="preview-pane" style={{ minHeight: '280px' }}>
              <img src={previewUrl} alt={t('rotate.preview')} style={{ transform, transition: 'transform 200ms ease', maxHeight: '260px' }} />
            </div>
          ) : null}
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('rotate.rotation')}</div>
            <Segmented
              label={t('rotate.rotation')}
              value={mode}
              wrap
              onChange={setMode}
              options={[
                { value: 'left', label: t('rotate.left'), icon: 'rotate-left' },
                { value: 'right', label: t('rotate.right'), icon: 'rotate-right' },
                { value: '180', label: '180°' },
                { value: 'custom', label: t('compress.custom') },
              ]}
            />
          </div>
          {mode === 'custom' ? <Slider label={t('rotate.angle')} value={angle} min={-180} max={180} onChange={setAngle} format={(v) => `${v}°`} hint={t('rotate.customHint')} /> : null}
          <SwitchRow label={t('rotate.flipH')} checked={flipH} onChange={setFlipH} />
          <SwitchRow label={t('rotate.flipV')} checked={flipV} onChange={setFlipV} />
          <Button variant="primary" size="lg" block icon="rotate" onClick={() => void run()} data-testid="run">
            {tn('rotate.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
