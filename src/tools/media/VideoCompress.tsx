import { compressVideo } from '../../engines/ffmpeg/commands';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, NumberInput, Segmented, Slider, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireVideo, runMediaJob } from './common';

type Preset = 'high' | 'balanced' | 'small';
const PRESETS: Record<Preset, { crf: number; maxHeight: number | null; audio: number }> = {
  high: { crf: 23, maxHeight: null, audio: 160 },
  balanced: { crf: 28, maxHeight: 1080, audio: 128 },
  small: { crf: 32, maxHeight: 720, audio: 96 },
};

export default function VideoCompress({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [preset, setPreset] = useSession<Preset>(tool.id, 'preset', 'balanced');
  const [advanced, setAdvanced] = useSession<boolean>(tool.id, 'advanced', false);
  const [crf, setCrf] = useSession<number>(tool.id, 'crf', 28);
  const [resolution, setResolution] = useSession<'original' | '1080' | '720' | '480'>(tool.id, 'res', '1080');
  const [useBitrate, setUseBitrate] = useSession<boolean>(tool.id, 'useBitrate', false);
  const [bitrate, setBitrate] = useSession<number | ''>(tool.id, 'bitrate', 1500);
  const [audio, setAudio] = useSession<number>(tool.id, 'audio', 128);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="compressed-videos.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('media.dropVideo')} buttonLabel={t('media.chooseVideo')} formatsHint={formatsHint(tool)} icon="compress" testId="dropzone" />;
  }

  const settings = advanced
    ? { crf, maxHeight: resolution === 'original' ? null : Number(resolution), audio, bitrate: useBitrate && typeof bitrate === 'number' && bitrate >= 100 ? bitrate : null }
    : { ...PRESETS[preset], bitrate: null };

  const run = async () => {
    const s = settings;
    const id = await startJobs(tool, files.files, {
      pool: 'media',
      operation: t('tool.video-compress.title'),
      run: (f) => async (ctx) => {
        const outputs = await runMediaJob(
          f,
          ctx,
          (info, input) => {
            requireVideo(info);
            return compressVideo({ input, info, crf: s.crf, maxHeight: s.maxHeight, videoBitrateKbps: s.bitrate, audioBitrateKbps: s.audio, baseName: 'output' });
          },
          { name: renameWithExtension(f.name, 'mp4', 'compressed'), format: 'mp4' },
        );
        if (outputs[0] && outputs[0].size >= f.size) ctx.note(t('note.videoNotSmaller'));
        return outputs;
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
          <CpuNotice />
        </>
      }
      panel={
        <OptionsCard>
          {!advanced ? (
            <div class="field">
              <div class="field__label">{t('compress.preset')}</div>
              <Segmented
                label={t('compress.preset')}
                value={preset}
                block
                onChange={setPreset}
                options={[
                  { value: 'high', label: t('video.preset.high') },
                  { value: 'balanced', label: t('video.preset.balanced') },
                  { value: 'small', label: t('video.preset.small') },
                ]}
              />
              <div class="field__hint">{t(`video.presetHint.${preset}` as never)}</div>
            </div>
          ) : null}
          <SwitchRow label={t('video.advanced')} checked={advanced} onChange={setAdvanced} />
          {advanced ? (
            <>
              <div class="field">
                <div class="field__label">{t('video.resolution')}</div>
                <Segmented label={t('video.resolution')} value={resolution} wrap onChange={setResolution} options={[{ value: 'original', label: t('video.original') }, { value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p' }]} />
              </div>
              <SwitchRow label={t('video.targetBitrate')} checked={useBitrate} onChange={setUseBitrate} />
              {useBitrate ? (
                <NumberInput label={t('video.videoBitrate')} value={bitrate} onChange={setBitrate} min={100} max={50000} suffix="kbps" />
              ) : (
                <Slider label={t('video.crf')} value={crf} min={18} max={36} onChange={setCrf} hint={t('video.crfHint')} />
              )}
              <div class="field">
                <div class="field__label">{t('video.audioBitrate')}</div>
                <Segmented label={t('video.audioBitrate')} value={audio} wrap onChange={setAudio} options={[64, 96, 128, 160, 192].map((b) => ({ value: b, label: `${b}k` }))} />
              </div>
            </>
          ) : null}
          <Button variant="primary" size="lg" block icon="compress" onClick={() => void run()} data-testid="run">
            {tn('video.compressN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
