import { parseJsonSafe, validateJson, type JsonError } from './json';

/** RFC 4180 CSV parsing/serialising and JSON ↔ CSV conversion. */

export type Delimiter = ',' | ';' | '\t' | '|';

export function detectDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [',', ';', '\t', '|'];
  const firstLines = text.split(/\r?\n/).slice(0, 5);
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = firstLines.map((line) => {
      let n = 0;
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    const consistent = counts.every((c) => c === counts[0]);
    const score = (counts[0] ?? 0) * (consistent ? 2 : 1);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Parses CSV into rows of cells. Handles quotes, escaped quotes and newlines inside quotes. */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r' && input[i + 1] === '\n') i++;
    } else cell += ch;
    i++;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function inferValue(value: string): unknown {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n))) return n;
  }
  return value;
}

export interface CsvToJsonOptions {
  delimiter: Delimiter | 'auto';
  header: boolean;
  inferTypes: boolean;
}

export function csvToJson(text: string, options: CsvToJsonOptions): { json: string; rows: number; columns: number } {
  const delimiter = options.delimiter === 'auto' ? detectDelimiter(text) : options.delimiter;
  const rows = parseCsv(text, delimiter);
  const convert = (v: string) => (options.inferTypes ? inferValue(v) : v);
  if (!rows.length) return { json: '[]', rows: 0, columns: 0 };
  let data: unknown[];
  let columns = Math.max(...rows.map((r) => r.length));
  if (options.header) {
    const seen = new Map<string, number>();
    const headers = rows[0]!.map((h, i) => {
      const base = h.trim() || `column${i + 1}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return count > 1 ? `${base}_${count}` : base;
    });
    columns = headers.length;
    data = rows.slice(1).map((r) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => (obj[h] = convert(r[i] ?? '')));
      for (let i = headers.length; i < r.length; i++) obj[`column${i + 1}`] = convert(r[i]!);
      return obj;
    });
  } else {
    data = rows.map((r) => r.map(convert));
  }
  return { json: JSON.stringify(data, null, 2), rows: data.length, columns };
}

export interface JsonToCsvOptions {
  delimiter: Delimiter;
  /** Prefix cells starting with = + - @ so spreadsheet apps don't run them as formulas. */
  escapeFormulas: boolean;
  /** Add a UTF-8 BOM so Excel detects accents correctly. */
  bom: boolean;
}

function flatten(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length && prefix) out[prefix] = '';
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix || 'value'] = value;
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.every((v) => v === null || typeof v !== 'object') ? value.join('; ') : JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCell(text: string, delimiter: Delimiter, escapeFormulas: boolean): string {
  let t = text;
  if (escapeFormulas && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  if (t.includes(delimiter) || t.includes('"') || t.includes('\n') || t.includes('\r') || /^\s|\s$/.test(t)) {
    return `"${t.replace(/"/g, '""')}"`;
  }
  return t;
}

export type JsonToCsvResult = { ok: true; csv: string; rows: number; columns: number } | { ok: false; error: JsonError | { message: string; position: null; line: null; column: null } };

export function jsonToCsv(text: string, options: JsonToCsvOptions): JsonToCsvResult {
  const error = validateJson(text.replace(/^\uFEFF/, ''));
  if (error) return { ok: false, error };
  let data = parseJsonSafe(text);
  // { "items": [ ... ] } → use the single array inside.
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const arrays = Object.values(data as Record<string, unknown>).filter(Array.isArray);
    data = arrays.length === 1 && Object.keys(data as object).length === 1 ? arrays[0] : [data];
  }
  if (!Array.isArray(data)) data = [data];
  const records = (data as unknown[]).map((item) => {
    const out: Record<string, unknown> = {};
    flatten(item, '', out);
    return out;
  });
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
  if (!columns.length) return { ok: false, error: { message: 'No tabular data found', position: null, line: null, column: null } };
  const d = options.delimiter;
  const lines = [columns.map((c) => escapeCell(c, d, options.escapeFormulas)).join(d)];
  for (const r of records) lines.push(columns.map((c) => escapeCell(cellText(r[c]), d, options.escapeFormulas)).join(d));
  return { ok: true, csv: (options.bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n', rows: records.length, columns: columns.length };
}
