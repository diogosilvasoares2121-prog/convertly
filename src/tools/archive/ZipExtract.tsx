import { useEffect, useState } from 'preact/hooks';
import { makeOutput } from '../../core/jobs';
import { downloadMany } from '../../core/download';
import { toAppError, type ErrorCode } from '../../core/errors';
import { extractZipEntries, listZip } from '../../engines/zip/client';
import { isExecutableName, type ZipEntry } from '../../engines/zip/reader';
import type { ToolProps } from '../../registry/types';
import { formatDate, t, tn, useI18n } from '../../i18n';
import { formatBytes, GB } from '../../utils/bytes';
import { splitName } from '../../utils/filename';
import { Button } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { openToolWith } from '../../app/handoff';

const MAX_TOTAL = 4 * GB;

export default function ZipExtract({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const [entries, setEntries] = useState<ZipEntry[] | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    if (!file) return;
    listZip(file.file)
      .then((list) => {
        if (!alive) return;
        setEntries(list);
        setSelected(new Set(list.filter((e) => !e.isDirectory && e.supported).map((e) => e.index)));
      })
      .catch((err: unknown) => alive && setError(toAppError(err).code));
    return () => {
      alive = false;
    };
  }, [file]);

  const folder = splitName(file?.name ?? 'archive').base || 'archive';

  if (groupId) {
    return (
      <JobGroupView
        groupId={groupId}
        zipName={`${folder}.zip`}
        onReset={() => { setGroupId(null); files.clear(); }}
        resetLabel={t('zip.extractAnother')}
        onDownloadAll={(outputs) => downloadMany(outputs.map((o) => ({ blob: o.blob, name: o.name.split('/').pop() ?? o.name, path: [folder, ...o.name.split('/').slice(0, -1)].join('/') })))}
        downloadAllLabel={(n) => tn('zip.saveAll', n, { folder })}
      />
    );
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('zip.dropZip')} buttonLabel={t('zip.chooseZip')} icon="extract" testId="dropzone" />;
  }

  const regular = entries?.filter((e) => !e.isDirectory) ?? [];
  const chosen = regular.filter((e) => selected.has(e.index) && e.supported);
  const total = chosen.reduce((n, e) => n + e.size, 0);
  const blocked = regular.filter((e) => !e.supported);
  const unsafe = regular.filter((e) => e.unsafePath);
  const executables = regular.filter((e) => isExecutableName(e.path));
  const encrypted = regular.filter((e) => e.encrypted);

  const run = async (list: ZipEntry[]) => {
    const id = await startCombinedJob(tool, [file], {
      pool: 'zip',
      operation: t('tool.zip-extract.title'),
      label: file.name,
      skipSizeCheck: true,
      run: async (ctx) => {
        ctx.setState('processing');
        const out = await extractZipEntries(file.file, list, { signal: ctx.signal, onProgress: ctx.progress });
        if (blocked.length) ctx.note(tn('zip.skippedNote', blocked.length));
        return out.map((o) => makeOutput(o.path, o.blob));
      },
    });
    if (id) setGroupId(id);
  };

  const toggle = (index: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(index)) n.delete(index);
      else n.add(index);
      return n;
    });

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} />
          {error ? <ErrorNotice code={error} /> : null}
          {!entries && !error ? <Spinner label={t('progress.reading')} /> : null}
          {unsafe.length ? <Notice tone="warning" title={t('zip.unsafeTitle')}>{tn('zip.unsafeDesc', unsafe.length)}</Notice> : null}
          {executables.length ? <Notice tone="warning" title={t('zip.execTitle')}>{t('zip.execDesc')}</Notice> : null}
          {encrypted.length ? (
            <Notice tone="info" icon="lock" title={t('zip.passwordTitle')}>
              <div class="stack" style={{ '--gap': '8px' }}>
                <span>{tn('zip.passwordDesc', encrypted.length)}</span>
                <div>
                  <Button size="sm" variant="soft" icon="key" onClick={() => openToolWith('archive-extract', [{ file: file.file, path: file.name }])} data-testid="open-archive-extract">
                    {t('zip.openWithPassword')}
                  </Button>
                </div>
              </div>
            </Notice>
          ) : null}
          {entries ? (
            <div class="table-wrap">
              <table class="table" data-testid="zip-entries">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input
                        type="checkbox"
                        aria-label={t('pages.selectAll')}
                        checked={chosen.length === regular.filter((e) => e.supported).length && chosen.length > 0}
                        onChange={(e) => setSelected((e.currentTarget as HTMLInputElement).checked ? new Set(regular.filter((x) => x.supported).map((x) => x.index)) : new Set())}
                      />
                    </th>
                    <th>{t('zip.colName')}</th>
                    <th>{t('zip.colSize')}</th>
                    <th>{t('zip.colModified')}</th>
                  </tr>
                </thead>
                <tbody>
                  {regular.slice(0, 2000).map((e) => (
                    <tr key={e.index}>
                      <td>
                        <input type="checkbox" aria-label={e.path} disabled={!e.supported} checked={selected.has(e.index) && e.supported} onChange={() => toggle(e.index)} />
                      </td>
                      <td>
                        <div class="row" style={{ '--gap': '6px' }}>
                          <span class="mono" style={{ overflowWrap: 'anywhere' }}>
                            {e.path}
                          </span>
                          {e.encrypted ? <Badge tone="danger" icon="lock">{t('zip.encrypted')}</Badge> : null}
                          {e.symlink ? <Badge tone="warning">{t('zip.symlink')}</Badge> : null}
                          {e.unsafePath ? <Badge tone="warning">{t('zip.renamed')}</Badge> : null}
                          {isExecutableName(e.path) ? <Badge tone="warning" icon="warning">{t('zip.executable')}</Badge> : null}
                          {!e.encrypted && !e.symlink && !e.supported ? <Badge tone="danger">{t('zip.unsupported')}</Badge> : null}
                        </div>
                      </td>
                      <td class="nowrap">{formatBytes(e.size)}</td>
                      <td class="nowrap muted">{e.modified ? formatDate(e.modified) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {regular.length > 2000 ? <p class="small muted" style={{ padding: '8px 12px' }}>{tn('zip.moreEntries', regular.length - 2000)}</p> : null}
            </div>
          ) : null}
        </>
      }
      panel={
        <OptionsCard title={t('zip.contents')}>
          {entries ? (
            <dl class="kv">
              <dt>{t('zip.files')}</dt>
              <dd>{regular.length}</dd>
              <dt>{t('zip.selected')}</dt>
              <dd>
                {chosen.length} · {formatBytes(total)}
              </dd>
            </dl>
          ) : null}
          {blocked.length ? <Notice tone="warning">{tn('zip.blocked', blocked.length)}</Notice> : null}
          {total > MAX_TOTAL ? <Notice tone="danger">{t('zip.tooLarge')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="extract" disabled={!chosen.length || total > MAX_TOTAL} onClick={() => void run(chosen)} data-testid="run">
            {chosen.length === regular.filter((e) => e.supported).length ? t('zip.extractAll') : tn('zip.extractSelected', chosen.length)}
          </Button>
          <p class="small muted">{t('zip.safety')}</p>
        </OptionsCard>
      }
    />
  );
}
