import { describe, expect, it } from 'vitest';
import { formatJson, minifyJson, validateJson } from '../../src/engines/data/json';
import { csvToJson, detectDelimiter, jsonToCsv, parseCsv } from '../../src/engines/data/csv';
import { formatXml, parseXml, xmlToJson, XmlParseError } from '../../src/engines/data/xml';
import { base64ToBytes, base64ToText, bytesToBase64, parseDataUrl, textToBase64, urlDecode, urlEncode, UrlDecodeError } from '../../src/engines/data/encoding';

describe('JSON', () => {
  it('formats without changing values (big integers preserved)', () => {
    const r = formatJson('{"id":12345678901234567890,"s":"a\\"b","arr":[1,{}],"e":[]}', 2);
    expect(r.ok && r.output).toBe('{\n  "id": 12345678901234567890,\n  "s": "a\\"b",\n  "arr": [\n    1,\n    {}\n  ],\n  "e": []\n}');
  });
  it('minifies', () => {
    const r = minifyJson('{\n  "a": "x y",\n  "b": [1, 2]\n}');
    expect(r.ok && r.output).toBe('{"a":"x y","b":[1,2]}');
  });
  it('reports error positions', () => {
    const e = validateJson('{\n  "a": 1,\n  "b": }');
    expect(e).not.toBeNull();
    expect(e!.line).toBe(3);
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes and newlines', () => {
    expect(parseCsv('a,"b ""q""","c\nd"\n1,2,3', ',')).toEqual([
      ['a', 'b "q"', 'c\nd'],
      ['1', '2', '3'],
    ]);
  });
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });
  it('converts CSV to JSON with headers and types', () => {
    const r = csvToJson('name;age;vip\nAna;31;true\n"Rui; Jr.";007;false', { delimiter: 'auto', header: true, inferTypes: true });
    expect(JSON.parse(r.json)).toEqual([
      { name: 'Ana', age: 31, vip: true },
      { name: 'Rui; Jr.', age: '007', vip: false },
    ]);
  });
  it('converts JSON to CSV, flattening objects and escaping', () => {
    const r = jsonToCsv('[{"a":1,"b":{"c":"x,y"}},{"a":2,"d":"=cmd()"}]', { delimiter: ',', escapeFormulas: true, bom: false });
    expect(r.ok && r.csv).toBe('a,b.c,d\r\n1,"x,y",\r\n2,,\'=cmd()\r\n');
  });
  it('unwraps a single array property', () => {
    const r = jsonToCsv('{"items":[{"x":1},{"x":2}]}', { delimiter: ';', escapeFormulas: false, bom: true });
    expect(r.ok && r.csv).toBe('\uFEFFx\r\n1\r\n2\r\n');
  });
});

describe('XML', () => {
  it('formats XML', () => {
    expect(formatXml('<a x="1"><b>t</b><c/></a>')).toBe('<a x="1">\n  <b>t</b>\n  <c/>\n</a>\n');
  });
  it('converts XML to JSON', () => {
    const json = JSON.parse(xmlToJson('<lib><book id="1"><t>A</t></book><book id="2"><t>B</t></book></lib>'));
    expect(json).toEqual({ lib: { book: [{ '@id': '1', t: 'A' }, { '@id': '2', t: 'B' }] } });
  });
  it('reports mismatched tags with position', () => {
    expect(() => parseXml('<a>\n<b></a>')).toThrow(XmlParseError);
  });
  it('never expands custom entities (XXE safe)', () => {
    const doc = '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;&amp;</x>';
    expect(JSON.parse(xmlToJson(doc))).toEqual({ x: '&e;&' });
  });
});

describe('Base64 and URL', () => {
  it('round-trips unicode text', () => {
    const b = textToBase64('Olá, mundo! 🎉');
    expect(base64ToText(b).text).toBe('Olá, mundo! 🎉');
    expect(textToBase64('??>', true)).toBe('Pz8-');
  });
  it('accepts URL-safe input and missing padding', () => {
    expect(Array.from(base64ToBytes('Pz8-'))).toEqual([63, 63, 62]);
  });
  it('rejects invalid characters', () => {
    expect(() => base64ToBytes('abc$')).toThrow();
  });
  it('encodes large binary data in chunks', () => {
    const data = new Uint8Array(300_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
  });
  it('detects binary data when decoding to text', () => {
    expect(base64ToText(bytesToBase64(new Uint8Array([0xff, 0xfe, 0x00, 0x80]))).text).toBeNull();
  });
  it('parses data URLs', () => {
    expect(parseDataUrl('data:image/png;base64,AAAA')).toEqual({ mime: 'image/png', payload: 'AAAA' });
  });
  it('URL encodes and decodes', () => {
    expect(urlEncode('café & more', 'component')).toBe('caf%C3%A9%20%26%20more');
    expect(urlEncode('https://x.pt/a b?q=1', 'full')).toBe('https://x.pt/a%20b?q=1');
    expect(urlDecode('a+b%20c', true)).toBe('a b c');
    expect(() => urlDecode('ok%E0%A4%A', false)).toThrow(UrlDecodeError);
  });
});
