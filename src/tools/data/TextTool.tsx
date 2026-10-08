import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { downloadBlob } from '../../core/download';
import { recordToolUse } from '../../storage/activity';
import { dropTargetStore, takePending } from '../../app/handoff';
import type { ToolDef } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatBytes, MB } from '../../utils/bytes';
import { Button, Segmented, type Option } from '../../ui/components/controls';
import { Notice } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';
import { toast } from '../../ui/components/Toasts';
import { useSession } from '../shared/session';
import type { PickedFile } from '../../ui/files';

export type TextResult =
  | { ok: true; output: string; info?: string }
  | { ok: false; message: string; line?: number | null; column?: number | null };

const LIVE_LIMIT = 2 * MB;
const DISPLAY_LIMIT = 5 * MB;

/**
 * Two-pane text tool used by the data tools. Everything runs locally in the page;
 * input is processed live for normal sizes and on demand for large inputs.
 */
export function TextTool<M extends string>({
  tool,
  modes,
  mode,
  onMode,
  process,
  options,
  outputName,
  outputMime,
  placeholder,
  accept,
  wrap,
  scope,
}: {
  tool: ToolDef;
  modes?: Array<Option<M>>;
  mode: M;
  onMode?: (m: M) => void;
  process: (input: string, mode: M) => TextResult;
  options?: ComponentChildren;
  outputName: string;
  outputMime: string;
  placeholder?: string;
  accept?: string;
  wrap?: boolean;
  /** Session scope shared by related modes (e.g. JSON format/minify keep the same input). */
  scope?: string;
}) {
  useI18n();
  const [input, setInput] = useSession<string>(scope ?? tool.id, 'input', '');
  const [result, setResult] = useState<TextResult | null>(null);
  const [stale, setStale] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const used = useRef(false);
  const live = input.length <= LIVE_LIMIT;

  const run = () => {
    if (!input) {
      setResult(null);
      return;
    }
    try {
      setResult(process(input, mode));
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
    setStale(false);
    if (!used.current) {
      used.current = true;
      void recordToolUse(tool.id, tool.category);
    }
  };

  useEffect(() => {
    if (!live) {
      setStale(true);
      return;
    }
    const timer = setTimeout(run, 180);
    return () => clearTimeout(timer);
  }, [input, mode, process]);

  const loadFile = async (file: File) => {
    if (file.size > 50 * MB) {
      toast(t('data.tooLarge'), 'warning');
      return;
    }
    setInput(await file.text());
  };

  useEffect(() => {
    const pending = takePending(tool.id);
    if (pending[0]) void loadFile(pending[0].file);
    const handler = (files: PickedFile[]) => {
      if (!files[0]) return false;
      void loadFile(files[0].file);
      return true;
    };
    dropTargetStore.set(() => handler);
    return () => {
      if (dropTargetStore.get() === handler) dropTargetStore.set(null);
    };
  }, [tool.id]);

  const output = result?.ok ? result.output : '';
  const shownOutput = useMemo(() => (output.length > DISPLAY_LIMIT ? `${output.slice(0, DISPLAY_LIMIT)}\n…` : output), [output]);

  return (
    <div class="stack">
      {modes && onMode ? <Segmented label={t('data.mode')} value={mode} onChange={onMode} options={modes} /> : null}
      {options ? <div class="card card--pad row" style={{ '--gap': '16px', alignItems: 'flex-end' }}>{options}</div> : null}
      <div class="tool-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <div class="stack" style={{ '--gap': '8px' }}>
          <div class="row row--between">
            <label class="field__label" for={`${tool.id}-input`}>
              {t('data.input')}
            </label>
            <div class="row" style={{ '--gap': '4px' }}>
              <Button size="sm" variant="ghost" icon="folder" onClick={() => fileInput.current?.click()}>
                {t('data.openFile')}
              </Button>
              <Button size="sm" variant="ghost" icon="trash" disabled={!input} onClick={() => setInput('')}>
                {t('action.clear')}
              </Button>
            </div>
          </div>
          <textarea
            id={`${tool.id}-input`}
            class={`textarea${wrap ? ' textarea--wrap' : ''}`}
            value={input}
            placeholder={placeholder}
            spellcheck={false}
            data-testid="data-input"
            aria-invalid={result && !result.ok ? true : undefined}
            onInput={(e) => setInput((e.currentTarget as HTMLTextAreaElement).value)}
          />
          <div class="small muted">{formatBytes(new Blob([input]).size)}</div>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={accept}
            onChange={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              const f = el.files?.[0];
              el.value = '';
              if (f) void loadFile(f);
            }}
          />
        </div>
        <div class="stack" style={{ '--gap': '8px' }}>
          <div class="row row--between">
            <span class="field__label">{t('data.output')}</span>
            <div class="row" style={{ '--gap': '4px' }}>
              <Button
                size="sm"
                variant="ghost"
                icon="copy"
                disabled={!output}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(output);
                    toast(t('data.copied'));
                  } catch {
                    toast(t('data.copyFailed'), 'warning');
                  }
                }}
              >
                {t('action.copy')}
              </Button>
              <Button size="sm" variant="soft" icon="download" disabled={!output} onClick={() => void downloadBlob(new Blob([output], { type: outputMime }), outputName)} data-testid="download">
                {t('action.download')}
              </Button>
            </div>
          </div>
          <textarea class={`textarea${wrap ? ' textarea--wrap' : ''}`} value={shownOutput} readOnly spellcheck={false} data-testid="data-output" aria-label={t('data.output')} />
          <div class="small muted">{result?.ok && result.info ? result.info : output ? formatBytes(new Blob([output]).size) : ''}</div>
        </div>
      </div>
      {!live && stale ? (
        <div class="row">
          <Button variant="primary" icon="sparkles" onClick={run}>
            {t('data.process')}
          </Button>
          <span class="small muted">{t('data.largeInput')}</span>
        </div>
      ) : null}
      {result && !result.ok ? (
        <Notice tone="danger" title={t('data.invalid')}>
          {result.message}
          {result.line ? (
            <div class="small" style={{ marginTop: '4px' }}>
              <Icon name="info" size={13} /> {t('data.position', { line: result.line, column: result.column ?? 1 })}
            </div>
          ) : null}
        </Notice>
      ) : null}
      <div class="dropzone__hint">
        <Icon name="lock" />
        {t('data.localNote')}
      </div>
    </div>
  );
}
