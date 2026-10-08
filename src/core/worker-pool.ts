import { AppError, toAppError, isSerializedError } from './errors';
import { uid } from '../utils/id';

/**
 * Main-thread side of the worker RPC protocol.
 *
 * - Each call runs on a dedicated worker from the pool.
 * - Cancelling a call terminates that worker (the only way to truly stop WASM code)
 *   and the pool spawns a fresh one on demand.
 * - Idle workers are terminated after `idleMs` to release WASM memory.
 */
export interface CallOptions {
  signal?: AbortSignal;
  onProgress?: (value: number | null, info?: unknown) => void;
  transfer?: Transferable[];
}

type WorkerMessage =
  | { id: string; type: 'progress'; value: number | null; info?: unknown }
  | { id: string; type: 'result'; value: unknown }
  | { id: string; type: 'error'; error: unknown };

interface Slot {
  worker: Worker;
  busy: boolean;
  lastUsed: number;
}

/** Counts live workers across all pools (used by memory tests and diagnostics). */
export const workerStats = { live: 0, created: 0 };

export class WorkerPool {
  private slots: Slot[] = [];
  private waiting: Array<(slot: Slot) => void> = [];
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly factory: () => Worker,
    private readonly options: { max: () => number; idleMs: number },
  ) {}

  get size(): number {
    return this.slots.length;
  }

  private spawn(): Slot {
    const slot: Slot = { worker: this.factory(), busy: false, lastUsed: Date.now() };
    workerStats.live++;
    workerStats.created++;
    this.slots.push(slot);
    this.ensureIdleTimer();
    return slot;
  }

  private kill(slot: Slot): void {
    slot.worker.terminate();
    const i = this.slots.indexOf(slot);
    if (i >= 0) {
      this.slots.splice(i, 1);
      workerStats.live--;
    }
  }

  private acquire(): Promise<Slot> {
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (this.slots.length < Math.max(1, this.options.max())) {
      const slot = this.spawn();
      slot.busy = true;
      return Promise.resolve(slot);
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(slot: Slot, broken: boolean): void {
    slot.lastUsed = Date.now();
    if (broken) this.kill(slot);
    const next = this.waiting.shift();
    if (!next) {
      slot.busy = false;
      return;
    }
    if (broken) {
      const fresh = this.spawn();
      fresh.busy = true;
      next(fresh);
    } else {
      slot.busy = true;
      next(slot);
    }
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const slot of [...this.slots]) {
        if (!slot.busy && now - slot.lastUsed > this.options.idleMs) this.kill(slot);
      }
      if (!this.slots.length && this.idleTimer) {
        clearInterval(this.idleTimer);
        this.idleTimer = null;
      }
    }, Math.min(5000, this.options.idleMs));
  }

  async call<T>(method: string, payload: unknown, options: CallOptions = {}): Promise<T> {
    const { signal, onProgress, transfer } = options;
    if (signal?.aborted) throw new AppError('cancelled');
    const slot = await this.acquire();
    if (signal?.aborted) {
      this.release(slot, false);
      throw new AppError('cancelled');
    }
    const id = uid('call');

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (broken: boolean) => {
        settled = true;
        slot.worker.removeEventListener('message', onMessage);
        slot.worker.removeEventListener('error', onError);
        slot.worker.removeEventListener('messageerror', onError);
        signal?.removeEventListener('abort', onAbort);
        this.release(slot, broken);
      };
      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        if (!msg || msg.id !== id || settled) return;
        if (msg.type === 'progress') {
          onProgress?.(msg.value, msg.info);
        } else if (msg.type === 'result') {
          finish(false);
          resolve(msg.value as T);
        } else {
          // Errors inside WASM can leave the module in a bad state: recycle the worker.
          const err = isSerializedError(msg.error) ? new AppError(msg.error.code, msg.error.detail) : toAppError(msg.error);
          finish(true);
          reject(err);
        }
      };
      const onError = (event: Event) => {
        if (settled) return;
        finish(true);
        const message = event instanceof ErrorEvent ? event.message : 'Worker failed';
        reject(toAppError(new Error(message)));
      };
      const onAbort = () => {
        if (settled) return;
        finish(true); // terminate: stops CPU work immediately and frees its memory
        reject(new AppError('cancelled'));
      };
      slot.worker.addEventListener('message', onMessage);
      slot.worker.addEventListener('error', onError);
      slot.worker.addEventListener('messageerror', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        slot.worker.postMessage({ id, method, payload }, transfer ?? []);
      } catch (err) {
        finish(true);
        reject(toAppError(err));
      }
    });
  }

  terminateAll(): void {
    for (const slot of [...this.slots]) this.kill(slot);
  }
}
