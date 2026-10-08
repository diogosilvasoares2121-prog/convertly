#!/usr/bin/env node
/**
 * Release gate (spec §98). Statically audits dist/ and prints PASS/FAIL per rule.
 * Runtime gates (offline E2E, console errors, network audit) are covered by
 * `npm run test:e2e`; `npm run release` runs both.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const root = process.cwd();
const dist = join(root, 'dist');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json missing — run npm run build first.');
  process.exit(1);
}

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = walk(dist).map((p) => relative(dist, p).replace(/\\/g, '/'));
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const codeFiles = files.filter((f) => /\.(js|mjs|html|css|json)$/.test(f) && !f.startsWith('vendor/pdfjs/cmaps/'));
const read = (f) => readFileSync(join(dist, f), 'utf8');

// 1. Manifest V3 valid
const mvErrors = [];
if (manifest.manifest_version !== 3) mvErrors.push('manifest_version must be 3');
for (const k of ['name', 'version', 'description', 'icons', 'action', 'background']) if (!manifest[k]) mvErrors.push(`missing ${k}`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) mvErrors.push('invalid version');
if (manifest.background?.service_worker && !files.includes(manifest.background.service_worker)) mvErrors.push('service worker file missing');
if (!files.includes(manifest.action?.default_popup)) mvErrors.push('popup missing');
const locales = files.filter((f) => f.startsWith('_locales/') && f.endsWith('messages.json'));
for (const l of locales) {
  const m = JSON.parse(read(l));
  if (!m.extName || m.extName.message.length > 75) mvErrors.push(`${l}: extName missing/too long`);
  if (!m.extDescription || m.extDescription.message.length > 132) mvErrors.push(`${l}: description missing/too long`);
}
check('Manifest V3 valid', mvErrors.length === 0, mvErrors.join('; '));

// 2. Icons present with the declared sizes
const iconErrors = [];
const pngSize = (f) => {
  const b = readFileSync(join(dist, f));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
for (const [size, f] of Object.entries({ ...manifest.icons, ...manifest.action.default_icon })) {
  if (!files.includes(f)) iconErrors.push(`${f} missing`);
  else {
    const [w, h] = pngSize(f);
    if (w !== Number(size) || h !== Number(size)) iconErrors.push(`${f} is ${w}x${h}, expected ${size}`);
  }
}
check('No missing icons', iconErrors.length === 0, iconErrors.join('; '));

// 3. Permissions minimised
const allowedPerms = new Set(['storage', 'downloads']);
const permErrors = [];
for (const p of manifest.permissions ?? []) if (!allowedPerms.has(p)) permErrors.push(`unexpected permission ${p}`);
for (const k of ['host_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources']) if (manifest[k]) permErrors.push(`${k} present`);
check('Permissions minimized (storage, downloads only; no hosts)', permErrors.length === 0, permErrors.join('; '));

// 4. CSP: local code only, no network
const csp = manifest.content_security_policy?.extension_pages ?? '';
const cspErrors = [];
if (!/script-src 'self' 'wasm-unsafe-eval'(;|$)/.test(csp)) cspErrors.push('script-src must be self + wasm-unsafe-eval only');
if (!/connect-src 'self' blob: data:(;|$)/.test(csp)) cspErrors.push('connect-src must block remote hosts');
if (/https?:|\*/.test(csp)) cspErrors.push('remote source in CSP');
check('CSP blocks remote code and network', cspErrors.length === 0, cspErrors.join('; '));

// 5. No remote JS / WASM / CDN / backend endpoints in shipped code
// URLs that only appear as XML namespaces, license notes, library doc links or URL-parser
// self-test strings inside libraries (e.g. PDF.js uses "http://example.com" / "https://foo.bar"
// to feature-detect URL parsing). None is ever fetched — the CSP would block it anyway.
const ALLOWED_URL = /^https?:\/\/(www\.xfa\.org|example\.com|foo\.bar|www\.w3\.org|ns\.adobe\.com|purl\.org|xmlns\.com|www\.npmjs\.com|github\.com|mozilla\.github\.io|docs\.github\.com|developer\.mozilla\.org|bugzil\.la|bugs\.chromium\.org|crbug\.com|fsf\.org|www\.gnu\.org|tc39\.es|feross\.org|opensource\.org|www\.apache\.org|ffmpeg\.org|issues\.chromium\.org|webassembly\.org|emscripten\.org|iptc\.org|www\.color\.org|schemas\.openxmlformats\.org|cipa\.jp|aomedia\.org|unicode\.org|www\.unicode\.org|rolldown\.rs)(\/|$)/;
const CDN = /(unpkg\.com|jsdelivr\.net|cdnjs|googleapis\.com|gstatic\.com|cloudflare|firebase|supabase|amazonaws|vercel|netlify|herokuapp|analytics|sentry\.io|mixpanel|segment\.io)/i;
const remote = [];
const cdnHits = [];
for (const f of codeFiles) {
  const text = read(f);
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    const url = m[0];
    // Not a resolvable remote host (library self-test strings such as https://a or template placeholders).
    const host = url.replace(/^https?:\/\//, '').split(/[/?#@:]/)[0] ?? '';
    if (!host.includes('.') || /[^\x21-\x7e]/.test(host) || host.includes('$')) continue;
    if (CDN.test(url)) cdnHits.push(`${f}: ${url}`);
    else if (!ALLOWED_URL.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) remote.push(`${f}: ${url}`);
  }
  if (/\bimport\s*\(\s*["'`]https?:/.test(text) || /importScripts\(\s*["'`]https?:/.test(text)) remote.push(`${f}: remote import`);
}
check('No CDN / analytics / backend endpoints', cdnHits.length === 0, cdnHits.slice(0, 5).join('; '));
check('No unexpected remote URLs (remote JS/WASM)', remote.length === 0, [...new Set(remote)].slice(0, 8).join('\n      '));

// 6. All WASM bundled locally
const wasm = files.filter((f) => f.endsWith('.wasm'));
const REQUIRED_WASM = ['vendor/ffmpeg/ffmpeg-core.wasm', 'vendor/libarchive/libarchive.wasm'];
check('WASM bundled locally', REQUIRED_WASM.every((w) => wasm.includes(w)) && files.includes('vendor/libarchive/worker-bundle.js'), wasm.join(', '));

// 7. No localhost / dev artifacts / source maps / console spam in our code
const devHits = [];
for (const f of codeFiles) {
  const text = read(f);
  if (/sourceMappingURL=/.test(text)) devHits.push(`${f}: sourcemap reference`);
  if (/\/\/(localhost|127\.0\.0\.1):\d+/.test(text)) devHits.push(`${f}: localhost URL`);
  if (/@vite\/client|import\.meta\.hot/.test(text)) devHits.push(`${f}: dev client`);
}
if (files.some((f) => f.endsWith('.map'))) devHits.push('.map files present');
check('No sourcemaps, localhost URLs or dev scripts', devHits.length === 0, devHits.join('; '));

// 8. Our own source has no console.log / TODO placeholders
const srcFiles = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
const srcHits = [];
for (const f of srcFiles) {
  const text = readFileSync(f, 'utf8');
  if (/\bconsole\.(log|debug|info|warn)\(/.test(text)) srcHits.push(`${relative(root, f)}: console call`);
  // Case-sensitive markers: "todo" is an ordinary Portuguese word ("em todo o lado").
  if (/\b(TODO|FIXME|XXX)\b/.test(text) || /coming soon|em breve/i.test(text)) srcHits.push(`${relative(root, f)}: placeholder`);
}
check('No console spam or TODO placeholders in source', srcHits.length === 0, srcHits.join('; '));

// 9. Privacy copy accurate: claims match the build
const en = readFileSync(join(root, 'src/i18n/locales/en.ts'), 'utf8');
const privacyErrors = [];
if (!en.includes('does not operate a file-processing server')) privacyErrors.push('privacy intro missing');
if (!en.includes('No analytics or tracking SDKs are included')) privacyErrors.push('analytics statement missing');
if (/supports every file format/i.test(en)) privacyErrors.push('overclaim: "supports every file format"');
const lock = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys(lock.dependencies ?? {});
if (deps.some((d) => /analytics|sentry|mixpanel|segment|amplitude|posthog|firebase|supabase|gtag/i.test(d))) privacyErrors.push('analytics/backend dependency present');
check('Privacy copy accurate (no analytics, no server)', privacyErrors.length === 0, privacyErrors.join('; '));

// 10. No forbidden features (downloaders, DRM, native messaging…)
const forbidden = [];
for (const f of codeFiles) {
  const text = read(f);
  if (/nativeMessaging|connectNative|sendNativeMessage/.test(text)) forbidden.push(`${f}: native messaging`);
  if (/youtube\.com|tiktok\.com|instagram\.com|netflix\.com/i.test(text)) forbidden.push(`${f}: streaming site reference`);
}
check('No downloaders / native messaging / scraping', forbidden.length === 0, forbidden.join('; '));

// 11. Third-party licenses shipped
check('THIRD_PARTY_LICENSES included', files.includes('THIRD_PARTY_LICENSES.txt') && read('THIRD_PARTY_LICENSES.txt').includes('GNU GENERAL PUBLIC LICENSE'));

// 11b. GPL: Convertly is GPL-3.0-or-later and points to its public Corresponding Source.
{
  const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const url = String(own.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
  const gplErrors = [];
  if (own.license !== 'GPL-3.0-or-later') gplErrors.push(`package.json license is ${own.license}`);
  if (!existsSync(join(root, 'LICENSE'))) gplErrors.push('LICENSE file missing');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(url)) gplErrors.push('package.json repository.url must be the public GitHub repository');
  else {
    if (!read('THIRD_PARTY_LICENSES.txt').includes(url)) gplErrors.push('source URL missing from THIRD_PARTY_LICENSES.txt');
    if (!codeFiles.some((f) => f.endsWith('.js') && read(f).includes(url))) gplErrors.push('source URL missing from the app (About page)');
  }
  check('Free software: GPL-3.0-or-later with a public source link', gplErrors.length === 0, gplErrors.join('; '));
}

// 12. Reproducible: lockfile present and exact dependency versions
const exact = Object.values({ ...lock.dependencies, ...lock.devDependencies }).every((v) => /^\d/.test(v));
check('Build reproducible (lockfile + pinned versions)', existsSync(join(root, 'package-lock.json')) && exact);

// 13. Offline E2E evidence (written by the Playwright suite)
const report = join(root, 'e2e-results', 'results.json');
let e2e = null;
if (existsSync(report)) {
  const stats = JSON.parse(readFileSync(report, 'utf8')).stats ?? {};
  e2e = { passed: stats.expected ?? 0, failed: (stats.unexpected ?? 0) + (stats.flaky ?? 0) };
}
check('Offline E2E passed (no console errors, zero external requests)', !!e2e && e2e.failed === 0 && e2e.passed > 0, e2e ? `${e2e.passed} passed, ${e2e.failed} failed` : 'run npm run test:e2e');

// Fingerprint for reproducibility.
const hash = createHash('sha256');
for (const f of [...files].sort()) hash.update(f).update(readFileSync(join(dist, f)));
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  commit = 'n/a';
}

console.log('\nConvertly release gate\n');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `\n      ${r.detail}` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed · version ${manifest.version} · dist sha256 ${hash.digest('hex').slice(0, 16)} · commit ${commit}`);
if (failed) process.exit(1);
