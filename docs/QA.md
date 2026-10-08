# QA procedures

## 1. Automated (run before every release)

```bash
npm run release
```

This runs typecheck, lint, unit tests, build, the offline E2E suite (real Chrome, network forced
offline, every external request aborted **and recorded**, every console error recorded), the
release gate and packaging. Any external request or console error fails the run.

## 2. Zero-network manual test (spec §50)

1. `npm run build`, then load `dist/` in Chrome (Developer mode → Load unpacked).
2. **Turn Wi-Fi / Ethernet off** (or DevTools → Network → Offline on the Convertly tab).
3. Click the Convertly icon → **Open File Toolbox**.
4. Convert `test-fixtures/sample.jpg` → PNG (JPG → PNG).
5. Merge `sample.pdf` + `sample2.pdf` (expect 5 pages).
6. PDF → JPG on `sample.pdf` (expect a ZIP with 3 JPGs).
7. HEIC → JPG on `sample.heic`.
8. MP4 → MP3 on `sample.mp4`.
9. Create a ZIP with any files.
10. Extract `sample.7z` and `sample-rar5.rar` (Extract archive) and open `encrypted.zip` with the
    password `secret`.
11. Add page numbers to `sample10.pdf`, watermark an image, convert `sample.svg` to PNG.
12. Convert `animated.gif` to MP4 and merge `sample.mp4` + `silent.mp4`.
13. Confirm every result downloads and opens correctly.

Expected: all steps succeed with no network.

## 2b. Testing the exact release package

```bash
npm run release                     # builds dist/, tests it and writes release/convertly-<version>.zip
# unzip the package somewhere, then run the whole E2E suite against that folder:
CONVERTLY_DIST=/path/to/unzipped npx playwright test
```

`tests/e2e/realworld.spec.ts` adds real-world inputs (a PDF printed by Chrome with CJK/Greek
text, an 8000×6000 image, a 100-file batch). On Windows it can also use files made by the OS:

```powershell
$w = "$env:TEMP\cv-real"; New-Item -ItemType Directory -Force "$w\Relatórios 2026\Faturação\Março" | Out-Null
Set-Content -Encoding utf8 "$w\Relatórios 2026\Leia-me ção.txt" 'Conteúdo com acentos: ação, coração, 日本'
Set-Content -Encoding utf8 "$w\Relatórios 2026\Faturação\Março\fatura nº 1.csv" "produto;preço`ncafé;1,20"
Compress-Archive -Path "$w\Relatórios 2026" -DestinationPath "$w\windows-explorer.zip" -Force
Push-Location $w; tar.exe -czf windows-tar.tar.gz 'Relatórios 2026'; Pop-Location
Copy-Item C:\Windows\Web\Wallpaper\Windows\img0.jpg "$w\wallpaper-4k.jpg"
```

(Windows PowerShell 5.1's Compress-Archive writes `\` path separators — a good real-world check.)

## 3. Network audit (spec §51)

1. Open the Convertly tab, then DevTools (F12) → **Network**, enable **Preserve log**.
2. Run several conversions (image, PDF, video).
3. Filter by `-scheme:chrome-extension -scheme:blob -scheme:data`.
4. Expected: **zero rows** — no upload, no external request of any kind.

The same audit is automated in `tests/e2e/fixtures.ts` (`audit.external` must be empty after every
test). In addition, the CSP `connect-src 'self' blob: data:` makes external connections impossible.

## 4. Edge cases (spec §74) — where each is covered

| Case | Coverage |
| --- | --- |
| 0-byte file | unit `detect`, E2E detection + PDF merge (`empty.bin`, `empty.pdf`) |
| Corrupt file | unit `pdf`, `zip`; E2E batch with `corrupt.jpg`, `corrupt.pdf` |
| Wrong extension | unit `detect`; E2E detection (`png-named.jpg`) |
| Unicode / emoji / very long names | unit `utils`; E2E batch convert → ZIP names |
| 100 files | manual: select 100 images in Convert images (queue runs a few at a time) |
| Large image | E2E `large.jpg` (3000×2000) compress/resize; canvas limits → "Browser limitation" |
| 500-page PDF | manual: thumbnails render lazily (only visible pages), 1–2 at a time |
| Large video | manual: warning dialog ≥ 100 MB; one transcode at a time; OOM → clear error |
| Cancel midway | E2E media "cancel stops a running transcode" |
| Close / reopen UI | jobs live in the tab; closing cancels them; reopening starts clean (no stale state) |
| Multiple parallel jobs | unit `jobs` (media pool = 1), E2E batches |
| Password-protected PDF | E2E (structural tools refuse; PDF → image unlocks with password) |
| Zip-slip archive | unit `zip`, E2E extract (`zip-slip.zip`) |
| Animated GIF | unit `detect`, E2E (honest "first frame" note); GIF → MP4/WEBM converts every frame |
| Encrypted archives | E2E: ZIP wrong password → immediate "Wrong password", right password → extracted; encrypted RAR → honest "not supported" notice |
| Plain .gz vs .tar.gz | unit `gzip` (native DecompressionStream sniffing), E2E `notes.txt.gz`, `sample.tar.gz` |
| SVG with scripts / remote images | E2E: rendered as an image, script never runs, zero network requests |
| PDF text with non-Latin characters | E2E text → PDF: characters replaced by "?" and the count reported |
| Every tool, both languages | E2E `ui-catalog`: all 149 tools render in EN and PT, no raw keys, no console errors |
| Accessibility | E2E `ui-catalog`: axe WCAG 2.1 AA on 10 screens, no serious/critical violations |

## 5. Visual / accessibility checklist

- Light and dark themes (Settings → Theme), system theme follows the OS.
- Keyboard only: Tab through sidebar, tool options, buttons; Ctrl/Cmd+K palette (↑/↓/Enter/Esc);
  Ctrl/Cmd+O open files; Esc closes dialogs and the jobs drawer; PDF page grid: arrows, Space,
  Alt+arrows, Delete; trim handles: arrows / Shift+arrows.
- Focus ring visible on every interactive element.
- Status never relies on colour alone (badges carry text: "Completed", "Failed"…).
- Narrow window (≤ 960 px): sidebar collapses to a drawer; no horizontal scrolling.
- Portuguese: Settings → Language → Português; every screen translated.
