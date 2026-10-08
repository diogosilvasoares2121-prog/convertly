import { useEffect, useState } from 'preact/hooks';
import { isAnimatedImage } from '../../core/detect';
import { makeOutput, type JobContext, type OutputFile } from '../../core/jobs';
import { processImage } from '../../engines/image/client';
import type { ImageOps, ImageOutputFormat, OutputSpec } from '../../engines/image/types';
import { imageOutputs } from '../../registry/matrix';
import { FORMATS, acceptAttribute, type FormatId } from '../../registry/formats';
import { t, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Badge } from '../../ui/components/feedback';
import { Segmented } from '../../ui/components/controls';
import type { ToolDef } from '../../registry/types';
import type { ToolFile } from '../shared/useToolFiles';

export const EXT: Record<ImageOutputFormat, string> = { jpg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };

export function acceptFor(tool: ToolDef): string {
  return tool.accepts === '*' ? '' : acceptAttribute(tool.accepts);
}

export function formatsHint(tool: ToolDef): string {
  if (tool.accepts === '*') return '';
  return t('dropzone.formats', { list: [...new Set(tool.accepts.map((f) => FORMATS[f].label))].join(', ') });
}

export function OutputFormatPicker({ value, onChange, from }: { value: ImageOutputFormat; onChange: (v: ImageOutputFormat) => void; from?: FormatId | null }) {
  useI18n();
  const outputs = imageOutputs(from ?? null) as ImageOutputFormat[];
  return (
    <div class="field">
      <div class="field__label">{t('options.convertTo')}</div>
      <Segmented
        label={t('options.convertTo')}
        value={value}
        block
        options={outputs.map((f) => ({ value: f, label: FORMATS[f].label }))}
        onChange={onChange}
      />
    </div>
  );
}

/** Shows an "Animated" badge so users know only the first frame will be converted. */
export function AnimatedBadge({ file }: { file: ToolFile }) {
  useI18n();
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    let alive = true;
    if (file.format === 'gif' || file.format === 'webp' || file.format === 'png') {
      void isAnimatedImage(file.file, file.format).then((a) => alive && setAnimated(a));
    }
    return () => {
      alive = false;
    };
  }, [file]);
  return animated ? (
    <Badge tone="warning" icon="layers">
      {t('image.animated')}
    </Badge>
  ) : null;
}

/** Runs the image pipeline for one file and returns the output with honest notes. */
export async function runImageJob(
  file: ToolFile,
  ops: ImageOps,
  output: OutputSpec,
  ctx: JobContext,
  suffix = '',
): Promise<OutputFile[]> {
  ctx.setState('processing');
  const result = await processImage(file.file, file.format!, ops, output, { signal: ctx.signal, onProgress: ctx.progress });
  ctx.setState('finalizing');
  if (result.firstFrameOnly) ctx.note(t('note.firstFrame'));
  if (result.firstPageOnly) ctx.note(t('note.firstPage'));
  if (output.targetBytes && result.targetReached === false) ctx.note(t('note.targetNotReached'));
  if (output.format === 'jpg' && (file.format === 'png' || file.format === 'webp' || file.format === 'gif')) ctx.note(t('note.transparencyFlattened'));
  return [
    makeOutput(renameWithExtension(file.name, EXT[output.format], suffix), result.blob, {
      [t('meta.dimensions')]: `${result.width}×${result.height}`,
    }),
  ];
}

export function qualityLabel(q: number): string {
  return `${Math.round(q)}%`;
}
