import { parse, stringify, YAMLParseError } from 'yaml';
import { parseJsonSafe, validateJson, type JsonError } from './json';

/** YAML ↔ JSON with the `yaml` library (ISC). Alias expansion is capped (no "billion laughs"). */
export type ConvertResult = { ok: true; output: string } | { ok: false; error: JsonError };

export function yamlToJson(text: string, indent = 2): ConvertResult {
  try {
    const docs = text.split(/^---\s*$/m).filter((d) => d.trim());
    const values = (docs.length > 1 ? docs : [text]).map((d) => parse(d, { maxAliasCount: 100, prettyErrors: true, uniqueKeys: true }) as unknown);
    const value = values.length > 1 ? values : values[0];
    return { ok: true, output: JSON.stringify(value ?? null, null, indent) };
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const pos = err.linePos?.[0];
      return { ok: false, error: { message: err.message.split('\n')[0] ?? err.message, position: err.pos[0], line: pos?.line ?? null, column: pos?.col ?? null } };
    }
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err), position: null, line: null, column: null } };
  }
}

export function jsonToYaml(text: string): ConvertResult {
  const error = validateJson(text.replace(/^﻿/, ''));
  if (error) return { ok: false, error };
  return { ok: true, output: stringify(parseJsonSafe(text), { lineWidth: 0, aliasDuplicateObjects: false }) };
}
