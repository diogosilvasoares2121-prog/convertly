/**
 * Small, safe, non-validating XML parser used for formatting and XML → JSON.
 * - Never fetches anything and never expands custom entities (no XXE, no "billion laughs").
 * - DOCTYPE declarations are kept verbatim when formatting and ignored when converting.
 */

export interface XmlElement {
  type: 'element';
  name: string;
  attributes: Array<[string, string]>;
  children: XmlNode[];
}
export type XmlNode =
  | XmlElement
  | { type: 'text'; value: string }
  | { type: 'cdata'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'pi'; value: string }
  | { type: 'doctype'; value: string };

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'XmlParseError';
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith('#x')) {
      const cp = parseInt(body.slice(2), 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    if (body.startsWith('#')) {
      const cp = parseInt(body.slice(1), 10);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[body] ?? m; // unknown entities are left untouched
  });
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

export function parseXml(input: string): XmlNode[] {
  const text = input.replace(/^\uFEFF/, '');
  let i = 0;
  const position = (at: number) => {
    let line = 1;
    let col = 1;
    for (let k = 0; k < at; k++) {
      if (text[k] === '\n') {
        line++;
        col = 1;
      } else col++;
    }
    return { line, col };
  };
  const fail = (message: string, at = i): never => {
    const p = position(at);
    throw new XmlParseError(message, p.line, p.col);
  };

  const root: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const push = (node: XmlNode) => (stack.length ? stack[stack.length - 1]!.children : root).push(node);
  const NAME = /[A-Za-z_:À-￿][\w:.\-·À-￿]*/y;

  while (i < text.length) {
    if (text[i] !== '<') {
      const end = text.indexOf('<', i);
      const raw = text.slice(i, end < 0 ? text.length : end);
      if (raw.trim()) {
        if (!stack.length) fail('Text outside the root element');
        push({ type: 'text', value: decodeEntities(raw) });
      }
      i = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) fail('Unclosed comment');
      push({ type: 'comment', value: text.slice(i + 4, end) });
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end < 0) fail('Unclosed CDATA section');
      push({ type: 'cdata', value: text.slice(i + 9, end) });
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) fail('Unclosed processing instruction');
      push({ type: 'pi', value: text.slice(i + 2, end) });
      i = end + 2;
    } else if (text.startsWith('<!DOCTYPE', i) || text.startsWith('<!doctype', i)) {
      let depth = 0;
      let k = i;
      for (; k < text.length; k++) {
        if (text[k] === '[') depth++;
        else if (text[k] === ']') depth--;
        else if (text[k] === '>' && depth <= 0) break;
      }
      if (k >= text.length) fail('Unclosed DOCTYPE');
      push({ type: 'doctype', value: text.slice(i + 2, k) });
      i = k + 1;
    } else if (text[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text);
      if (!m) fail('Invalid closing tag');
      const name = m![0];
      const close = text.indexOf('>', i);
      if (close < 0) fail('Unclosed tag');
      const open = stack.pop();
      if (!open) fail(`Unexpected closing tag </${name}>`);
      if (open!.name !== name) fail(`Expected </${open!.name}> but found </${name}>`);
      i = close + 1;
    } else {
      const start = i;
      NAME.lastIndex = i + 1;
      const m = NAME.exec(text);
      if (!m) fail('Invalid tag name');
      const el: XmlElement = { type: 'element', name: m![0], attributes: [], children: [] };
      i = NAME.lastIndex;
      for (;;) {
        while (/\s/.test(text[i] ?? '')) i++;
        if (i >= text.length) fail('Unclosed tag', start);
        if (text[i] === '/' && text[i + 1] === '>') {
          i += 2;
          if (!stack.length && root.some((n) => n.type === 'element')) fail('Multiple root elements', start);
          push(el);
          break;
        }
        if (text[i] === '>') {
          i++;
          if (!stack.length && root.some((n) => n.type === 'element')) fail('Multiple root elements', start);
          push(el);
          stack.push(el);
          break;
        }
        NAME.lastIndex = i;
        const attr = NAME.exec(text);
        if (!attr) fail('Invalid attribute');
        i = NAME.lastIndex;
        while (/\s/.test(text[i] ?? '')) i++;
        if (text[i] !== '=') fail(`Attribute "${attr![0]}" has no value`);
        i++;
        while (/\s/.test(text[i] ?? '')) i++;
        const quote = text[i];
        if (quote !== '"' && quote !== "'") fail('Attribute value must be quoted');
        const end = text.indexOf(quote!, i + 1);
        if (end < 0) fail('Unclosed attribute value');
        if (el.attributes.some(([n]) => n === attr![0])) fail(`Duplicate attribute "${attr![0]}"`);
        el.attributes.push([attr![0], decodeEntities(text.slice(i + 1, end))]);
        i = end + 1;
      }
    }
  }
  if (stack.length) fail(`Unclosed element <${stack[stack.length - 1]!.name}>`, text.length);
  if (!root.some((n) => n.type === 'element')) fail('No root element', 0);
  return root;
}

export function formatXml(input: string, indent: number | '\t' = 2): string {
  const nodes = parseXml(input);
  const unit = indent === '\t' ? '\t' : ' '.repeat(indent);
  const lines: string[] = [];
  const write = (node: XmlNode, depth: number) => {
    const pad = unit.repeat(depth);
    switch (node.type) {
      case 'text':
        lines.push(pad + escapeText(node.value.trim()));
        break;
      case 'cdata':
        lines.push(`${pad}<![CDATA[${node.value}]]>`);
        break;
      case 'comment':
        lines.push(`${pad}<!--${node.value}-->`);
        break;
      case 'pi':
        lines.push(`${pad}<?${node.value}?>`);
        break;
      case 'doctype':
        lines.push(`${pad}<!${node.value}>`);
        break;
      case 'element': {
        const attrs = node.attributes.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
        if (!node.children.length) {
          lines.push(`${pad}<${node.name}${attrs}/>`);
        } else if (node.children.length === 1 && node.children[0]!.type === 'text') {
          lines.push(`${pad}<${node.name}${attrs}>${escapeText(node.children[0]!.value.trim())}</${node.name}>`);
        } else {
          lines.push(`${pad}<${node.name}${attrs}>`);
          for (const child of node.children) write(child, depth + 1);
          lines.push(`${pad}</${node.name}>`);
        }
        break;
      }
    }
  };
  for (const n of nodes) write(n, 0);
  return lines.join('\n') + '\n';
}

function elementToJson(el: XmlElement): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of el.attributes) obj[`@${k}`] = v;
  const texts: string[] = [];
  for (const child of el.children) {
    if (child.type === 'text' || child.type === 'cdata') {
      if (child.value.trim()) texts.push(child.value.trim());
    } else if (child.type === 'element') {
      const value = elementToJson(child);
      const existing = obj[child.name];
      if (existing === undefined) obj[child.name] = value;
      else if (Array.isArray(existing) && (existing as unknown[] & { __multi?: true }).__multi) (existing as unknown[]).push(value);
      else {
        const arr = [existing, value] as unknown[] & { __multi?: true };
        Object.defineProperty(arr, '__multi', { value: true, enumerable: false });
        obj[child.name] = arr;
      }
    }
  }
  const keys = Object.keys(obj);
  if (!keys.length) return texts.length ? texts.join(' ') : '';
  if (texts.length) obj['#text'] = texts.join(' ');
  return obj;
}

/** Makes a string a valid XML element name. */
function elementName(key: string): string {
  let name = key.replace(/[^\w.\-:À-￿]/g, '_');
  if (!/^[A-Za-z_À-￿]/.test(name)) name = `_${name}`;
  return name || 'item';
}

/**
 * Converts JSON into XML using the same conventions as xmlToJson:
 * "@name" keys become attributes, "#text" becomes text content, arrays repeat the element.
 */
export function jsonToXml(value: unknown, rootName = 'root', indent = 2): string {
  const unit = ' '.repeat(indent);
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const write = (name: string, v: unknown, depth: number) => {
    const pad = unit.repeat(depth);
    const tag = elementName(name);
    if (Array.isArray(v)) {
      for (const item of v) write(name, item, depth);
      return;
    }
    if (v === null || v === undefined) {
      lines.push(`${pad}<${tag}/>`);
      return;
    }
    if (typeof v !== 'object') {
      lines.push(`${pad}<${tag}>${escapeText(String(v))}</${tag}>`);
      return;
    }
    const entries = Object.entries(v as Record<string, unknown>);
    const attrs = entries
      .filter(([k, x]) => k.startsWith('@') && (x === null || typeof x !== 'object'))
      .map(([k, x]) => ` ${elementName(k.slice(1))}="${escapeAttr(String(x ?? ''))}"`)
      .join('');
    const text = entries.find(([k]) => k === '#text')?.[1];
    const children = entries.filter(([k]) => !k.startsWith('@') && k !== '#text');
    if (!children.length) {
      lines.push(text === undefined ? `${pad}<${tag}${attrs}/>` : `${pad}<${tag}${attrs}>${escapeText(String(text))}</${tag}>`);
      return;
    }
    lines.push(`${pad}<${tag}${attrs}>`);
    if (text !== undefined) lines.push(`${pad}${unit}${escapeText(String(text))}`);
    for (const [k, x] of children) write(k, x, depth + 1);
    lines.push(`${pad}</${tag}>`);
  };
  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = isPlainObject ? Object.keys(value as object) : [];
  if (isPlainObject && keys.length === 1 && !keys[0]!.startsWith('@')) write(keys[0]!, (value as Record<string, unknown>)[keys[0]!], 0);
  else if (Array.isArray(value)) {
    lines.push(`<${elementName(rootName)}>`);
    for (const item of value) write('item', item, 1);
    lines.push(`</${elementName(rootName)}>`);
  } else write(rootName, value, 0);
  return lines.join('\n') + '\n';
}

/** Converts XML into JSON: attributes become "@name", mixed text becomes "#text", repeated tags become arrays. */
export function xmlToJson(input: string): string {
  const nodes = parseXml(input);
  const root = nodes.find((n): n is XmlElement => n.type === 'element')!;
  return JSON.stringify({ [root.name]: elementToJson(root) }, null, 2);
}
