import { useCallback } from 'preact/hooks';
import { jsonToYaml, yamlToJson } from '../../engines/data/yaml';
import { markdownToHtml } from '../../engines/data/markdown';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { Checkbox } from '../../ui/components/controls';
import { navigate, toolHref } from '../../app/router';
import { useSession } from '../shared/session';
import { TextTool, type TextResult } from './TextTool';
import { IndentSelect, spaces, type Indent } from './DataTools';

/** YAML ↔ JSON (multi-document YAML becomes a JSON array). */
export function YamlTool({ tool }: ToolProps) {
  useI18n();
  const mode = (tool.preset?.mode as 'to-json' | 'from-json' | undefined) ?? 'to-json';
  const [indent, setIndent] = useSession<Indent>('yaml', 'indent', '2');
  const process = useCallback(
    (input: string, m: 'to-json' | 'from-json'): TextResult => {
      const r = m === 'to-json' ? yamlToJson(input, spaces(indent)) : jsonToYaml(input);
      return r.ok ? { ok: true, output: r.output, info: m === 'to-json' ? t('data.validYaml') : t('data.validJson') } : { ok: false, message: r.error.message, line: r.error.line, column: r.error.column };
    },
    [indent],
  );
  return (
    <TextTool
      tool={tool}
      mode={mode}
      modes={[
        { value: 'to-json', label: 'YAML → JSON' },
        { value: 'from-json', label: 'JSON → YAML' },
      ]}
      onMode={(m) => navigate(toolHref(m === 'to-json' ? 'yaml-to-json' : 'json-to-yaml'))}
      process={process}
      options={mode === 'to-json' ? <IndentSelect value={indent} onChange={setIndent} /> : undefined}
      outputName={mode === 'to-json' ? 'data.json' : 'data.yaml'}
      outputMime={mode === 'to-json' ? 'application/json' : 'application/yaml'}
      placeholder={mode === 'to-json' ? 'name: Convertly\nprivate: true\ntools:\n  - pdf\n  - image' : '{"name": "Convertly", "tools": ["pdf", "image"]}'}
      accept={mode === 'to-json' ? '.yaml,.yml,.txt,text/yaml,text/plain' : '.json,.txt,application/json'}
      scope={`yaml-${mode}`}
    />
  );
}

/** Markdown → standalone HTML document (or an HTML fragment). */
export function MarkdownTool({ tool }: ToolProps) {
  useI18n();
  const [standalone, setStandalone] = useSession<boolean>('markdown', 'standalone', true);
  const process = useCallback(
    (input: string): TextResult => ({ ok: true, output: markdownToHtml(input, 'Document', standalone), info: t('data.markdownInfo') }),
    [standalone],
  );
  return (
    <TextTool
      tool={tool}
      mode="convert"
      process={process}
      options={<Checkbox checked={standalone} onChange={setStandalone} label={t('data.standalone')} />}
      outputName={standalone ? 'document.html' : 'fragment.html'}
      outputMime="text/html"
      placeholder={'# Title\n\nSome **bold** text and a [link](#notes).\n\n- one\n- two'}
      accept=".md,.markdown,.txt,text/markdown,text/plain"
      wrap
    />
  );
}
