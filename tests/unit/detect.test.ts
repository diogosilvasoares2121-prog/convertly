import { describe, expect, it } from 'vitest';
import { countGifFrames, detectFile, isAnimatedImage, resolveFormat, sizeClassOf } from '../../src/core/detect';
import { fixture, fixtureBlob } from './helpers';

const head = (name: string) => fixture(name).subarray(0, 4096);

describe('file detection by signature', () => {
  const cases: Array<[string, string]> = [
    ['sample.jpg', 'jpg'],
    ['sample.png', 'png'],
    ['sample.webp', 'webp'],
    ['sample.bmp', 'bmp'],
    ['sample.tiff', 'tiff'],
    ['animated.gif', 'gif'],
    ['sample.heic', 'heic'],
    ['sample.pdf', 'pdf'],
    ['sample.mp4', 'mp4'],
    ['sample.mov', 'mov'],
    ['sample.webm', 'webm'],
    ['sample.avi', 'avi'],
    ['sample.mkv', 'mkv'],
    ['sample.wav', 'wav'],
    ['sample.mp3', 'mp3'],
    ['sample.m4a', 'm4a'],
    ['sample.ogg', 'ogg'],
    ['sample.flac', 'flac'],
    ['sample.zip', 'zip'],
    ['sample.json', 'json'],
    ['sample.csv', 'csv'],
    ['sample.xml', 'xml'],
  ];
  for (const [name, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(resolveFormat(name, '', head(name)).format).toBe(expected);
    });
  }

  it('detects the real type when the extension is wrong', () => {
    const r = resolveFormat('png-named.jpg', 'image/jpeg', head('png-named.jpg'));
    expect(r.format).toBe('png');
    expect(r.extensionMismatch).toBe(true);
  });

  it('handles empty files', async () => {
    const d = await detectFile(new File([], 'empty.bin'));
    expect(d.empty).toBe(true);
  });

  it('falls back to the extension for unknown content', () => {
    expect(resolveFormat('notes.txt', '', new TextEncoder().encode('hello')).format).toBe('txt');
    expect(resolveFormat('mystery.xyz', '', new Uint8Array([1, 2, 3, 4, 5])).format).toBeNull();
  });

  it('classifies sizes', () => {
    expect(sizeClassOf(10 * 1024 * 1024)).toBe('light');
    expect(sizeClassOf(200 * 1024 * 1024)).toBe('medium');
    expect(sizeClassOf(700 * 1024 * 1024)).toBe('heavy');
    expect(sizeClassOf(2 * 1024 * 1024 * 1024)).toBe('very-heavy');
  });
});

describe('animation detection', () => {
  it('distinguishes animated and static GIFs', async () => {
    expect(countGifFrames(fixture('animated.gif'))).toBeGreaterThan(1);
    expect(countGifFrames(fixture('static.gif'))).toBe(1);
    expect(await isAnimatedImage(fixtureBlob('animated.gif'), 'gif')).toBe(true);
    expect(await isAnimatedImage(fixtureBlob('static.gif'), 'gif')).toBe(false);
    expect(await isAnimatedImage(fixtureBlob('sample.png'), 'png')).toBe(false);
  });
});
