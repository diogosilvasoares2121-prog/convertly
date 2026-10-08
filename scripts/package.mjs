#!/usr/bin/env node
/**
 * npm run package — zips dist/ (manifest.json at the root) into
 * release/convertly-<version>.zip, ready for the Chrome Web Store.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = process.cwd();
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

// Fixed timestamps → identical input produces an identical ZIP.
const mtime = new Date('2026-01-01T00:00:00Z');
const entries = {};
for (const file of walk(dist).sort()) {
  const rel = relative(dist, file).replace(/\\/g, '/');
  const alreadyCompressed = /\.(png|wasm|zip)$/.test(rel) && !rel.endsWith('.wasm');
  entries[rel] = [new Uint8Array(readFileSync(file)), { level: alreadyCompressed ? 0 : 9, mtime }];
}
const zip = zipSync(entries);
mkdirSync(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `convertly-${manifest.version}.zip`);
writeFileSync(out, zip);
const sha = createHash('sha256').update(zip).digest('hex');
console.log(`package: ${relative(root, out)} (${(zip.length / 1024 / 1024).toFixed(2)} MB)\nsha256: ${sha}`);
