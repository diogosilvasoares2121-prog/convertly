import { useEffect, useRef } from 'preact/hooks';
import { useStore } from '../../core/store';
import { clearFinishedJobs, isFinished, jobsStore } from '../../core/jobs';
import { t, tn, useI18n } from '../../i18n';
import { formatBytes } from '../../utils/bytes';
import { Button, IconButton } from '../components/controls';
import { EmptyState } from '../components/feedback';
import { JobRow } from '../../tools/shared/Results';

/** Side drawer listing every job of this session (status, progress, cancel/retry/remove). */
export function JobsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const jobs = useStore(jobsStore);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const finished = jobs.filter(isFinished);
  const held = jobs.reduce((n, j) => n + j.outputs.reduce((m, o) => m + o.size, 0), 0);
  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="jobs-title" tabIndex={-1} ref={ref} data-testid="jobs-drawer">
        <div class="drawer__head">
          <div>
            <h2 id="jobs-title">{t('jobs.title')}</h2>
            <div class="small muted">{tn('jobs.count', jobs.length)}</div>
          </div>
          <IconButton icon="close" label={t('action.close')} onClick={onClose} />
        </div>
        <div class="drawer__body">
          {jobs.length ? (
            <div class="job-list">
              {[...jobs].reverse().map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </div>
          ) : (
            <EmptyState icon="layers">{t('jobs.empty')}</EmptyState>
          )}
        </div>
        <div class="drawer__foot">
          <span class="small muted">{t('jobs.memory', { size: formatBytes(held) })}</span>
          <Button size="sm" icon="trash" disabled={!finished.length} onClick={clearFinishedJobs}>
            {t('jobs.clearFinished')}
          </Button>
        </div>
      </aside>
    </>
  );
}
