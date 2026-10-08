# FFmpeg build and codec support table

Convertly bundles **`@ffmpeg/core@0.12.10`** unmodified (`vendor/ffmpeg/ffmpeg-core.js` + `.wasm`,
~31 MB). It is the **single-threaded** build of **FFmpeg 5.1.4** compiled with Emscripten 3.1.40.

Configuration (from `ffmpeg -version`):

```
--enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame
--enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp
--enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg --disable-pthreads
```

Why single-threaded: the multi-threaded core requires `SharedArrayBuffer` (cross-origin isolation)
and is known to hang on some commands. Stability first; fast paths (stream copy) are used whenever
the codecs allow, so many conversions are instant.

## How the app uses it

- One FFmpeg worker per transcode, **one transcode at a time** (job pool `media`).
- Inputs are mounted with **WORKERFS** (lazy reads from the `File`, no copy into WASM memory).
- `ffprobe` (same core, separate short-lived worker) inspects every input first: duration,
  streams and codecs. Inputs whose video codec cannot be decoded are rejected with
  "Unsupported codec" **before** any work starts.
- Progress = `time=` from FFmpeg stats ÷ duration from ffprobe (real progress, never simulated).
- Cancel terminates the worker (frees the WASM heap immediately).
- Quirk: this core's `ffprobe()` never sets its exit code (always `-1`); success is detected by the
  output file being written.

## Verified support table

✓ = covered by `tests/e2e/media-matrix.spec.ts` (real conversion of a fixture, output verified by
signature). The UI only offers these combinations.

### Video → video

| Input container | Input codecs in fixture | → MP4 (H.264/AAC) | → WEBM (VP8/Opus) | → MOV (H.264/AAC) | → MKV (H.264/AAC) |
| --- | --- | --- | --- | --- | --- |
| MP4 | H.264 + AAC | ✓ (stream copy) | ✓ | ✓ (copy) | ✓ (copy) |
| MOV | H.264 + AAC | ✓ (copy) | ✓ | ✓ (copy) | ✓ (copy) |
| WEBM | VP8 + Vorbis | ✓ | ✓ (copy) | ✓ | ✓ (copy) |
| AVI | MPEG-4 Part 2 + MP3 | ✓ | ✓ | ✓ | ✓ (copy) |
| MKV | H.264 + Opus | ✓ | ✓ | ✓ | ✓ (copy) |
| MPEG/MPG | MPEG-1 + MP2 | ✓ | ✓ | ✓ | ✓ |
| 3GP | MPEG-4 + AAC | ✓ | ✓ | ✓ | ✓ (copy) |
| WMV/ASF | WMV2 + WMA2 | ✓ | ✓ | ✓ | ✓ |

Decoders also present (not exhaustively tested): HEVC/H.265, VP9, ProRes, MJPEG, Theora, H.263,
MPEG-2, WMV1/3, VC-1, DV.
**Not supported:** AV1 (FFmpeg 5.1 native AV1 decoder requires hardware acceleration).

### Video → audio and audio → audio

| Output | Encoder | From video (8 containers) | From audio (WAV, MP3, M4A, OGG, FLAC, AAC, OPUS, WMA) |
| --- | --- | --- | --- |
| MP3 | libmp3lame | ✓ | ✓ |
| WAV | pcm_s16le | ✓ (MP4) | ✓ |
| M4A | aac (native) | ✓ (MP4, copy) | ✓ |
| AAC (ADTS) | aac (native) | ✓ (MP4, copy) | ✓ |
| OGG | libvorbis | ✓ (MP4) | ✓ |
| FLAC | flac | ✓ (MP4) | ✓ |
| OPUS | libopus | ✓ (MP4) | ✓ |

### Other operations (all ✓ in E2E)

| Operation | Method |
| --- | --- |
| Video → GIF | `palettegen` + `paletteuse` (fps, width, segment, loop) |
| Trim (fast) | input seek + `-c copy` (keyframe accurate, instant) |
| Trim (precise) | input seek + re-encode (frame accurate) |
| Resize | `scale=-2:H` / box with `force_original_aspect_ratio` |
| Mute | `-an -c:v copy` |
| Rotate / flip | `transpose` / `hflip` / `vflip` |
| Compress | libx264 CRF or target bitrate, max resolution, AAC audio bitrate |
| GIF → MP4 / WEBM / MOV / MKV | GIF decoder → libx264 (even size, yuv420p) / libvpx (forced `-pix_fmt yuv420p`, GIF alpha would otherwise select yuva420p and fail) |
| Video → images | `fps=1/N` (+ optional `scale`) → **PNG** frames collected by prefix; JPG frames are re-encoded by the browser (the MJPEG encoder crashes with "memory access out of bounds" in this build) |
| Speed | `setpts=PTS/N` + chained `atempo` (0.5–2 per stage, pitch preserved) |
| Crop to ratio | centre `crop=W:H:X:Y` from the probed display size, even dimensions |
| Merge videos | `scale`+`pad` to the first clip, `fps=30`, `concat`; clips without audio get silence from an `anullsrc` **source filter inside the graph** (no lavfi input device needed) |
| Merge audio | `aformat` 44.1 kHz stereo + `concat` |
| Add music | second input (optionally `-stream_loop -1`), `volume`, replace or `amix`, `-shortest`; H.264/HEVC video stream-copied |
| Volume / normalize / fade / reverse | `volume=XdB` / `loudnorm=I=-16:TP=-1.5:LRA=11` / `afade` in+out / `areverse` |
| Images → GIF / MP4 | PNG sequence (`img%04d.png`, frames pre-fitted by the image worker) → `palettegen/paletteuse` or libx264 `-tune stillimage`; the last frame is repeated so it is shown for its full duration |
| Channels / sample rate | `-ac 1` or `-ac 2`, `-ar` (Opus limited to 48/16 kHz) |

### Encoders present but deliberately not offered

| Encoder | Reason |
| --- | --- |
| libx265 (HEVC) | Spawns frame threads; hangs in this single-threaded build |
| libvpx-vp9 | Too slow single-threaded for an acceptable UX |
| libtheora, mpeg4, wmv2, … | Legacy formats; MP4/WEBM/MOV/MKV cover the use cases |
| mjpeg | Crashes ("memory access out of bounds") in this build; JPG frames come from the browser encoder |

## Re-verifying the build

`ffmpegCapabilities()` in `src/engines/ffmpeg/client.ts` lists the encoders/decoders/muxers/demuxers
of the bundled core at runtime. The authoritative check is the E2E matrix:

```bash
npm run build
npx playwright test tests/e2e/media-matrix.spec.ts tests/e2e/tools-expanded-media.spec.ts
```

Stream copy into MKV is limited to codecs with well-defined Matroska mappings (H.264, HEVC, VP8/9,
MPEG-4 with AAC/MP3/Opus/Vorbis/FLAC/AC-3/ALAC/PCM); everything else is re-encoded.

## Licensing

The core is GPL-2.0-or-later because of x264/x265. See the README "Licensing note" and
`THIRD_PARTY_LICENSES.txt`. To ship an LGPL-only build, rebuild ffmpeg.wasm without
`--enable-gpl --enable-libx264 --enable-libx265` and switch MP4 output to another encoder
(e.g. `mpeg4`) or to WebCodecs.
