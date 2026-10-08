import type { ComponentChildren } from 'preact';
import { confirmLargeFiles } from '../../app/confirm';
import { submitJob, type JobRunner, type Pool } from '../../core/jobs';
import { recordToolUse } from '../../storage/activity';
import type { ToolDef } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { uid } from '../../utils/id';
import { Icon } from '../../ui/components/Icon';

/**
 * Standard tool layout: input area on the left, options + primary action on the right.
 * Collapses to a single column on narrow windows.
 */
export function ToolWorkspace({ main, panel, single }: { main: ComponentChildren; panel?: ComponentChildren; single?: boolean }) {
  return (
    <div class={`tool-layout${single || !panel ? ' tool-layout--single' : ''}`}>
      <div class="stack">{main}</div>
      {panel ? <aside class="tool-panel">{panel}</aside> : null}
    </div>
  );
}

export function OptionsCard({ children, title }: { children: ComponentChildren; title?: string }) {
  useI18n();
  return (
    <div class="card card--pad options">
      <div class="options__title">{title ?? t('options.title')}</div>
      {children}
    </div>
  );
}

export function LocalNote() {
  useI18n();
  return (
    <div class="dropzone__hint" style={{ justifyContent: 'center' }}>
      <Icon name="lock" />
      {t('privacy.local')}
    </div>
  );
}

export interface JobInput {
  name: string;
  size: number;
}

/**
 * Submits one job per input (after the large-file check) and records the tool
 * as recently used (tool id only). Returns the batch group id, or null if the
 * user cancelled.
 */
export async function startJobs<T extends JobInput>(
  tool: ToolDef,
  inputs: T[],
  options: { pool: Pool; operation: string | ((input: T) => string); run: (input: T) => JobRunner; skipSizeCheck?: boolean },
): Promise<string | null> {
  if (!inputs.length) return null;
  if (!options.skipSizeCheck && !(await confirmLargeFiles(inputs, !!tool.heavy))) return null;
  const groupId = uid('grp');
  for (const input of inputs) {
    submitJob({
      toolId: tool.id,
      groupId,
      pool: options.pool,
      operation: typeof options.operation === 'function' ? options.operation(input) : options.operation,
      inputName: input.name,
      inputSize: input.size,
      run: options.run(input),
    });
  }
  void recordToolUse(tool.id, tool.category);
  return groupId;
}

/** Single job covering several inputs (merge, create ZIP, images → PDF…). */
export async function startCombinedJob(
  tool: ToolDef,
  inputs: JobInput[],
  options: { pool: Pool; operation: string; label: string; run: JobRunner; skipSizeCheck?: boolean },
): Promise<string | null> {
  if (!inputs.length) return null;
  if (!options.skipSizeCheck && !(await confirmLargeFiles(inputs, !!tool.heavy))) return null;
  const groupId = uid('grp');
  submitJob({
    toolId: tool.id,
    groupId,
    pool: options.pool,
    operation: options.operation,
    inputName: options.label,
    inputSize: inputs.reduce((n, f) => n + f.size, 0),
    inputCount: inputs.length,
    run: options.run,
  });
  void recordToolUse(tool.id, tool.category);
  return groupId;
}
