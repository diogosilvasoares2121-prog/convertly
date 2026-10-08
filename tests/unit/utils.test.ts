import { describe, expect, it } from 'vitest';
import { NameDeduper, renameWithExtension, sanitizeFilename, sanitizeRelativePath, splitName, MAX_NAME_LENGTH } from '../../src/utils/filename';
import { chunkPages, formatPageRanges, parsePageRanges } from '../../src/utils/ranges';
import { formatTimecode, parseTimecode, formatDuration } from '../../src/utils/time';
import { formatBytes, savedPercent } from '../../src/utils/bytes';

describe('filenames', () => {
  it('renames with the new extension, keeping the base name', () => {
    expect(renameWithExtension('photo.heic', 'jpg')).toBe('photo.jpg');
    expect(renameWithExtension('IMG_2034.HEIC', 'png')).toBe('IMG_2034.png');
    expect(renameWithExtension('my.photo.final.jpeg', 'webp', 'compressed')).toBe('my.photo.final-compressed.webp');
  });

  it('keeps unicode and emoji', () => {
    expect(sanitizeFilename('fotografia-ação-日本.png')).toBe('fotografia-ação-日本.png');
    expect(sanitizeFilename('🎉 party.png')).toBe('🎉 party.png');
  });

  it('removes illegal characters, reserved names and trailing dots', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j.txt')).toBe('a_b_c_d_e_f_g_h_i_j.txt');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('  name. . ')).toBe('name');
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('\u0000\u0007')).toBe('__');
  });

  it('truncates very long names but keeps the extension and does not split emoji', () => {
    const long = `${'😀'.repeat(200)}.png`;
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(out.endsWith('.png')).toBe(true);
    expect(out).not.toMatch(/\uD83D$/);
  });

  it('neutralises path traversal (zip-slip)', () => {
    expect(sanitizeRelativePath('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeRelativePath('/abs/path.txt')).toBe('abs/path.txt');
    expect(sanitizeRelativePath('C:\\Windows\\win.ini')).toBe('Windows/win.ini');
    expect(sanitizeRelativePath('a/./b//c.txt')).toBe('a/b/c.txt');
  });

  it('deduplicates names inside a batch', () => {
    const d = new NameDeduper();
    expect(d.unique('photo.jpg')).toBe('photo.jpg');
    expect(d.unique('photo.jpg')).toBe('photo (1).jpg');
    expect(d.unique('PHOTO.jpg')).toBe('PHOTO (2).jpg');
    expect(d.unique('dir/a.txt')).toBe('dir/a.txt');
    expect(d.unique('dir/a.txt')).toBe('dir/a (1).txt');
  });

  it('splits names', () => {
    expect(splitName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: 'gz' });
    expect(splitName('.hidden')).toEqual({ base: '.hidden', ext: '' });
  });
});

describe('page ranges', () => {
  it('parses ranges, singles and open ranges', () => {
    const r = parsePageRanges('1-3, 5, 8-', 10);
    expect(r.ok && r.pages).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(r.ok && r.groups).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
  });
  it('rejects invalid parts', () => {
    expect(parsePageRanges('0-2', 5).ok).toBe(false);
    expect(parsePageRanges('4-9', 5).ok).toBe(false);
    expect(parsePageRanges('abc', 5).ok).toBe(false);
    expect(parsePageRanges('', 5).ok).toBe(false);
  });
  it('supports reverse ranges and formats back', () => {
    const r = parsePageRanges('3-1', 5);
    expect(r.ok && r.pages).toEqual([2, 1, 0]);
    expect(formatPageRanges([0, 1, 2, 4, 6, 7])).toBe('1-3, 5, 7-8');
  });
  it('chunks pages', () => {
    expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });
});

describe('time and size formatting', () => {
  it('parses and formats timecodes', () => {
    expect(parseTimecode('00:01:25')).toBe(85);
    expect(parseTimecode('1:05.5')).toBe(65.5);
    expect(parseTimecode('12')).toBe(12);
    expect(parseTimecode('00:61:00')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
    expect(formatTimecode(85.25, true)).toBe('00:01:25.250');
  });
  it('formats durations and sizes', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1800)).toBe('1.8 s');
    expect(formatBytes(3.8 * 1024 * 1024, 'en')).toBe('3.8 MB');
    expect(savedPercent(3800, 820)).toBe(78);
  });
});
