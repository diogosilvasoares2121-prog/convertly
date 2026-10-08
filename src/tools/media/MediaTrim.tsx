import { useEffect, useRef, useState } from 'preact/hooks';
import { trimMedia } from '../../engines/ffmpeg/commands';
import { sameAudioContainer, sameVideoContainer } from '../../engines/ffmpeg/commands';
import { FORMATS, type FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatTimecode, parseTimecode } from '../../utils/time';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { useObjectUrl } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';
import { CpuNotice, MediaBadges, PreviewUnavailable, requireAudio, runMediaJob, useMediaInfo } from './common';
import { Timeline, useWaveform } from './Timeline';

function outputFormatFor(kind: 'video' | 'audio', format: FormatId, precise: boolean): FormatId {
  if (kind === 'audio') return sameAudioContainer(format);
  if (!precise && (format === 'avi' || format === 'mpeg' || format === '3gp' || format === 'wmv')) return format;
  return sameVideoContainer(format);
}

export default function MediaTrim({ tool }: ToolProps) {
  useI18n();
  const kind: 'video' | 'audio' = tool.preset?.mode === 'audio' ? 'audio' : 'video';
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const { info, error } = useMediaInfo(file?.file ?? null, file?.name ?? '');
  const url = useObjectUrl(file?.file ?? null);
  const { peaks, status } = useWaveform(file?.file ?? null, kind === 'audio');
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useSession<'fast' | 'precise'>(tool.id, 'mode', kind === 'audio' ? 'precise' : 'fast');
  const [canPreview, setCanPreview] = useState(true);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);

  const duration = info?.duration ?? 0;
  useEffect(() => {
    if (duration > 0) {
      setRange({ start: 0, end: duration });
      setStartText(formatTimecode(0, true));
      setEndText(formatTimecode(duration, true));
    } else setRange(null);
    setCanPreview(true);
  }, [duration, file]);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="trimmed.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return (
      <Dropzone
        onFiles={(p) => void files.add(p)}
        accept={acceptFor(tool)}
        multiple={false}
        title={kind === 'audio' ? t('media.dropAudioOne') : t('media.dropVideoOne')}
        buttonLabel={kind === 'audio' ? t('media.chooseAudio') : t('media.chooseVideo')}
        formatsHint={formatsHint(tool)}
        icon="trim"
        testId="dropzone"
      />
    );
  }

  const update = (start: number, end: number) => {
    setRange({ start, end });
    setStartText(formatTimecode(start, true));
    setEndText(formatTimecode(end, true));
  };
  const startValue = parseTimecode(startText);
  const endValue = parseTimecode(endText);
  const textError = startValue === null || endValue === null ? t('trim.invalidTime') : endValue <= startValue ? t('trim.endAfterStart') : duration && endValue > duration + 0.05 ? t('trim.beyondEnd', { duration: formatTimecode(duration) }) : null;

  const preview = () => {
    const el = media.current;
    if (!el || !range) return;
    el.currentTime = range.start;
    stopAt.current = range.end;
    void el.play();
  };

  const run = async () => {
    if (!range || !file.format) return;
    const { start, end } = range;
    const precise = mode === 'precise';
    const out = outputFormatFor(kind, file.format, precise);
    const id = await startJobs(tool, [file], {
      pool: 'media',
      operation: `${t('trim.trim')} ${formatTimecode(start)} – ${formatTimecode(end)}`,
      run: (f) => (ctx) =>
        runMediaJob(
          f,
          ctx,
          (mi, input) => {
            if (kind === 'audio') requireAudio(mi);
            return trimMedia({ input, info: mi, format: f.format!, start, end, precise, baseName: 'output', kind });
          },
          { name: renameWithExtension(f.name, FORMATS[out].extensions[0]!, 'trimmed'), format: out },
          kind === 'audio' ? 'audio' : 'convert',
        ),
    });
    if (id) setGroupId(id);
  };

  const Player = kind === 'audio' ? 'audio' : 'video';
  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <MediaBadges file={f.file} name={f.name} />} />
          {error ? <ErrorNotice code={error} /> : null}
          {!info && !error ? <Spinner label={t('progress.reading')} /> : null}
          {url && canPreview ? (
            <Player
              ref={media}
              src={url}
              controls
              preload="metadata"
              class={kind === 'video' ? 'media-preview' : ''}
              style={kind === 'audio' ? { width: '100%' } : undefined}
              onError={() => setCanPreview(false)}
              onTimeUpdate={(e) => {
                const el = e.currentTarget as HTMLMediaElement;
                setCurrent(el.currentTime);
                if (stopAt.current !== null && el.currentTime >= stopAt.current) {
                  el.pause();
                  stopAt.current = null;
                }
              }}
            />
          ) : null}
          {!canPreview ? <PreviewUnavailable /> : null}
          {range && duration > 0 ? (
            <div class="card card--pad stack">
              <Timeline
                duration={duration}
                start={range.start}
                end={range.end}
                current={canPreview ? current : undefined}
                peaks={peaks}
                status={kind === 'audio' && status === 'loading' ? t('trim.waveformLoading') : undefined}
                onChange={update}
                onSeek={(time) => {
                  if (media.current) media.current.currentTime = time;
                }}
              />
              <div class="row" style={{ alignItems: 'flex-end' }}>
                <div class="grow">
                  <TextInput label={t('trim.start')} value={startText} onChange={(v) => { setStartText(v); const s = parseTimecode(v); if (s !== null && range && s < range.end) setRange({ ...range, start: s }); }} mono />
                </div>
                <div class="grow">
                  <TextInput label={t('trim.end')} value={endText} onChange={(v) => { setEndText(v); const e = parseTimecode(v); if (e !== null && range && e > range.start && e <= duration + 0.05) setRange({ ...range, end: Math.min(duration, e) }); }} mono />
                </div>
              </div>
              <div class="row row--between">
                <div class="row" style={{ '--gap': '8px' }}>
                  {canPreview ? (
                    <>
                      <Button size="sm" icon="play" onClick={preview}>
                        {t('trim.previewSelection')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => update(Math.min(current, range.end - 0.1), range.end)}>
                        {t('trim.setStart')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => update(range.start, Math.max(current, range.start + 0.1))}>
                        {t('trim.setEnd')}
                      </Button>
                    </>
                  ) : null}
                </div>
                <span class="small muted">{t('trim.keyboardHint')}</span>
              </div>
              {textError ? <div class="field__error">{textError}</div> : null}
            </div>
          ) : null}
          {kind === 'video' ? <CpuNotice /> : null}
        </>
      }
      panel={
        <OptionsCard>
          <dl class="kv">
            <dt>{t('trim.originalDuration')}</dt>
            <dd class="mono">{duration ? formatTimecode(duration, true) : '—'}</dd>
            <dt>{t('trim.finalDuration')}</dt>
            <dd class="mono" data-testid="final-duration">
              {range ? formatTimecode(range.end - range.start, true) : '—'}
            </dd>
          </dl>
          <div class="field">
            <div class="field__label">{t('trim.mode')}</div>
            <Segmented label={t('trim.mode')} value={mode} block onChange={setMode} options={[{ value: 'fast', label: t('trim.fast') }, { value: 'precise', label: t('trim.precise') }]} />
            <div class="field__hint">{mode === 'fast' ? t('trim.fastHint') : t('trim.preciseHint')}</div>
          </div>
          <Button variant="primary" size="lg" block icon="trim" disabled={!range || !!textError || !!error} onClick={() => void run()} data-testid="run">
            {t('trim.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
