import { makeOutput } from '../../core/jobs';
import { detectFile } from '../../core/detect';
import { assertDecodable, probeMedia, runFfmpegInputs } from '../../engines/ffmpeg/client';
import { addAudioToVideo } from '../../engines/ffmpeg/commands';
import { AUDIO_INPUTS, VIDEO_INPUTS } from '../../registry/matrix';
import { acceptAttribute, FORMATS, type FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatBytes } from '../../utils/bytes';
import { renameWithExtension } from '../../utils/filename';
import { Button, IconButton, Segmented, Slider, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Icon } from '../../ui/components/Icon';
import { toast } from '../../ui/components/Toasts';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireAudio, requireVideo } from './common';

const MUSIC_FORMATS: FormatId[] = [...AUDIO_INPUTS, ...VIDEO_INPUTS];
const ext = (name: string) => (name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';

/** Adds background music to a video, replacing or mixing with the original sound. */
export default function VideoAddAudio({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const video = files.files[0] ?? null;
  const [music, setMusic] = useSession<{ file: File; name: string; format: FormatId } | null>(tool.id, 'music', null);
  const [mode, setMode] = useSession<'replace' | 'mix'>(tool.id, 'mode', 'replace');
  const [volume, setVolume] = useSession<number>(tool.id, 'volume', 100);
  const [loop, setLoop] = useSession<boolean>(tool.id, 'loop', true);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="videos.zip" onReset={() => { setGroupId(null); files.clear(); setMusic(null); }} />;
  }
  if (!video) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('addAudio.dropVideo')} buttonLabel={t('media.chooseVideo')} formatsHint={formatsHint(tool)} icon="music-plus" testId="dropzone" />;
  }

  const pickMusic = async (picked: Array<{ file: File }>) => {
    const f = picked[0]?.file;
    if (!f) return;
    const d = await detectFile(f);
    if (d.empty || !d.format || !MUSIC_FORMATS.includes(d.format)) {
      toast(t('addAudio.badAudio'), 'warning');
      return;
    }
    setMusic({ file: f, name: f.name, format: d.format });
  };

  const run = async () => {
    if (!music) return;
    const opts = { mode, volume: volume / 100, loop };
    const audioFile = music;
    const id = await startCombinedJob(tool, [video, { name: audioFile.name, size: audioFile.file.size }], {
      pool: 'media',
      operation: t('tool.video-add-audio.title'),
      label: video.name,
      run: async (ctx) => {
        ctx.setState('preparing');
        const vInfo = await probeMedia(video.file, video.name, ctx.signal);
        assertDecodable(vInfo);
        requireVideo(vInfo);
        const aInfo = await probeMedia(audioFile.file, audioFile.name, ctx.signal);
        requireAudio(aInfo);
        const vName = `video.${ext(video.name)}`;
        const aName = `music.${ext(audioFile.name)}`;
        ctx.setState('processing');
        const command = addAudioToVideo({
          video: { name: vName, info: vInfo },
          audio: { name: aName, info: aInfo },
          mode: opts.mode,
          musicVolume: opts.volume,
          loop: opts.loop,
          shortest: true,
          baseName: 'output',
        });
        if (opts.mode === 'mix' && !vInfo.audio) ctx.note(t('addAudio.noOriginal'));
        const blob = await runFfmpegInputs(
          [
            { name: vName, blob: video.file },
            { name: aName, blob: audioFile.file },
          ],
          command,
          { signal: ctx.signal, onProgress: ctx.progress },
        );
        return [makeOutput(renameWithExtension(video.name, 'mp4', 'with-audio'), new Blob([blob], { type: 'video/mp4' }))];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <div class="field__label">{t('addAudio.video')}</div>
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          <div class="field__label">{t('addAudio.music')}</div>
          {music ? (
            <div class="file-row card" data-testid="music-file">
              <Icon name="music" />
              <div class="grow truncate">
                <div class="truncate">{music.name}</div>
                <div class="small muted row" style={{ '--gap': '8px' }}>
                  <span>{FORMATS[music.format].label}</span>
                  <span>{formatBytes(music.file.size)}</span>
                  <MediaBadges file={music.file} name={music.name} />
                </div>
              </div>
              <IconButton icon="close" label={t('action.remove')} onClick={() => setMusic(null)} />
            </div>
          ) : (
            <Dropzone
              onFiles={(p) => void pickMusic(p)}
              accept={acceptAttribute(MUSIC_FORMATS)}
              multiple={false}
              compact
              title={t('addAudio.dropMusic')}
              buttonLabel={t('media.chooseAudio')}
              icon="music"
              testId="music-dropzone"
            />
          )}
          <CpuNotice />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('addAudio.mode')}</div>
            <Segmented label={t('addAudio.mode')} value={mode} block onChange={setMode} options={[{ value: 'replace', label: t('addAudio.replace') }, { value: 'mix', label: t('addAudio.mix') }]} />
            <div class="field__hint">{mode === 'replace' ? t('addAudio.replaceHint') : t('addAudio.mixHint')}</div>
          </div>
          <Slider label={t('addAudio.volume')} value={volume} min={5} max={200} step={5} onChange={setVolume} format={(v) => `${v}%`} />
          <SwitchRow label={t('addAudio.loop')} hint={t('addAudio.loopHint')} checked={loop} onChange={setLoop} />
          <Button variant="primary" size="lg" block icon="music-plus" disabled={!music} onClick={() => void run()} data-testid="run">
            {t('addAudio.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
