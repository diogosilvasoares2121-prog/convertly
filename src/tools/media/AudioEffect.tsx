import { audioEffect, sameAudioContainer, type AudioEffect as Effect } from '../../engines/ffmpeg/commands';
import { FORMATS } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented, Slider } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { MediaBadges, requireAudio, runMediaJob } from './common';

type Mode = 'volume' | 'fade' | 'reverse';

/** Volume / normalize, fade in-out and reverse for audio files (batch). */
export default function AudioEffectTool({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as Mode | undefined) ?? 'volume';
  const files = useToolFiles(tool);
  const [volumeMode, setVolumeMode] = useSession<'gain' | 'normalize'>(tool.id, 'volumeMode', 'gain');
  const [db, setDb] = useSession<number>(tool.id, 'db', 6);
  const [fadeIn, setFadeIn] = useSession<number>(tool.id, 'fadeIn', 2);
  const [fadeOut, setFadeOut] = useSession<number>(tool.id, 'fadeOut', 3);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="audio.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('media.dropAudio')} buttonLabel={t('media.chooseAudio')} formatsHint={formatsHint(tool)} icon={tool.icon} testId="dropzone" />;
  }

  const effect: Effect =
    mode === 'reverse' ? { kind: 'reverse' } : mode === 'fade' ? { kind: 'fade', fadeIn, fadeOut } : volumeMode === 'normalize' ? { kind: 'normalize' } : { kind: 'volume', db };
  const suffix = mode === 'reverse' ? 'reversed' : mode === 'fade' ? 'faded' : volumeMode === 'normalize' ? 'normalized' : `${db > 0 ? '+' : ''}${db}dB`;
  const nothing = (mode === 'fade' && fadeIn === 0 && fadeOut === 0) || (mode === 'volume' && volumeMode === 'gain' && db === 0);

  const run = async () => {
    const fx = effect;
    const id = await startJobs(tool, files.files, {
      pool: 'media',
      operation: t(`tool.${tool.id}.title` as never),
      run: (f) => (ctx) => {
        const out = sameAudioContainer(f.format!);
        return runMediaJob(
          f,
          ctx,
          (info, input) => {
            requireAudio(info);
            return audioEffect({ input, info, format: f.format!, effect: fx, baseName: 'output' });
          },
          { name: renameWithExtension(f.name, FORMATS[out].extensions[0]!, suffix), format: out },
          'audio',
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
        </>
      }
      panel={
        <OptionsCard>
          {mode === 'volume' ? (
            <>
              <div class="field">
                <div class="field__label">{t('volume.mode')}</div>
                <Segmented label={t('volume.mode')} value={volumeMode} block onChange={setVolumeMode} options={[{ value: 'gain', label: t('volume.gain') }, { value: 'normalize', label: t('volume.normalize') }]} />
                <div class="field__hint">{volumeMode === 'normalize' ? t('volume.normalizeHint') : t('volume.gainHint')}</div>
              </div>
              {volumeMode === 'gain' ? <Slider label={t('volume.amount')} value={db} min={-20} max={20} onChange={setDb} format={(v) => `${v > 0 ? '+' : ''}${v} dB`} /> : null}
            </>
          ) : null}
          {mode === 'fade' ? (
            <>
              <Slider label={t('fade.in')} value={fadeIn} min={0} max={15} step={0.5} onChange={setFadeIn} format={(v) => (v ? `${v} s` : t('adjust.off'))} />
              <Slider label={t('fade.out')} value={fadeOut} min={0} max={15} step={0.5} onChange={setFadeOut} format={(v) => (v ? `${v} s` : t('adjust.off'))} />
            </>
          ) : null}
          {mode === 'reverse' ? <p class="small muted">{t('reverse.help')}</p> : null}
          <Button variant="primary" size="lg" block icon={tool.icon} disabled={nothing} onClick={() => void run()} data-testid="run">
            {tn(`effect.run.${mode}` as never, files.files.length)}
          </Button>
        </OptionsCard>
      }
    />
  );
}
