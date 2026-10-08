import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { settingsStore } from '../../storage/settings';
import { getImageInfo, makeThumbnail, NATIVE_PREVIEW } from '../../engines/image/client';
import { rotatedSize } from '../../engines/image/geometry';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { toAppError, type ErrorCode } from '../../core/errors';
import { Button, IconButton, Segmented, Slider } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { ErrorNotice, Spinner } from '../../ui/components/feedback';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint, runImageJob } from './common';
import { sameOrFallback } from './ImageResize';

type Ratio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16';
const RATIOS: Record<Exclude<Ratio, 'free'>, number> = { '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16 };
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_PREVIEW = 2048;

function fitRatio(bounds: { width: number; height: number }, ratio: number): Rect {
  let w = bounds.width;
  let h = w / ratio;
  if (h > bounds.height) {
    h = bounds.height;
    w = h * ratio;
  }
  return { x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, w, h };
}

export default function ImageCrop({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  const [preview, setPreview] = useState<ImageBitmap | null>(null);
  const [orig, setOrig] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [fine, setFine] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [ratio, setRatio] = useState<Ratio>('free');
  const [shape, setShape] = useState<'rect' | 'circle' | 'rounded'>('rect');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [crop, setCrop] = useState<Rect | null>(null);
  const [stage, setStage] = useState({ w: 800, h: 500 });
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const degrees = quarter * 90 + fine;

  // Load a downscaled preview + the original dimensions.
  useEffect(() => {
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    setPreview(null);
    setOrig(null);
    setLoadError(null);
    setCrop(null);
    if (!file?.format) return;
    void (async () => {
      try {
        const info = await getImageInfo(file.file, file.format!);
        const scale = Math.min(1, MAX_PREVIEW / Math.max(info.width, info.height));
        if (NATIVE_PREVIEW.has(file.format!)) {
          bitmap = await createImageBitmap(file.file, { resizeWidth: Math.max(1, Math.round(info.width * scale)), resizeHeight: Math.max(1, Math.round(info.height * scale)), resizeQuality: 'high', imageOrientation: 'from-image' });
        } else {
          bitmap = await createImageBitmap(await makeThumbnail(file.file, file.format!, MAX_PREVIEW));
        }
        if (!alive) {
          bitmap.close();
          return;
        }
        setOrig({ width: info.width, height: info.height });
        setPreview(bitmap);
      } catch (err) {
        if (alive) setLoadError(toAppError(err).code);
      }
    })();
    return () => {
      alive = false;
      bitmap?.close();
    };
  }, [file]);

  const oriented = preview ? rotatedSize(preview.width, preview.height, degrees) : null;

  // Reset the crop whenever the geometry changes.
  useEffect(() => {
    if (!oriented) return;
    setCrop(ratio === 'free' ? { x: 0, y: 0, w: oriented.width, h: oriented.height } : fitRatio(oriented, RATIOS[ratio]));
  }, [preview, quarter, fine, ratio]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview]);

  const view = oriented
    ? (() => {
        const s0 = Math.min(stage.w / oriented.width, stage.h / oriented.height) * 0.9;
        const s = s0 * zoom;
        return { s, ox: (stage.w - oriented.width * s) / 2 + pan.x, oy: (stage.h - oriented.height * s) / 2 + pan.y };
      })()
    : null;

  // Draw the oriented preview.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview || !oriented || !view) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage.w * dpr);
    canvas.height = Math.round(stage.h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.w, stage.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.s, view.s);
    ctx.translate(oriented.width / 2, oriented.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(preview, -preview.width / 2, -preview.height / 2);
    ctx.restore();
  });

  const drag = useRef<{ mode: 'move' | 'pan' | 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; start: Rect; pan: { x: number; y: number } } | null>(null);

  const onPointerDown = (mode: 'move' | 'pan' | 'nw' | 'ne' | 'sw' | 'se') => (e: PointerEvent) => {
    if (!crop) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...crop }, pan: { ...pan } };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !view || !oriented) return;
    const dx = (e.clientX - d.sx) / view.s;
    const dy = (e.clientY - d.sy) / view.s;
    if (d.mode === 'pan') {
      setPan({ x: d.pan.x + (e.clientX - d.sx), y: d.pan.y + (e.clientY - d.sy) });
      return;
    }
    const r = d.start;
    const W = oriented.width;
    const H = oriented.height;
    if (d.mode === 'move') {
      setCrop({ ...r, x: Math.min(Math.max(0, r.x + dx), W - r.w), y: Math.min(Math.max(0, r.y + dy), H - r.h) });
      return;
    }
    const min = 8 / view.s;
    let x1 = r.x;
    let y1 = r.y;
    let x2 = r.x + r.w;
    let y2 = r.y + r.h;
    if (d.mode.includes('w')) x1 = Math.min(Math.max(0, r.x + dx), x2 - min);
    if (d.mode.includes('e')) x2 = Math.max(Math.min(W, x2 + dx), x1 + min);
    if (d.mode.includes('n')) y1 = Math.min(Math.max(0, r.y + dy), y2 - min);
    if (d.mode.includes('s')) y2 = Math.max(Math.min(H, y2 + dy), y1 + min);
    if (ratio !== 'free') {
      const target = RATIOS[ratio];
      let w = x2 - x1;
      let h = y2 - y1;
      if (w / h > target) w = h * target;
      else h = w / target;
      if (d.mode.includes('w')) x1 = x2 - w;
      else x2 = x1 + w;
      if (d.mode.includes('n')) y1 = y2 - h;
      else y2 = y1 + h;
      if (x1 < 0 || y1 < 0 || x2 > W || y2 > H) return;
    }
    setCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  };

  const endDrag = () => {
    drag.current = null;
  };

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="cropped-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('image.dropOne')} buttonLabel={t('image.chooseOne')} formatsHint={formatsHint(tool)} icon="crop" testId="dropzone" />;
  }

  const k = orig && preview ? orig.width / preview.width : 1;
  const cropPx = crop ? { x: Math.round(crop.x * k), y: Math.round(crop.y * k), width: Math.max(1, Math.round(crop.w * k)), height: Math.max(1, Math.round(crop.h * k)) } : null;

  const run = async () => {
    if (!cropPx) return;
    const ops = { rotate: degrees, flipH, flipV, crop: cropPx, ...(shape !== 'rect' ? { shape: { kind: shape, radiusPct: 14 } } : {}) };
    // Shapes need transparent corners: JPG/HEIC sources are saved as PNG.
    const outFormat = (f: typeof file) => {
      const same = sameOrFallback(f.format, caps);
      return shape !== 'rect' && (same === 'jpg' || same === 'avif') ? 'png' : same;
    };
    const id = await startJobs(tool, [file], {
      pool: 'image',
      operation: t('tool.image-crop.title'),
      run: (f) => (ctx) => runImageJob(f, ops, { format: outFormat(f), quality: settings.imageQuality / 100 }, ctx, shape === 'circle' ? 'circle' : 'edited'),
    });
    if (id) setGroupId(id);
  };

  const reset = () => {
    setQuarter(0);
    setFine(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRatio('free');
    setShape('rect');
  };

  return (
    <ToolWorkspace
      main={
        <>
          <div class="toolbar" role="toolbar" aria-label={t('crop.toolbar')}>
            <IconButton icon="rotate-left" label={t('rotate.left')} onClick={() => setQuarter((q) => (q + 3) % 4)} />
            <IconButton icon="rotate-right" label={t('rotate.right')} onClick={() => setQuarter((q) => (q + 1) % 4)} />
            <IconButton icon="flip-h" label={t('rotate.flipH')} active={flipH} onClick={() => setFlipH((v) => !v)} />
            <IconButton icon="flip-v" label={t('rotate.flipV')} active={flipV} onClick={() => setFlipV((v) => !v)} />
            <span class="toolbar__sep" />
            <IconButton icon="zoom-out" label={t('crop.zoomOut')} disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 1.25))} />
            <span class="small mono" style={{ minWidth: '44px', textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <IconButton icon="zoom-in" label={t('crop.zoomIn')} disabled={zoom >= 6} onClick={() => setZoom((z) => Math.min(6, z * 1.25))} />
            <span class="toolbar__sep" />
            <Button variant="ghost" size="sm" icon="undo" onClick={reset}>
              {t('action.reset')}
            </Button>
            <span class="grow" />
            <Button variant="ghost" size="sm" icon="close" onClick={files.clear}>
              {t('action.changeImage')}
            </Button>
          </div>
          {loadError ? <ErrorNotice code={loadError} /> : null}
          <div
            ref={stageRef}
            class="crop-stage"
            onPointerDown={onPointerDown('pan') as unknown as (e: Event) => void}
            onPointerMove={onPointerMove as unknown as (e: Event) => void}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={(e) => {
              e.preventDefault();
              setZoom((z) => Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
            }}
          >
            <canvas ref={canvasRef} aria-label={t('crop.preview')} role="img" />
            {!preview && !loadError ? (
              <div class="waveform-status">
                <Spinner label={t('progress.loading')} />
              </div>
            ) : null}
            {crop && view && cropPx ? (
              <div
                class={`crop-box${shape === 'circle' ? ' crop-box--circle' : shape === 'rounded' ? ' crop-box--rounded' : ''}`}
                style={{ left: `${view.ox + crop.x * view.s}px`, top: `${view.oy + crop.y * view.s}px`, width: `${crop.w * view.s}px`, height: `${crop.h * view.s}px` }}
                onPointerDown={onPointerDown('move') as unknown as (e: Event) => void}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                  <span key={h} class={`crop-handle crop-handle--${h}`} onPointerDown={onPointerDown(h) as unknown as (e: Event) => void} />
                ))}
                <span class="crop-size">
                  {cropPx.width} × {cropPx.height}
                </span>
              </div>
            ) : null}
          </div>
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('crop.aspect')}</div>
            <Segmented
              label={t('crop.aspect')}
              value={ratio}
              wrap
              onChange={setRatio}
              options={[
                { value: 'free', label: t('crop.free') },
                { value: '1:1', label: '1:1' },
                { value: '4:3', label: '4:3' },
                { value: '3:2', label: '3:2' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
              ]}
            />
          </div>
          <div class="field">
            <div class="field__label">{t('crop.shape')}</div>
            <Segmented
              label={t('crop.shape')}
              value={shape}
              block
              onChange={(v) => {
                setShape(v);
                if (v === 'circle') setRatio('1:1');
              }}
              options={[
                { value: 'rect', label: t('crop.shapeRect') },
                { value: 'circle', label: t('crop.shapeCircle') },
                { value: 'rounded', label: t('crop.shapeRounded') },
              ]}
            />
            {shape !== 'rect' ? <div class="field__hint">{t('crop.shapeHint')}</div> : null}
          </div>
          <Slider label={t('crop.straighten')} value={fine} min={-45} max={45} onChange={setFine} format={(v) => `${v}°`} />
          {orig ? (
            <dl class="kv">
              <dt>{t('meta.original')}</dt>
              <dd>
                {orig.width} × {orig.height}
              </dd>
              <dt>{t('meta.result')}</dt>
              <dd>{cropPx ? `${cropPx.width} × ${cropPx.height}` : '—'}</dd>
            </dl>
          ) : null}
          <Button variant="primary" size="lg" block icon="crop" disabled={!cropPx} onClick={() => void run()} data-testid="run">
            {t('crop.apply')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
