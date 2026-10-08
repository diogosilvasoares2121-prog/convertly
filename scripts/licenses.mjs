#!/usr/bin/env node
/**
 * License audit. Generates:
 *  - THIRD_PARTY_LICENSES.txt (full texts, shipped inside the extension)
 *  - src/generated/licenses.json (summary shown on the About page)
 *
 * Only packages that are actually bundled into dist/ are listed. The FFmpeg core is
 * GPL-2.0-or-later (built with x264/x265); its components and source location are
 * documented as required by the GPL.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const spdx = require('spdx-license-list/full');

/** Runtime packages bundled into the extension and why. */
const PACKAGES = [
  ['preact', 'UI rendering'],
  ['lucide-preact', 'Interface icons'],
  ['pdf-lib', 'PDF merge, split, organize, metadata, images → PDF, compression'],
  ['@pdf-lib/standard-fonts', 'Dependency of pdf-lib'],
  ['@pdf-lib/upng', 'PNG decoding for pdf-lib'],
  ['pako', 'Deflate (used by pdf-lib and UTIF)'],
  ['tslib', 'Runtime helpers for pdf-lib'],
  ['pdfjs-dist', 'PDF rendering (thumbnails, PDF → image)'],
  ['@ffmpeg/core', 'Video and audio processing (FFmpeg 5.1 compiled to WebAssembly)'],
  ['libheif-js', 'HEIC/HEIF decoding (libheif + libde265, WebAssembly)'],
  ['fflate', 'ZIP creation, inflate for ZIP extraction and PDF images'],
  ['utif', 'TIFF decoding'],
  ['libarchive.js', 'Reading 7Z, RAR, TAR, GZ/BZ2/XZ and ISO archives (libarchive compiled to WebAssembly)'],
  ['comlink', 'Worker messaging used by libarchive.js'],
  ['yaml', 'YAML ↔ JSON conversion'],
  ['marked', 'Markdown → HTML conversion'],
];

/** Libraries statically linked into libarchive.js 2.0.2 (libarchive.wasm). */
const LIBARCHIVE_COMPONENTS = [
  ['libarchive 3.7.2', 'BSD-2-Clause', 'https://www.libarchive.org/'],
  ['zlib', 'Zlib', 'https://zlib.net/'],
  ['bzip2 / libbzip2', 'bzip2-1.0.6', 'https://sourceware.org/bzip2/'],
  ['liblzma (XZ Utils)', '0BSD', 'https://tukaani.org/xz/'],
  ['OpenSSL (libcrypto, archive decryption)', 'Apache-2.0 / OpenSSL', 'https://www.openssl.org/'],
];

/** Components statically linked into @ffmpeg/core 0.12.10 (from its build configuration). */
const FFMPEG_COMPONENTS = [
  ['FFmpeg 5.1.4', 'GPL-2.0-or-later (built with --enable-gpl)', 'https://ffmpeg.org/'],
  ['x264', 'GPL-2.0-or-later', 'https://code.videolan.org/videolan/x264'],
  ['x265', 'GPL-2.0-or-later', 'https://bitbucket.org/multicoreware/x265_git'],
  ['libvpx', 'BSD-3-Clause', 'https://chromium.googlesource.com/webm/libvpx'],
  ['LAME (libmp3lame)', 'LGPL-2.1-or-later', 'https://lame.sourceforge.io/'],
  ['Opus', 'BSD-3-Clause', 'https://opus-codec.org/'],
  ['libogg / libvorbis / libtheora', 'BSD-3-Clause', 'https://xiph.org/'],
  ['libwebp', 'BSD-3-Clause', 'https://chromium.googlesource.com/webm/libwebp'],
  ['zlib', 'Zlib', 'https://zlib.net/'],
  ['FreeType', 'FTL', 'https://freetype.org/'],
  ['FriBidi', 'LGPL-2.1-or-later', 'https://github.com/fribidi/fribidi'],
  ['libass', 'ISC', 'https://github.com/libass/libass'],
  ['zimg', 'WTFPL', 'https://github.com/sekrit-twc/zimg'],
];

function pkgDir(name) {
  return join(root, 'node_modules', ...name.split('/'));
}

function licenseText(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const rule = (c = '=') => c.repeat(78);
const out = [];
const summary = [];

out.push(rule());
out.push('CONVERTLY — THIRD-PARTY SOFTWARE NOTICES AND LICENSES');
out.push(rule());
out.push('');
const ownPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sourceUrl = String(ownPkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
out.push(`Convertly ${ownPkg.version} is free software: you can redistribute it and/or modify it under`);
out.push('the terms of the GNU General Public License as published by the Free Software Foundation,');
out.push('either version 3 of the License, or (at your option) any later version. It is distributed');
out.push('WITHOUT ANY WARRANTY; see the GNU General Public License for details.');
out.push('');
out.push('CORRESPONDING SOURCE');
out.push(`  Convertly (this extension, build scripts included): ${sourceUrl || '(repository URL not set)'}`);
out.push('  FFmpeg WebAssembly core 0.12.10 (build scripts with pinned component versions):');
out.push('    https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10');
out.push('  libheif-js 1.23.5 (libheif + libde265): https://github.com/catdad-experiments/libheif-js');
out.push('  All other components: the source repositories listed for each package below.');
out.push('');
out.push('Convertly bundles the open-source components listed below. All of them run');
out.push('locally inside the extension; none is loaded from the network.');
out.push('');

for (const [name, usage] of PACKAGES) {
  const dir = pkgDir(name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN';
  const homepage = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? pkg.homepage ?? '';
  summary.push({ name, version: pkg.version, license, usage, homepage: homepage.replace(/^git\+/, '').replace(/\.git$/, '') });

  out.push(rule('-'));
  out.push(`${name} ${pkg.version}`);
  out.push(`License: ${license}`);
  out.push(`Source: ${homepage.replace(/^git\+/, '').replace(/\.git$/, '')}`);
  out.push(`Used for: ${usage}`);
  out.push(rule('-'));
  if (name === '@ffmpeg/core') {
    out.push('The FFmpeg WebAssembly core (ffmpeg-core.js / ffmpeg-core.wasm) is distributed');
    out.push('unmodified from the npm package @ffmpeg/core@0.12.10. Complete corresponding');
    out.push('source code (build scripts and pinned component sources) is available at:');
    out.push('  https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10');
    out.push('  https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10');
    out.push('A copy of that source can also be requested from the Convertly maintainers.');
    out.push('');
    out.push('Statically linked components:');
    for (const [comp, lic, url] of FFMPEG_COMPONENTS) out.push(`  - ${comp} — ${lic} — ${url}`);
    out.push('');
    out.push('GNU General Public License, version 2 (or later):');
    out.push('');
    out.push(spdx['GPL-2.0-or-later'].licenseText.trim());
    out.push('');
    for (const id of ['LGPL-2.1-or-later', 'BSD-3-Clause', 'Zlib', 'FTL', 'ISC', 'WTFPL']) {
      out.push(rule('·'));
      out.push(`${spdx[id].name} (${id})`);
      out.push(rule('·'));
      out.push(spdx[id].licenseText.trim());
      out.push('');
    }
    continue;
  }
  if (name === 'libarchive.js') {
    out.push(licenseText(dir) ?? spdx.MIT.licenseText.trim());
    out.push('');
    out.push('Statically linked components of libarchive.wasm:');
    for (const [comp, lic, url] of LIBARCHIVE_COMPONENTS) out.push(`  - ${comp} — ${lic} — ${url}`);
    out.push('');
    for (const id of ['BSD-2-Clause', 'bzip2-1.0.6', '0BSD', 'Apache-2.0', 'OpenSSL']) {
      out.push(rule('·'));
      out.push(`${spdx[id].name} (${id})`);
      out.push(rule('·'));
      out.push(spdx[id].licenseText.trim());
      out.push('');
    }
    continue;
  }
  const text = licenseText(dir);
  if (text) out.push(text);
  else if (spdx[license]) out.push(spdx[license].licenseText.trim());
  else throw new Error(`No license text found for ${name} (${license})`);
  if (name === 'pdfjs-dist') {
    // PDF.js ships extra licenses for its bundled fonts and WASM decoders.
    for (const f of ['standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION', 'wasm/LICENSE_OPENJPEG', 'wasm/LICENSE_JBIG2', 'wasm/LICENSE_QCMS']) {
      const p = join(dir, f);
      if (!existsSync(p)) continue;
      out.push('');
      out.push(rule('·'));
      out.push(`pdfjs-dist/${f}`);
      out.push(rule('·'));
      out.push(readFileSync(p, 'utf8').trim());
    }
  }
  out.push('');
}

writeFileSync(join(root, 'THIRD_PARTY_LICENSES.txt'), out.join('\n') + '\n');
mkdirSync(join(root, 'src/generated'), { recursive: true });
writeFileSync(join(root, 'src/generated/licenses.json'), JSON.stringify(summary, null, 2) + '\n');

// Fail loudly if a bundled dependency has an unexpected license.
const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', '0BSD', '(MIT AND Zlib)', 'LGPL-3.0', 'GPL-2.0-or-later']);
const unexpected = summary.filter((s) => !ALLOWED.has(s.license));
if (unexpected.length) {
  console.error('Unexpected licenses:', unexpected);
  process.exit(1);
}
console.log(`licenses: ${summary.length} packages audited → THIRD_PARTY_LICENSES.txt`);
