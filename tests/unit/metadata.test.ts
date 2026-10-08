import { describe, expect, it } from 'vitest';
import { readMetadata, stripJpeg, stripPng, stripWebp, jpegSegments } from '../../src/engines/image/metadata';
import { fixture } from './helpers';

describe('image metadata', () => {
  it('reads EXIF and GPS from JPEG', () => {
    const m = readMetadata(fixture('sample.jpg'), 'jpg');
    expect(m.hasExif).toBe(true);
    expect(m.hasGps).toBe(true);
    expect(m.hasComments).toBe(true);
    expect(m.entries.find((e) => e.key === 'Make')?.value).toBe('Convertly Test');
    expect(m.entries.find((e) => e.key === 'Date taken')?.value).toBe('2024:05:01 10:00:00');
    expect(m.entries.find((e) => e.key === 'GPS position')?.value).toBe('38.70000, -9.13333');
    expect(m.orientation).toBe(1);
  });

  it('reads orientation', () => {
    expect(readMetadata(fixture('rotated.jpg'), 'jpg').orientation).toBe(6);
  });

  it('strips JPEG metadata losslessly', () => {
    const original = fixture('sample.jpg');
    const stripped = stripJpeg(original)!;
    expect(stripped.removed).toEqual(expect.arrayContaining(['EXIF', 'Comments']));
    const after = readMetadata(stripped.data, 'jpg');
    expect(after.hasExif).toBe(false);
    expect(after.hasGps).toBe(false);
    expect(after.hasComments).toBe(false);
    // Image data (from SOS on) is byte-identical.
    const sosA = jpegSegments(original)!.scanStart;
    const sosB = jpegSegments(stripped.data)!.scanStart;
    expect(Buffer.from(stripped.data.subarray(sosB)).equals(Buffer.from(original.subarray(sosA)))).toBe(true);
  });

  it('strips PNG text chunks and keeps it valid', () => {
    const png = fixture('sample.png');
    const r = stripPng(png)!;
    expect(r.data.subarray(0, 8)).toEqual(png.subarray(0, 8));
    expect(readMetadata(r.data, 'png').hasComments).toBe(false);
  });

  it('handles WebP containers', () => {
    const r = stripWebp(fixture('sample.webp'))!;
    const size = r.data[4]! | (r.data[5]! << 8) | (r.data[6]! << 16) | (r.data[7]! << 24);
    expect(size).toBe(r.data.length - 8);
  });

  it('ignores malformed data safely', () => {
    expect(() => readMetadata(fixture('corrupt.jpg'), 'jpg')).not.toThrow();
    expect(readMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2]), 'jpg').hasExif).toBe(false);
  });
});
