import { useCallback } from 'preact/hooks';
import { formatJson, minifyJson, parseJsonSafe, validateJson } from '../../engines/data/json';
import { csvToJson, jsonToCsv, type Delimiter } from '../../engines/data/csv';
import { formatXml, jsonToXml, xmlToJson, XmlParseError } from '../../engines/data/xml';
import { urlDecode, urlEncode, UrlDecodeError, type UrlMode } from '../../engines/data/encoding';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { Checkbox, Select, TextInput } from '../../ui/components/controls';
import { navigate, toolHref } from '../../app/router';
import { useSession } from '../shared/session';
import { TextTool, type TextResult } from './TextTool';

export type Indent = '2' | '4' | 'tab';
const BOM = /^\uFEFF/;
export const indentValue = (i: Indent): number | '\t' => (i === 'tab' ? '\t' : Number(i));

export function IndentSelect({ value, onChange }: { value: Indent; onChange: (v: Indent) => void }) {
  return (
    <div style={{ minWidth: '160px' }}>
      <Select label={t('data.indent')} value={value} onChange={onChange} options={[{ value: '2', label: t('data.spaces', { n: 2 }) }, { value: '4', label: t('data.spaces', { n: 4 }) }, { value: 'tab', label: t('data.tab') }]} />
    </div>
  );
}

/** JSON formatter / minifier / validator. */
export function JsonTool({ tool }: ToolProps) {
  useI18n();
  const [indent, setIndent] = useSession<Indent>('json', 'indent', '2');
  const mode = (tool.preset?.mode as 'format' | 'minify' | undefined) ?? 'format';
  const process = useCallback(
    (input: string, m: 'format' | 'minify'): TextResult => {
      const r = m === 'minify' ? minifyJson(input) : formatJson(input, indentValue(indent));
      return r.ok ? { ok: true, output: r.output, info: t('data.validJson') } : { ok: false, message: r.error.message, line: r.error.line, column: r.error.column };
    },
    [indent],
  );
  return (
    <TextTool
      tool={tool}
      mode={mode}
      modes={[
        { value: 'format', label: t('data.format') },
        { value: 'minify', label: t('data.minify') },
      ]}
      onMode={(m) => navigate(toolHref(m === 'minify' ? 'json-minify' : 'json-format'))}
      process={process}
      options={mode === 'format' ? <IndentSelect value={indent} onChange={setIndent} /> : undefined}
      outputName={mode === 'minify' ? 'data.min.json' : 'data.json'}
      outputMime="application/json"
      placeholder='{"name": "Convertly", "private": true}'
      accept=".json,.txt,application/json,text/plain"
      scope="json"
    />
  );
}

/** JSON ↔ CSV. */
export function CsvTool({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as 'json-to-csv' | 'csv-to-json' | undefined) ?? 'json-to-csv';
  const [delimiter, setDelimiter] = useSession<Delimiter | 'auto'>('csv', `delimiter-${mode}`, mode === 'csv-to-json' ? 'auto' : ',');
  const [header, setHeader] = useSession<boolean>('csv', 'header', true);
  const [infer, setInfer] = useSession<boolean>('csv', 'infer', true);
  const [formulas, setFormulas] = useSession<boolean>('csv', 'formulas', false);
  const [bom, setBom] = useSession<boolean>('csv', 'bom', false);
  const process = useCallback(
    (input: string, m: 'json-to-csv' | 'csv-to-json'): TextResult => {
      if (m === 'csv-to-json') {
        const r = csvToJson(input, { delimiter, header, inferTypes: infer });
        return { ok: true, output: r.json, info: t('data.tableInfo', { rows: r.rows, columns: r.columns }) };
      }
      const r = jsonToCsv(input, { delimiter: delimiter === 'auto' ? ',' : delimiter, escapeFormulas: formulas, bom });
      return r.ok ? { ok: true, output: r.csv, info: t('data.tableInfo', { rows: r.rows, columns: r.columns }) } : { ok: false, message: r.error.message, line: r.error.line, column: r.error.column };
    },
    [delimiter, header, infer, formulas, bom],
  );
  const delimiters = [
    ...(mode === 'csv-to-json' ? [{ value: 'auto' as const, label: t('data.autoDetect') }] : []),
    { value: ',' as const, label: t('data.comma') },
    { value: ';' as const, label: t('data.semicolon') },
    { value: '\t' as const, label: t('data.tab') },
    { value: '|' as const, label: '|' },
  ];
  return (
    <TextTool
      tool={tool}
      mode={mode}
      modes={[
        { value: 'json-to-csv', label: 'JSON → CSV' },
        { value: 'csv-to-json', label: 'CSV → JSON' },
      ]}
      onMode={(m) => navigate(toolHref(m))}
      process={process}
      options={
        <>
          <div style={{ minWidth: '170px' }}>
            <Select label={t('data.delimiter')} value={mode === 'json-to-csv' && delimiter === 'auto' ? ',' : delimiter} onChange={setDelimiter} options={delimiters} />
          </div>
          {mode === 'csv-to-json' ? (
            <>
              <Checkbox checked={header} onChange={setHeader} label={t('data.headerRow')} />
              <Checkbox checked={infer} onChange={setInfer} label={t('data.inferTypes')} />
            </>
          ) : (
            <>
              <Checkbox checked={formulas} onChange={setFormulas} label={t('data.escapeFormulas')} />
              <Checkbox checked={bom} onChange={setBom} label={t('data.excelBom')} />
            </>
          )}
        </>
      }
      outputName={mode === 'csv-to-json' ? 'data.json' : 'data.csv'}
      outputMime={mode === 'csv-to-json' ? 'application/json' : 'text/csv'}
      placeholder={mode === 'csv-to-json' ? 'name,city\nAna,Lisboa\nRui,Porto' : '[{"name":"Ana","city":"Lisboa"}]'}
      accept={mode === 'csv-to-json' ? '.csv,.tsv,.txt,text/csv,text/plain' : '.json,.txt,application/json'}
    />
  );
}

type XmlMode = 'format' | 'to-json' | 'from-json';
const XML_TOOL: Record<XmlMode, string> = { format: 'xml-format', 'to-json': 'xml-to-json', 'from-json': 'json-to-xml' };
export const spaces = (i: Indent): number => (i === 'tab' ? 2 : Number(i));

/** XML formatter / XML → JSON / JSON → XML. */
export function XmlTool({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as XmlMode | undefined) ?? 'format';
  const [indent, setIndent] = useSession<Indent>('xml', 'indent', '2');
  const [root, setRoot] = useSession<string>('xml', 'root', 'root');
  const process = useCallback(
    (input: string, m: XmlMode): TextResult => {
      try {
        if (m === 'from-json') {
          const error = validateJson(input.replace(BOM, ''));
          if (error) return { ok: false, message: error.message, line: error.line, column: error.column };
          return { ok: true, output: jsonToXml(parseJsonSafe(input), root.trim() || 'root', spaces(indent)) };
        }
        return m === 'to-json' ? { ok: true, output: xmlToJson(input) } : { ok: true, output: formatXml(input, indentValue(indent)), info: t('data.validXml') };
      } catch (err) {
        if (err instanceof XmlParseError) return { ok: false, message: err.message, line: err.line, column: err.column };
        throw err;
      }
    },
    [indent, root],
  );
  return (
    <TextTool
      tool={tool}
      mode={mode}
      modes={[
        { value: 'format', label: t('data.format') },
        { value: 'to-json', label: 'XML → JSON' },
        { value: 'from-json', label: 'JSON → XML' },
      ]}
      onMode={(m) => navigate(toolHref(XML_TOOL[m]))}
      process={process}
      options={
        mode === 'format' ? (
          <IndentSelect value={indent} onChange={setIndent} />
        ) : mode === 'from-json' ? (
          <div style={{ minWidth: '220px' }}>
            <TextInput label={t('data.rootName')} value={root} onChange={setRoot} mono hint={t('data.rootHint')} />
          </div>
        ) : undefined
      }
      outputName={mode === 'to-json' ? 'data.json' : 'data.xml'}
      outputMime={mode === 'to-json' ? 'application/json' : 'application/xml'}
      placeholder={mode === 'from-json' ? '{"note": {"@lang": "pt", "to": "Ana", "body": "Olá"}}' : '<note><to>Ana</to><body>Hello</body></note>'}
      accept={mode === 'from-json' ? '.json,.txt,application/json' : '.xml,.svg,.txt,application/xml,text/xml,text/plain'}
      scope={mode === 'from-json' ? 'json-xml' : 'xml'}
    />
  );
}

/** URL encode / decode. */
export function UrlTool({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as 'encode' | 'decode' | undefined) ?? 'encode';
  const [scope, setScope] = useSession<UrlMode>('url', 'scope', 'component');
  const [plus, setPlus] = useSession<boolean>('url', 'plus', false);
  const process = useCallback(
    (input: string, m: 'encode' | 'decode'): TextResult => {
      if (m === 'encode') return { ok: true, output: urlEncode(input, scope) };
      try {
        return { ok: true, output: urlDecode(input, plus) };
      } catch (err) {
        if (err instanceof UrlDecodeError) return { ok: false, message: t('data.urlMalformed', { position: err.position + 1 }) };
        throw err;
      }
    },
    [scope, plus],
  );
  return (
    <TextTool
      tool={tool}
      mode={mode}
      modes={[
        { value: 'encode', label: t('data.encode') },
        { value: 'decode', label: t('data.decode') },
      ]}
      onMode={(m) => navigate(toolHref(m === 'decode' ? 'url-decode' : 'url-encode'))}
      process={process}
      wrap
      options={
        mode === 'encode' ? (
          <div style={{ minWidth: '240px' }}>
            <Select label={t('data.urlScope')} value={scope} onChange={setScope} options={[{ value: 'component', label: t('data.urlComponent') }, { value: 'full', label: t('data.urlFull') }]} />
          </div>
        ) : (
          <Checkbox checked={plus} onChange={setPlus} label={t('data.plusSpace')} />
        )
      }
      outputName={mode === 'encode' ? 'encoded.txt' : 'decoded.txt'}
      outputMime="text/plain"
      placeholder={mode === 'encode' ? 'café & more/?q=1' : 'caf%C3%A9%20%26%20more'}
      accept=".txt,text/plain"
      scope="url"
    />
  );
}
