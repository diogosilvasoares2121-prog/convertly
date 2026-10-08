import type { ComponentChildren, JSX } from 'preact';
import { useId } from 'preact/hooks';
import { Icon, type AnyIcon } from './Icon';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';

interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'loading'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: AnyIcon;
  iconAfter?: AnyIcon;
  loading?: boolean;
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

export function Button({ variant = 'secondary', size = 'md', icon, iconAfter, loading, block, children, class: cls, type = 'button', disabled, ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'secondary' && `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', !children && 'btn--icon', cls]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} class={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span class="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconAfter && !loading ? <Icon name={iconAfter} /> : null}
    </button>
  );
}

interface IconButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon'> {
  icon: AnyIcon;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function IconButton({ icon, label, active, danger, class: cls, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      class={['icon-btn', active && 'icon-btn--active', danger && 'icon-btn--danger', cls].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: ComponentChildren;
  disabled?: boolean;
  icon?: AnyIcon;
  title?: string;
}

/** Radio-group style selector (keyboard: arrow keys). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  block,
  wrap,
}: {
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
  label: string;
  block?: boolean;
  wrap?: boolean;
}) {
  const enabled = options.filter((o) => !o.disabled);
  const move = (dir: number) => {
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      class={['segmented', block && 'segmented--block', wrap && 'segmented--wrap'].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          class="segmented__option"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" class="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />
  );
}

export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ComponentChildren;
  disabled?: boolean;
}) {
  return (
    <div class="switch-row">
      <div class="switch-row__text">
        <div class="field__label">{label}</div>
        {hint ? <div class="field__hint">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} {...(disabled ? { disabled } : {})} />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  value,
  children,
  htmlFor,
}: {
  label: ComponentChildren;
  hint?: ComponentChildren;
  error?: ComponentChildren;
  value?: ComponentChildren;
  children: ComponentChildren;
  htmlFor?: string;
}) {
  return (
    <div class="field">
      <label class="field__label" for={htmlFor}>
        <span>{label}</span>
        {value !== undefined ? <span class="field__value">{value}</span> : null}
      </label>
      {children}
      {error ? (
        <div class="field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div class="field__hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  hint,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  label: string;
  hint?: ComponentChildren;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} class="select" value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  hint,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  hint?: ComponentChildren;
}) {
  const id = useId();
  return (
    <Field label={label} value={format ? format(value) : value} hint={hint} htmlFor={id}>
      <input
        id={id}
        class="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </Field>
  );
}

export function NumberInput({
  value,
  onChange,
  label,
  min,
  max,
  suffix,
  hint,
  error,
  step,
}: {
  value: number | '';
  onChange: (v: number | '') => void;
  label: string;
  min?: number;
  max?: number;
  suffix?: string;
  hint?: ComponentChildren;
  error?: ComponentChildren;
  step?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <div class="input-group">
        <input
          id={id}
          class="input"
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-invalid={error ? true : undefined}
          onInput={(e) => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            onChange(raw === '' ? '' : Number(raw));
          }}
        />
        {suffix ? <span class="input-suffix">{suffix}</span> : null}
      </div>
    </Field>
  );
}

export function TextInput({
  value,
  onChange,
  label,
  placeholder,
  hint,
  error,
  mono,
  type = 'text',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  hint?: ComponentChildren;
  error?: ComponentChildren;
  mono?: boolean;
  type?: 'text' | 'password';
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        class={`input${mono ? ' input--mono' : ''}`}
        type={type}
        value={value}
        placeholder={placeholder}
        spellcheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
    </Field>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren }) {
  return (
    <label class="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

const SWATCHES = ['#ffffff', '#000000', '#e5484d', '#f5a524', '#30a46c', '#3e63dd', '#8e4ec6'];

/** Colour picker: quick swatches plus the native colour input (no external picker). */
export function ColorField({ value, onChange, label, swatches = SWATCHES }: { value: string; onChange: (v: string) => void; label: string; swatches?: string[] }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} value={<span class="mono">{value.toUpperCase()}</span>}>
      <div class="swatches" role="group" aria-label={label}>
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            class={`swatch${c.toLowerCase() === value.toLowerCase() ? ' swatch--active' : ''}`}
            style={{ background: c }}
            aria-label={c}
            aria-pressed={c.toLowerCase() === value.toLowerCase()}
            onClick={() => onChange(c)}
          />
        ))}
        <input id={id} type="color" class="swatch swatch--input" value={value} onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)} />
      </div>
    </Field>
  );
}

export type GridPosition = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
const GRID: GridPosition[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

/** 3×3 position picker (watermarks, page numbers). Disabled cells are hidden from keyboard users. */
export function PositionPicker<T extends GridPosition>({
  value,
  onChange,
  label,
  labels,
  allowed,
}: {
  value: T;
  onChange: (v: T) => void;
  label: string;
  labels: Record<GridPosition, string>;
  allowed?: readonly T[];
}) {
  return (
    <div class="field">
      <div class="field__label">{label}</div>
      <div class="position-grid" role="radiogroup" aria-label={label}>
        {GRID.map((p) => {
          const enabled = !allowed || (allowed as readonly string[]).includes(p);
          return (
            <button
              key={p}
              type="button"
              role="radio"
              class={`position-grid__cell${p === value ? ' position-grid__cell--active' : ''}`}
              aria-checked={p === value}
              aria-label={labels[p]}
              title={labels[p]}
              disabled={!enabled}
              tabIndex={enabled ? 0 : -1}
              onClick={() => onChange(p as T)}
            >
              <span />
            </button>
          );
        })}
      </div>
    </div>
  );
}
