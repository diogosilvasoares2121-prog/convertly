import { makeOutput } from '../../core/jobs';
import { useStore } from '../../core/store';
import { settingsStore } from '../../storage/settings';
import { processImage } from '../../engines/image/client';
import { assertDecodable, probeMedia, runFfmpegCollect, safeInputName } from '../../engines/ffmpeg/client';
import { videoFrames } from '../../engines/ffmpeg/commands';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { splitName } from '../../utils/filename';
import { Button, NumberInput, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireVideo, useMediaInfo } from './common';

type Every = '1' | '2' | '5' | '10' | 'custom';
const MAX_FRAMES = 500;

/** Saves still frames from a video as JPG/PNG images (every N seconds). */
export default function VideoFrames({ tool }: ToolProps) {
  useI18n();
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const { info } = useMediaInfo(file?.file ?? null, file?.name ?? '');
  const [every, setEvery] = useSession<Every>(tool.id, 'every', '1');
  const [custom, setCustom] = useSession<number | ''>(tool.id, 'custom', 0.5);
  const [format, setFormat] = useSession<'jpg' | 'png'>(tool.id, 'format', 'jpg');
  const [width, setWidth] = useSession<'original' | '1280' | '640'>(tool.id, 'width', 'original');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={`${splitName(file?.name ?? 'video').base}-frames.zip`} onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('media.dropVideo')} buttonLabel={t('media.chooseVideo')} formatsHint={formatsHint(tool)} icon="frames" testId="dropzone" />;
  }

  const seconds = every === 'custom' ? (typeof custom === 'number' ? custom : 0) : Number(every);
  const invalid = !(seconds >= 0.04 && seconds <= 3600);
  const estimate = info?.duration && !invalid ? Math.min(MAX_FRAMES, Math.max(1, Math.floor(info.duration / seconds))) : null;

  const run = async () => {
    const opts = { seconds, format, maxWidth: width === 'original' ? null : Number(width) };
    const base = splitName(file.name).base || 'video';
    const id = await startCombinedJob(tool, [file], {
      pool: 'media',
      operation: t('tool.video-to-frames.title'),
      label: file.name,
      run: async (ctx) => {
        ctx.setState('preparing');
        const probed = await probeMedia(file.file, file.name, ctx.signal);
        assertDecodable(probed);
        requireVideo(probed);
        const input = safeInputName(file.name);
        ctx.setState('processing');
        // FFmpeg always writes lossless PNG frames (its MJPEG encoder is unreliable in this
        // WebAssembly build); JPG frames are then encoded by the browser's own encoder.
        const command = videoFrames({ input, info: probed, everySeconds: opts.seconds, format: 'png', maxWidth: opts.maxWidth, maxFrames: MAX_FRAMES });
        const jpg = opts.format === 'jpg';
        const frames = await runFfmpegCollect(file.file, input, command, { signal: ctx.signal, onProgress: (p) => ctx.progress(p === null ? null : jpg ? p * 0.7 : p) });
        if (frames.length >= MAX_FRAMES) ctx.note(t('frames.capped', { n: MAX_FRAMES }));
        const outputs = [];
        for (const [i, f] of frames.entries()) {
          let blob = new Blob([f.blob], { type: 'image/png' });
          if (jpg) {
            blob = (await processImage(blob, 'png', {}, { format: 'jpg', quality: settings.imageQuality / 100 }, { signal: ctx.signal })).blob;
            ctx.progress(0.7 + ((i + 1) / frames.length) * 0.3);
          }
          outputs.push(makeOutput(`${base}-${String(i + 1).padStart(4, '0')}.${opts.format}`, blob, { [t('frames.time')]: `${(opts.seconds * i).toFixed(2)} s` }));
        }
        return outputs;
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          <CpuNotice />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('frames.every')}</div>
            <Segmented
              label={t('frames.every')}
              value={every}
              wrap
              onChange={setEvery}
              options={[
                { value: '1', label: '1 s' },
                { value: '2', label: '2 s' },
                { value: '5', label: '5 s' },
                { value: '10', label: '10 s' },
                { value: 'custom', label: t('compress.custom') },
              ]}
            />
          </div>
          {every === 'custom' ? <NumberInput label={t('frames.seconds')} value={custom} onChange={setCustom} min={0.04} max={3600} step={0.1} suffix="s" /> : null}
          <div class="field">
            <div class="field__label">{t('options.convertTo')}</div>
            <Segmented label={t('options.convertTo')} value={format} block onChange={setFormat} options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
          </div>
          <div class="field">
            <div class="field__label">{t('frames.width')}</div>
            <Segmented
              label={t('frames.width')}
              value={width}
              block
              onChange={setWidth}
              options={[
                { value: 'original', label: t('frames.original') },
                { value: '1280', label: '1280px' },
                { value: '640', label: '640px' },
              ]}
            />
          </div>
          {invalid ? <div class="field__error">{t('frames.invalid')}</div> : null}
          {estimate ? <p class="small muted">{t('frames.estimate', { n: estimate })}</p> : null}
          <Button variant="primary" size="lg" block icon="frames" disabled={invalid} onClick={() => void run()} data-testid="run">
            {t('frames.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
