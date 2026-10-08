import { AppError, toAppError } from '../core/errors';

/**
 * Worker side of the RPC protocol (see core/worker-pool.ts).
 * Handlers receive the payload and a context to report real progress.
 */
export interface HandlerContext {
  progress(value: number | null, info?: unknown): void;
}

export type Handler = (payload: never, ctx: HandlerContext) => Promise<unknown> | unknown;

const TRANSFER = Symbol('transfer');
interface WithTransfer {
  [TRANSFER]: true;
  value: unknown;
  transfer: Transferable[];
}

/** Return value helper: transfers ArrayBuffers instead of copying them. */
export function withTransfer<T>(value: T, transfer: Transferable[]): T {
  return { [TRANSFER]: true, value, transfer } as unknown as T;
}

interface Scope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export function expose(handlers: Record<string, Handler>): void {
  const scope = self as unknown as Scope;
  scope.addEventListener('message', (event: MessageEvent<{ id: string; method: string; payload: unknown }>) => {
    const { id, method, payload } = event.data ?? {};
    if (!id || !method) return;
    const handler = handlers[method];
    const ctx: HandlerContext = {
      progress: (value, info) => scope.postMessage({ id, type: 'progress', value, info }),
    };
    void (async () => {
      try {
        if (!handler) throw new AppError('browser-limitation', `Unknown worker method: ${method}`);
        const result = await (handler as (p: unknown, c: HandlerContext) => unknown)(payload, ctx);
        if (result && typeof result === 'object' && TRANSFER in result) {
          const r = result as WithTransfer;
          scope.postMessage({ id, type: 'result', value: r.value }, r.transfer);
        } else {
          scope.postMessage({ id, type: 'result', value: result });
        }
      } catch (err) {
        scope.postMessage({ id, type: 'error', error: toAppError(err).serialize() });
      }
    })();
  });
}
