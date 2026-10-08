import { useEffect, useRef, useState } from 'preact/hooks';
import { t, useI18n } from '../../i18n';
import { formatTimecode } from '../../utils/time';
import { MB } from '../../utils/bytes';

const MAX_WAVEFORM_BYTES = 150 * MB;

/** Computes waveform peaks with the Web Audio API (local decode; skipped for very large files). */
export function useWaveform(file: Blob | null, enabled: boolean): { peaks: Float32Array | null; status: 'idle' | 'loading' | 'ready' | 'unavailable' } {
  const [state, setState] = useState<{ peaks: Float32Array | null; status: 'idle' | 'loading' | 'ready' | 'unavailable' }>({ peaks: null, status: 'idle' });
  useEffect(() => {
    let alive = true;
    if (!file || !enabled) {
      setState({ peaks: null, status: 'idle' });
      return;
    }
    if (file.size > MAX_WAVEFORM_BYTES || typeof OfflineAudioContext === 'undefined') {
      setState({ peaks: null, status: 'unavailable' });
      return;
    }
    setState({ peaks: null, status: 'loading' });
    void (async () => {
      try {
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        const data = buffer.getChannelData(0);
        const buckets = 1200;
        const step = Math.max(1, Math.floor(data.length / buckets));
        const peaks = new Float32Array(buckets);
        for (let b = 0; b < buckets; b++) {
          let max = 0;
          const start = b * step;
          for (let i = start; i < start + step && i < data.length; i += 4) {
            const v = Math.abs(data[i]!);
            if (v > max) max = v;
          }
          peaks[b] = max;
        }
        if (alive) setState({ peaks, status: 'ready' });
      } catch {
        if (alive) setState({ peaks: null, status: 'unavailable' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, enabled]);
  return state;
}

/**
 * Range selector with draggable start/end handles (mouse, touch and keyboard:
 * arrows = 0.1 s, Shift+arrows = 1 s) and an optional waveform.
 */
export function Timeline({
  duration,
  start,
  end,
  current,
  peaks,
  onChange,
  onSeek,
  status,
}: {
  duration: number;
  start: number;
  end: number;
  current?: number;
  peaks?: Float32Array | null;
  onChange: (start: number, end: number) => void;
  onSeek?: (time: number) => void;
  status?: string;
}) {
  useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const el = ref.current;
    if (!canvas || !el) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const color = getComputedStyle(el).getPropertyValue('--text-3').trim() || '#888';
      ctx.fillStyle = color;
      if (peaks && peaks.length) {
        const bar = w / peaks.length;
        for (let i = 0; i < peaks.length; i++) {
          const v = Math.max(0.02, peaks[i]!);
          const bh = v * (h - 12);
          ctx.globalAlpha = 0.55;
          ctx.fillRect(i * bar, (h - bh) / 2, Math.max(1, bar - 0.5), bh);
        }
      } else {
        ctx.globalAlpha = 0.25;
        for (let x = 0; x < w; x += 8) ctx.fillRect(x, h / 2 - 1, 4, 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [peaks]);

  const timeAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };
  const minGap = Math.min(0.1, duration / 100);

  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const time = timeAt(e.clientX);
    if (drag.current === 'start') onChange(Math.min(time, end - minGap), end);
    else onChange(start, Math.max(time, start + minGap));
  };

  const keyAdjust = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
    else return;
    e.preventDefault();
    if (which === 'start') onChange(Math.max(0, Math.min(start + delta, end - minGap)), end);
    else onChange(start, Math.min(duration, Math.max(end + delta, start + minGap)));
  };

  const pct = (v: number) => `${(v / duration) * 100}%`;
  return (
    <div
      ref={ref}
      class="timeline"
      onPointerMove={onMove as unknown as (e: Event) => void}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onPointerDown={(e) => {
        if (e.target === ref.current || e.target === canvasRef.current) onSeek?.(timeAt(e.clientX));
      }}
    >
      <canvas ref={canvasRef} />
      {status ? <div class="waveform-status">{status}</div> : null}
      <div class="timeline__range" style={{ left: pct(start), width: `calc(${pct(end - start)})` }} />
      {current !== undefined ? <div class="timeline__playhead" style={{ left: pct(current) }} /> : null}
      {(['start', 'end'] as const).map((which) => (
        <button
          key={which}
          type="button"
          class="timeline__handle"
          style={{ left: pct(which === 'start' ? start : end) }}
          role="slider"
          aria-label={which === 'start' ? t('trim.start') : t('trim.end')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 1000) / 1000}
          aria-valuenow={Math.round((which === 'start' ? start : end) * 1000) / 1000}
          aria-valuetext={formatTimecode(which === 'start' ? start : end, true)}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            drag.current = which;
          }}
          onKeyDown={keyAdjust(which) as unknown as (e: Event) => void}
        />
      ))}
    </div>
  );
}
