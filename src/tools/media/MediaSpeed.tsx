import { changeSpeed, sameAudioContainer, sameVideoContainer } from '../../engines/ffmpeg/commands';
import { FORMATS } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { formatTimecode } from '../../utils/time';
import { Button, Segmented, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireAudio, requireVideo, runMediaJob, useMediaInfo } from './common';

const SPEEDS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4] as const;

/** Speed up / slow down video (with pitch-preserving audio) or audio alone. */
export default function MediaSpeed({ tool }: ToolProps) {
  useI18n();
  const kind = tool.preset?.mode === 'audio' ? 'audio' : 'video';
  const files = useToolFiles(tool);
  const [speed, setSpeed] = useSession<number>(tool.id, 'speed', 2);
  const [keepAudio, setKeepAudio] = useSession<boolean>(tool.id, 'keepAudio', true);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;
  const { info } = useMediaInfo(first?.file ?? null, first?.name ?? '');

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={kind === 'audio' ? 'audio.zip' : 'videos.zip'} onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return (
      <Dropzone
        onFiles={(p) => void files.add(p)}
        accept={acceptFor(tool)}
        title={kind === 'audio' ? t('media.dropAudio') : t('media.dropVideo')}
        buttonLabel={kind === 'audio' ? t('media.chooseAudio') : t('media.chooseVideo')}
        formatsHint={formatsHint(tool)}
        icon="speed"
        testId="dropzone"
      />
    );
  }

  const run = async () => {
    const opts = { speed, keepAudio };
    const id = await startJobs(tool, files.files, {
      pool: 'media',
      operation: `${t(`tool.${tool.id}.title` as never)} · ${opts.speed}×`,
      run: (f) => (ctx) => {
        const out = kind === 'audio' ? sameAudioContainer(f.format!) : sameVideoContainer(f.format!);
        return runMediaJob(
          f,
          ctx,
          (probed, input) => {
            if (kind === 'audio') requireAudio(probed);
            else requireVideo(probed);
            return changeSpeed({ input, info: probed, format: f.format!, speed: opts.speed, kind, keepAudio: opts.keepAudio, baseName: 'output' });
          },
          { name: renameWithExtension(f.name, FORMATS[out].extensions[0]!, `${opts.speed}x`), format: out },
          kind === 'audio' ? 'audio' : 'convert',
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
          {kind === 'video' ? <CpuNotice /> : null}
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('speed.speed')}</div>
            <Segmented label={t('speed.speed')} value={speed} wrap onChange={setSpeed} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
            <div class="field__hint">{speed < 1 ? t('speed.slower') : t('speed.faster')}</div>
          </div>
          {info?.duration ? (
            <dl class="kv">
              <dt>{t('meta.original')}</dt>
              <dd class="mono">{formatTimecode(info.duration)}</dd>
              <dt>{t('meta.result')}</dt>
              <dd class="mono">{formatTimecode(info.duration / speed)}</dd>
            </dl>
          ) : null}
          {kind === 'video' ? <SwitchRow label={t('speed.keepAudio')} hint={t('speed.keepAudioHint')} checked={keepAudio} onChange={setKeepAudio} /> : <p class="small muted">{t('speed.pitchNote')}</p>}
          <Button variant="primary" size="lg" block icon="speed" onClick={() => void run()} data-testid="run">
            {tn('speed.runN', files.files.length, { speed: `${speed}×` })}
          </Button>
        </OptionsCard>
      }
    />
  );
}
