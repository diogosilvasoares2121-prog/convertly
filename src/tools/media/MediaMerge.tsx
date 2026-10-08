import { makeOutput } from '../../core/jobs';
import { assertDecodable, probeMedia, runFfmpegInputs } from '../../engines/ffmpeg/client';
import { mergeAudio, mergeVideos, type AudioOut, type MergeInput } from '../../engines/ffmpeg/commands';
import { FORMATS, type FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { splitName } from '../../utils/filename';
import { Button, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireAudio, requireVideo } from './common';

const AUDIO_TARGETS: AudioOut[] = ['mp3', 'm4a', 'wav', 'ogg', 'flac'];
const BITRATES = [128, 192, 256, 320] as const;

/** Joins several videos (or audio files) one after another into a single file. */
export default function MediaMerge({ tool }: ToolProps) {
  useI18n();
  const audio = tool.preset?.mode === 'audio';
  const files = useToolFiles(tool);
  const [maxHeight, setMaxHeight] = useSession<number>(tool.id, 'maxHeight', 720);
  const [target, setTarget] = useSession<AudioOut>(tool.id, 'target', 'mp3');
  const [bitrate, setBitrate] = useSession<number>(tool.id, 'bitrate', 192);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="merged.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return (
      <Dropzone
        onFiles={(p) => void files.add(p)}
        accept={acceptFor(tool)}
        title={audio ? t('merge.dropAudio') : t('merge.dropVideo')}
        buttonLabel={audio ? t('media.chooseAudio') : t('media.chooseVideo')}
        formatsHint={formatsHint(tool)}
        icon="join"
        testId="dropzone"
      />
    );
  }

  const run = async () => {
    const list = files.files.map((f) => ({ file: f.file, name: f.name }));
    const opts = { maxHeight, target, bitrate };
    const out: FormatId = audio ? opts.target : 'mp4';
    const name = `${splitName(list[0]!.name).base || 'media'}-merged.${FORMATS[out].extensions[0]}`;
    const id = await startCombinedJob(tool, files.files, {
      pool: 'media',
      operation: t(`tool.${tool.id}.title` as never),
      label: tn('files.count', list.length),
      run: async (ctx) => {
        ctx.setState('preparing');
        const inputs: Array<MergeInput & { blob: Blob }> = [];
        for (const [k, item] of list.entries()) {
          const info = await probeMedia(item.file, item.name, ctx.signal);
          assertDecodable(info);
          if (audio) requireAudio(info);
          else requireVideo(info);
          const ext = (item.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
          inputs.push({ name: `input${k}.${ext}`, info, blob: item.file });
        }
        ctx.setState('processing');
        const command = audio ? mergeAudio(inputs, { target: opts.target, bitrateKbps: opts.bitrate, baseName: 'output' }) : mergeVideos(inputs, { maxHeight: opts.maxHeight, baseName: 'output' });
        const blob = await runFfmpegInputs(
          inputs.map((i) => ({ name: i.name, blob: i.blob })),
          command,
          { signal: ctx.signal, onProgress: ctx.progress, kind: audio ? 'audio' : 'convert' },
        );
        return [makeOutput(name, new Blob([blob], { type: FORMATS[out].mimes[0] }), { [t('merge.parts')]: inputs.length })];
      },
    });
    if (id) setGroupId(id);
  };

  const lossless = target === 'wav' || target === 'flac';
  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} onMove={files.move} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          {!audio ? <CpuNotice /> : null}
        </>
      }
      panel={
        <OptionsCard>
          <p class="small muted">{audio ? t('merge.audioHelp') : t('merge.videoHelp')}</p>
          {audio ? (
            <>
              <div class="field">
                <div class="field__label">{t('options.convertTo')}</div>
                <Segmented label={t('options.convertTo')} value={target} wrap onChange={setTarget} options={AUDIO_TARGETS.map((f) => ({ value: f, label: FORMATS[f].label }))} />
              </div>
              {!lossless ? (
                <div class="field">
                  <div class="field__label">{t('media.bitrate')}</div>
                  <Segmented label={t('media.bitrate')} value={bitrate} wrap onChange={setBitrate} options={BITRATES.map((b) => ({ value: b, label: `${b} kbps` }))} />
                </div>
              ) : null}
            </>
          ) : (
            <div class="field">
              <div class="field__label">{t('video.resolution')}</div>
              <Segmented
                label={t('video.resolution')}
                value={maxHeight}
                block
                onChange={setMaxHeight}
                options={[
                  { value: 1080, label: '1080p' },
                  { value: 720, label: '720p' },
                  { value: 480, label: '480p' },
                ]}
              />
              <div class="field__hint">{t('merge.resolutionHint')}</div>
            </div>
          )}
          {files.files.length < 2 ? <Notice tone="info">{t('merge.needTwo')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="join" disabled={files.files.length < 2} onClick={() => void run()} data-testid="run">
            {tn('merge.runN', files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
