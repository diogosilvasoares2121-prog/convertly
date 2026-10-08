import { useEffect, useRef, useState } from 'preact/hooks';
import { toAppError, type ErrorCode } from '../../core/errors';
import { recordToolUse } from '../../storage/activity';
import { hashFile } from '../../engines/zip/client';
import type { HashAlgorithm } from '../../engines/data/hash';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { formatBytes } from '../../utils/bytes';
import { Button, Checkbox, IconButton, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, ErrorNotice, Progress } from '../../ui/components/feedback';
import { toast } from '../../ui/components/Toasts';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';

const ALGORITHMS: Array<{ id: HashAlgorithm; label: string }> = [
  { id: 'md5', label: 'MD5' },
  { id: 'sha1', label: 'SHA-1' },
  { id: 'sha256', label: 'SHA-256' },
];

type Result = { state: 'pending' } | { state: 'running'; progress: number } | { state: 'done'; hashes: Partial<Record<HashAlgorithm, string>> } | { state: 'error'; code: ErrorCode };

/** MD5 / SHA-1 / SHA-256 checksums of local files, with a "verify" field. */
export default function HashTool({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const [algorithms, setAlgorithms] = useSession<HashAlgorithm[]>(tool.id, 'algorithms', ['sha256', 'md5']);
  const [expected, setExpected] = useSession<string>(tool.id, 'expected', '');
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  useEffect(() => () => controller.current?.abort(), []);

  /** Hashes every file, or only the ones without a result yet (new files are hashed automatically). */
  const run = async (onlyMissing = false) => {
    const algos = ALGORITHMS.map((a) => a.id).filter((a) => algorithms.includes(a));
    const targets = onlyMissing ? files.files.filter((f) => !resultsRef.current[f.id]) : files.files;
    if (!targets.length || !algos.length) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setRunning(true);
    setResults((r) => ({ ...(onlyMissing ? r : {}), ...Object.fromEntries(targets.map((f) => [f.id, { state: 'pending' } as Result])) }));
    void recordToolUse(tool.id, tool.category);
    for (const f of targets) {
      if (ctrl.signal.aborted) break;
      setResults((r) => ({ ...r, [f.id]: { state: 'running', progress: 0 } }));
      try {
        const hashes = await hashFile(f.file, algos, { signal: ctrl.signal, onProgress: (p) => setResults((r) => ({ ...r, [f.id]: { state: 'running', progress: p ?? 0 } })) });
        setResults((r) => ({ ...r, [f.id]: { state: 'done', hashes } }));
      } catch (err) {
        setResults((r) => ({ ...r, [f.id]: { state: 'error', code: toAppError(err).code } }));
      }
    }
    setRunning(false);
  };

  useEffect(() => {
    if (!running && files.files.some((f) => !resultsRef.current[f.id])) void run(true);
  }, [files.files, running]);

  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} title={t('hash.dropTitle')} buttonLabel={t('hash.choose')} icon="hash" testId="dropzone" />;
  }

  const wanted = expected.trim().toLowerCase().replace(/\s+/g, '');
  const anyDone = Object.values(results).some((r) => r.state === 'done');
  const matches = wanted
    ? files.files.filter((f) => {
        const r = results[f.id];
        return r?.state === 'done' && Object.values(r.hashes).includes(wanted);
      })
    : [];

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(t('data.copied'));
    } catch {
      toast(t('data.copyFailed'), 'warning');
    }
  };

  return (
    <div class="stack">
      <div class="card card--pad row" style={{ '--gap': '16px', alignItems: 'center' }}>
        <span class="field__label">{t('hash.algorithms')}</span>
        {ALGORITHMS.map((a) => (
          <Checkbox key={a.id} checked={algorithms.includes(a.id)} onChange={(v) => setAlgorithms((prev) => (v ? [...prev, a.id] : prev.filter((x) => x !== a.id)))} label={a.label} />
        ))}
        <span class="grow" />
        {running ? (
          <Button variant="ghost" icon="close" onClick={() => controller.current?.abort()}>
            {t('action.cancel')}
          </Button>
        ) : (
          <Button variant="primary" icon="hash" disabled={!algorithms.length} onClick={() => void run()} data-testid="run">
            {t('hash.run')}
          </Button>
        )}
      </div>
      <div class="stack" style={{ '--gap': '10px' }} data-testid="hash-results">
        {files.files.map((f) => {
          const r = results[f.id];
          const match = wanted && matches.includes(f);
          return (
            <div key={f.id} class={`card card--pad stack hash-card${match ? ' hash-card--match' : ''}`} style={{ '--gap': '8px' }}>
              <div class="row row--between">
                <div class="row" style={{ '--gap': '8px', minWidth: 0 }}>
                  <strong class="truncate">{f.name}</strong>
                  <span class="muted small">{formatBytes(f.size)}</span>
                  {match ? <Badge tone="success" icon="check">{t('hash.match')}</Badge> : null}
                </div>
                {!running ? <IconButton icon="close" label={t('action.remove')} onClick={() => files.remove(f.id)} /> : null}
              </div>
              {r?.state === 'running' ? <Progress value={r.progress} label={t('progress.processing')} /> : null}
              {r?.state === 'error' ? <ErrorNotice code={r.code} compact /> : null}
              {r?.state === 'done'
                ? ALGORITHMS.filter((a) => r.hashes[a.id]).map((a) => (
                    <div key={a.id} class="hash-row">
                      <span class="hash-row__label">{a.label}</span>
                      <code class="hash-row__value" data-testid={`hash-${a.id}`}>
                        {r.hashes[a.id]}
                      </code>
                      <IconButton icon="copy" label={t('hash.copy', { algorithm: a.label })} onClick={() => void copy(r.hashes[a.id]!)} />
                    </div>
                  ))
                : null}
            </div>
          );
        })}
      </div>
      <Dropzone onFiles={(p) => void files.add(p)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
      <div class="card card--pad stack" style={{ '--gap': '8px' }}>
        <TextInput label={t('hash.verify')} value={expected} onChange={setExpected} mono placeholder="e3b0c44298fc1c149afbf4c8996fb924…" hint={t('hash.verifyHint')} />
        {wanted && anyDone ? (
          matches.length ? (
            <Badge tone="success" icon="check">
              {t('hash.verified', { name: matches.map((m) => m.name).join(', ') })}
            </Badge>
          ) : (
            <Badge tone="danger" icon="warning">
              {t('hash.noMatch')}
            </Badge>
          )
        ) : null}
      </div>
      <p class="small muted">{t('hash.note')}</p>
    </div>
  );
}
