import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { downloadBlob } from '../../core/download';
import { recordToolUse } from '../../storage/activity';
import { dropTargetStore, takePending } from '../../app/handoff';
import type { Delimiter } from '../../engines/data/csv';
import { cellString, rowsToCsv, rowsToJson, textToRows } from '../../engines/data/table';
import { readXlsx, writeXlsx, type Cell, type Sheet } from '../../engines/data/xlsx';
import { createZip } from '../../engines/zip/client';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { MB, formatBytes } from '../../utils/bytes';
import { sanitizeFilename, splitName } from '../../utils/filename';
import { Button, Checkbox, Segmented, Select, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Notice } from '../../ui/components/feedback';
import { Icon } from '../../ui/components/Icon';
import { toast } from '../../ui/components/Toasts';
import type { PickedFile } from '../../ui/files';
import { useSession } from '../shared/session';

type Direction = 'from-xlsx' | 'to-xlsx';
type Out = 'csv' | 'json';
const PREVIEW_ROWS = 50;
const MAX_FILE = 50 * MB;

function PreviewTable({ rows }: { rows: Cell[][] }) {
  useI18n();
  const shown = rows.slice(0, PREVIEW_ROWS);
  const width = Math.min(30, Math.max(0, ...shown.map((r) => r.length)));
  return (
    <div class="table-wrap" style={{ maxHeight: '420px' }}>
      <table class="table table--grid" data-testid="sheet-preview">
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <th class="muted small">{i + 1}</th>
              {Array.from({ length: width }, (_, j) => (
                <td key={j} class="truncate" style={{ maxWidth: '220px' }}>
                  {cellString(r[j] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > PREVIEW_ROWS ? <p class="small muted" style={{ padding: '8px 12px' }}>{t('xlsx.moreRows', { n: rows.length - PREVIEW_ROWS })}</p> : null}
    </div>
  );
}

/** Excel (.xlsx) ↔ CSV / JSON, fully local (no spreadsheet service). */
export default function XlsxTool({ tool }: ToolProps) {
  useI18n();
  const presetMode = tool.preset?.mode;
  const initialDirection: Direction = presetMode === 'csv-to-xlsx' || presetMode === 'json-to-xlsx' ? 'to-xlsx' : 'from-xlsx';
  const [direction, setDirection] = useSession<Direction>(tool.id, 'direction', initialDirection);
  const [book, setBook] = useState<{ name: string; sheets: Sheet[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [out, setOut] = useSession<Out>(tool.id, 'out', presetMode === 'xlsx-to-json' ? 'json' : 'csv');
  const [delimiter, setDelimiter] = useSession<Delimiter>(tool.id, 'delimiter', ',');
  const [bom, setBom] = useSession<boolean>(tool.id, 'bom', true);
  const [header, setHeader] = useSession<boolean>(tool.id, 'header', true);
  const [text, setText] = useSession<string>(tool.id, 'text', '');
  const [sheetName, setSheetName] = useSession<string>(tool.id, 'sheetName', 'Sheet1');
  const [numbers, setNumbers] = useSession<boolean>(tool.id, 'numbers', true);
  const fileInput = useRef<HTMLInputElement>(null);
  const used = useRef(false);

  const markUsed = () => {
    if (used.current) return;
    used.current = true;
    void recordToolUse(tool.id, tool.category);
  };

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      toast(t('data.tooLarge'), 'warning');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isZip) {
      setDirection('from-xlsx');
      try {
        const sheets = readXlsx(bytes);
        if (!sheets.length) throw new Error(t('xlsx.noSheets'));
        setBook({ name: file.name, sheets });
        setSheetIndex(0);
        setError(null);
        markUsed();
      } catch (err) {
        setBook(null);
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setDirection('to-xlsx');
    setText(new TextDecoder().decode(bytes));
    setSheetName(sanitizeFilename(splitName(file.name).base, 'Sheet1').slice(0, 31));
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

  const parsed = useMemo(() => (direction === 'to-xlsx' && text.trim() ? textToRows(text) : null), [direction, text]);
  const sheet = book?.sheets[sheetIndex] ?? null;
  const base = splitName(book?.name ?? 'spreadsheet').base || 'spreadsheet';

  const exportSheet = (s: Sheet): Blob =>
    out === 'csv' ? new Blob([rowsToCsv(s.rows, delimiter, bom)], { type: 'text/csv;charset=utf-8' }) : new Blob([rowsToJson(s.rows, header)], { type: 'application/json' });
  const sheetFile = (s: Sheet) => `${base}${book && book.sheets.length > 1 ? `-${sanitizeFilename(s.name, 'sheet')}` : ''}.${out}`;

  const downloadAll = async () => {
    if (!book) return;
    const entries = book.sheets.map((s) => ({ path: sheetFile(s), blob: exportSheet(s), lastModified: Date.now() }));
    const zip = await createZip(entries, 'normal');
    await downloadBlob(zip, `${base}-sheets.zip`);
  };

  const downloadXlsx = async () => {
    if (!parsed?.ok) return;
    const bytes = writeXlsx(parsed.rows, sheetName.trim().slice(0, 31) || 'Sheet1', numbers);
    await downloadBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${sanitizeFilename(sheetName.trim() || 'spreadsheet')}.xlsx`);
    markUsed();
  };

  return (
    <div class="stack">
      <Segmented
        label={t('data.mode')}
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'from-xlsx', label: t('xlsx.fromXlsx') },
          { value: 'to-xlsx', label: t('xlsx.toXlsx') },
        ]}
      />
      {direction === 'from-xlsx' ? (
        <>
          {!book ? (
            <Dropzone onFiles={(p) => p[0] && void loadFile(p[0].file)} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple={false} title={t('xlsx.dropTitle')} buttonLabel={t('xlsx.choose')} icon="table" testId="dropzone" />
          ) : (
            <>
              <div class="card card--pad row" style={{ '--gap': '16px', alignItems: 'flex-end' }}>
                <div class="row grow" style={{ '--gap': '8px' }}>
                  <Icon name="table" />
                  <strong class="truncate">{book.name}</strong>
                  <span class="muted small">{t('xlsx.sheetsCount', { n: book.sheets.length })}</span>
                </div>
                {book.sheets.length > 1 ? (
                  <div style={{ minWidth: '180px' }}>
                    <Select label={t('xlsx.sheet')} value={String(sheetIndex)} onChange={(v) => setSheetIndex(Number(v))} options={book.sheets.map((s, i) => ({ value: String(i), label: s.name }))} />
                  </div>
                ) : null}
                <Button variant="ghost" size="sm" icon="close" onClick={() => setBook(null)}>
                  {t('action.clear')}
                </Button>
              </div>
              <div class="card card--pad row" style={{ '--gap': '16px', alignItems: 'flex-end' }}>
                <Segmented label={t('options.convertTo')} value={out} onChange={setOut} options={[{ value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }]} />
                {out === 'csv' ? (
                  <>
                    <div style={{ minWidth: '160px' }}>
                      <Select
                        label={t('data.delimiter')}
                        value={delimiter}
                        onChange={setDelimiter}
                        options={[
                          { value: ',', label: t('data.comma') },
                          { value: ';', label: t('data.semicolon') },
                          { value: '\t', label: t('data.tab') },
                          { value: '|', label: '|' },
                        ]}
                      />
                    </div>
                    <Checkbox checked={bom} onChange={setBom} label={t('data.excelBom')} />
                  </>
                ) : (
                  <Checkbox checked={header} onChange={setHeader} label={t('data.headerRow')} />
                )}
                <span class="grow" />
                {book.sheets.length > 1 ? (
                  <Button variant="secondary" icon="archive" onClick={() => void downloadAll()} data-testid="download-all">
                    {t('xlsx.allSheets')}
                  </Button>
                ) : null}
                <Button variant="primary" icon="download" disabled={!sheet} onClick={() => sheet && void downloadBlob(exportSheet(sheet), sheetFile(sheet)).then(markUsed)} data-testid="download">
                  {t('xlsx.downloadAs', { format: out.toUpperCase() })}
                </Button>
              </div>
              {sheet ? (
                <>
                  <div class="small muted">{t('data.tableInfo', { rows: sheet.rows.length, columns: Math.max(0, ...sheet.rows.map((r) => r.length)) })}</div>
                  <PreviewTable rows={sheet.rows} />
                </>
              ) : null}
            </>
          )}
          {error ? <ErrorNotice code="corrupted-file" detail={error} /> : null}
        </>
      ) : (
        <>
          <div class="card card--pad row" style={{ '--gap': '16px', alignItems: 'flex-end' }}>
            <div style={{ minWidth: '200px' }}>
              <TextInput label={t('xlsx.sheetName')} value={sheetName} onChange={setSheetName} />
            </div>
            <Checkbox checked={numbers} onChange={setNumbers} label={t('xlsx.detectNumbers')} />
            <span class="grow" />
            <Button variant="primary" icon="download" disabled={!parsed?.ok || !parsed.rows.length} onClick={() => void downloadXlsx()} data-testid="download">
              {t('xlsx.downloadXlsx')}
            </Button>
          </div>
          <div class="stack" style={{ '--gap': '8px' }}>
            <div class="row row--between">
              <label class="field__label" for="xlsx-input">
                {t('xlsx.input')}
              </label>
              <div class="row" style={{ '--gap': '4px' }}>
                <Button size="sm" variant="ghost" icon="folder" onClick={() => fileInput.current?.click()}>
                  {t('data.openFile')}
                </Button>
                <Button size="sm" variant="ghost" icon="trash" disabled={!text} onClick={() => setText('')}>
                  {t('action.clear')}
                </Button>
              </div>
            </div>
            <textarea
              id="xlsx-input"
              class="textarea"
              style={{ minHeight: '200px' }}
              value={text}
              placeholder={'name,city,age\nAna,Lisboa,31\nRui,Porto,27'}
              spellcheck={false}
              data-testid="data-input"
              onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
            />
            <div class="small muted">
              {formatBytes(new Blob([text]).size)}
              {parsed?.ok ? ` · ${parsed.kind.toUpperCase()} · ${t('data.tableInfo', { rows: parsed.rows.length, columns: Math.max(0, ...parsed.rows.map((r) => r.length)) })}` : ''}
            </div>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".csv,.tsv,.json,.txt,text/csv,application/json,text/plain"
              onChange={(e) => {
                const el = e.currentTarget as HTMLInputElement;
                const f = el.files?.[0];
                el.value = '';
                if (f) void loadFile(f);
              }}
            />
          </div>
          {parsed && !parsed.ok ? <Notice tone="danger" title={t('data.invalid')}>{parsed.message}</Notice> : null}
          {parsed?.ok && parsed.rows.length ? <PreviewTable rows={parsed.rows} /> : null}
        </>
      )}
      <div class="dropzone__hint">
        <Icon name="lock" />
        {t('data.localNote')}
      </div>
    </div>
  );
}
