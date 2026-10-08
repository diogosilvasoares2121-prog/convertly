import { createStore } from '../core/store';
import type { PickedFile } from '../ui/files';
import { navigate, toolHref } from './router';

/**
 * Moves File references between screens (detection → tool, result → next tool).
 * Only in-memory references; nothing is persisted.
 */
const pending = new Map<string, PickedFile[]>();

/** Files currently shown on the detection screen. */
export const detectionStore = createStore<{ files: PickedFile[]; source: 'drop' | 'paste' | 'picker' | 'result' } | null>(null);

export function openToolWith(toolId: string, files: PickedFile[]): void {
  pending.set(toolId, files);
  navigate(toolHref(toolId));
}

export function takePending(toolId: string): PickedFile[] {
  const files = pending.get(toolId) ?? [];
  pending.delete(toolId);
  return files;
}

export function analyzeFiles(files: PickedFile[], source: 'drop' | 'paste' | 'picker' | 'result'): void {
  detectionStore.set({ files, source });
  navigate('#/detect');
}

/**
 * The tool currently on screen can claim globally dropped/pasted files.
 * The handler returns true when it accepted at least one file.
 */
export const dropTargetStore = createStore<((files: PickedFile[]) => boolean) | null>(null);
