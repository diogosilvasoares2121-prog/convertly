import { createStore } from './store';
import { AppError, toAppError, type ErrorCode } from './errors';
import { poolLimits } from './capabilities';
import { uid } from '../utils/id';

/**
 * Job engine. Every conversion is a Job with an explicit lifecycle:
 * queued → preparing → processing → finalizing → completed | failed | cancelled.
 * Jobs are scheduled per resource pool so heavy work (FFmpeg) never runs in parallel
 * by default while light work (images) uses a few workers.
 */
export type JobState = 'queued' | 'preparing' | 'processing' | 'finalizing' | 'completed' | 'cancelled' | 'failed';
export type Pool = 'image' | 'pdf' | 'media' | 'zip' | 'light';

export interface OutputFile {
  id: string;
  name: string;
  blob: Blob;
  mime: string;
  size: number;
  /** Optional extra facts shown in the result (e.g. page count, dimensions). */
  meta?: Record<string, string | number>;
}

export interface JobError {
  code: ErrorCode;
  detail?: string;
}

export interface Job {
  id: string;
  toolId: string;
  groupId: string;
  operation: string;
  inputName: string;
  inputSize: number;
  inputCount: number;
  pool: Pool;
  state: JobState;
  /** 0..1 when real progress is known; null = indeterminate. */
  progress: number | null;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: JobError;
  outputs: OutputFile[];
  /** Honest notes about the result (e.g. "Only the first frame of the animated GIF was converted"). */
  notes: string[];
}

export interface JobContext {
  signal: AbortSignal;
  setState(state: 'preparing' | 'processing' | 'finalizing'): void;
  progress(value: number | null): void;
  note(message: string): void;
}

export type JobRunner = (ctx: JobContext) => Promise<OutputFile[]>;

export interface JobSpec {
  toolId: string;
  operation: string;
  inputName: string;
  inputSize: number;
  inputCount?: number;
  groupId?: string;
  pool: Pool;
  run: JobRunner;
}

export const jobsStore = createStore<Job[]>([]);

const runners = new Map<string, JobRunner>();
const controllers = new Map<string, AbortController>();

const ACTIVE: ReadonlySet<JobState> = new Set(['preparing', 'processing', 'finalizing']);
export const isActive = (job: Job): boolean => ACTIVE.has(job.state);
export const isFinished = (job: Job): boolean => job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled';

function patch(id: string, update: Partial<Job> | ((job: Job) => Partial<Job>)): void {
  jobsStore.set((jobs) =>
    jobs.map((j) => (j.id === id ? { ...j, ...(typeof update === 'function' ? update(j) : update) } : j)),
  );
}

// Progress events can arrive hundreds of times per second (FFmpeg logs); batch them.
const pendingProgress = new Map<string, number | null>();
let progressTimer: ReturnType<typeof setTimeout> | null = null;
function queueProgress(id: string, value: number | null): void {
  pendingProgress.set(id, value);
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    const updates = new Map(pendingProgress);
    pendingProgress.clear();
    jobsStore.set((jobs) =>
      jobs.map((j) => (updates.has(j.id) && isActive(j) ? { ...j, progress: updates.get(j.id) ?? null } : j)),
    );
  }, 120);
}

function pump(): void {
  const limits = poolLimits();
  const jobs = jobsStore.get();
  const running = new Map<Pool, number>();
  for (const j of jobs) if (isActive(j)) running.set(j.pool, (running.get(j.pool) ?? 0) + 1);
  for (const job of jobs) {
    if (job.state !== 'queued') continue;
    const count = running.get(job.pool) ?? 0;
    if (count >= limits[job.pool]) continue;
    running.set(job.pool, count + 1);
    start(job.id);
  }
}

function start(id: string): void {
  const run = runners.get(id);
  if (!run) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(id, { state: 'preparing', startedAt: Date.now(), progress: null, error: undefined, outputs: [], notes: [] });

  const ctx: JobContext = {
    signal: controller.signal,
    setState: (state) => {
      if (!controller.signal.aborted) patch(id, { state });
    },
    progress: (value) => {
      if (!controller.signal.aborted) queueProgress(id, value === null ? null : Math.max(0, Math.min(1, value)));
    },
    note: (message) => patch(id, (j) => ({ notes: j.notes.includes(message) ? j.notes : [...j.notes, message] })),
  };

  // Defer so that state updates are not batched with the caller's render.
  queueMicrotask(async () => {
    try {
      const outputs = await run(ctx);
      if (controller.signal.aborted) throw new AppError('cancelled');
      pendingProgress.delete(id);
      patch(id, { state: 'completed', progress: 1, outputs, endedAt: Date.now() });
    } catch (err) {
      pendingProgress.delete(id);
      const appError = controller.signal.aborted ? new AppError('cancelled') : toAppError(err);
      if (appError.code === 'cancelled') {
        patch(id, { state: 'cancelled', progress: null, endedAt: Date.now(), outputs: [] });
      } else {
        patch(id, {
          state: 'failed',
          progress: null,
          endedAt: Date.now(),
          outputs: [],
          error: { code: appError.code, ...(appError.detail ? { detail: appError.detail } : {}) },
        });
      }
    } finally {
      controllers.delete(id);
      pump();
    }
  });
}

export function submitJob(spec: JobSpec): string {
  const id = uid('job');
  runners.set(id, spec.run);
  const job: Job = {
    id,
    toolId: spec.toolId,
    groupId: spec.groupId ?? id,
    operation: spec.operation,
    inputName: spec.inputName,
    inputSize: spec.inputSize,
    inputCount: spec.inputCount ?? 1,
    pool: spec.pool,
    state: 'queued',
    progress: null,
    createdAt: Date.now(),
    outputs: [],
    notes: [],
  };
  jobsStore.set((jobs) => [...jobs, job]);
  pump();
  return id;
}

/** Real cancellation: aborts the job's signal, which terminates its worker and frees memory. */
export function cancelJob(id: string): void {
  const job = jobsStore.get().find((j) => j.id === id);
  if (!job) return;
  if (job.state === 'queued') {
    patch(id, { state: 'cancelled', endedAt: Date.now() });
    return;
  }
  controllers.get(id)?.abort();
}

export function cancelGroup(groupId: string): void {
  for (const j of jobsStore.get()) if (j.groupId === groupId && !isFinished(j)) cancelJob(j.id);
}

export function retryJob(id: string): void {
  const job = jobsStore.get().find((j) => j.id === id);
  if (!job || !runners.has(id) || !isFinished(job)) return;
  patch(id, { state: 'queued', progress: null, error: undefined, outputs: [], notes: [], startedAt: undefined, endedAt: undefined });
  pump();
}

/** Removes a job and drops every reference to its result blobs so memory can be reclaimed. */
export function removeJob(id: string): void {
  cancelJob(id);
  runners.delete(id);
  jobsStore.set((jobs) => jobs.filter((j) => j.id !== id));
}

export function removeGroup(groupId: string): void {
  for (const j of jobsStore.get()) if (j.groupId === groupId) removeJob(j.id);
}

export function clearFinishedJobs(): void {
  for (const j of jobsStore.get()) if (isFinished(j)) removeJob(j.id);
}

export function makeOutput(name: string, blob: Blob, meta?: OutputFile['meta']): OutputFile {
  return { id: uid('out'), name, blob, mime: blob.type, size: blob.size, ...(meta ? { meta } : {}) };
}
