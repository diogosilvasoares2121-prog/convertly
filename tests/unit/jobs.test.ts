import { beforeEach, describe, expect, it } from 'vitest';
import { cancelJob, clearFinishedJobs, jobsStore, makeOutput, removeJob, retryJob, submitJob, type JobContext } from '../../src/core/jobs';
import { AppError, toAppError } from '../../src/core/errors';
import { capabilitiesStore } from '../../src/core/capabilities';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const job = (id: string) => jobsStore.get().find((j) => j.id === id)!;

async function until(predicate: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await tick(5);
  }
}

beforeEach(() => {
  for (const j of jobsStore.get()) removeJob(j.id);
  capabilitiesStore.set({ ...capabilitiesStore.get(), cores: 8, memoryGb: 8 });
});

describe('job engine', () => {
  it('goes through the lifecycle and stores outputs', async () => {
    const id = submitJob({
      toolId: 't',
      operation: 'op',
      inputName: 'a.txt',
      inputSize: 1,
      pool: 'light',
      run: async (ctx) => {
        ctx.setState('processing');
        ctx.progress(0.5);
        await tick();
        ctx.note('honest note');
        return [makeOutput('a.out', new Blob(['x']))];
      },
    });
    await until(() => job(id).state === 'completed');
    expect(job(id).outputs[0]!.name).toBe('a.out');
    expect(job(id).notes).toEqual(['honest note']);
    expect(job(id).progress).toBe(1);
  });

  it('runs heavy media jobs one at a time', async () => {
    let running = 0;
    let maxRunning = 0;
    const ids = Array.from({ length: 3 }, (_, i) =>
      submitJob({
        toolId: 'v',
        operation: 'op',
        inputName: `v${i}`,
        inputSize: 1,
        pool: 'media',
        run: async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await tick(30);
          running--;
          return [];
        },
      }),
    );
    await until(() => ids.every((id) => job(id).state === 'completed'));
    expect(maxRunning).toBe(1);
  });

  it('cancels for real: the runner signal is aborted', async () => {
    let aborted = false;
    const id = submitJob({
      toolId: 't',
      operation: 'op',
      inputName: 'big',
      inputSize: 1,
      pool: 'light',
      run: (ctx: JobContext) =>
        new Promise((_, reject) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new AppError('cancelled'));
          });
        }),
    });
    await until(() => job(id).state === 'preparing');
    cancelJob(id);
    await until(() => job(id).state === 'cancelled');
    expect(aborted).toBe(true);
  });

  it('records failures with a code and supports retry', async () => {
    let attempts = 0;
    const id = submitJob({
      toolId: 't',
      operation: 'op',
      inputName: 'x',
      inputSize: 1,
      pool: 'light',
      run: async () => {
        attempts++;
        if (attempts === 1) throw new RangeError('Array buffer allocation failed');
        return [];
      },
    });
    await until(() => job(id).state === 'failed');
    expect(job(id).error?.code).toBe('out-of-memory');
    retryJob(id);
    await until(() => job(id).state === 'completed');
    expect(attempts).toBe(2);
    clearFinishedJobs();
    expect(jobsStore.get().find((j) => j.id === id)).toBeUndefined();
  });

  it('maps library errors to user-facing codes', () => {
    expect(toAppError(Object.assign(new Error('Input document to `PDFDocument.load` is encrypted'), { name: 'EncryptedPDFError' })).code).toBe('pdf-encrypted');
    expect(toAppError(new DOMException('aborted', 'AbortError')).code).toBe('cancelled');
    expect(toAppError(new Error('The source image could not be decoded.')).code).toBe('corrupted-file');
    expect(toAppError('weird').code).toBe('conversion-failed');
  });
});
