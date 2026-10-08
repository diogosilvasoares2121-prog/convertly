import { useEffect, useState } from 'preact/hooks';
import { AppError, toAppError, type ErrorCode } from '../../core/errors';
import { makeOutput, type OutputFile } from '../../core/jobs';
import { downloadMany } from '../../core/download';
import { openArchive, type ArchiveItem } from '../../engines/archive/libarchive';
import { gunzipFile } from '../../engines/zip/client';
import { gzipContainsTar, gzipOriginalSize } from '../../engines/archive/gzip';
import { isExecutableName } from '../../engines/zip/reader';
import type { FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { formatBytes, GB } from '../../utils/bytes';
import { NameDeduper, splitName } from '../../utils/filename';
import { Button, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from '../image/common';

const MAX_TOTAL = 4 * GB;
const MAX_ENTRIES_SHOWN = 2000;
/** libarchive can decrypt ZIP (ZipCrypto/AES) but not RAR or 7-Zip encryption. */
const NO_DECRYPTION: ReadonlySet<FormatId> = new Set(['rar', '7z']);

/** Name of the single file inside a plain .gz (not a tarball). */
function gunzippedName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tgz')) return `${name.slice(0, -4)}.tar`;
  if (lower.endsWith('.gz')) return name.slice(0, -3) || 'file';
  return `${name}.out`;
}

interface Listing {
  items: ArchiveItem[];
  encrypted: boolean;
  /** Plain gzip stream of a single file (handled without libarchive). */
  plainGzip: boolean;
}

/**
 * Universal extractor: 7Z, RAR (v4/v5), TAR, TAR.GZ/BZ2/XZ, GZ, ISO and ZIP (including
 * password-protected archives) with libarchive compiled to WebAssembly.
 * Paths are sanitised (no zip-slip), executables are flagged, nothing is ever run.
 */
export default function ArchiveExtract({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  useEffect(() => {
    setSubmitted(undefined);
    setPassword('');
  }, [file]);

  useEffect(() => {
    let alive = true;
    setListing(null);
    setError(null);
    if (!file) return;
    void (async () => {
      if (file.format === 'gz' && !/\.(tgz|tar\.gz)$/i.test(file.name) && !(await gzipContainsTar(file.file))) {
        // A single gzip-compressed file (not a tarball): no need for libarchive.
        const name = gunzippedName(file.name);
        const size = await gzipOriginalSize(file.file);
        if (alive) {
          setListing({ items: [{ rawPath: name, path: name, size, unsafePath: false }], encrypted: false, plainGzip: true });
          setSelected(new Set([name]));
        }
        return;
      }
      try {
        const opened = await openArchive(file.file, file.name, submitted);
        const items = opened.items;
        try {
          // Check the password right away by decrypting the smallest entry.
          if (submitted !== undefined && opened.encrypted && items.length) {
            await opened.extract(items.reduce((a, b) => (b.size < a.size ? b : a)));
          }
        } finally {
          await opened.close();
        }
        if (!alive) return;
        setListing({ items, encrypted: opened.encrypted, plainGzip: false });
        setSelected(new Set(items.map((i) => i.rawPath)));
      } catch (err) {
        if (alive) setError(toAppError(err).code);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, submitted]);

  const folder = splitName(file?.name.replace(/\.tar\.(gz|bz2|xz)$/i, '') ?? 'archive').base || 'archive';

  if (groupId) {
    return (
      <JobGroupView
        groupId={groupId}
        zipName={`${folder}.zip`}
        onReset={() => { setGroupId(null); files.clear(); }}
        resetLabel={t('archive.extractAnother')}
        onDownloadAll={(outputs) => downloadMany(outputs.map((o) => ({ blob: o.blob, name: o.name.split('/').pop() ?? o.name, path: [folder, ...o.name.split('/').slice(0, -1)].join('/') })))}
        downloadAllLabel={(n) => tn('zip.saveAll', n, { folder })}
      />
    );
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('archive.dropTitle')} buttonLabel={t('archive.choose')} formatsHint={formatsHint(tool)} icon="extract" testId="dropzone" />;
  }

  const encryptedError = error === 'archive-encrypted' || error === 'archive-wrong-password';
  const unsupportedEncryption = !!file.format && NO_DECRYPTION.has(file.format) && (encryptedError || !!listing?.encrypted);
  const wrongPassword = error === 'archive-wrong-password' || (error === 'archive-encrypted' && submitted !== undefined);
  const needsPassword = !unsupportedEncryption && (encryptedError || (!!listing?.encrypted && submitted === undefined));
  const items = listing?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.rawPath));
  const total = chosen.reduce((n, i) => n + i.size, 0);
  const unsafe = items.filter((i) => i.unsafePath);
  const executables = items.filter((i) => isExecutableName(i.path));

  const run = async () => {
    const picks = new Set(chosen.map((c) => c.rawPath));
    const pw = submitted;
    const plain = !!listing?.plainGzip;
    const id = await startCombinedJob(tool, [file], {
      pool: 'zip',
      operation: t('tool.archive-extract.title'),
      label: file.name,
      skipSizeCheck: true,
      run: async (ctx): Promise<OutputFile[]> => {
        ctx.setState('processing');
        if (plain) {
          const blob = await gunzipFile(file.file, { signal: ctx.signal });
          return [makeOutput(gunzippedName(file.name), blob)];
        }
        const archive = await openArchive(file.file, file.name, pw);
        // Cancelling closes the archive, which terminates its WebAssembly worker.
        const onAbort = () => void archive.close();
        ctx.signal.addEventListener('abort', onAbort, { once: true });
        try {
          const wanted = archive.items.filter((i) => picks.has(i.rawPath));
          const totalBytes = wanted.reduce((n, i) => n + i.size, 0) || 1;
          const dedupe = new NameDeduper();
          const out: OutputFile[] = [];
          let done = 0;
          for (const item of wanted) {
            if (ctx.signal.aborted) throw new AppError('cancelled');
            const blob = await archive.extract(item);
            out.push(makeOutput(dedupe.unique(item.path), blob));
            done += item.size;
            ctx.progress(done / totalBytes);
          }
          return out;
        } finally {
          ctx.signal.removeEventListener('abort', onAbort);
          await archive.close();
        }
      },
    });
    if (id) setGroupId(id);
  };

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} />
          {unsupportedEncryption ? (
            <div data-testid="archive-unsupported-encryption">
              <Notice tone="warning" icon="lock" title={t('error.archive-encrypted.title')}>
                {t('archive.encryptedUnsupported')}
              </Notice>
            </div>
          ) : null}
          {error && !needsPassword && !unsupportedEncryption ? <ErrorNotice code={error} /> : null}
          {needsPassword ? (
            <form
              class="card card--pad stack"
              data-testid="archive-password"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(password);
              }}
            >
              <Notice tone={wrongPassword ? 'danger' : 'warning'} icon="lock" title={wrongPassword ? t('error.archive-wrong-password.title') : t('archive.protected')}>
                {wrongPassword ? t('error.archive-wrong-password.desc') : t('archive.passwordHelp')}
              </Notice>
              <TextInput label={t('archive.password')} type="password" value={password} onChange={setPassword} autoFocus />
              <div class="row">
                <Button type="submit" variant="primary" icon="key" disabled={!password}>
                  {t('archive.unlock')}
                </Button>
                <span class="small muted">{t('archive.passwordLocal')}</span>
              </div>
            </form>
          ) : null}
          {!listing && !error ? <Spinner label={t('progress.reading')} /> : null}
          {unsafe.length ? <Notice tone="warning" title={t('zip.unsafeTitle')}>{tn('zip.unsafeDesc', unsafe.length)}</Notice> : null}
          {executables.length ? <Notice tone="warning" title={t('zip.execTitle')}>{t('zip.execDesc')}</Notice> : null}
          {listing && !needsPassword && !unsupportedEncryption ? (
            <div class="table-wrap">
              <table class="table" data-testid="zip-entries">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input
                        type="checkbox"
                        aria-label={t('pages.selectAll')}
                        checked={chosen.length === items.length && items.length > 0}
                        onChange={(e) => setSelected((e.currentTarget as HTMLInputElement).checked ? new Set(items.map((x) => x.rawPath)) : new Set())}
                      />
                    </th>
                    <th>{t('zip.colName')}</th>
                    <th>{t('zip.colSize')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, MAX_ENTRIES_SHOWN).map((e) => (
                    <tr key={e.rawPath}>
                      <td>
                        <input type="checkbox" aria-label={e.path} checked={selected.has(e.rawPath)} onChange={() => toggle(e.rawPath)} />
                      </td>
                      <td>
                        <div class="row" style={{ '--gap': '6px' }}>
                          <span class="mono" style={{ overflowWrap: 'anywhere' }}>
                            {e.path}
                          </span>
                          {e.unsafePath ? <Badge tone="warning">{t('zip.renamed')}</Badge> : null}
                          {isExecutableName(e.path) ? <Badge tone="warning" icon="warning">{t('zip.executable')}</Badge> : null}
                        </div>
                      </td>
                      <td class="nowrap">{formatBytes(e.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length > MAX_ENTRIES_SHOWN ? <p class="small muted" style={{ padding: '8px 12px' }}>{tn('zip.moreEntries', items.length - MAX_ENTRIES_SHOWN)}</p> : null}
            </div>
          ) : null}
        </>
      }
      panel={
        <OptionsCard title={t('zip.contents')}>
          {listing && !needsPassword ? (
            <dl class="kv">
              <dt>{t('zip.files')}</dt>
              <dd>{items.length}</dd>
              <dt>{t('zip.selected')}</dt>
              <dd>
                {chosen.length}
                {` · ${formatBytes(total)}`}
              </dd>
              {listing.encrypted ? (
                <>
                  <dt>{t('archive.encryption')}</dt>
                  <dd>
                    <Badge tone="success" icon="lock">
                      {t('archive.unlocked')}
                    </Badge>
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {total > MAX_TOTAL ? <Notice tone="danger">{t('zip.tooLarge')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="extract" disabled={!listing || needsPassword || unsupportedEncryption || !chosen.length || total > MAX_TOTAL} onClick={() => void run()} data-testid="run">
            {chosen.length === items.length ? t('zip.extractAll') : tn('zip.extractSelected', chosen.length)}
          </Button>
          <p class="small muted">{t('archive.safety')}</p>
        </OptionsCard>
      }
    />
  );
}
