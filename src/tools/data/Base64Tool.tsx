import { useCallback, useMemo, useState } from 'preact/hooks';
import { base64ToBytes, base64ToText, Base64Error, bytesToBase64, parseDataUrl, textToBase64 } from '../../engines/data/encoding';
import { detectFromSignature, sniffText } from '../../core/detect';
import { downloadBlob } from '../../core/download';
import { recordToolUse } from '../../storage/activity';
import { navigate, toolHref } from '../../app/router';
import { FORMATS } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatBytes, MB } from '../../utils/bytes';
import { sanitizeFilename } from '../../utils/filename';
import { Button, Checkbox, Segmented, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, Notice } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';
import { toast } from '../../ui/components/Toasts';
import { useSession } from '../shared/session';
import { TextTool, type TextResult } from './TextTool';

type Mode = 'encode' | 'decode' | 'file-encode' | 'file-decode';
const MODE_TOOL: Record<Mode, string> = { encode: 'base64-encode', decode: 'base64-decode', 'file-encode': 'file-to-base64', 'file-decode': 'base64-to-file' };
const MAX_FILE = 50 * MB;

function ModeSwitch({ mode }: { mode: Mode }) {
  return (
    <Segmented
      label={t('data.mode')}
      value={mode}
      wrap
      onChange={(m) => navigate(toolHref(MODE_TOOL[m]))}
      options={[
        { value: 'encode', label: t('b64.textEncode') },
        { value: 'decode', label: t('b64.textDecode') },
        { value: 'file-encode', label: t('b64.fileEncode') },
        { value: 'file-decode', label: t('b64.fileDecode') },
      ]}
    />
  );
}

function FileEncode({ tool }: ToolProps) {
  useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState('');
  const [dataUrl, setDataUrl] = useSession<boolean>('b64', 'dataUrl', false);
  const [busy, setBusy] = useState(false);

  const encode = async (f: File, asDataUrl: boolean) => {
    if (f.size > MAX_FILE) {
      toast(t('data.tooLarge'), 'warning');
      return;
    }
    setBusy(true);
    setFile(f);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const b64 = bytesToBase64(bytes);
    setOutput(asDataUrl ? `data:${f.type || 'application/octet-stream'};base64,${b64}` : b64);
    setBusy(false);
    void recordToolUse(tool.id, tool.category);
  };

  return (
    <div class="stack">
      <ModeSwitch mode="file-encode" />
      {!file ? (
        <Dropzone onFiles={(p) => p[0] && void encode(p[0].file, dataUrl)} multiple={false} title={t('b64.dropFile')} icon="base64" testId="dropzone" />
      ) : (
        <div class="card card--pad stack">
          <div class="row row--between">
            <div class="row">
              <Icon name="file" />
              <strong class="truncate">{file.name}</strong>
              <span class="muted">{formatBytes(file.size)}</span>
            </div>
            <Button size="sm" variant="ghost" icon="close" onClick={() => { setFile(null); setOutput(''); }}>
              {t('action.changeFile')}
            </Button>
          </div>
          <Checkbox
            checked={dataUrl}
            onChange={(v) => {
              setDataUrl(v);
              void encode(file, v);
            }}
            label={t('b64.asDataUrl')}
          />
          <textarea class="textarea textarea--wrap" readOnly value={output.length > 5 * MB ? `${output.slice(0, 5 * MB)}…` : output} aria-label={t('data.output')} data-testid="data-output" />
          <div class="row">
            <Button
              variant="primary"
              icon="copy"
              disabled={!output || busy}
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
            <Button icon="download" disabled={!output} onClick={() => void downloadBlob(new Blob([output], { type: 'text/plain' }), `${file.name}.base64.txt`)}>
              {t('action.download')}
            </Button>
            <span class="small muted">{formatBytes(output.length)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FileDecode({ tool }: ToolProps) {
  useI18n();
  const [input, setInput] = useSession<string>('b64', 'fileInput', '');
  const [name, setName] = useState('');
  const decoded = useMemo(() => {
    if (!input.trim()) return null;
    const { mime, payload } = parseDataUrl(input);
    try {
      const bytes = base64ToBytes(payload);
      const format = detectFromSignature(bytes.subarray(0, 4096)) ?? sniffText(bytes.subarray(0, 512));
      return { ok: true as const, bytes, format, mime: mime ?? (format ? FORMATS[format].mimes[0]! : null) };
    } catch (err) {
      return { ok: false as const, message: err instanceof Base64Error ? t('b64.invalid', { position: err.position + 1 }) : String(err) };
    }
  }, [input]);
  const ext = decoded?.ok && decoded.format ? FORMATS[decoded.format].extensions[0]! : 'bin';
  const filename = sanitizeFilename(name.trim() || `decoded.${ext}`);

  return (
    <div class="stack">
      <ModeSwitch mode="file-decode" />
      <div class="card card--pad stack">
        <label class="field__label" for="b64-file-input">
          {t('b64.pasteBase64')}
        </label>
        <textarea id="b64-file-input" class="textarea textarea--wrap" value={input} placeholder="data:image/png;base64,iVBORw0KGgo…" spellcheck={false} onInput={(e) => setInput((e.currentTarget as HTMLTextAreaElement).value)} data-testid="data-input" />
        {decoded && !decoded.ok ? <Notice tone="danger">{decoded.message}</Notice> : null}
        {decoded?.ok ? (
          <>
            <div class="row">
              <Badge tone={decoded.format ? 'success' : 'warning'}>{decoded.format ? FORMATS[decoded.format].label : t('b64.unknownType')}</Badge>
              <span class="muted">{formatBytes(decoded.bytes.length)}</span>
              {decoded.mime ? <span class="muted mono small">{decoded.mime}</span> : null}
            </div>
            {!decoded.format ? <Notice tone="info">{t('b64.unknownHint')}</Notice> : null}
            <TextInput label={t('b64.fileName')} value={name} onChange={setName} placeholder={filename} />
            <div>
              <Button
                variant="primary"
                icon="download"
                data-testid="download"
                onClick={() => {
                  void downloadBlob(new Blob([decoded.bytes as BlobPart], { type: decoded.mime ?? 'application/octet-stream' }), filename);
                  void recordToolUse(tool.id, tool.category);
                }}
              >
                {t('b64.downloadFile', { name: filename })}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function Base64Tool(props: ToolProps) {
  useI18n();
  const mode = (props.tool.preset?.mode as Mode | undefined) ?? 'encode';
  const [urlSafe, setUrlSafe] = useSession<boolean>('b64', 'urlSafe', false);
  const process = useCallback(
    (input: string, m: Mode): TextResult => {
      if (m === 'encode') return { ok: true, output: textToBase64(input, urlSafe) };
      try {
        const { text, bytes } = base64ToText(parseDataUrl(input).payload);
        if (text === null) return { ok: false, message: t('b64.binary', { size: formatBytes(bytes.length) }) };
        return { ok: true, output: text };
      } catch (err) {
        if (err instanceof Base64Error) return { ok: false, message: t('b64.invalid', { position: err.position + 1 }) };
        throw err;
      }
    },
    [urlSafe],
  );
  if (mode === 'file-encode') return <FileEncode {...props} />;
  if (mode === 'file-decode') return <FileDecode {...props} />;
  return (
    <div class="stack">
      <ModeSwitch mode={mode} />
      <TextTool
        tool={props.tool}
        mode={mode}
        process={process}
        wrap
        scope="b64text"
        options={mode === 'encode' ? <Checkbox checked={urlSafe} onChange={setUrlSafe} label={t('b64.urlSafe')} /> : undefined}
        outputName={mode === 'encode' ? 'encoded.txt' : 'decoded.txt'}
        outputMime="text/plain"
        placeholder={mode === 'encode' ? 'Olá, Convertly!' : 'T2zDoSwgQ29udmVydGx5IQ=='}
        accept=".txt,text/plain"
      />
    </div>
  );
}
