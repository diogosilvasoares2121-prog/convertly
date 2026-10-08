import type { ComponentChildren } from 'preact';
import { hasMessage, t, useI18n, type MessageKey } from '../../i18n';
import type { ErrorCode } from '../../core/errors';
import { Icon, type AnyIcon } from './Icon';

export function Progress({ value, label, success }: { value: number | null; label: string; success?: boolean }) {
  const indeterminate = value === null;
  const pct = indeterminate ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      class={['progress', indeterminate && 'progress--indeterminate', success && 'progress--success'].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? { 'aria-valuetext': t('progress.processing') } : { 'aria-valuenow': pct })}
    >
      <div class="progress__bar" style={{ width: indeterminate ? '35%' : `${pct}%` }} />
    </div>
  );
}

type Tone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';
const TONE_ICON: Record<Tone, AnyIcon> = { info: 'info', warning: 'warning', danger: 'error', success: 'success', neutral: 'info' };

export function Notice({ tone = 'info', title, children, icon }: { tone?: Tone; title?: ComponentChildren; children?: ComponentChildren; icon?: AnyIcon }) {
  return (
    <div class={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div>
        {title ? <div class="notice__title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/** Translated, actionable explanation for an error code (never a bare "Something went wrong"). */
export function ErrorNotice({ code, detail, compact }: { code: ErrorCode; detail?: string | undefined; compact?: boolean }) {
  useI18n();
  const title = t(`error.${code}.title` as MessageKey);
  const desc = t(`error.${code}.desc` as MessageKey);
  const tipsKey = `error.${code}.tips`;
  const tips = hasMessage(tipsKey) ? t(tipsKey).split('\n').filter(Boolean) : [];
  if (compact) {
    return (
      <div class="small" style={{ color: 'var(--danger)' }}>
        <strong>{title}</strong> — {desc}
      </div>
    );
  }
  return (
    <Notice tone={code === 'cancelled' ? 'neutral' : 'danger'} title={title}>
      <p>{desc}</p>
      {tips.length ? (
        <ul>
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      ) : null}
      {detail && code !== 'cancelled' ? (
        <details style={{ marginTop: '6px' }}>
          <summary class="small muted">{t('error.technicalDetails')}</summary>
          <code class="small" style={{ overflowWrap: 'anywhere' }}>
            {detail}
          </code>
        </details>
      ) : null}
    </Notice>
  );
}

export function Badge({ tone, children, icon, format }: { tone?: 'brand' | 'success' | 'warning' | 'danger' | 'processing'; children: ComponentChildren; icon?: AnyIcon; format?: boolean }) {
  return (
    <span class={['badge', tone && `badge--${tone}`, format && 'badge--format'].filter(Boolean).join(' ')}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return <span class="spinner" role="status" aria-label={label} />;
}

export function EmptyState({ icon = 'info', children }: { icon?: AnyIcon; children: ComponentChildren }) {
  return (
    <div class="empty">
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}
