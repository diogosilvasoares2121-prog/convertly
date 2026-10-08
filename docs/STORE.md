# Chrome Web Store listing pack

## Single purpose

> Local file conversion, compression and manipulation.

Every feature converts, compresses or edits a file the user selects, entirely on the device.

## Name

**Convertly — Private File Converter** (34 characters; limit 75)
Portuguese: **Convertly — Conversor de Ficheiros Privado**

## Short description (manifest `description`, limit 132)

> Convert, compress and edit images, PDFs, video, audio and archives directly in Chrome. Files never leave your device.

(117 characters)

## Detailed description

**PRIVATE FILE CONVERSION — right in Chrome.**
No uploads. No accounts. No waiting queues. No servers.

Convertly is a complete file toolbox — 74 tools — that runs 100% on your computer. Your files are
processed in your browser with WebAssembly and never leave your device — it even works offline.

**Images**
• Convert JPG, PNG, WEBP, HEIC (iPhone photos), BMP, TIFF, GIF and AVIF — one file or hundreds
• Compress with quality presets or a target size, with before/after comparison
• Resize (social media presets, pixels or percent), crop (also circle/rounded), rotate and flip
• Filters & adjustments, text watermarks, combine images, split into Instagram grids
• SVG to PNG/JPG, create ICO favicons, photos to animated GIF or MP4 slideshow
• View EXIF/GPS data and remove it to create clean copies
• Turn images into a PDF

**PDF**
• Merge, split, organize, rotate, delete and extract pages with thumbnails
• PDF to JPG/PNG at 72, 150 or 300 DPI · PDF to text · text to PDF · extract images
• Page numbers, watermarks, crop margins, insert blank pages, repair damaged PDFs
• Edit or remove metadata · honest compression (real results only)

**Video & audio** (powered by FFmpeg running inside Chrome)
• MOV, AVI, MKV, WEBM, MPEG, 3GP, WMV, GIF → MP4, WEBM, MOV, MKV
• Extract audio to MP3, WAV, M4A, OGG, FLAC… · Video to GIF · Video to images
• Trim, crop for Reels/Shorts, speed up/slow down, merge clips, add music, resize, mute, rotate, compress
• Convert audio (mono/stereo, sample rate), change bitrate, volume/normalize, fade, speed, reverse, merge

**Archives & data**
• Create ZIP, TAR, TAR.GZ and GZ · safely extract ZIP, 7Z, RAR, TAR, GZ, BZ2, XZ and ISO
• Password-protected ZIP files (the password never leaves your device)
• Excel ↔ CSV/JSON, JSON formatter, JSON ↔ CSV, XML ↔ JSON, YAML ↔ JSON, Markdown → HTML
• Base64, URL encode/decode, MD5/SHA-1/SHA-256 checksums

**Built for privacy**
• Files are never uploaded — there is no Convertly server
• No analytics, no tracking, no account
• Works with Wi-Fi off
• Minimal permissions: storage + downloads only
• Free and open source (GPL-3.0) — anyone can verify how files are processed

Supports dozens of popular file formats. Available in English and Portuguese.

## Category

Productivity (alternatively: Tools)

## Permission justifications (developer dashboard)

| Permission | Justification |
| --- | --- |
| `storage` | Stores the user's preferences (theme, language, default quality, download folder), favorite tools and, optionally, recently used tool ids. No file data is stored. |
| `downloads` | Saves converted files through Chrome's download manager, optionally into a user-chosen sub-folder of Downloads or with a "Save as" dialog, and lets Convertly release memory once a download finishes. |

**Remote code:** No. All JavaScript and WebAssembly is included in the package. The CSP
(`script-src 'self' 'wasm-unsafe-eval'`) is required to run the bundled WebAssembly (FFmpeg,
libheif, libarchive, PDF.js decoders).

**Host permissions:** none.

## Data usage disclosures (privacy practices tab)

- Does the extension collect user data? **No.**
- Personally identifiable information, health, financial, authentication, personal
  communications, location, web history, user activity, website content: **not collected**.
- Certify: data is not sold, not used for unrelated purposes, not used for creditworthiness.
- Privacy policy URL: https://diogosilvasoares2121-prog.github.io/convertly/privacy.html
  (GitHub Pages, served from `docs/privacy.html` on `main`).
- Homepage URL: https://diogosilvasoares2121-prog.github.io/convertly/
- Support URL: https://github.com/diogosilvasoares2121-prog/convertly/issues

## Assets

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `store/icon-128.png` | 128×128 (96×96 artwork + transparent padding) |
| Small promo tile | `store/promo-small-440x280.png` | 440×280 |
| Screenshots | `store/screenshots/*.png` | 1280×800 (generate with `node scripts/screenshots.mjs` after a build) |
| Extension icons | `public/icons/icon-{16,32,48,128}.png` | — |

Generated screenshots (`node scripts/screenshots.mjs`): 1 Home · 2 All tools · 3 batch convert
result · 4 PDF watermark preview · 5 archive extraction · 6 image watermark · 7 PDF page organizer ·
8 video → MP3 · 9 detection (dark). The store shows up to 5: upload 1–5 (6–9 are alternates).

## Positioning rules

- Message: **PRIVATE FILE CONVERSION** — no uploads, no accounts, no waiting queues, no servers.
- Never claim "supports every file format"; use "Supports dozens of popular file formats".
- Never mention downloading from websites/streams (not a feature, and out of scope).
