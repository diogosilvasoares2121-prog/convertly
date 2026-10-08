import { createStore } from './store';

/**
 * Startup feature detection. Results are used only locally to enable/disable
 * tools; they are never stored remotely or transmitted.
 */
export interface Capabilities {
  ready: boolean;
  wasm: boolean;
  worker: boolean;
  offscreenCanvas: boolean;
  encodeJpeg: boolean;
  encodePng: boolean;
  encodeWebp: boolean;
  encodeAvif: boolean;
  webAudio: boolean;
  sharedArrayBuffer: boolean;
  downloadsApi: boolean;
  /** Logical CPU cores (used to size worker pools). */
  cores: number;
  /** Approximate device memory in GB when the browser exposes it. */
  memoryGb: number | null;
}

export type CapabilityKey = Exclude<keyof Capabilities, 'ready' | 'cores' | 'memoryGb'>;

export const capabilitiesStore = createStore<Capabilities>({
  ready: false,
  wasm: false,
  worker: false,
  offscreenCanvas: false,
  encodeJpeg: false,
  encodePng: false,
  encodeWebp: false,
  encodeAvif: false,
  webAudio: false,
  sharedArrayBuffer: false,
  downloadsApi: false,
  cores: 4,
  memoryGb: null,
});

// Smallest valid WebAssembly module (magic + version).
const WASM_HEADER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function detectWasm(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(WASM_HEADER);
  } catch {
    return false;
  }
}

async function canEncode(type: string): Promise<boolean> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(2, 2);
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.fillRect(0, 0, 1, 1);
      const blob = await canvas.convertToBlob({ type, quality: 0.8 });
      return blob.type === type;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8));
    return blob?.type === type;
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  const [encodeJpeg, encodePng, encodeWebp, encodeAvif] = await Promise.all([
    canEncode('image/jpeg'),
    canEncode('image/png'),
    canEncode('image/webp'),
    canEncode('image/avif'),
  ]);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const caps: Capabilities = {
    ready: true,
    wasm: detectWasm(),
    worker: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    encodeJpeg,
    encodePng,
    encodeWebp,
    encodeAvif,
    webAudio: typeof AudioContext !== 'undefined' || typeof OfflineAudioContext !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true,
    downloadsApi: typeof chrome !== 'undefined' && !!chrome.downloads?.download,
    cores: Math.max(1, Math.min(32, navigator.hardwareConcurrency || 4)),
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
  capabilitiesStore.set(caps);
  return caps;
}

export function hasCapabilities(keys: readonly CapabilityKey[]): boolean {
  const caps = capabilitiesStore.get();
  return keys.every((k) => caps[k]);
}

/** Concurrency budget per resource pool, adapted to the device. */
export function poolLimits(): Record<'image' | 'pdf' | 'media' | 'zip' | 'light', number> {
  const { cores, memoryGb } = capabilitiesStore.get();
  const lowMemory = memoryGb !== null && memoryGb <= 4;
  return {
    image: Math.max(1, Math.min(lowMemory ? 2 : 4, Math.floor(cores / 2))),
    pdf: lowMemory ? 1 : 2,
    media: 1, // FFmpeg transcodes are CPU and memory heavy: one at a time.
    zip: 1,
    light: 4,
  };
}
