import type { ComponentChildren } from 'preact';
import { createStore, useStore } from '../core/store';
import { t, tn, useI18n } from '../i18n';
import { settingsStore } from '../storage/settings';
import { sizeClassOf, type SizeClass } from '../core/detect';
import { formatBytes } from '../utils/bytes';
import { Modal } from '../ui/components/Modal';
import { Button } from '../ui/components/controls';
import { Icon } from '../ui/components/Icon';

interface ConfirmRequest {
  title: string;
  body: ComponentChildren;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

const confirmStore = createStore<ConfirmRequest | null>(null);

export function confirmDialog(title: string, body: ComponentChildren, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmStore.get()?.resolve(false);
    confirmStore.set({ title, body, confirmLabel, resolve });
  });
}

const ORDER: SizeClass[] = ['light', 'medium', 'heavy', 'very-heavy'];

/**
 * Large file protection: warns (never blocks) before heavy work on big inputs.
 * `heavy` tools (video) always show the CPU/memory notice for MEDIUM+ files.
 */
export async function confirmLargeFiles(files: Array<{ size: number }>, heavyTool: boolean): Promise<boolean> {
  if (!settingsStore.get().confirmLargeFiles) return true;
  const total = files.reduce((n, f) => n + f.size, 0);
  const biggest = files.reduce((m, f) => Math.max(m, f.size), 0);
  const cls = ORDER[Math.max(ORDER.indexOf(sizeClassOf(biggest)), ORDER.indexOf(sizeClassOf(total)))]!;
  if (cls === 'light') return true;
  return confirmDialog(
    t('large.title'),
    <div class="stack" style={{ '--gap': '12px' }}>
      <div class="row">
        <span class={`badge badge--${cls === 'medium' ? 'warning' : 'danger'}`}>{t(`size.${cls}`)}</span>
        <span class="muted">
          {tn('large.files', files.length)} · {formatBytes(total)}
        </span>
      </div>
      <p>{t('large.body')}</p>
      {heavyTool ? (
        <p class="row" style={{ '--gap': '8px' }}>
          <Icon name="cpu" />
          {t('video.cpuNotice')}
        </p>
      ) : null}
      <p class="muted small">{t('large.tip')}</p>
    </div>,
    t('action.continue'),
  );
}

export function ConfirmHost() {
  useI18n();
  const request = useStore(confirmStore);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    confirmStore.set(null);
  };
  return (
    <Modal open={!!request} onClose={() => close(false)} labelledBy="confirm-title">
      {request ? (
        <>
          <div class="modal__body stack">
            <h2 id="confirm-title" class="modal__title">
              {request.title}
            </h2>
            <div>{request.body}</div>
          </div>
          <div class="modal__footer">
            <Button onClick={() => close(false)}>{t('action.cancel')}</Button>
            <Button variant="primary" onClick={() => close(true)} autoFocus>
              {request.confirmLabel}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
