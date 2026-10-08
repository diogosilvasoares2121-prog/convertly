import { makeOutput } from '../../core/jobs';
import { getImageInfo, processImage } from '../../engines/image/client';
import { runFfmpegInputs } from '../../engines/ffmpeg/client';
import { imagesToMotion } from '../../engines/ffmpeg/commands';
import { frameSize, type FrameAspect as Aspect } from '../../engines/image/filters';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { splitName } from '../../utils/filename';
import { Button, ColorField, Segmented, Slider, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from './common';
import { CpuNotice } from '../media/common';

/** Photos → animated GIF or MP4 slideshow (FFmpeg, locally). */
export default function ImagesMotion({ tool }: ToolProps) {
  useI18n();
  const gif = tool.preset?.mode !== 'mp4';
  const files = useToolFiles(tool);
  const [seconds, setSeconds] = useSession<number>(tool.id, 'seconds', gif ? 0.5 : 2);
  const [aspect, setAspect] = useSession<Aspect>(tool.id, 'aspect', 'first');
  const [maxSide, setMaxSide] = useSession<number>(tool.id, 'maxSide', gif ? 480 : 1080);
  const [bg, setBg] = useSession<string>(tool.id, 'bg', '#000000');
  const [loop, setLoop] = useSession<boolean>(tool.id, 'loop', true);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={gif ? 'animation.zip' : 'slideshow.zip'} onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('motion.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon={tool.icon} testId="dropzone" />;
  }

  const sizes = gif ? [320, 480, 640, 800] : [720, 1080, 1440];
  const total = seconds * files.files.length;

  const run = async () => {
    const list = files.files.map((f) => ({ file: f.file, format: f.format!, name: f.name }));
    const opts = { seconds, aspect, maxSide, bg, loop };
    const base = splitName(list[0]!.name).base || 'images';
    const id = await startCombinedJob(tool, files.files, {
      pool: 'media',
      operation: t(`tool.${tool.id}.title` as never),
      label: tn('files.count', list.length),
      run: async (ctx) => {
        ctx.setState('preparing');
        const info = await getImageInfo(list[0]!.file, list[0]!.format, ctx.signal);
        const frame = frameSize(opts.aspect, opts.maxSide, info);
        const inputs: Array<{ name: string; blob: Blob }> = [];
        for (const [i, item] of list.entries()) {
          const r = await processImage(
            item.file,
            item.format,
            { fit: { maxWidth: frame.width, maxHeight: frame.height, allowEnlarge: true }, frame: { ...frame, fit: 'contain', background: opts.bg } },
            { format: 'png', quality: 1 },
            { signal: ctx.signal },
          );
          inputs.push({ name: `img${String(i + 1).padStart(4, '0')}.png`, blob: r.blob });
          ctx.progress(((i + 1) / list.length) * 0.3);
        }
        // Repeat the last frame so it is shown for its full duration.
        inputs.push({ name: `img${String(list.length + 1).padStart(4, '0')}.png`, blob: inputs[inputs.length - 1]!.blob });
        ctx.setState('processing');
        const command = imagesToMotion({ count: list.length, secondsPerImage: opts.seconds, format: gif ? 'gif' : 'mp4', loop: opts.loop, baseName: 'output' });
        const blob = await runFfmpegInputs(inputs, command, { signal: ctx.signal, onProgress: (p) => ctx.progress(p === null ? null : 0.3 + p * 0.7) });
        return [
          makeOutput(`${base}-${gif ? 'animation.gif' : 'slideshow.mp4'}`, new Blob([blob], { type: gif ? 'image/gif' : 'video/mp4' }), {
            [t('meta.dimensions')]: `${frame.width}×${frame.height}`,
            [t('motion.frames')]: list.length,
          }),
        ];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} onMove={files.move} />
          {!gif ? <CpuNotice /> : null}
        </>
      }
      panel={
        <OptionsCard>
          <Slider
            label={t('motion.perImage')}
            value={seconds}
            min={gif ? 0.1 : 0.5}
            max={gif ? 3 : 10}
            step={gif ? 0.1 : 0.5}
            onChange={setSeconds}
            format={(v) => t('motion.seconds', { n: v.toFixed(1) })}
            hint={t('motion.total', { n: total.toFixed(1) })}
          />
          <div class="field">
            <div class="field__label">{t('motion.aspect')}</div>
            <Segmented
              label={t('motion.aspect')}
              value={aspect}
              wrap
              onChange={setAspect}
              options={[
                { value: 'first', label: t('motion.matchFirst') },
                { value: '1:1', label: '1:1' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '4:5', label: '4:5' },
              ]}
            />
          </div>
          <div class="field">
            <div class="field__label">{t('motion.size')}</div>
            <Segmented label={t('motion.size')} value={maxSide} block onChange={setMaxSide} options={sizes.map((s) => ({ value: s, label: `${s}px` }))} />
            <div class="field__hint">{t('motion.sizeHint')}</div>
          </div>
          <ColorField label={t('motion.background')} value={bg} onChange={setBg} />
          {gif ? <SwitchRow label={t('motion.loop')} checked={loop} onChange={setLoop} /> : null}
          {files.files.length < 2 ? <Notice tone="info">{t('motion.needTwo')}</Notice> : null}
          <Button variant="primary" size="lg" block icon={tool.icon} disabled={files.files.length < 2} onClick={() => void run()} data-testid="run">
            {gif ? t('motion.runGif') : t('motion.runVideo')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
