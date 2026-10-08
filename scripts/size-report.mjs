#!/usr/bin/env node
/**
 * npm run size-report — breaks down dist/ by category (JS, CSS, WASM, workers, assets)
 * and estimates the compressed size of the Web Store package.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const dist = join(process.cwd(), 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found — run npm run build first.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).map((p) => ({ path: relative(dist, p).replace(/\\/g, '/'), size: statSync(p).size }));

function category(path) {
  if (path.endsWith('.wasm')) return 'WASM';
  if (/worker/i.test(path) && path.endsWith('.js')) return 'Workers';
  if (path.startsWith('vendor/ffmpeg/')) return 'Vendor JS (FFmpeg loader)';
  if (path.endsWith('.js')) return 'JS';
  if (path.endsWith('.css')) return 'CSS';
  if (path.startsWith('vendor/pdfjs/')) return 'PDF.js data (CMaps, fonts, ICC)';
  if (path.endsWith('.html')) return 'HTML';
  if (/\.(png|svg|ico)$/.test(path)) return 'Icons/Images';
  return 'Other (manifest, locales, licenses)';
}

const fmt = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
const groups = new Map();
for (const f of files) {
  const c = category(f.path);
  const g = groups.get(c) ?? { size: 0, count: 0, files: [] };
  g.size += f.size;
  g.count++;
  g.files.push(f);
  groups.set(c, g);
}

const total = files.reduce((n, f) => n + f.size, 0);
console.log('\nConvertly — package size report\n');
console.log('Category'.padEnd(38) + 'Files'.padStart(7) + 'Size'.padStart(14) + 'Share'.padStart(9));
console.log('─'.repeat(68));
for (const [name, g] of [...groups].sort((a, b) => b[1].size - a[1].size)) {
  console.log(name.padEnd(38) + String(g.count).padStart(7) + fmt(g.size).padStart(14) + `${((g.size / total) * 100).toFixed(1)}%`.padStart(9));
}
console.log('─'.repeat(68));
console.log('Total'.padEnd(38) + String(files.length).padStart(7) + fmt(total).padStart(14));

console.log('\nLargest files:');
for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 10)) console.log(`  ${fmt(f.size).padStart(10)}  ${f.path}`);

const zipped = zipSync(Object.fromEntries(files.map((f) => [f.path, readFileSync(join(dist, f.path))])), { level: 9 });
console.log(`\nEstimated Web Store ZIP: ${fmt(zipped.length)} (Chrome Web Store limit: 2 GB)`);

// Duplicate detection: identical file contents bundled twice.
const seen = new Map();
const dups = [];
for (const f of files) {
  if (f.size < 4096) continue;
  const key = `${f.size}:${readFileSync(join(dist, f.path)).subarray(0, 256).toString('base64')}`;
  if (seen.has(key)) dups.push([seen.get(key), f.path]);
  else seen.set(key, f.path);
}
if (dups.length) {
  console.log('\nPossible duplicate files:');
  for (const [a, b] of dups) console.log(`  ${a} == ${b}`);
} else console.log('\nNo duplicate files detected.');
