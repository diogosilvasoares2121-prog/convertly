#!/usr/bin/env node
/** Minimal uudecode: node scripts/uudecode.mjs input.uu output.bin */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: uudecode.mjs <input.uu> <output>');
  process.exit(1);
}
const lines = readFileSync(input, 'latin1').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('begin '));
const bytes = [];
for (const line of lines.slice(start + 1)) {
  if (line === 'end' || line === '`' || !line) break;
  const n = (line.charCodeAt(0) - 32) & 63;
  const chars = line.slice(1);
  const decoded = [];
  for (let i = 0; i < chars.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => ((chars.charCodeAt(i + k) || 32) - 32) & 63);
    decoded.push((c[0] << 2) | (c[1] >> 4), ((c[1] & 15) << 4) | (c[2] >> 2), ((c[2] & 3) << 6) | c[3]);
  }
  bytes.push(...decoded.slice(0, n));
}
writeFileSync(output, Buffer.from(bytes));
console.log(`${output}: ${bytes.length} bytes`);
