import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import {
  cancelGroup,
  cancelJob,
  isActive,
  isFinished,
  jobsStore,
  removeGroup,
  removeJob,
  retryJob,
  type Job,
  type OutputFile,
} from '../../core/jobs';
import { downloadBlob } from '../../core/download';
import { createZip } from '../../engines/zip/client';
import { analyzeFiles } from '../../app/handoff';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { formatBytes, savedPercent } from '../../utils/bytes';
import { formatDuration } from '../../utils/time';
import { Button, IconButton } from '../../ui/components/controls';
import { Badge, ErrorNotice, Progress } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';
import { toast } from '../../ui/components/Toasts';
import { toAppError } from '../../core/errors';

/** Ticks once per second while `active` (elapsed-time display). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const STATE_TONE: Record<Job['state'], 'brand' | 'success' | 'warning' | 'danger' | 'processing' | undefined> = {
  queued: undefined,
  preparing: 'processing',
  processing: 'processing',
  finalizing: 'processing',
  completed: 'success',
  cancelled: 'warning',
  failed: 'danger',
};

export function elapsed(job: Job, now: number): number | null {
  if (!job.startedAt) return null;
  return (job.endedAt ?? now) - job.startedAt;
}

export function JobRow({ job, compact }: { job: Job; compact?: boolean }) {
  useI18n();
  const active = isActive(job);
  const now = useNow(active);
  const time = elapsed(job, now);
  return (
    <div class="job-row" data-testid="job-row" data-state={job.state}>
      <div class="stack" style={{ '--gap': '4px', minWidth: 0 }}>
        <div class="job-row__title">
          {active ? <span class="spinner" aria-hidden="true" style={{ width: '14px', height: '14px', color: 'var(--processing)' }} /> : null}
          <span class="truncate" title={job.inputName}>
            {job.inputName}
          </span>
        </div>
        <div class="job-row__meta">
          <span>{job.operation}</span>
          <Badge {...(STATE_TONE[job.state] ? { tone: STATE_TONE[job.state]! } : {})}>{t(`job.state.${job.state}` as MessageKey)}</Badge>
          {active && job.progress !== null ? <span class="mono">{Math.round(job.progress * 100)}%</span> : null}
          {time !== null ? (
            <span class="row" style={{ '--gap': '4px' }}>
              <Icon name="clock" size={12} />
              {formatDuration(time)}
            </span>
          ) : null}
          {job.state === 'completed' && job.outputs.length ? <span>{formatBytes(job.outputs.reduce((n, o) => n + o.size, 0))}</span> : null}
        </div>
      </div>
      <div class="job-row__actions">
        {job.state === 'completed' && job.outputs.length === 1 ? (
          <IconButton icon="download" label={t('action.download')} onClick={() => void downloadBlob(job.outputs[0]!.blob, job.outputs[0]!.name)} />
        ) : null}
        {!isFinished(job) ? <IconButton icon="close" label={t('action.cancel')} onClick={() => cancelJob(job.id)} /> : null}
        {job.state === 'failed' || job.state === 'cancelled' ? <IconButton icon="retry" label={t('action.retry')} onClick={() => retryJob(job.id)} /> : null}
        {isFinished(job) && !compact ? <IconButton icon="trash" label={t('action.remove')} onClick={() => removeJob(job.id)} /> : null}
      </div>
      {active ? (
        <div class="job-row__progress">
          <Progress value={job.progress} label={t('progress.label', { name: job.inputName })} />
        </div>
      ) : null}
      {job.state === 'failed' && job.error ? (
        <div class="job-row__error">
          <ErrorNotice code={job.error.code} detail={job.error.detail} compact />
        </div>
      ) : null}
    </div>
  );
}

async function downloadAllAsZip(outputs: OutputFile[], zipName: string): Promise<void> {
  try {
    const blob = await createZip(
      outputs.map((o) => ({ path: o.name, blob: o.blob })),
      'normal',
    );
    await downloadBlob(blob, zipName);
  } catch (err) {
    toast(t(`error.${toAppError(err).code}.title` as MessageKey), 'error');
  }
}

export function OutputList({ outputs }: { outputs: OutputFile[] }) {
  useI18n();
  return (
    <ul class="file-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {outputs.map((o) => (
        <li key={o.id} class="file-row">
          <div class="file-row__thumb">
            <Icon name="file" />
          </div>
          <div class="grow">
            <div class="file-row__name truncate" title={o.name}>
              {o.name}
            </div>
            <div class="file-row__meta">
              <span>{formatBytes(o.size)}</span>
              {o.meta
                ? Object.entries(o.meta).map(([k, v]) => (
                    <span key={k}>
                      {k}: {v}
                    </span>
                  ))
                : null}
            </div>
          </div>
          <IconButton icon="download" label={t('action.downloadName', { name: o.name })} onClick={() => void downloadBlob(o.blob, o.name)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Shows a group of jobs: live progress while running, then the result card
 * (single job) or the batch summary (many jobs).
 */
export function JobGroupView({
  groupId,
  zipName,
  onReset,
  resetLabel,
  extra,
  showOriginal = true,
  onDownloadAll,
  downloadAllLabel,
}: {
  groupId: string;
  zipName: string;
  onReset: () => void;
  resetLabel?: string;
  extra?: (jobs: Job[]) => ComponentChildren;
  showOriginal?: boolean;
  /** Replaces the default "download as ZIP" action for multi-file results. */
  onDownloadAll?: (outputs: OutputFile[]) => Promise<void>;
  downloadAllLabel?: (count: number) => string;
}) {
  useI18n();
  const jobs = useStore(jobsStore, (all) => all.filter((j) => j.groupId === groupId));
  const running = jobs.some((j) => !isFinished(j));
  const now = useNow(running);
  const [zipping, setZipping] = useState(false);
  const outputs = useMemo(() => jobs.flatMap((j) => j.outputs), [jobs]);

  if (!jobs.length) return null;

  const reset = () => {
    removeGroup(groupId);
    onReset();
  };

  if (running) {
    const done = jobs.filter(isFinished).length;
    const knownProgress = jobs.every((j) => isFinished(j) || j.progress !== null);
    const overall = jobs.length === 1 ? jobs[0]!.progress : knownProgress ? jobs.reduce((n, j) => n + (isFinished(j) ? 1 : (j.progress ?? 0)), 0) / jobs.length : null;
    const started = Math.min(...jobs.map((j) => j.startedAt ?? now));
    return (
      <div class="card card--pad stack" data-testid="job-group" data-status="running">
        <div class="row row--between">
          <div class="row" style={{ '--gap': '10px' }}>
            <span class="spinner" style={{ color: 'var(--processing)' }} aria-hidden="true" />
            <h2>{jobs.length > 1 ? t('result.processingMany', { done, total: jobs.length }) : t('progress.processing')}</h2>
          </div>
          <Button variant="ghost" icon="close" onClick={() => cancelGroup(groupId)}>
            {jobs.length > 1 ? t('action.cancelAll') : t('action.cancel')}
          </Button>
        </div>
        <Progress value={overall} label={t('progress.overall')} />
        <div class="small muted">{t('result.elapsed', { time: formatDuration(now - started) })}</div>
        {jobs.length > 1 || jobs[0]!.state === 'queued' ? (
          <div class="job-list">
            {jobs.slice(0, 200).map((j) => (
              <JobRow key={j.id} job={j} compact />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const succeeded = jobs.filter((j) => j.state === 'completed');
  const failed = jobs.filter((j) => j.state === 'failed');
  const cancelled = jobs.filter((j) => j.state === 'cancelled');

  // ───── Single job ─────
  if (jobs.length === 1) {
    const job = jobs[0]!;
    if (job.state !== 'completed') {
      return (
        <div class="result-card result-card--failed stack" data-testid="job-group" data-status={job.state}>
          <div class="result-card__status">
            <span class="status-icon status-icon--failed">
              <Icon name={job.state === 'cancelled' ? 'close' : 'error'} />
            </span>
            {job.state === 'cancelled' ? t('result.cancelled') : t('result.failed')}
          </div>
          {job.error ? <ErrorNotice code={job.error.code} detail={job.error.detail} /> : null}
          <div class="result-actions">
            <Button variant="primary" icon="retry" onClick={() => retryJob(job.id)}>
              {t('action.retry')}
            </Button>
            <Button onClick={reset}>{resetLabel ?? t('action.startOver')}</Button>
          </div>
        </div>
      );
    }
    if (!job.outputs.length) {
      // Completed without producing a file (e.g. a PDF that cannot be made smaller).
      return (
        <div class="card card--pad stack" data-testid="job-group" data-status="no-output">
          <div class="result-card__status">
            <span class="status-icon" style={{ background: 'var(--processing)' }}>
              <Icon name="info" />
            </span>
            {t('result.noOutput')}
          </div>
          {job.notes.map((n) => (
            <p key={n} class="muted">
              {n}
            </p>
          ))}
          <div class="result-actions">
            <Button icon="repeat" onClick={reset}>
              {resetLabel ?? t('action.startOver')}
            </Button>
          </div>
        </div>
      );
    }
    const size = job.outputs.reduce((n, o) => n + o.size, 0);
    const time = elapsed(job, now);
    const saved = savedPercent(job.inputSize, size);
    const single = job.outputs.length === 1 ? job.outputs[0]! : null;
    return (
      <div class="result-card" data-testid="job-group" data-status="completed">
        <div class="result-card__status">
          <span class="status-icon">
            <Icon name="check" />
          </span>
          {t('result.completed')}
        </div>
        {showOriginal ? (
          <div class="result-flow">
            <span class="truncate">{job.inputName}</span>
            <Icon name="arrow-right" />
            <span class="truncate">{single ? single.name : tn('result.outputs', job.outputs.length)}</span>
          </div>
        ) : null}
        <div class="stats">
          <div class="stat">
            <div class="stat__label">{t('result.original')}</div>
            <div class="stat__value">{formatBytes(job.inputSize)}</div>
          </div>
          <div class="stat">
            <div class="stat__label">{t('result.result')}</div>
            <div class="stat__value">{formatBytes(size)}</div>
          </div>
          {saved > 0 ? (
            <div class="stat">
              <div class="stat__label">{t('result.saved')}</div>
              <div class="stat__value stat__value--good">{saved}%</div>
            </div>
          ) : null}
          {time !== null ? (
            <div class="stat">
              <div class="stat__label">{t('result.time')}</div>
              <div class="stat__value">{formatDuration(time)}</div>
            </div>
          ) : null}
        </div>
        {job.notes.length ? (
          <div class="stack" style={{ '--gap': '6px', marginTop: '14px' }}>
            {job.notes.map((n) => (
              <div key={n} class="notice notice--info">
                <Icon name="info" />
                <div>{n}</div>
              </div>
            ))}
          </div>
        ) : null}
        {extra ? <div style={{ marginTop: '16px' }}>{extra(jobs)}</div> : null}
        {!single && job.outputs.length > 1 ? (
          <div style={{ marginTop: '16px' }}>
            <OutputList outputs={job.outputs} />
          </div>
        ) : null}
        <div class="result-actions">
          {single ? (
            <Button variant="primary" size="lg" icon="download" onClick={() => void downloadBlob(single.blob, single.name)} data-testid="download">
              {t('action.download')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon="download"
              loading={zipping}
              data-testid="download-zip"
              onClick={async () => {
                setZipping(true);
                await (onDownloadAll ? onDownloadAll(job.outputs) : downloadAllAsZip(job.outputs, zipName));
                setZipping(false);
              }}
            >
              {downloadAllLabel ? downloadAllLabel(job.outputs.length) : tn('result.downloadZip', job.outputs.length)}
            </Button>
          )}
          <Button icon="repeat" onClick={reset}>
            {resetLabel ?? t('action.convertAnother')}
          </Button>
          {single ? (
            <Button
              variant="ghost"
              icon="external"
              onClick={() => analyzeFiles([{ file: new File([single.blob], single.name, { type: single.mime }), path: single.name }], 'result')}
            >
              {t('action.openInTool')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // ───── Batch ─────
  return (
    <div class={`result-card stack${succeeded.length ? '' : ' result-card--failed'}`} data-testid="job-group" data-status="completed">
      <div class="result-card__status">
        <span class={`status-icon${succeeded.length ? '' : ' status-icon--failed'}`}>
          <Icon name={succeeded.length ? 'check' : 'error'} />
        </span>
        {tn('result.batchDone', jobs.length)}
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat__label">{t('result.successful')}</div>
          <div class="stat__value stat__value--good">{succeeded.length}</div>
        </div>
        <div class="stat">
          <div class="stat__label">{t('result.failedCount')}</div>
          <div class="stat__value" style={failed.length ? { color: 'var(--danger)' } : undefined}>
            {failed.length}
          </div>
        </div>
        {cancelled.length ? (
          <div class="stat">
            <div class="stat__label">{t('result.cancelledCount')}</div>
            <div class="stat__value">{cancelled.length}</div>
          </div>
        ) : null}
        <div class="stat">
          <div class="stat__label">{t('result.totalSize')}</div>
          <div class="stat__value">{formatBytes(outputs.reduce((n, o) => n + o.size, 0))}</div>
        </div>
      </div>
      {extra ? extra(jobs) : null}
      <div class="result-actions">
        {outputs.length ? (
          <Button
            variant="primary"
            size="lg"
            icon="download"
            loading={zipping}
            data-testid="download-zip"
            onClick={async () => {
              setZipping(true);
              await (onDownloadAll ? onDownloadAll(outputs) : downloadAllAsZip(outputs, zipName));
              setZipping(false);
            }}
          >
            {downloadAllLabel ? downloadAllLabel(outputs.length) : tn('result.downloadZip', outputs.length)}
          </Button>
        ) : null}
        <Button icon="repeat" onClick={reset}>
          {resetLabel ?? t('action.convertAnother')}
        </Button>
      </div>
      {failed.length ? (
        <div class="stack" style={{ '--gap': '8px' }}>
          <h3>{t('result.failedList')}</h3>
          <div class="job-list">
            {failed.map((j) => (
              <JobRow key={j.id} job={j} compact />
            ))}
          </div>
        </div>
      ) : null}
      {outputs.length ? (
        <details>
          <summary class="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
            {t('result.downloadIndividually')}
          </summary>
          <div style={{ marginTop: '10px' }}>
            <OutputList outputs={outputs} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
