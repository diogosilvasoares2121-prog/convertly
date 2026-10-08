import { useEffect, useState } from 'preact/hooks';
import { videoToGif } from '../../engines/ffmpeg/commands';
import { displaySize } from '../../engines/ffmpeg/probe';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatTimecode } from '../../utils/time';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, requireVideo, runMediaJob, useMediaInfo } from './common';
import { Timeline } from './Timeline';

const DEFAULT_SPAN = 5;

export default function VideoGif({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const { info, error } = useMediaInfo(file?.file ?? null, file?.name ?? '');
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [fps, setFps] = useSession<number>(tool.id, 'fps', 12);
  const [width, setWidth] = useSession<number>(tool.id, 'width', 480);
  const [loop, setLoop] = useSession<boolean>(tool.id, 'loop', true);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const duration = info?.duration ?? 0;

  useEffect(() => {
    setRange(duration > 0 ? { start: 0, end: Math.min(duration, DEFAULT_SPAN) } : null);
  }, [duration, file]);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="gifs.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('media.dropVideoOne')} buttonLabel={t('media.chooseVideo')} formatsHint={formatsHint(tool)} icon="gif" testId="dropzone" />;
  }

  const span = range ? range.end - range.start : 0;
  const sourceWidth = info ? (displaySize(info)?.width ?? 0) : 0;

  const run = async () => {
    if (!range) return;
    const r = range;
    const opts = { fps, width, loop };
    const id = await startJobs(tool, [file], {
      pool: 'media',
      operation: `GIF · ${opts.fps} fps · ${opts.width || t('video.original')}`,
      run: (f) => (ctx) =>
        runMediaJob(
          f,
          ctx,
          (mi, input) => {
            requireVideo(mi);
            return videoToGif({ input, start: r.start, end: r.end, fps: opts.fps, width: opts.width, loop: opts.loop, baseName: 'output', sourceWidth: displaySize(mi)?.width ?? 0 });
          },
          { name: renameWithExtension(f.name, 'gif'), format: 'gif' },
        ),
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          {error ? <ErrorNotice code={error} /> : null}
          {!info && !error ? <Spinner label={t('progress.reading')} /> : null}
          {range && duration ? (
            <div class="card card--pad stack">
              <div class="row row--between">
                <h3>{t('gif.segment')}</h3>
                <span class="mono small">
                  {formatTimecode(range.start, true)} – {formatTimecode(range.end, true)}
                </span>
              </div>
              <Timeline duration={duration} start={range.start} end={range.end} onChange={(start, end) => setRange({ start, end })} />
              <span class="small muted">{t('trim.keyboardHint')}</span>
            </div>
          ) : null}
          {span > 15 ? <Notice tone="warning">{t('gif.longWarning')}</Notice> : null}
          <CpuNotice />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('gif.fps')}</div>
            <Segmented label={t('gif.fps')} value={fps} block onChange={setFps} options={[8, 12, 15, 20, 25].map((v) => ({ value: v, label: String(v) }))} />
          </div>
          <div class="field">
            <div class="field__label">{t('gif.width')}</div>
            <Segmented
              label={t('gif.width')}
              value={width}
              wrap
              onChange={setWidth}
              options={[
                { value: 320, label: '320 px' },
                { value: 480, label: '480 px' },
                { value: 640, label: '640 px' },
                { value: 0, label: sourceWidth ? `${t('video.original')} (${Math.min(800, sourceWidth)})` : t('video.original') },
              ]}
            />
          </div>
          <SwitchRow label={t('gif.loop')} checked={loop} onChange={setLoop} />
          <dl class="kv">
            <dt>{t('trim.finalDuration')}</dt>
            <dd class="mono">{range ? formatTimecode(span, true) : '—'}</dd>
          </dl>
          <Button variant="primary" size="lg" block icon="gif" disabled={!range || span <= 0 || !!error} onClick={() => void run()} data-testid="run">
            {t('gif.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
