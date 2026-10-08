import { cropVideoToRatio, muteVideo, resizeVideo, rotateVideo, sameVideoContainer, type RotateMode } from '../../engines/ffmpeg/commands';
import { FORMATS, type FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, NumberInput, Segmented, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireVideo, runMediaJob } from './common';

type Mode = 'resize' | 'mute' | 'rotate' | 'crop';
type Ratio = '1:1' | '9:16' | '16:9' | '4:5' | '4:3';
const RATIOS: Record<Ratio, number> = { '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '4:5': 4 / 5, '4:3': 4 / 3 };
type SizePreset = '1080' | '720' | '480' | 'custom';

function copyContainer(format: FormatId): FormatId {
  return format === 'avi' || format === 'mpeg' || format === '3gp' || format === 'wmv' ? format : sameVideoContainer(format);
}

export default function VideoEdit({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as Mode | undefined) ?? 'resize';
  const files = useToolFiles(tool);
  const [size, setSize] = useSession<SizePreset>(tool.id, 'size', '720');
  const [width, setWidth] = useSession<number | ''>(tool.id, 'w', 1280);
  const [height, setHeight] = useSession<number | ''>(tool.id, 'h', 720);
  const [keepAspect, setKeepAspect] = useSession<boolean>(tool.id, 'aspect', true);
  const [rotation, setRotation] = useSession<RotateMode>(tool.id, 'rotation', 'cw');
  const [ratio, setRatio] = useSession<Ratio>(tool.id, 'ratio', '9:16');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="videos.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('media.dropVideo')} buttonLabel={t('media.chooseVideo')} formatsHint={formatsHint(tool)} icon={tool.icon} testId="dropzone" />;
  }

  const customInvalid = mode === 'resize' && size === 'custom' && (typeof width !== 'number' || typeof height !== 'number' || width < 16 || height < 16 || width > 7680 || height > 4320);

  const run = async () => {
    const opts = { size, width: Number(width), height: Number(height), keepAspect, rotation, ratio: RATIOS[ratio] };
    const id = await startJobs(tool, files.files, {
      pool: 'media',
      operation: t(`tool.${tool.id}.title` as never),
      run: (f) => (ctx) => {
        const out = mode === 'mute' ? copyContainer(f.format!) : sameVideoContainer(f.format!);
        const suffix = mode === 'mute' ? 'muted' : mode === 'rotate' ? 'rotated' : mode === 'crop' ? ratio.replace(':', 'x') : 'resized';
        return runMediaJob(
          f,
          ctx,
          (info, input) => {
            requireVideo(info);
            if (mode === 'mute') return muteVideo({ input, info, format: f.format!, baseName: 'output' });
            if (mode === 'crop') return cropVideoToRatio({ input, info, format: f.format!, ratio: opts.ratio, baseName: 'output' });
            if (mode === 'rotate') return rotateVideo({ input, info, format: f.format!, mode: opts.rotation, baseName: 'output' });
            return opts.size === 'custom'
              ? resizeVideo({ input, info, format: f.format!, box: { width: opts.width, height: opts.height, keepAspect: opts.keepAspect }, baseName: 'output' })
              : resizeVideo({ input, info, format: f.format!, height: Number(opts.size), baseName: 'output' });
          },
          { name: renameWithExtension(f.name, FORMATS[out].extensions[0]!, suffix), format: out },
        );
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          {mode !== 'mute' ? <CpuNotice /> : null}
        </>
      }
      panel={
        <OptionsCard>
          {mode === 'resize' ? (
            <>
              <div class="field">
                <div class="field__label">{t('video.resolution')}</div>
                <Segmented
                  label={t('video.resolution')}
                  value={size}
                  wrap
                  onChange={setSize}
                  options={[
                    { value: '1080', label: '1080p' },
                    { value: '720', label: '720p' },
                    { value: '480', label: '480p' },
                    { value: 'custom', label: t('compress.custom') },
                  ]}
                />
                <div class="field__hint">{t('video.resizeHint')}</div>
              </div>
              {size === 'custom' ? (
                <>
                  <div class="row" style={{ alignItems: 'flex-start' }}>
                    <div class="grow">
                      <NumberInput label={t('resize.width')} value={width} onChange={setWidth} min={16} max={7680} suffix="px" />
                    </div>
                    <div class="grow">
                      <NumberInput label={t('resize.height')} value={height} onChange={setHeight} min={16} max={4320} suffix="px" />
                    </div>
                  </div>
                  <SwitchRow label={t('resize.keepAspect')} hint={keepAspect ? t('video.keepAspectHint') : undefined} checked={keepAspect} onChange={setKeepAspect} />
                  {customInvalid ? <div class="field__error">{t('video.invalidSize')}</div> : null}
                </>
              ) : null}
            </>
          ) : null}
          {mode === 'rotate' ? (
            <div class="field">
              <div class="field__label">{t('rotate.rotation')}</div>
              <Segmented
                label={t('rotate.rotation')}
                value={rotation}
                wrap
                onChange={setRotation}
                options={[
                  { value: 'ccw', label: t('rotate.left'), icon: 'rotate-left' },
                  { value: 'cw', label: t('rotate.right'), icon: 'rotate-right' },
                  { value: '180', label: '180°' },
                  { value: 'hflip', label: t('rotate.flipH') },
                  { value: 'vflip', label: t('rotate.flipV') },
                ]}
              />
            </div>
          ) : null}
          {mode === 'crop' ? (
            <div class="field">
              <div class="field__label">{t('crop.aspect')}</div>
              <Segmented
                label={t('crop.aspect')}
                value={ratio}
                wrap
                onChange={setRatio}
                options={[
                  { value: '9:16', label: t('videoCrop.vertical') },
                  { value: '1:1', label: t('videoCrop.square') },
                  { value: '4:5', label: '4:5' },
                  { value: '16:9', label: '16:9' },
                  { value: '4:3', label: '4:3' },
                ]}
              />
              <div class="field__hint">{t('videoCrop.hint')}</div>
            </div>
          ) : null}
          {mode === 'mute' ? <p class="small muted">{t('video.muteHint')}</p> : null}
          <Button variant="primary" size="lg" block icon={tool.icon} disabled={customInvalid} onClick={() => void run()} data-testid="run">
            {tn(`video.run.${mode}` as never, files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
