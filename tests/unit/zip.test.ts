import { describe, expect, it } from 'vitest';
import { createZip } from '../../src/engines/zip/writer';
import { extractEntry, isExecutableName, listZip } from '../../src/engines/zip/reader';
import { crc32 } from '../../src/engines/zip/crc32';
import { fixtureBlob } from './helpers';

describe('ZIP engine', () => {
  it('creates a ZIP and reads it back (round trip)', async () => {
    const text = 'Olá Convertly! '.repeat(200);
    const zip = await createZip(
      [
        { path: 'docs/readme.txt', blob: new Blob([text]) },
        { path: 'docs/readme.txt', blob: new Blob(['duplicate']) },
        { path: 'img/photo.jpg', blob: fixtureBlob('sample.jpg') },
        { path: 'empty.txt', blob: new Blob([]) },
      ],
      'normal',
    );
    const entries = await listZip(zip);
    expect(entries.map((e) => e.path)).toEqual(['docs/readme.txt', 'docs/readme (1).txt', 'img/photo.jpg', 'empty.txt']);
    const readme = await extractEntry(zip, entries[0]!);
    expect(new TextDecoder().decode(readme)).toBe(text);
    expect(entries[0]!.compressedSize).toBeLessThan(entries[0]!.size); // deflated
    expect(entries[2]!.method).toBe(0); // JPEG stored as-is
    expect((await extractEntry(zip, entries[3]!)).length).toBe(0);
  });

  it('lists and extracts an existing archive', async () => {
    const zip = fixtureBlob('sample.zip');
    const entries = await listZip(zip);
    expect(entries.map((e) => e.path).sort()).toEqual(['folder/data.json', 'folder/nested/notes.md', 'image.png', 'readme.txt']);
    const json = await extractEntry(zip, entries.find((e) => e.path === 'folder/data.json')!);
    expect(JSON.parse(new TextDecoder().decode(json))).toEqual({ ok: true });
  });

  it('neutralises zip-slip paths and flags executables', async () => {
    const entries = await listZip(fixtureBlob('zip-slip.zip'));
    const byRaw = Object.fromEntries(entries.map((e) => [e.rawName, e]));
    expect(byRaw['../evil.txt']!.path).toBe('evil.txt');
    expect(byRaw['../evil.txt']!.unsafePath).toBe(true);
    expect(byRaw['/abs/path.txt']!.path).toBe('abs/path.txt');
    expect(byRaw['C:/windows/win.ini']!.path).toBe('windows/win.ini');
    expect(byRaw['safe/ok.txt']!.unsafePath).toBe(false);
    for (const e of entries) expect(e.path.split('/')).not.toContain('..');
    expect(isExecutableName('run-me.exe')).toBe(true);
    expect(isExecutableName('notes.txt')).toBe(false);
  });

  it('rejects invalid archives', async () => {
    await expect(listZip(fixtureBlob('corrupt.pdf'))).rejects.toMatchObject({ code: 'invalid-archive' });
    await expect(listZip(new Blob([]))).rejects.toMatchObject({ code: 'empty-file' });
  });

  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
