# Convertly — private file toolbox for Chrome

Convert, compress and edit images, PDFs, video, audio, archives and data files **directly in Chrome** —
74 tools (plus 75 one-click format shortcuts such as "HEIC → JPG" or "GIF → MP4").
Everything runs locally on your device: no backend, no uploads, no accounts, no analytics,
no remote code. The extension keeps working with Wi-Fi turned off.

> **Your files. Your device. Your privacy.**

---

## Contents

1. [Requirements](#requirements)
2. [Install dependencies](#install-dependencies)
3. [Development](#development)
4. [Build](#build)
5. [Load unpacked in Chrome](#load-unpacked-in-chrome)
6. [What's included (v1.1 toolset)](#whats-included-v11-toolset)
7. [Architecture](#architecture)
8. [Adding a tool](#adding-a-tool)
9. [Adding a converter](#adding-a-converter)
10. [Testing](#testing)
11. [Publishing](#publishing)
12. [Privacy architecture](#privacy-architecture)
13. [Third-party libraries](#third-party-libraries)
14. [Known limitations](#known-limitations)
15. [License](#license)

---

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 20 or newer (developed on 24) |
| npm | 10 or newer |
| Google Chrome | 120 or newer (`minimum_chrome_version`) |

## Install dependencies

```bash
npm install
```

All runtime libraries come from npm and are **bundled into `dist/`** at build time. Nothing is
downloaded at runtime.

## Development

```bash
npm run dev
```

Runs `vite build --watch` in development mode and writes an unpacked extension to `dist/`.
Load `dist/` once (see below); after each change click **Reload** on `chrome://extensions`
and refresh the Convertly tab. (A dev server cannot be used for extension pages.)

## Build

```bash
npm run build
```

Produces `dist/`, ready for **Load unpacked** and for packaging. No source maps are emitted in
production builds.

| Script | What it does |
| --- | --- |
| `npm run build` | License audit + production build into `dist/` |
| `npm run dev` | Development build in watch mode |
| `npm run typecheck` | TypeScript strict check (app + tests) |
| `npm run lint` | ESLint (bans `eval`, `console`, `any` and remote URLs in `src/`) |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests in real Chrome, **offline**, with a network audit |
| `npm run size-report` | Size of JS / CSS / WASM / workers / assets + estimated store ZIP |
| `npm run release:check` | Release gate (see [Publishing](#publishing)) |
| `npm run package` | Creates `release/convertly-<version>.zip` from `dist/` |
| `npm run release` | typecheck → lint → test → build → e2e → release gate → package |
| `npm run fixtures` | Regenerates synthetic test fixtures in `test-fixtures/` |
| `npm run icons` | Renders the PNG icons and store artwork |
| `npm run licenses` | Regenerates `THIRD_PARTY_LICENSES.txt` |

## Load unpacked in Chrome

1. `npm install && npm run build`
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the **`dist/`** folder
5. Pin Convertly and click its icon → **Open File Toolbox**

The first install opens the welcome screen.

## What's included (v1.1 toolset)

Every tool runs on the device. Tools are organised by category and, inside each category, by
section (Convert · Optimize · Edit · Organize · Create & combine · Extract · Format & encode ·
Privacy & integrity). The **All tools** page (`#/tools`) lists everything with an instant filter.

| Category | Tools |
| --- | --- |
| **Image (15)** | Batch convert (JPG, PNG, WEBP, HEIC/HEIF, BMP, TIFF, GIF, AVIF, ICO → JPG/PNG/WEBP, AVIF when the browser can encode it) · **SVG → PNG/JPG/WEBP** at any resolution (scripts never run, remote resources never load) · **Create ICO favicon** (16–256 px, multi-size) · compress (presets, quality, target size, before/after) · resize · visual crop (ratios, zoom, rotate, straighten, flip, **circle / rounded shapes**) · rotate/flip · **adjust & filters** (brightness, contrast, saturation, hue, black & white, sepia, invert, blur, presets, live preview) · **text watermark** (position grid, tiled, opacity, angle, colour, live preview) · **combine images** (side by side, stacked, grid) · **split image** into tiles (Instagram carousels) · **images → animated GIF** · **images → MP4 slideshow** · metadata viewer + remover · images → PDF |
| **PDF (16)** | Merge · split · organize (thumbnails, drag & drop, rotate, duplicate, delete, reverse, **insert blank page**, undo, keyboard) · rotate · delete pages · extract pages · PDF → JPG/PNG (72/150/300 DPI, password-protected PDFs) · **PDF → text** · **text → PDF** · **extract embedded images** · **page numbers** (6 positions, 4 styles, start number, skip cover) · **text watermark** (diagonal, horizontal, tiled) · **crop margins** (CropBox, text stays selectable) · compress (real, measured) · **repair** (lenient re-parse, rebuilt xref) · metadata view/edit/remove |
| **Video (13)** | Convert (MP4, MOV, WEBM, AVI, MKV, MPEG, 3GP, WMV and **GIF** → MP4/WEBM/MOV/MKV, lossless remux when possible) · video → audio (MP3, WAV, M4A, AAC, OGG, FLAC, OPUS) · video → GIF · **video → images** (frames every N seconds) · compress · resize · trim · **crop to 9:16 / 1:1 / 4:5 / 16:9** · rotate/flip · **change speed** (0.25×–4×, pitch-preserving audio) · mute · **add music** (replace or mix, loop) · **merge videos** |
| **Audio (8)** | Convert (MP3, WAV, AAC, M4A, OGG, OPUS, FLAC, WEBM audio, WMA → MP3/WAV/M4A/AAC/OGG/FLAC/OPUS, **mono/stereo, sample rate**) · change bitrate · **volume / normalize (−16 LUFS)** · trim with waveform · **fade in/out** · **change speed** · **reverse** · **merge audio** |
| **Archive (4)** | Create ZIP (files and folders) · **create TAR / TAR.GZ / GZ** · extract ZIP (zip-slip safe) · **extract any archive: 7Z, RAR (RAR4/RAR5), TAR, TAR.GZ/BZ2/XZ, GZ, ISO, ZIP — including password-protected ZIP** (libarchive in WebAssembly). Search shortcuts: "Extract RAR", "Extract 7Z", "Extract TAR" |
| **Data (18)** | JSON format/minify/validate · JSON ↔ CSV · **Excel XLSX ↔ CSV/JSON** (all sheets, preview) · XML format · XML ↔ JSON · **YAML ↔ JSON** · **Markdown → HTML** · Text ↔ Base64 · File ↔ Base64 · URL encode/decode · **file checksum (MD5, SHA-1, SHA-256) with verification** |

Plus: universal file detection (magic bytes), instant search with aliases (EN/PT), command palette
(Ctrl/Cmd+K), open files (Ctrl/Cmd+O), global drag & drop, clipboard paste (Ctrl+V), job queue with
real progress / cancel / retry, favorites, recent tools, dark/light themes, English and Portuguese.

## Architecture

```
FILE ──► browser memory ──► Web Worker (JS / WebAssembly) ──► result Blob ──► chrome.downloads
                     (never: FILE ──► upload ──► server)
```

```
src/
  app/            App shell, router, global drop/paste/shortcuts, hand-off, confirmations
  popup/          Toolbar popup (Open File Toolbox, recent tools)
  background/     Minimal stateless MV3 service worker (opens welcome on install)
  core/           Job engine, worker pool/RPC, download engine, detection, errors, capabilities
  engines/        Conversion engines — no UI code
    image/        decode → transform → encode pipeline, EXIF reader / stripper, TIFF
    heic/         libheif (WASM) decoder
    pdf/          pdf-lib operations, compression, PDF.js rendering
    ffmpeg/       FFmpeg argument builders, ffprobe parsing, log → error/progress mapping
    zip/          streaming writer (fflate), safe central-directory reader, CRC-32, hashing
    archive/      libarchive (WASM) reader for 7Z/RAR/TAR/ISO, TAR writer, gzip helpers
    data/         JSON, CSV, XML, YAML, XLSX, Markdown, Base64, URL, hashes (pure functions)
  workers/        image / pdf / zip / ffmpeg workers + RPC
  registry/       formats, tool registry, conversion matrix, search
  tools/          Tool UIs (image, pdf, media, archive, data) + shared building blocks
  ui/             Design-system components, layout (sidebar, topbar, palette, jobs), pages
  storage/        chrome.storage wrappers (settings, recent, favorites) — never file data
  i18n/           Typed dictionaries (en, pt)
  styles/         CSS tokens (light/dark), base, layout, components
public/           Locales for the manifest, icons
scripts/          Build/QA scripts (licenses, icons, fixtures, size report, release gate, package)
tests/unit        Vitest unit tests (engines, registry, search, jobs, manifest policy)
tests/e2e         Playwright tests in real Chrome, offline, with network audit
test-fixtures/    Small synthetic fixtures (all generated by scripts, legally safe)
docs/             Store listing, privacy, permissions, FFmpeg codec table, QA checklists
store/            Web Store icon and promo artwork
```

Key design decisions:

- **Preact + Vite** — 4 KB UI runtime, predictable bundles, each tool is its own lazy chunk.
- **Tool registry** (`src/registry/tools.ts`) — every tool is data (id, category, section, accepted
  formats, outputs, engine, required capabilities, component). The sidebar, category pages, the
  "All tools" page, search, detection suggestions, popup and routing are all generated from it.
  Format pairs ("JPG → PNG") and search-only shortcuts ("Extract RAR") reuse generic tools with a preset.
- **Conversion matrix** (`src/registry/matrix.ts`) — the single source of truth for "what can this
  become"; outputs without an encoder (e.g. AVIF when the browser cannot encode it) never appear.
- **Feature detection** (`src/core/capabilities.ts`) — WebAssembly, Workers, OffscreenCanvas,
  canvas encoders, Web Audio; tools that cannot run are hidden or disabled with an explanation.
- **Job engine** (`src/core/jobs.ts`) — every conversion is a job (`queued → preparing → processing
  → finalizing → completed | failed | cancelled`) scheduled in resource pools: images use a few
  workers (based on `navigator.hardwareConcurrency`), FFmpeg runs **one transcode at a time**.
- **Real cancellation** — cancelling aborts the job's signal, which **terminates its worker**
  (the only way to stop WASM), releases its memory and returns the UI to a clean state.
- **Memory** — Object URLs are revoked after use, idle workers are terminated (20–45 s),
  FFmpeg reads inputs lazily through WORKERFS (no copy into WASM memory), results are dropped
  when a job is removed. Covered by `tests/e2e/memory.spec.ts`.
- **MV3** — the service worker holds no state; the app runs in a normal extension tab, so no
  offscreen document (and no `offscreen` permission) is required.

## Adding a tool

1. **Engine** — put pure processing code in `src/engines/<area>/` (no UI). If it is heavy, expose
   it from a worker in `src/workers/` using `expose({...})` and call it through a `WorkerPool`.
2. **UI** — create `src/tools/<area>/MyTool.tsx` exporting a default component `({ tool }) => …`.
   Use `useToolFiles`, `Dropzone`, `FileList`, `OptionsCard`, `startJobs`/`startCombinedJob` and
   `JobGroupView` to get detection, validation, jobs, progress, results and downloads for free.
3. **Register the component** in `src/tools/index.ts` (lazy import) and its key in
   `ToolComponentKey` (`src/registry/types.ts`).
4. **Register the tool** in `TOOLS` (`src/registry/tools.ts`): id, category, **group** (section on
   the category page), icon, accepted formats, outputs, engine, required capabilities, keywords.
5. **Translate** `tool.<id>.title` and `tool.<id>.desc` in `src/i18n/locales/en.ts` and `pt.ts`
   (TypeScript fails the build if a language misses a key).
6. **Test** — unit tests for the engine, an E2E test for the tool.

## Adding a converter

- New **image** output: add it to `IMAGE_ENCODERS` and the encoder check in `matrix.ts`
  (and `MIME` in `engines/image/pipeline.ts`).
- New **format pair** shortcut ("X → Y" in search/detection): add `imagePair(...)`,
  `videoPair(...)`, `audioPair(...)` etc. at the bottom of `TOOLS`.
- New **media format**: add it to `FORMATS` (`registry/formats.ts`), to `VIDEO_INPUTS`/
  `AUDIO_INPUTS`/`*_OUTPUTS` in `matrix.ts`, add encoder arguments in
  `engines/ffmpeg/commands.ts`, a fixture in `scripts/generate-fixtures.mjs` and the combination to
  `tests/e2e/media-matrix.spec.ts`. Only advertise codecs that the bundled FFmpeg build really
  contains (see `docs/FFMPEG.md`).
- New **language**: add `src/i18n/locales/xx.ts` typed as `Record<keyof typeof en, string>`,
  register it in `DICTIONARIES`/`LANGUAGES` (`src/i18n/index.ts`) and add `public/_locales/xx/`.

## Testing

```bash
npm run test        # 143 unit tests: engines, detection, metadata, PDF, ZIP/TAR/gzip, XLSX/YAML/XML, FFmpeg args, registry, search, jobs, manifest
npm run build
npm run test:e2e    # real Chrome, offline, network audit, console-error audit
```

- **Unit tests** (`tests/unit`) run in Node against the real engines and the fixtures.
- **E2E tests** (`tests/e2e`) launch Chrome with a temporary profile, load `dist/` with the CDP
  `Extensions.loadUnpacked` command, force the browser **offline** and abort + record every
  non-extension request. Each test fails on any external request or console error. They cover the
  spec's offline checklist (JPG→PNG, merge PDFs, PDF→JPG, HEIC→JPG, MP4→MP3, ZIP…), every
  image/PDF/archive/data tool, the **FFmpeg codec matrix** (8 video inputs × 4 video outputs,
  video → 7 audio formats, 8 audio inputs × 7 audio outputs), cancellation, password-protected
  PDFs, zip-slip archives, corrupt/empty/wrong-extension/unicode/emoji/long file names, search,
  palette, paste, settings, mobile layout, and a **memory-leak test** (object URLs, workers, heap).
  v1.1 adds an E2E test for **every new tool** (outputs verified by signature, pixels, page count,
  extracted text, duration or checksum), archive extraction for 7Z/RAR4/RAR5/TAR.GZ/BZ2/XZ/ISO/GZ,
  password-protected ZIP (wrong + right password), an **all-tools render test** (all 149 tools in
  English and Portuguese, no missing strings, no console errors) and an **axe accessibility audit**
  (WCAG 2.1 AA, no serious/critical violations).
- By default the E2E suite uses the installed **Google Chrome** (`channel: 'chrome'`). Set
  `CONVERTLY_E2E_CHANNEL=chromium` to use Playwright's Chromium instead
  (`npx playwright install chromium`).
- Manual offline and network-audit procedures: [`docs/QA.md`](docs/QA.md).

Fixtures are synthetic and regenerated with `npm run fixtures` (images via canvas, media via the
bundled FFmpeg, PDFs via pdf-lib, encrypted PDF via RC4). `sample.heic` is produced on Windows by
`scripts/make-heic.ps1` (the WASM x265 encoder cannot run single-threaded).

## Publishing

1. Bump `version` in `package.json` (the manifest version is taken from it).
2. `npm run release` — runs every check and writes `release/convertly-<version>.zip`.
   The **release gate** (`scripts/release-check.mjs`) only passes when:
   Manifest V3 is valid · no remote JS · no remote WASM · no CDN · no backend endpoint ·
   no localhost/dev scripts/source maps · icons present · permissions minimized ·
   CSP blocks the network · privacy copy accurate · licenses shipped · build reproducible ·
   offline E2E passed (no console errors, zero external requests).
3. Upload the ZIP in the [Chrome Web Store developer dashboard](docs/STORE.md) and use the texts,
   screenshots and permission justifications from `docs/STORE.md`.

## Privacy architecture

- **No network**: the extension-page CSP is
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; …`
  — even a bug could not send data to a remote host.
- **No remote code**: every JS, CSS, font, worker and WASM file is inside the package.
- **Permissions**: `storage` (preferences) and `downloads` (save results, optional sub-folder or
  "Save as"). No host permissions, no `tabs`, no `<all_urls>`, no content scripts.
- **Storage**: settings, favorite tool ids and (optional) recent tool ids + dates. Never file
  names or contents. "Clear recent activity" is one click.
- **No analytics, telemetry or accounts.**

Full policy: [`docs/PRIVACY.md`](docs/PRIVACY.md) (also shown inside the app).

## Third-party libraries

| Library | License | Used for |
| --- | --- | --- |
| Preact | MIT | UI |
| lucide-preact | ISC | Icons |
| pdf-lib (+ @pdf-lib/standard-fonts, @pdf-lib/upng, pako, tslib) | MIT / Zlib / 0BSD | PDF editing |
| PDF.js (pdfjs-dist, legacy build) | Apache-2.0 | PDF rendering |
| @ffmpeg/core 0.12.10 (FFmpeg 5.1.4 + x264, x265, libvpx, LAME, Opus, Vorbis…) | GPL-2.0-or-later | Video & audio |
| libheif-js (libheif + libde265) | LGPL-3.0 | HEIC/HEIF decoding |
| fflate | MIT | ZIP / deflate / gzip |
| UTIF.js | MIT | TIFF decoding |
| libarchive.js 2.0.2 (libarchive 3.7.2, zlib, bzip2, liblzma, OpenSSL) + comlink | MIT / BSD-2-Clause / Zlib / bzip2 / 0BSD / Apache-2.0 | Reading 7Z, RAR, TAR, ISO… |
| yaml | ISC | YAML ↔ JSON |
| marked | MIT | Markdown → HTML |

`npm run licenses` audits the bundled packages and writes `THIRD_PARTY_LICENSES.txt` (shipped
inside the extension and viewable from **About**).

## Known limitations

- **Single-threaded FFmpeg**: transcoding large or long videos is CPU-heavy and slower than a
  native app. Fast (stream-copy) paths are used automatically whenever codecs allow it.
- **AV1 input** is not supported (FFmpeg 5.1's AV1 decoder needs hardware acceleration).
- **HEVC/H.265 encoding** is not offered (x265 cannot run without threads in WASM).
- **AVIF output** appears only when Chrome can encode AVIF in a canvas.
- **Animated GIF/WebP/APNG** inputs are converted from their first frame (the app says so).
- **Password-protected PDFs** can be rendered (PDF → image) with the password, but not edited.
- **Archives**: password-protected **ZIP** files are supported in "Extract archive"; encrypted
  **RAR and 7-Zip** archives are not (libarchive has no decryption for them) — the app says so.
  Creating 7Z/RAR is not offered (no reliable encoder in WASM). ZIP files > 4 GB are not supported.
- **Video → images**: FFmpeg writes PNG frames; JPG frames are encoded by the browser (the
  FFmpeg MJPEG encoder is unreliable in this WASM build).
- **PDF text tools** use the standard PDF fonts (Western European characters); other characters
  are replaced by "?" and the app reports how many. **PDF → text** has no OCR for scanned pages.
- Jobs live in the open tab; closing the tab cancels running jobs (results are never persisted).

## License

Convertly is **free software**: you can redistribute it and/or modify it under the terms of the
**GNU General Public License v3.0 or later** (see [`LICENSE`](LICENSE)). It is distributed in the
hope that it will be useful, but WITHOUT ANY WARRANTY.

GPL-3.0-or-later was chosen because the bundled FFmpeg core is GPL-2.0-or-later (x264/x265) and
libheif is LGPL-3.0; every other bundled component uses a GPL-3.0-compatible permissive license
(MIT, ISC, BSD, Apache-2.0, Zlib, 0BSD). Corresponding Source:

- Convertly (this repository, including the build scripts that produce the store package).
- FFmpeg WebAssembly core 0.12.10 — [ffmpegwasm/ffmpeg.wasm @ v0.12.10](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10)
  (build scripts pinning FFmpeg 5.1.4, x264, x265, libvpx, LAME, Opus, Vorbis… versions).
- libheif-js 1.23.5 — [catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js).

The same information ships inside the extension (`THIRD_PARTY_LICENSES.txt`, **About → Source code**).
The release gate refuses to build a store package without the public repository URL in
`package.json`.
