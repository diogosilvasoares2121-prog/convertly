import { convertAudio, convertVideo, type AudioOut, type VideoOut, type VideoQuality } from '../../engines/ffmpeg/commands';
import { AUDIO_OUTPUTS, VIDEO_OUTPUTS } from '../../registry/matrix';
import { FORMATS, type FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented, Select, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireAudio, requireVideo, runMediaJob } from './common';

const LOSSLESS: ReadonlySet<FormatId> = new Set(['wav', 'flac']);
const BITRATES = [96, 128, 192, 256, 320] as const;

/**
 * Video → video, video → audio, audio → audio and "change bitrate" share this screen;
 * the tool preset decides which outputs are offered.
 */
export default function MediaConvert({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const audioMode = tool.preset?.mode === 'audio' || tool.preset?.mode === 'bitrate' || tool.category === 'audio' || (!!tool.preset?.to && FORMATS[tool.preset.to].category === 'audio');
  const bitrateMode = tool.preset?.mode === 'bitrate';
  const outputs = (audioMode ? (tool.pair ? AUDIO_OUTPUTS : (tool.outputs ?? AUDIO_OUTPUTS)) : VIDEO_OUTPUTS.filter((f) => f !== 'gif')) as FormatId[];
  const defaultOut = (tool.preset?.to && outputs.includes(tool.preset.to) ? tool.preset.to : outputs[0]!) as FormatId;
  const [target, setTarget] = useSession<FormatId>(tool.id, 'target', defaultOut);
  const [bitrate, setBitrate] = useSession<number>(tool.id, 'bitrate', bitrateMode ? 128 : 192);
  const [quality, setQuality] = useSession<VideoQuality>(tool.id, 'quality', 'balanced');
  const [fast, setFast] = useSession<boolean>(tool.id, 'fast', true);
  const [channels, setChannels] = useSession<'keep' | '1' | '2'>(tool.id, 'channels', 'keep');
  const [sampleRate, setSampleRate] = useSession<'keep' | '48000' | '44100' | '32000' | '22050' | '16000'>(tool.id, 'sampleRate', 'keep');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={audioMode ? 'converted-audio.zip' : 'converted-videos.zip'} onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return (
      <Dropzone
        onFiles={(p) => void files.add(p)}
        accept={acceptFor(tool)}
        title={tool.category === 'audio' ? t('media.dropAudio') : t('media.dropVideo')}
        buttonLabel={tool.category === 'audio' ? t('media.chooseAudio') : t('media.chooseVideo')}
        formatsHint={formatsHint(tool)}
        icon={tool.icon}
        testId="dropzone"
      />
    );
  }

  const lossless = LOSSLESS.has(target);
  // Opus only encodes at 48/24/16/12/8 kHz.
  const rates = (target === 'opus' || target === 'weba' ? ['keep', '48000', '16000'] : ['keep', '48000', '44100', '32000', '22050', '16000']) as Array<typeof sampleRate>;
  const rate = rates.includes(sampleRate) ? sampleRate : 'keep';
  const run = async () => {
    const out = target;
    const layout = { ...(channels !== 'keep' ? { channels: Number(channels) as 1 | 2 } : {}), ...(rate !== 'keep' ? { sampleRate: Number(rate) } : {}) };
    const id = await startJobs(tool, files.files, {
      pool: 'media',
      operation: (f) => `${f.format ? FORMATS[f.format].label : '?'} → ${FORMATS[out].label}`,
      run: (f) => (ctx) =>
        audioMode
          ? runMediaJob(
              f,
              ctx,
              (info, input) => {
                requireAudio(info);
                // Same-format re-encode is the point of "change bitrate": never stream-copy there.
                return convertAudio({ input, info, target: out as AudioOut, bitrateKbps: bitrate, allowCopy: fast && !bitrateMode, baseName: 'output', ...layout });
              },
              { name: renameWithExtension(f.name, FORMATS[out].extensions[0]!, f.format === out ? `${bitrate}kbps` : ''), format: out },
              'audio',
            )
          : runMediaJob(
              f,
              ctx,
              (info, input) => {
                requireVideo(info);
                return convertVideo({ input, info, target: out as VideoOut, quality, allowCopy: fast, baseName: 'output' });
              },
              { name: renameWithExtension(f.name, FORMATS[out].extensions[0]!, f.format === out ? 'converted' : ''), format: out },
            ),
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          {!audioMode || tool.category === 'video' ? <CpuNotice /> : null}
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('options.convertTo')}</div>
            <Segmented label={t('options.convertTo')} value={target} wrap onChange={setTarget} options={outputs.map((f) => ({ value: f, label: FORMATS[f].label }))} />
          </div>
          {audioMode && !lossless ? (
            <div class="field">
              <div class="field__label">{t('media.bitrate')}</div>
              <Segmented label={t('media.bitrate')} value={bitrate} wrap onChange={setBitrate} options={BITRATES.map((b) => ({ value: b, label: `${b} kbps` }))} />
              <div class="field__hint">{t('media.bitrateHint')}</div>
            </div>
          ) : null}
          {audioMode && lossless ? <div class="field__hint">{t('media.losslessHint')}</div> : null}
          {!audioMode ? (
            <div class="field">
              <div class="field__label">{t('media.quality')}</div>
              <Segmented
                label={t('media.quality')}
                value={quality}
                block
                onChange={setQuality}
                options={[
                  { value: 'high', label: t('media.q.high') },
                  { value: 'balanced', label: t('media.q.balanced') },
                  { value: 'small', label: t('media.q.small') },
                ]}
              />
            </div>
          ) : null}
          {audioMode && !bitrateMode ? (
            <div class="grid-2">
              <Select
                label={t('audio.channels')}
                value={channels}
                onChange={setChannels}
                options={[
                  { value: 'keep', label: t('audio.keep') },
                  { value: '2', label: t('audio.stereo') },
                  { value: '1', label: t('audio.mono') },
                ]}
              />
              <Select label={t('audio.sampleRate')} value={rate} onChange={setSampleRate} options={rates.map((r) => ({ value: r, label: r === 'keep' ? t('audio.keep') : `${Number(r) / 1000} kHz` }))} />
            </div>
          ) : null}
          {!bitrateMode ? <SwitchRow label={t('media.fast')} hint={t('media.fastHint')} checked={fast} onChange={setFast} /> : null}
          <Button variant="primary" size="lg" block icon={audioMode ? 'music' : 'video'} onClick={() => void run()} data-testid="run">
            {tn('media.convertN', files.files.length, { format: FORMATS[target].label })}
          </Button>
        </OptionsCard>
      }
    />
  );
}
