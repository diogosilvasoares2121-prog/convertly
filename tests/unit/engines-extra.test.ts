import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { gunzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { hashBytes, hashBlob } from '../../src/engines/data/hash';
import { buildIco, readIcoSizes } from '../../src/engines/image/ico';
import { createTar } from '../../src/engines/archive/tar';
import { readXlsx, writeXlsx, columnIndex, columnName } from '../../src/engines/data/xlsx';
import { yamlToJson, jsonToYaml } from '../../src/engines/data/yaml';
import { jsonToXml, xmlToJson } from '../../src/engines/data/xml';
import { markdownToHtml } from '../../src/engines/data/markdown';
import { addPageNumbers, addPdfWatermark, cropPdf, repairPdf, textToPdf, toWinAnsi } from '../../src/engines/pdf/edit';
import { assemblePdf } from '../../src/engines/pdf/ops';
import { svgSize } from '../../src/engines/image/svg';
import { atempoChain, audioEffect, changeSpeed, cropVideoToRatio, imagesToMotion, mergeAudio, mergeVideos, videoFrames, addAudioToVideo, convertAudio } from '../../src/engines/ffmpeg/commands';
import type { MediaInfo } from '../../src/engines/ffmpeg/probe';
import { resolveFormat } from '../../src/core/detect';
import { fixture } from './helpers';

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  container: 'mp4',
  duration: 10,
  bitrate: 1e6,
  video: { codec: 'h264', width: 1920, height: 1080, fps: 30, rotation: 0, bitrate: null },
  audio: { codec: 'aac', sampleRate: 44100, channels: 2, bitrate: 128000 },
  audioStreams: 1,
  videoStreams: 1,
  ...over,
});

describe('hashing', () => {
  const vectors: Array<[string, Record<'md5' | 'sha1' | 'sha256', string>]> = [
    ['', { md5: 'd41d8cd98f00b204e9800998ecf8427e', sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }],
    ['abc', { md5: '900150983cd24fb0d6963f7d28e17f72', sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }],
  ];
  for (const [input, expected] of vectors) {
    it(`known vectors for "${input}"`, () => {
      const data = new TextEncoder().encode(input);
      expect(hashBytes(data, 'md5')).toBe(expected.md5);
      expect(hashBytes(data, 'sha1')).toBe(expected.sha1);
      expect(hashBytes(data, 'sha256')).toBe(expected.sha256);
    });
  }
  it('matches Node crypto on a real file streamed in chunks', async () => {
    const bytes = fixture('sample.mp4');
    const result = await hashBlob(new Blob([bytes as BlobPart]), ['md5', 'sha1', 'sha256']);
    for (const algo of ['md5', 'sha1', 'sha256'] as const) expect(result[algo]).toBe(createHash(algo).update(bytes).digest('hex'));
  });
});

describe('ICO', () => {
  it('builds a multi-size icon', () => {
    const png = fixture('sample.png');
    const ico = buildIco([{ size: 32, png }, { size: 16, png }, { size: 256, png }]);
    expect(readIcoSizes(ico)).toEqual([16, 32, 256]);
    expect(resolveFormat('favicon.ico', '', ico.subarray(0, 64)).format).toBe('ico');
  });
});

describe('TAR', () => {
  it('writes ustar entries with PAX headers for unicode names', async () => {
    const tar = new Uint8Array(await (await createTar([{ path: 'docs/readme.txt', blob: new Blob(['hello']) }, { path: 'fotos/ação 🎉.txt', blob: new Blob(['x'.repeat(600)]) }])).arrayBuffer());
    expect(tar.length % 512).toBe(0);
    expect(new TextDecoder().decode(tar.subarray(257, 262))).toBe('ustar');
    expect(new TextDecoder().decode(tar.subarray(0, 15))).toBe('docs/readme.txt');
    expect(new TextDecoder().decode(tar)).toContain('path=fotos/ação 🎉.txt');
    expect(resolveFormat('x.tar', '', tar.subarray(0, 4096)).format).toBe('tar');
  });
});

describe('XLSX', () => {
  it('round-trips values', () => {
    const rows = [
      ['Name', 'City', 'Age', 'VIP'],
      ['Ana', 'Lisboa', 31, true],
      ['Rui "Jr"', 'São Paulo <SP>', '007', false],
    ];
    const xlsx = writeXlsx(rows, 'Pessoas');
    expect(resolveFormat('t.xlsx', '', xlsx.subarray(0, 64)).format).toBe('xlsx');
    const [sheet] = readXlsx(xlsx);
    expect(sheet!.name).toBe('Pessoas');
    expect(sheet!.rows).toEqual([
      ['Name', 'City', 'Age', 'VIP'],
      ['Ana', 'Lisboa', 31, true],
      ['Rui "Jr"', 'São Paulo <SP>', '007', false],
    ]);
  });
  it('column helpers', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(27)).toBe('AB');
    expect(columnIndex('AB12')).toBe(27);
  });
  it('rejects non-xlsx data', () => {
    expect(() => readXlsx(fixture('sample.zip'))).toThrow();
  });
});

describe('YAML / XML / Markdown', () => {
  it('converts YAML to JSON and back', () => {
    const r = yamlToJson('name: Convertly\nformats:\n  - jpg\n  - pdf\nprivate: true\n');
    expect(r.ok && JSON.parse(r.output)).toEqual({ name: 'Convertly', formats: ['jpg', 'pdf'], private: true });
    const y = jsonToYaml('{"a":1,"b":["x","y"]}');
    expect(y.ok && y.output).toBe('a: 1\nb:\n  - x\n  - y\n');
  });
  it('reports YAML errors with a line and blocks alias bombs', () => {
    const r = yamlToJson('a: [1, 2\nb: 3');
    expect(r.ok).toBe(false);
    const bomb = 'a: &a [x,x,x,x,x,x,x,x,x]\n' + Array.from({ length: 12 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(',')}]`).join('\n');
    expect(yamlToJson(bomb).ok).toBe(false);
  });
  it('converts JSON to XML and back', () => {
    const xml = jsonToXml({ library: { book: [{ '@id': '1', title: 'A & B' }, { '@id': '2', title: 'C' }] } });
    expect(xml).toContain('<book id="1">');
    expect(xml).toContain('<title>A &amp; B</title>');
    expect(JSON.parse(xmlToJson(xml))).toEqual({ library: { book: [{ '@id': '1', title: 'A & B' }, { '@id': '2', title: 'C' }] } });
  });
  it('renders Markdown to a standalone HTML document', () => {
    const html = markdownToHtml('# Título\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', 'doc');
    expect(html).toContain('<title>Título</title>');
    expect(html).toContain('<table>');
  });
});

describe('PDF editing', () => {
  const pages = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();
  it('maps text to WinAnsi', () => {
    expect(toWinAnsi('Olá ção €5 🎉 日本')).toEqual({ text: 'Olá ção €5 ? ??', replaced: 3 });
  });
  it('adds page numbers, watermark, crop and repair keeping the page count', async () => {
    const src = fixture('sample.pdf');
    const numbered = await addPageNumbers(src, { position: 'bottom-center', format: 'page-n-of-total', start: 1, fontSize: 11, margin: 28, skipFirst: false, color: '#333333', pageWord: 'Página', ofWord: 'de' });
    expect(await pages(numbered)).toBe(3);
    const wm = await addPdfWatermark(src, { text: 'CONFIDENCIAL 🎉', fontSize: 60, opacity: 0.2, color: '#ff0000', layout: 'diagonal' });
    expect(wm.replaced).toBe(1);
    expect(await pages(wm.bytes)).toBe(3);
    const cropped = await cropPdf(src, { top: 50, right: 20, bottom: 50, left: 20 });
    const box = (await PDFDocument.load(cropped)).getPage(0).getCropBox();
    expect(Math.round(box.width)).toBe(595 - 40);
    const repaired = await repairPdf(src);
    expect(repaired.pages).toBe(3);
  });
  it('creates PDFs from text with wrapping and pagination', async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Linha ${i + 1} com acentuação e uma palavra muito ${'longa'.repeat(30)}`).join('\n');
    const r = await textToPdf(long, { pageSize: 'a4', fontSize: 11, margin: 50, font: 'sans', title: 'Teste' });
    expect(r.pages).toBeGreaterThan(5);
    expect(await pages(r.bytes)).toBe(r.pages);
  });
  it('inserts blank pages when assembling', async () => {
    const out = await assemblePdf([fixture('sample.pdf')], [{ src: 0, index: 0 }, { src: -1, index: 0 }, { src: 0, index: 2 }]);
    expect(await pages(out)).toBe(3);
  });
});

describe('FFmpeg commands (new tools)', () => {
  it('atempo chains stay within 0.5–2', () => {
    expect(atempoChain(4)).toBe('atempo=2,atempo=2');
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5');
    expect(atempoChain(1.5)).toBe('atempo=1.5');
  });
  it('builds frame extraction, speed, crop, merge, effects and slideshows', () => {
    const frames = videoFrames({ input: 'i.mp4', info: info(), everySeconds: 2, format: 'jpg', maxWidth: 1280, maxFrames: 100 });
    expect(frames.collect).toBe('frame-');
    expect(frames.args.join(' ')).toContain('fps=1/2');
    const speed = changeSpeed({ input: 'i.mp4', info: info(), format: 'mp4', speed: 2, kind: 'video', keepAudio: true, baseName: 'o' });
    expect(speed.args.join(' ')).toContain('setpts=PTS/2');
    expect(speed.duration).toBe(5);
    const crop = cropVideoToRatio({ input: 'i.mp4', info: info(), format: 'mp4', ratio: 1, baseName: 'o' });
    expect(crop.args.join(' ')).toContain('crop=1080:1080:420:0');
    const portrait = cropVideoToRatio({ input: 'i.mp4', info: info(), format: 'mp4', ratio: 9 / 16, baseName: 'o' });
    expect(portrait.args.join(' ')).toContain('crop=608:1080:656:0');
    const merged = mergeVideos([{ name: 'a.mp4', info: info() }, { name: 'b.mp4', info: info({ audio: null, duration: 4 }) }], { maxHeight: 720, baseName: 'o' });
    expect(merged.args.join(' ')).toContain('anullsrc');
    expect(merged.args.join(' ')).toContain('concat=n=2:v=1:a=1');
    expect(merged.duration).toBe(14);
    expect(mergeAudio([{ name: 'a.mp3', info: info() }, { name: 'b.wav', info: info() }], { target: 'mp3', bitrateKbps: 192, baseName: 'o' }).args.join(' ')).toContain('concat=n=2:v=0:a=1');
    expect(audioEffect({ input: 'a.mp3', info: info(), format: 'mp3', effect: { kind: 'fade', fadeIn: 2, fadeOut: 3 }, baseName: 'o' }).args.join(' ')).toContain('afade=t=out:st=7.000:d=3');
    expect(audioEffect({ input: 'a.mp3', info: info(), format: 'mp3', effect: { kind: 'normalize' }, baseName: 'o' }).args.join(' ')).toContain('loudnorm');
    expect(imagesToMotion({ count: 5, secondsPerImage: 2, format: 'mp4', loop: true, baseName: 'o' }).duration).toBe(10);
    const music = addAudioToVideo({ video: { name: 'v.mp4', info: info() }, audio: { name: 'm.mp3', info: info() }, mode: 'mix', musicVolume: 0.5, loop: true, shortest: true, baseName: 'o' });
    expect(music.args.join(' ')).toContain('amix=inputs=2');
    expect(music.args).toContain('-stream_loop');
  });
  it('audio conversion can force mono and a sample rate (disables stream copy)', () => {
    const c = convertAudio({ input: 'a.m4a', info: info(), target: 'm4a', bitrateKbps: 128, allowCopy: true, baseName: 'o', channels: 1, sampleRate: 22050 });
    expect(c.streamCopy).toBe(false);
    expect(c.args).toEqual(expect.arrayContaining(['-ac', '1', '-ar', '22050']));
  });
});

describe('SVG and new format detection', () => {
  it('reads SVG intrinsic size', () => {
    expect(svgSize('<svg width="120" height="40"></svg>')).toEqual({ width: 120, height: 40 });
    expect(svgSize('<svg viewBox="0 0 24 12"></svg>')).toEqual({ width: 24, height: 12 });
    expect(svgSize('<svg width="2in" viewBox="0 0 10 5"></svg>')).toEqual({ width: 192, height: 96 });
  });
  it('detects new formats', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(resolveFormat('logo.svg', '', enc('<?xml version="1.0"?>\n<svg xmlns="x"></svg>')).format).toBe('svg');
    expect(resolveFormat('logo.xml', '', enc('<svg xmlns="x"></svg>')).format).toBe('xml'); // extension of a compatible sibling wins
    expect(resolveFormat('page.html', '', enc('<!DOCTYPE html><html></html>')).format).toBe('html');
    expect(resolveFormat('a.7z', '', fixture('sample.7z').subarray(0, 4096)).format).toBe('7z');
    expect(resolveFormat('a.rar', '', fixture('sample.rar').subarray(0, 4096)).format).toBe('rar');
    expect(resolveFormat('a.rar', '', fixture('sample-rar5.rar').subarray(0, 4096)).format).toBe('rar');
    expect(resolveFormat('a.tar.bz2', '', fixture('sample.tar.bz2').subarray(0, 4096)).format).toBe('bz2');
    expect(resolveFormat('a.tar.xz', '', fixture('sample.tar.xz').subarray(0, 4096)).format).toBe('xz');
    expect(resolveFormat('a.iso', '', fixture('sample.iso').subarray(0, 4096)).format).toBe('iso');
    expect(resolveFormat('config.yml', '', enc('a: 1')).format).toBe('yaml');
    expect(resolveFormat('README.md', '', enc('# hi')).format).toBe('md');
  });
  it('gunzip of our gzip helper input is standard', () => {
    // fflate gzip output is checked in E2E; here just ensure fflate decodes standard gzip from fixtures.
    expect(gunzipSync(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])).length).toBe(0);
  });
});
