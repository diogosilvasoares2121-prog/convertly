#!/usr/bin/env node
/**
 * Generates small, legally safe test fixtures (all synthetic) into test-fixtures/.
 * - Images are drawn with <canvas> in headless Chromium or written byte-by-byte here.
 * - Video/audio are synthesized with the bundled FFmpeg WASM core (testsrc + sine).
 * - sample.heic is produced separately by scripts/make-heic.ps1 (Windows HEIF encoder), because
 *   x265 cannot run inside the single-threaded FFmpeg WASM build.
 * - PDFs are generated with pdf-lib; sample-encrypted.pdf uses RC4 40-bit (password "test").
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test-fixtures');
mkdirSync(out, { recursive: true });
const save = (name, data) => {
  writeFileSync(join(out, name), data);
  console.log(`fixture: ${name} (${data.length} bytes)`);
};

// ───────────────────────── Byte helpers ─────────────────────────
const u16be = (n) => [(n >> 8) & 255, n & 255];
const u16le = (n) => [n & 255, (n >> 8) & 255];
const u32le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s) => [...Buffer.from(s, 'latin1')];

// ───────────────────────── EXIF builder (little-endian TIFF) ─────────────────────────
function buildExif({ orientation = 1, gps = true } = {}) {
  // Entries: [tag, type, count, valueBytes]
  const entries0 = [];
  const exifEntries = [];
  const gpsEntries = [];
  const asciiVal = (s) => [...Buffer.from(`${s}\0`, 'latin1')];
  const rational = (pairs) => pairs.flatMap(([n, d]) => [...u32le(n), ...u32le(d)]);
  entries0.push([0x010f, 2, 'Convertly Test\0'.length, asciiVal('Convertly Test')]);
  entries0.push([0x0110, 2, 'Fixture Cam\0'.length, asciiVal('Fixture Cam')]);
  entries0.push([0x0112, 3, 1, [...u16le(orientation), 0, 0]]);
  entries0.push([0x8769, 4, 1, null]); // Exif IFD pointer (patched)
  if (gps) entries0.push([0x8825, 4, 1, null]); // GPS IFD pointer (patched)
  exifEntries.push([0x9003, 2, 20, asciiVal('2024:05:01 10:00:00')]);
  exifEntries.push([0x829d, 5, 1, rational([[28, 10]])]);
  gpsEntries.push([0x0001, 2, 2, asciiVal('N')]);
  gpsEntries.push([0x0002, 5, 3, rational([[38, 1], [42, 1], [0, 1]])]);
  gpsEntries.push([0x0003, 2, 2, asciiVal('W')]);
  gpsEntries.push([0x0004, 5, 3, rational([[9, 1], [8, 1], [0, 1]])]);

  const bytes = [...ascii('II'), ...u16le(42), ...u32le(8)];
  const ifdSize = (n) => 2 + n * 12 + 4;
  // Layout: IFD0 | IFD0 data | ExifIFD | Exif data | GPSIFD | GPS data
  const layout = (entries, start) => {
    let dataOffset = start + ifdSize(entries.length);
    const ifd = [...u16le(entries.length)];
    const data = [];
    for (const [tag, type, count, value] of entries) {
      ifd.push(...u16le(tag), ...u16le(type), ...u32le(count));
      if (value === null) ifd.push(0, 0, 0, 0);
      else if (value.length <= 4) ifd.push(...value, ...new Array(4 - value.length).fill(0));
      else {
        ifd.push(...u32le(dataOffset + data.length));
        data.push(...value);
        if (data.length % 2) data.push(0);
      }
    }
    ifd.push(0, 0, 0, 0);
    return { ifd, data, end: start + ifd.length + data.length };
  };
  const l0 = layout(entries0, 8);
  const lExif = layout(exifEntries, l0.end);
  const lGps = layout(gpsEntries, lExif.end);
  const patch = (ifd, tag, offset) => {
    const n = ifd[0] | (ifd[1] << 8);
    for (let i = 0; i < n; i++) {
      const p = 2 + i * 12;
      if ((ifd[p] | (ifd[p + 1] << 8)) === tag) ifd.splice(p + 8, 4, ...u32le(offset));
    }
  };
  patch(l0.ifd, 0x8769, l0.end);
  if (gps) patch(l0.ifd, 0x8825, lExif.end);
  bytes.push(...l0.ifd, ...l0.data, ...lExif.ifd, ...lExif.data, ...(gps ? [...lGps.ifd, ...lGps.data] : []));
  return Buffer.from(bytes);
}

function injectExif(jpeg, exif) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exif]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, ...u16be(payload.length + 2)]), payload]);
  // after SOI + APP0
  const app0Len = (jpeg[4] << 8) | jpeg[5];
  const cut = jpeg[3] === 0xe0 ? 4 + app0Len : 2;
  const comment = Buffer.from([0xff, 0xfe, ...u16be(2 + 13), ...ascii('fixture-note!')]);
  return Buffer.concat([jpeg.subarray(0, cut), app1, comment, jpeg.subarray(cut)]);
}

// ───────────────────────── BMP / TIFF writers ─────────────────────────
function bmp(width, height, pixel) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, height - 1 - y);
      const o = 54 + y * rowSize + x * 3;
      buf[o] = b;
      buf[o + 1] = g;
      buf[o + 2] = r;
    }
  }
  return buf;
}

function tiff(width, height, pixel) {
  const dataSize = width * height * 3;
  const entries = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, 3, null], // bits per sample → offset
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, null], // strip offset
    [277, 3, 1, 3],
    [278, 3, 1, height],
    [279, 4, 1, dataSize],
    [284, 3, 1, 1],
  ];
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const bpsOffset = ifdOffset + ifdSize;
  const dataOffset = bpsOffset + 6;
  const buf = Buffer.alloc(dataOffset + dataSize);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOffset, 4);
  buf.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, count, value], i) => {
    const p = ifdOffset + 2 + i * 12;
    buf.writeUInt16LE(tag, p);
    buf.writeUInt16LE(type, p + 2);
    buf.writeUInt32LE(count, p + 4);
    const v = tag === 258 ? bpsOffset : tag === 273 ? dataOffset : value;
    if (type === 3 && count === 1) buf.writeUInt16LE(v, p + 8);
    else buf.writeUInt32LE(v, p + 8);
  });
  buf.writeUInt16LE(8, bpsOffset);
  buf.writeUInt16LE(8, bpsOffset + 2);
  buf.writeUInt16LE(8, bpsOffset + 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = dataOffset + (y * width + x) * 3;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
    }
  return buf;
}

const gradient = (w, h) => (x, y) => [Math.round((x / w) * 255), Math.round((y / h) * 255), 160];

// ───────────────────────── RC4-encrypted PDF (Standard security handler R2) ─────────────────────────
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
function rc4(key, data) {
  const s = [...Array(256).keys()];
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const padPw = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

function encryptedPdf(userPw, ownerPw) {
  const id = md5(Buffer.from('convertly-fixture'));
  const P = -44; // print allowed, others restricted
  const O = rc4(md5(padPw(ownerPw)).subarray(0, 5), padPw(userPw));
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);
  const key = md5(padPw(userPw), O, pBytes, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);
  const content = Buffer.from('BT /F1 28 Tf 72 700 Td (Protected fixture) Tj ET', 'latin1');
  const enc = rc4(objKey(4), content);
  const hex = (b) => b.toString('hex').toUpperCase();
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // stream
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let length = parts[0].length;
  objs.forEach((body, i) => {
    offsets.push(length);
    const chunk =
      body === null
        ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${enc.length} >>\nstream\n`, 'latin1'), enc, Buffer.from('\nendstream\nendobj\n', 'latin1')])
        : Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

// ───────────────────────── PDFs ─────────────────────────
async function makePdf(pages, title, color) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(title);
  doc.setAuthor('Convertly fixtures');
  doc.setSubject('Synthetic test document');
  doc.setKeywords(['test', 'fixture']);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 40, y: 40, width: 515, height: 762, borderColor: color, borderWidth: 4 });
    page.drawText(`${title}`, { x: 70, y: 740, size: 28, font, color });
    page.drawText(`Page ${i} of ${pages}`, { x: 70, y: 690, size: 48, font, color: rgb(0.1, 0.1, 0.1) });
  }
  return Buffer.from(await doc.save());
}

async function makePdfWithPhoto(jpeg) {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 20, y: 20, width: 555, height: 802 });
  }
  return Buffer.from(await doc.save());
}

// ───────────────────────── Browser part: canvas + FFmpeg ─────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://fixtures.local/**', (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === '/') return route.fulfill({ body: '<!doctype html><title>fixtures</title>', contentType: 'text/html' });
  const file = join(root, 'node_modules', p);
  route.fulfill({ body: readFileSync(file), contentType: p.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
});
await page.goto('http://fixtures.local/');

const canvasImages = await page.evaluate(async () => {
  const draw = (w, h, alpha) => {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b8378');
    g.addColorStop(1, '#f4b740');
    ctx.fillStyle = g;
    if (alpha) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('Convertly', 24, h / 2);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(0, 0, 40, 40); // top-left marker (orientation checks)
    return c;
  };
  const enc = async (c, type, quality) => {
    const b = await c.convertToBlob({ type, quality });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  };
  return {
    jpg: await enc(draw(640, 427, false), 'image/jpeg', 0.92),
    png: await enc(draw(400, 300, true), 'image/png'),
    webp: await enc(draw(480, 320, false), 'image/webp', 0.9),
    big: await enc(draw(3000, 2000, false), 'image/jpeg', 0.95),
  };
});

const ffmpeg = await page.evaluate(async () => {
  const { default: create } = await import('/@ffmpeg/core/dist/esm/ffmpeg-core.js');
  const m = await create({ locateFile: (p) => `/@ffmpeg/core/dist/esm/${p}` });
  const logs = [];
  m.setLogger(({ message }) => logs.push(message));
  const run = (args, name) => {
    logs.length = 0;
    const ret = m.exec(...args);
    m.reset();
    if (ret !== 0) throw new Error(`${name} failed: ${logs.slice(-5).join(' | ')}`);
    const data = m.FS.readFile(name);
    m.FS.unlink(name);
    return Array.from(data);
  };
  const av = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100'];
  const a = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100'];
  return {
    mp4: run([...av, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', 'out.mp4'], 'out.mp4'),
    mov: run([...av, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', 'out.mov'], 'out.mov'),
    webm: run([...av, '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '300k', '-c:a', 'libvorbis', '-shortest', 'out.webm'], 'out.webm'),
    avi: run([...av, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '96k', '-shortest', 'out.avi'], 'out.avi'),
    mkv: run([...av, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '64k', '-shortest', 'out.mkv'], 'out.mkv'),
    mpeg: run([...av, '-c:v', 'mpeg1video', '-q:v', '5', '-c:a', 'mp2', '-b:a', '128k', '-shortest', '-f', 'mpeg', 'out.mpg'], 'out.mpg'),
    gpp: run([...av, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-b:a', '64k', '-ar', '22050', '-shortest', 'out.3gp'], 'out.3gp'),
    wmv: run([...av, '-c:v', 'wmv2', '-q:v', '5', '-c:a', 'wmav2', '-b:a', '96k', '-shortest', 'out.wmv'], 'out.wmv'),
    aac: run([...a, '-c:a', 'aac', '-b:a', '96k', '-f', 'adts', 'out.aac'], 'out.aac'),
    opus: run([...a, '-c:a', 'libopus', '-b:a', '64k', 'out.opus'], 'out.opus'),
    wma: run([...a, '-c:a', 'wmav2', '-b:a', '96k', 'out.wma'], 'out.wma'),
    silent: run(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'silent.mp4'], 'silent.mp4'),
    wav: run([...a, '-c:a', 'pcm_s16le', 'out.wav'], 'out.wav'),
    mp3: run([...a, '-c:a', 'libmp3lame', '-b:a', '128k', 'out.mp3'], 'out.mp3'),
    m4a: run([...a, '-c:a', 'aac', '-b:a', '96k', 'out.m4a'], 'out.m4a'),
    ogg: run([...a, '-c:a', 'libvorbis', 'out.ogg'], 'out.ogg'),
    flac: run([...a, '-c:a', 'flac', 'out.flac'], 'out.flac'),
    gif: run(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=1', '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', 'anim.gif'], 'anim.gif'),
    staticGif: run(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=1:duration=1', '-frames:v', '1', 'static.gif'], 'static.gif'),
  };
});
await browser.close();

const b = (arr) => Buffer.from(arr);

// Images
save('sample.jpg', injectExif(b(canvasImages.jpg), buildExif({ orientation: 1, gps: true })));
save('rotated.jpg', injectExif(b(canvasImages.jpg), buildExif({ orientation: 6, gps: false })));
save('sample.png', b(canvasImages.png));
save('sample.webp', b(canvasImages.webp));
save('large.jpg', b(canvasImages.big));
save('sample.bmp', bmp(200, 120, gradient(200, 120)));
save('sample.tiff', tiff(200, 120, gradient(200, 120)));
save('animated.gif', b(ffmpeg.gif));
save('static.gif', b(ffmpeg.staticGif));
if (!existsSync(join(out, 'sample.heic'))) console.warn('sample.heic missing: run scripts/make-heic.ps1 on Windows (x265 cannot run in FFmpeg WASM).');

// Video / audio
save('sample.mp4', b(ffmpeg.mp4));
save('sample.mov', b(ffmpeg.mov));
save('sample.webm', b(ffmpeg.webm));
save('sample.avi', b(ffmpeg.avi));
save('sample.mkv', b(ffmpeg.mkv));
save('silent.mp4', b(ffmpeg.silent));
save('sample.mpg', b(ffmpeg.mpeg));
save('sample.3gp', b(ffmpeg.gpp));
save('sample.wmv', b(ffmpeg.wmv));
save('sample.aac', b(ffmpeg.aac));
save('sample.opus', b(ffmpeg.opus));
save('sample.wma', b(ffmpeg.wma));
save('sample.wav', b(ffmpeg.wav));
save('sample.mp3', b(ffmpeg.mp3));
save('sample.m4a', b(ffmpeg.m4a));
save('sample.ogg', b(ffmpeg.ogg));
save('sample.flac', b(ffmpeg.flac));

// PDFs
save('sample.pdf', await makePdf(3, 'Convertly Sample A', rgb(0.04, 0.51, 0.47)));
save('sample2.pdf', await makePdf(2, 'Convertly Sample B', rgb(0.9, 0.28, 0.3)));
save('sample10.pdf', await makePdf(10, 'Ten Pages', rgb(0.2, 0.3, 0.8)));
save('photos.pdf', await makePdfWithPhoto(b(canvasImages.big)));
save('sample-encrypted.pdf', encryptedPdf('test', 'owner'));

// Data
save('sample.json', Buffer.from(JSON.stringify([
  { id: 1, name: 'Ana', city: 'Lisboa', tags: ['a', 'b'], meta: { active: true, score: 9.5 } },
  { id: 2, name: 'Rui, Jr.', city: 'Porto', tags: [], meta: { active: false, score: 7 } },
  { id: 12345678901234567890, name: 'Big "Number"', city: 'Faro', note: 'line1\nline2' },
], null, 2)));
save('sample.csv', Buffer.from('name;city;age\nAna;Lisboa;31\n"Rui; Jr.";Porto;27\nMaria;"Faro\nAlgarve";45\n'));
save('sample.xml', Buffer.from('<?xml version="1.0"?><library><book id="1"><title>Os Lusíadas</title><author>Camões</author></book><book id="2"><title>Mensagem</title></book></library>'));

// Archives
const enc = (s) => strToU8(s);
save('sample.zip', Buffer.from(zipSync({
  'readme.txt': enc('Convertly fixture archive\n'),
  'folder/data.json': enc('{"ok":true}\n'),
  'folder/nested/notes.md': enc('# Notes\n'),
  'image.png': b(canvasImages.png),
})));
save('zip-slip.zip', Buffer.from(zipSync({
  '../evil.txt': enc('should never escape'),
  '/abs/path.txt': enc('absolute'),
  'C:/windows/win.ini': enc('drive'),
  'safe/ok.txt': enc('fine'),
  'run-me.exe': enc('MZ not really'),
})));

// Edge cases
save('empty.bin', Buffer.alloc(0));
save('empty.pdf', Buffer.alloc(0));
save('corrupt.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 37) % 251))]));
save('corrupt.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.alloc(300, 7)]));
save('png-named.jpg', b(canvasImages.png));
save('fotografia-ação-日本.png', b(canvasImages.png));
save('🎉 party.png', b(canvasImages.png));
save(`${'very-long-file-name-'.repeat(8)}end.png`, b(canvasImages.png));
console.log('done');
