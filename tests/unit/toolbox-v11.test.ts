import { beforeAll, describe, expect, it } from 'vitest';
import { capabilitiesStore } from '../../src/core/capabilities';
import { gzipSync } from 'fflate';
import { rowsToCsv, rowsToJson, textToRows } from '../../src/engines/data/table';
import { NEUTRAL, adjustmentOps, filterString, frameSize } from '../../src/engines/image/filters';
import { gzipContainsTar, gzipOriginalSize } from '../../src/engines/archive/gzip';
import { createTar } from '../../src/engines/archive/tar';
import { convertVideo, mergeVideos } from '../../src/engines/ffmpeg/commands';
import type { MediaInfo } from '../../src/engines/ffmpeg/probe';
import { SIDEBAR, TOOLS, getTool, listedTools, toolsByCategory } from '../../src/registry/tools';
import { CATEGORIES } from '../../src/registry/formats';
import { TOOL_COMPONENTS } from '../../src/tools';
import { en } from '../../src/i18n/locales/en';

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  container: 'mp4',
  duration: 4,
  bitrate: 1e6,
  video: { codec: 'gif', width: 101, height: 75, fps: 10, rotation: 0, bitrate: null },
  audio: null,
  audioStreams: 0,
  videoStreams: 1,
  ...over,
});

describe('spreadsheet table helpers', () => {
  it('writes RFC 4180 CSV with optional BOM', () => {
    const csv = rowsToCsv([['name', 'note'], ['Ana', 'a,b'], ['Rui', 'say "hi"'], [null, 3]], ',', false);
    expect(csv).toBe('name,note\r\nAna,"a,b"\r\nRui,"say ""hi"""\r\n,3\r\n');
    expect(rowsToCsv([['a']], ';', true).startsWith('﻿')).toBe(true);
  });

  it('converts rows to JSON objects keyed by the header', () => {
    expect(JSON.parse(rowsToJson([['name', '', 'age'], ['Ana', 'x', 31]], true))).toEqual([{ name: 'Ana', column2: 'x', age: 31 }]);
    expect(JSON.parse(rowsToJson([['a', 1]], false))).toEqual([['a', 1]]);
  });

  it('reads CSV (delimiter detected) and JSON input', () => {
    expect(textToRows('a;b\n1;2')).toEqual({ ok: true, kind: 'csv', rows: [['a', 'b'], ['1', '2']] });
    const json = textToRows('[{"a":1,"b":{"c":2}}]');
    expect(json).toEqual({ ok: true, kind: 'json', rows: [['a', 'b.c'], ['1', '2']] });
    expect(textToRows('[{"a":').ok).toBe(false);
  });
});

describe('image adjustments and frames', () => {
  it('omits neutral values and maps presets to canvas filters', () => {
    expect(filterString(NEUTRAL)).toBe('');
    expect(filterString({ ...NEUTRAL, grayscale: 100, contrast: 110 })).toBe('contrast(1.1) grayscale(1)');
    expect(adjustmentOps({ ...NEUTRAL, blur: 5 })).toEqual({ blurPct: 0.5 });
    expect(adjustmentOps(NEUTRAL)).toEqual({});
  });

  it('computes even frame sizes for GIF/MP4 slideshows', () => {
    expect(frameSize('first', 1080, { width: 4000, height: 3000 })).toEqual({ width: 1080, height: 810 });
    expect(frameSize('9:16', 1080, { width: 1, height: 1 })).toEqual({ width: 608, height: 1080 });
    expect(frameSize('1:1', 481, { width: 1, height: 1 })).toEqual({ width: 482, height: 482 });
    const odd = frameSize('first', 480, { width: 333, height: 777 });
    expect(odd.width % 2).toBe(0);
    expect(odd.height).toBe(480);
  });
});

describe('archives', () => {
  it('tells a tar.gz from a plain .gz and reads the original size', async () => {
    const tar = await createTar([{ path: 'docs/a.txt', blob: new Blob(['hello']) }]);
    const tgz = new Blob([gzipSync(new Uint8Array(await tar.arrayBuffer()))]);
    expect(await gzipContainsTar(tgz)).toBe(true);
    const text = new TextEncoder().encode('plain text, not a tarball '.repeat(40));
    const gz = new Blob([gzipSync(text)]);
    expect(await gzipContainsTar(gz)).toBe(false);
    expect(await gzipOriginalSize(gz)).toBe(text.length);
    expect(await gzipContainsTar(new Blob(['not gzip at all']))).toBe(false);
  });
});

describe('FFmpeg commands for the new tools', () => {
  it('GIF → WEBM forces yuv420p and GIF → MP4 re-encodes to even H.264', () => {
    const webm = convertVideo({ input: 'in.gif', info: info(), target: 'webm', quality: 'balanced', allowCopy: true, baseName: 'o' });
    expect(webm.args).toEqual(expect.arrayContaining(['-c:v', 'libvpx', '-pix_fmt', 'yuv420p']));
    expect(webm.streamCopy).toBe(false);
    const mp4 = convertVideo({ input: 'in.gif', info: info(), target: 'mp4', quality: 'balanced', allowCopy: true, baseName: 'o' });
    expect(mp4.args.join(' ')).toContain('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });

  it('merging silent clips generates silence inside the filter graph (no lavfi device)', () => {
    const cmd = mergeVideos([{ name: 'a.mp4', info: info({ video: { codec: 'h264', width: 640, height: 360, fps: 30, rotation: 0, bitrate: null } }) }, { name: 'b.mp4', info: info() }], { maxHeight: 720, baseName: 'o' });
    expect(cmd.args).not.toContain('lavfi');
    expect(cmd.args.filter((a) => a === '-i')).toHaveLength(2);
    expect(cmd.args.join(' ')).toContain('anullsrc=r=44100:cl=stereo,atrim=duration=4.000');
  });
});

describe('registry organisation', () => {
  beforeAll(() =>
    capabilitiesStore.set({ ready: true, wasm: true, worker: true, offscreenCanvas: true, encodeJpeg: true, encodePng: true, encodeWebp: true, encodeAvif: false, webAudio: true, sharedArrayBuffer: false, downloadsApi: true, cores: 8, memoryGb: 8 }),
  );

  it('every tool has a component, a section and translated copy', () => {
    for (const tool of TOOLS) {
      expect(TOOL_COMPONENTS[tool.component], tool.id).toBeTypeOf('function');
      if (tool.pair) continue;
      expect(tool.group, tool.id).toBeTruthy();
      expect(en[`tool.${tool.id}.title` as keyof typeof en], tool.id).toBeTruthy();
      expect(en[`tool.${tool.id}.desc` as keyof typeof en], tool.id).toBeTruthy();
      expect(en[`group.${tool.group}` as keyof typeof en], tool.group).toBeTruthy();
    }
  });

  it('ids are unique and search-only shortcuts stay off category pages', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    const listed = new Set(CATEGORIES.flatMap((c) => toolsByCategory(c).map((t) => t.id)));
    expect(listed.has('extract-rar')).toBe(false);
    expect(listed.has('archive-extract')).toBe(true);
    expect(listedTools().length).toBe(listed.size);
    expect(getTool('extract-7z')?.hidden).toBe(true);
  });

  it('sidebar links point to existing tools', () => {
    for (const section of SIDEBAR) for (const item of section.items) expect(getTool(item.toolId), item.toolId).toBeTruthy();
  });

  it('offers the expected breadth of tools per category', () => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, toolsByCategory(c).length]));
    expect(counts).toMatchObject({ image: 15, pdf: 16, video: 13, audio: 8, archive: 4, data: 18 });
  });
});
