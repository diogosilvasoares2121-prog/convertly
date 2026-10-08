import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseXml, type XmlElement, type XmlNode } from './xml';

/**
 * Minimal, dependency-free XLSX (Office Open XML spreadsheet) reader and writer.
 * Reads cell values (numbers, text, booleans, dates, formula results) of every sheet;
 * writes a single-sheet workbook. Formatting, charts and formulas are not preserved.
 */
export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Writes a one-sheet XLSX. Strings that look like numbers can optionally be stored as numbers. */
export function writeXlsx(rows: Cell[][], sheetName = 'Sheet1', detectNumbers = true): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const si = (s: string) => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIndex.set(s, i);
    }
    return i;
  };
  const numeric = /^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/;
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (v === null || v === '') return '';
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          const text = String(v);
          if (detectNumbers && numeric.test(text)) return `<c r="${ref}"><v>${Number(text)}</v></c>`;
          return `<c r="${ref}" t="s"><v>${si(text.replace(XML_INVALID, ''))}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const safeName = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
    ),
  };
  return zipSync(files, { level: 6 });
}

const children = (el: XmlElement, name: string) => el.children.filter((c): c is XmlElement => c.type === 'element' && local(c.name) === name);
const local = (name: string) => name.split(':').pop()!;
const attr = (el: XmlElement, name: string) => el.attributes.find(([k]) => local(k) === name)?.[1];
const textOf = (node: XmlNode): string =>
  node.type === 'text' || node.type === 'cdata' ? node.value : node.type === 'element' ? node.children.map(textOf).join('') : '';

function root(xml: string): XmlElement {
  const el = parseXml(xml).find((n): n is XmlElement => n.type === 'element');
  if (!el) throw new Error('Invalid workbook part');
  return el;
}

// Built-in number formats that are dates/times.
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const iso = new Date(ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

export function readXlsx(bytes: Uint8Array, maxCells = 2_000_000): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') || f.name === '[Content_Types].xml' });
  } catch {
    throw new Error('Not a valid XLSX file');
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]!) : null);
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('Not a valid XLSX file (workbook missing)');
  const shared: string[] = [];
  const sst = read('xl/sharedStrings.xml');
  if (sst) for (const si of children(root(sst), 'si')) shared.push(textOf(si));
  // Styles: which cell styles are dates.
  const dateStyles = new Set<number>();
  const styles = read('xl/styles.xml');
  if (styles) {
    const s = root(styles);
    const custom = new Map<number, string>();
    for (const nf of children(s, 'numFmts').flatMap((n) => children(n, 'numFmt'))) custom.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') ?? '');
    children(s, 'cellXfs')
      .flatMap((x) => children(x, 'xf'))
      .forEach((xf, i) => {
        const id = Number(attr(xf, 'numFmtId') ?? 0);
        const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*]/g, '') ?? '';
        if (DATE_FORMATS.has(id) || /[dmyhs]/i.test(code)) dateStyles.add(i);
      });
  }
  const rels = new Map<string, string>();
  const relsXml = read('xl/_rels/workbook.xml.rels');
  if (relsXml) for (const r of children(root(relsXml), 'Relationship')) rels.set(attr(r, 'Id') ?? '', attr(r, 'Target') ?? '');
  const sheets: Sheet[] = [];
  let cells = 0;
  for (const sheet of children(root(workbook), 'sheets').flatMap((s) => children(s, 'sheet'))) {
    const target = rels.get(attr(sheet, 'id') ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = read(path);
    if (!xml) continue;
    const rows: Cell[][] = [];
    const data = children(root(xml), 'sheetData')[0];
    for (const row of data ? children(data, 'row') : []) {
      const rowIndex = Number(attr(row, 'r') ?? rows.length + 1) - 1;
      const values: Cell[] = [];
      for (const c of children(row, 'c')) {
        if (++cells > maxCells) throw new Error('Spreadsheet too large');
        const col = columnIndex(attr(c, 'r') ?? columnName(values.length));
        const type = attr(c, 't');
        const v = children(c, 'v')[0];
        const raw = v ? textOf(v) : '';
        let value: Cell = null;
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = children(c, 'is').map(textOf).join('');
        else if (type === 'b') value = raw === '1';
        else if (type === 'str' || type === 'e') value = raw;
        else if (raw !== '') {
          const n = Number(raw);
          value = dateStyles.has(Number(attr(c, 's') ?? -1)) && Number.isFinite(n) ? excelDate(n) : n;
        }
        values[col] = value;
      }
      rows[rowIndex] = Array.from({ length: values.length }, (_, i) => values[i] ?? null);
    }
    sheets.push({ name: attr(sheet, 'name') ?? `Sheet${sheets.length + 1}`, rows: Array.from({ length: rows.length }, (_, i) => rows[i] ?? []) });
  }
  if (!sheets.length) throw new Error('No worksheets found');
  return sheets;
}
