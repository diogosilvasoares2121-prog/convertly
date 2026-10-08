import { beforeAll, describe, expect, it } from 'vitest';
import { capabilitiesStore } from '../../src/core/capabilities';
import { TOOLS, getTool, isToolAvailable, SIDEBAR } from '../../src/registry/tools';
import { searchTools, tokenize } from '../../src/registry/search';
import { conversionTargets, imageOutputs } from '../../src/registry/matrix';
import { en } from '../../src/i18n/locales/en';
import { pt } from '../../src/i18n/locales/pt';
import { TOOL_COMPONENTS } from '../../src/tools';

const FULL = {
  ready: true,
  wasm: true,
  worker: true,
  offscreenCanvas: true,
  encodeJpeg: true,
  encodePng: true,
  encodeWebp: true,
  encodeAvif: false,
  webAudio: true,
  sharedArrayBuffer: false,
  downloadsApi: true,
  cores: 8,
  memoryGb: 8,
};

beforeAll(() => capabilitiesStore.set(FULL));

describe('tool registry', () => {
  it('has unique ids and a component for every tool', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of TOOLS) expect(TOOL_COMPONENTS[tool.component], tool.id).toBeTypeOf('function');
  });

  it('has translations for every tool in every language', () => {
    for (const tool of TOOLS) {
      if ('key' in tool.title) {
        expect(en, tool.id).toHaveProperty([tool.title.key]);
        expect(pt, tool.id).toHaveProperty([tool.title.key]);
      }
      expect(en).toHaveProperty([tool.description.key]);
      if (tool.formatTitleKey) expect(en).toHaveProperty([tool.formatTitleKey]);
    }
  });

  it('sidebar only references existing tools', () => {
    for (const section of SIDEBAR) for (const item of section.items) expect(getTool(item.toolId), item.toolId).toBeDefined();
  });

  it('never offers impossible conversions (AVIF hidden without an encoder)', () => {
    expect(isToolAvailable(getTool('jpg-to-avif')!)).toBe(false);
    expect(imageOutputs('heic')).toEqual(['jpg', 'png', 'webp']);
    capabilitiesStore.set({ ...FULL, encodeAvif: true });
    expect(isToolAvailable(getTool('jpg-to-avif')!)).toBe(true);
    capabilitiesStore.set(FULL);
  });

  it('disables WASM tools when WebAssembly is unavailable', () => {
    capabilitiesStore.set({ ...FULL, wasm: false });
    expect(isToolAvailable(getTool('heic-to-jpg')!)).toBe(false);
    expect(isToolAvailable(getTool('video-convert')!)).toBe(false);
    expect(isToolAvailable(getTool('pdf-merge')!)).toBe(true);
    capabilitiesStore.set(FULL);
  });

  it('conversion matrix', () => {
    expect(conversionTargets('heic')).toEqual(['jpg', 'png', 'webp', 'pdf', 'ico']);
    expect(conversionTargets('gif')).toEqual(expect.arrayContaining(['png', 'mp4', 'webm']));
    expect(conversionTargets('gif')).not.toContain('gif');
    expect(conversionTargets('svg')).toEqual(['png', 'jpg', 'webp']);
    expect(conversionTargets('mov')).toEqual(expect.arrayContaining(['mp4', 'webm', 'gif', 'mp3', 'wav']));
    expect(conversionTargets('pdf')).toEqual(['jpg', 'png']);
    expect(conversionTargets('zip')).toEqual([]);
  });
});

describe('search', () => {
  const labels = (q: string, limit?: number) => searchTools(q, limit).map((r) => r.label);

  it('finds tools for a format query', () => {
    const r = labels('jpg', 60);
    for (const expected of ['JPG → PNG', 'JPG → WEBP', 'JPG → PDF', 'Compress JPG', 'Resize JPG', 'Crop JPG', 'Rotate JPG', 'JPG → Base64']) {
      expect(r, expected).toContain(expected);
    }
    expect(r).not.toContain('JPG → AVIF');
  });

  it('understands aliases', () => {
    expect(tokenize('JPEG picture combine separate')).toEqual(['jpg', 'image', 'merge', 'split']);
    expect(labels('join pdf')[0]).toBe('Merge PDF');
    expect(labels('reduce size')).toContain('Compress image');
    expect(labels('juntar pdf')[0]).toBe('Merge PDF');
  });

  it('ranks format pairs', () => {
    expect(labels('png to jpg')[0]).toBe('PNG → JPG');
    expect(labels('heic → jpg')[0]).toBe('HEIC → JPG');
    expect(labels('video mp3')).toContain('MP4 → MP3');
  });

  it('finds the expanded toolbox', () => {
    expect(labels('extract rar')[0]).toBe('Extract RAR');
    expect(labels('7z')).toContain('Extract 7Z');
    expect(labels('watermark pdf')[0]).toBe('Watermark PDF');
    expect(labels('excel')).toContain('Excel converter');
    expect(labels('gif to mp4')[0]).toBe('GIF → MP4');
    expect(labels('svg to png')[0]).toBe('SVG → PNG');
    expect(labels('favicon')).toContain('Create ICO favicon');
    expect(labels('page numbers')).toContain('Add page numbers');
    expect(labels('sha256')).toContain('File checksum');
    expect(labels('yaml')).toContain('YAML to JSON');
  });

  it('returns nothing for gibberish', () => {
    expect(searchTools('zzqqxx')).toEqual([]);
  });
});

describe('i18n', () => {
  it('Portuguese has every English key with the same placeholders', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(pt[key], key).toBeTypeOf('string');
      const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(params(pt[key]), key).toEqual(params(en[key]));
    }
  });
});
