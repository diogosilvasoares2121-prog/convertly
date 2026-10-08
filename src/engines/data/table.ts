import { detectDelimiter, jsonToCsv, parseCsv, type Delimiter } from './csv';
import type { Cell } from './xlsx';

/** Table helpers shared by the Excel converter (pure, unit-tested). */
export const cellString = (c: Cell): string => (c === null ? '' : String(c));

/** RFC 4180 CSV with CRLF line endings; optional UTF-8 BOM so Excel detects accents. */
export function rowsToCsv(rows: Cell[][], delimiter: Delimiter, bom: boolean): string {
  const quote = (s: string) => (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return (bom ? '﻿' : '') + rows.map((r) => r.map((c) => quote(cellString(c))).join(delimiter)).join('\r\n') + '\r\n';
}

/** Rows → JSON: objects keyed by the header row, or an array of arrays. */
export function rowsToJson(rows: Cell[][], header: boolean): string {
  if (!header) return JSON.stringify(rows, null, 2);
  const [head = [], ...body] = rows;
  const keys = head.map((h, i) => cellString(h).trim() || `column${i + 1}`);
  return JSON.stringify(
    body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null]))),
    null,
    2,
  );
}

/** Text (CSV/TSV or a JSON array/object) → table rows for the XLSX writer. */
export function textToRows(text: string): { ok: true; rows: Cell[][]; kind: 'csv' | 'json' } | { ok: false; message: string } {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const r = jsonToCsv(trimmed, { delimiter: ',', escapeFormulas: false, bom: false });
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, rows: parseCsv(r.csv, ','), kind: 'json' };
  }
  return { ok: true, rows: parseCsv(text, detectDelimiter(text)), kind: 'csv' };
}
