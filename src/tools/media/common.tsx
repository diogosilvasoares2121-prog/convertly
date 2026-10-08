import { useEffect, useState } from 'preact/hooks';
import { AppError, toAppError, type ErrorCode } from '../../core/errors';
import { makeOutput, type JobContext, type OutputFile } from '../../core/jobs';
import { assertDecodable, probeMedia, runFfmpeg, safeInputName } from '../../engines/ffmpeg/client';
import type { FfmpegCommand } from '../../engines/ffmpeg/commands';
import { displaySize, type MediaInfo } from '../../engines/ffmpeg/probe';
import { FORMATS, type FormatId } from '../../registry/formats';
import { t, useI18n } from '../../i18n';
import { formatTimecode } from '../../utils/time';
import { Badge, Notice } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';

/** ffprobe information for a file (cached per File). */
export function useMediaInfo(file: Blob | null, name: string): { info: MediaInfo | null; error: ErrorCode | null } {
  const [state, setState] = useState<{ info: MediaInfo | null; error: ErrorCode | null }>({ info: null, error: null });
  useEffect(() => {
    let alive = true;
    setState({ info: null, error: null });
    if (!file) return;
    probeMedia(file, name)
      .then((info) => {
        if (!alive) return;
        try {
          assertDecodable(info);
          setState({ info, error: null });
        } catch (err) {
          setState({ info, error: toAppError(err).code });
        }
      })
      .catch((err: unknown) => alive && setState({ info: null, error: toAppError(err).code }));
    return () => {
      alive = false;
    };
  }, [file, name]);
  return state;
}

export function MediaBadges({ file, name }: { file: Blob; name: string }) {
  useI18n();
  const { info, error } = useMediaInfo(file, name);
  if (error) return <Badge tone="danger">{t(`error.${error}.title` as never)}</Badge>;
  if (!info) return <span class="muted">{t('progress.reading')}</span>;
  const size = displaySize(info);
  return (
    <>
      {info.duration ? <span class="mono">{formatTimecode(info.duration)}</span> : null}
      {size ? <span>{size.width}×{size.height}</span> : null}
      {info.video ? <Badge format>{info.video.codec.toUpperCase()}</Badge> : null}
      {info.audio ? <Badge format>{info.audio.codec.toUpperCase()}</Badge> : <Badge tone="warning">{t('media.noAudio')}</Badge>}
    </>
  );
}

export function CpuNotice() {
  useI18n();
  return (
    <Notice tone="neutral" icon="cpu">
      {t('video.cpuNotice')}
    </Notice>
  );
}

export function typedBlob(blob: Blob, format: FormatId): Blob {
  return new Blob([blob], { type: FORMATS[format].mimes[0] });
}

/**
 * Probes the input, validates it, runs FFmpeg and wraps the output.
 * `build` receives the probe result and returns the command (or throws a clear error).
 */
export async function runMediaJob(
  file: { file: Blob; name: string },
  ctx: JobContext,
  build: (info: MediaInfo, input: string) => FfmpegCommand,
  output: { name: string; format: FormatId },
  kind: 'convert' | 'audio' = 'convert',
): Promise<OutputFile[]> {
  ctx.setState('preparing');
  const info = await probeMedia(file.file, file.name, ctx.signal);
  assertDecodable(info);
  const input = safeInputName(file.name);
  const command = build(info, input);
  ctx.setState('processing');
  const blob = await runFfmpeg(file.file, input, command, { signal: ctx.signal, onProgress: ctx.progress, kind });
  ctx.setState('finalizing');
  if (command.streamCopy) ctx.note(t('note.streamCopy'));
  return [makeOutput(output.name, typedBlob(blob, output.format))];
}

export function requireAudio(info: MediaInfo): void {
  if (!info.audio) throw new AppError('no-audio-track');
}

export function requireVideo(info: MediaInfo): void {
  if (!info.video) throw new AppError('no-video-track');
}

export function PreviewUnavailable() {
  useI18n();
  return (
    <div class="notice">
      <Icon name="eye" />
      <div>{t('media.previewUnavailable')}</div>
    </div>
  );
}
