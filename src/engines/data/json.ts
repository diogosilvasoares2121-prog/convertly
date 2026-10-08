/**
 * JSON tools. Formatting/minifying is token based, so numbers and strings are
 * preserved byte-for-byte (no precision loss on big integers, no key reordering).
 */

export interface JsonError {
  message: string;
  position: number | null;
  line: number | null;
  column: number | null;
}

export type JsonResult = { ok: true; output: string } | { ok: false; error: JsonError };

function locate(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}

/**
 * Finds the offset of the first syntax error with a small recursive-descent scanner.
 * Used because engine error messages do not always include a position.
 */
export function findJsonErrorOffset(text: string): number {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail();
  };
  const string = () => {
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail();
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) i += 2;
        else {
          i++;
          fail();
        }
      } else if (ch < ' ') fail();
      else i++;
    }
    fail();
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || !m[0]) fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string();
        ws();
        if (text[i] !== ':') fail();
        i++;
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return;
        }
        fail();
      }
    } else if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return;
        }
        fail();
      }
    } else if (ch === '"') string();
    else if (ch === 't') literal('true');
    else if (ch === 'f') literal('false');
    else if (ch === 'n') literal('null');
    else if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) number();
    else fail();
  };
  try {
    value();
    ws();
    return i < text.length ? i : -1;
  } catch (pos) {
    return typeof pos === 'number' ? Math.min(pos, text.length) : 0;
  }
}

/** Validates JSON and returns a precise error location when invalid. */
export function validateJson(text: string): JsonError | null {
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!text.trim()) return { message: 'Empty input', position: 0, line: 1, column: 1 };
    const lc = /line (\d+) column (\d+)/.exec(message);
    const pos = /position (\d+)/.exec(message);
    const position = pos ? Number(pos[1]) : findJsonErrorOffset(text);
    if (lc) return { message, position, line: Number(lc[1]), column: Number(lc[2]) };
    if (position >= 0) return { message, position, ...locate(text, position) };
    return { message, position: null, line: null, column: null };
  }
}

/** Re-indents valid JSON. `indent` is a number of spaces or '\t'. */
export function formatJson(text: string, indent: number | '\t' = 2): JsonResult {
  const input = text.replace(/^\uFEFF/, '');
  const error = validateJson(input);
  if (error) return { ok: false, error };
  const unit = indent === '\t' ? '\t' : ' '.repeat(indent);
  let out = '';
  let depth = 0;
  let inString = false;
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const ch = input[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += input[++i] ?? '';
      } else if (ch === '"') inString = false;
      continue;
    }
    switch (ch) {
      case '"':
        inString = true;
        out += ch;
        break;
      case '{':
      case '[': {
        // Keep empty containers compact: {} and []
        let j = i + 1;
        while (j < n && /\s/.test(input[j]!)) j++;
        const close = ch === '{' ? '}' : ']';
        if (input[j] === close) {
          out += ch + close;
          i = j;
        } else {
          depth++;
          out += ch + '\n' + unit.repeat(depth);
        }
        break;
      }
      case '}':
      case ']':
        depth--;
        out += '\n' + unit.repeat(depth) + ch;
        break;
      case ',':
        out += ',\n' + unit.repeat(depth);
        break;
      case ':':
        out += ': ';
        break;
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        break;
      default:
        out += ch;
    }
  }
  return { ok: true, output: out };
}

export function minifyJson(text: string): JsonResult {
  const input = text.replace(/^\uFEFF/, '');
  const error = validateJson(input);
  if (error) return { ok: false, error };
  let out = '';
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') out += input[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (!/\s/.test(ch)) out += ch;
  }
  return { ok: true, output: out };
}

/**
 * JSON.parse that keeps integers beyond Number.MAX_SAFE_INTEGER as strings
 * (uses the reviver source-text access available in modern Chrome/Node).
 */
export function parseJsonSafe(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ''), function (this: unknown, _key: string, value: unknown, context?: { source?: string }) {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value) && context?.source) return context.source;
    return value;
  } as (this: unknown, key: string, value: unknown) => unknown);
}
