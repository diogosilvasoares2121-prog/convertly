import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import type { Job } from '../../core/jobs';
import type { ImageOutputFormat } from '../../engines/image/types';
import { FORMATS, type FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { formatBytes, KB, savedPercent } from '../../utils/bytes';
import { Button, NumberInput, Segmented, Slider, SwitchRow } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { useImagePreview, useObjectUrl } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles, type ToolFile } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint, qualityLabel, runImageJob } from './common';

type Preset = 'max' | 'balanced' | 'small' | 'custom';
type Target = 'none' | '100' | '250' | '500' | '1024' | 'custom';
type OutChoice = 'auto' | ImageOutputFormat;

const PRESET_QUALITY: Record<Exclude<Preset, 'custom'>, number> = { max: 92, balanced: 78, small: 58 };

function autoFormat(from: FormatId | null, caps: { encodeWebp: boolean; encodeAvif: boolean }): ImageOutputFormat {
  if (from === 'jpg') return 'jpg';
  if (from === 'webp' && caps.encodeWebp) return 'webp';
  if (from === 'avif') return caps.encodeAvif ? 'avif' : caps.encodeWebp ? 'webp' : 'jpg';
  if (from === 'png') return caps.encodeWebp ? 'webp' : 'jpg'; // keeps transparency, much smaller
  return 'jpg';
}

function Compare({ job, original }: { job: Job; original: ToolFile | undefined }) {
  useI18n();
  const before = useImagePreview(original?.file ?? null, original?.format ?? null, 900);
  const after = useObjectUrl(job.outputs[0]?.blob);
  if (!original || !job.outputs[0]) return null;
  return (
    <div class="compare">
      <figure>
        <div class="preview-pane">{before ? <img src={before} alt={t('result.original')} /> : null}</div>
        <figcaption>
          <span>{t('result.original')}</span>
          <span>{formatBytes(original.size)}</span>
        </figcaption>
      </figure>
      <figure>
        <div class="preview-pane">{after ? <img src={after} alt={t('result.result')} /> : null}</div>
        <figcaption>
          <span>{t('image.compressed')}</span>
          <span>{formatBytes(job.outputs[0].size)}</span>
        </figcaption>
      </figure>
    </div>
  );
}

export default function ImageCompress({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const files = useToolFiles(tool);
  const [preset, setPreset] = useSession<Preset>(tool.id, 'preset', 'balanced');
  const [custom, setCustom] = useSession<number>(tool.id, 'custom', 75);
  const [target, setTarget] = useSession<Target>(tool.id, 'target', 'none');
  const [targetKb, setTargetKb] = useSession<number | ''>(tool.id, 'targetKb', 300);
  const [downscale, setDownscale] = useSession<boolean>(tool.id, 'downscale', true);
  const [out, setOut] = useSession<OutChoice>(tool.id, 'out', 'auto');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return (
      <JobGroupView
        groupId={groupId}
        zipName="compressed-images.zip"
        onReset={() => {
          setGroupId(null);
          files.clear();
        }}
        extra={(jobs) => {
          const done = jobs.filter((j) => j.state === 'completed');
          if (jobs.length === 1 && done[0]) return <Compare job={done[0]} original={files.files[0]} />;
          const before = done.reduce((n, j) => n + j.inputSize, 0);
          const after = done.reduce((n, j) => n + j.outputs.reduce((m, o) => m + o.size, 0), 0);
          return done.length ? (
            <div class="notice notice--success">
              <div>
                {t('image.batchSaved', { before: formatBytes(before), after: formatBytes(after), percent: Math.max(0, savedPercent(before, after)) })}
              </div>
            </div>
          ) : null;
        }}
      />
    );
  }

  if (!files.files.length) {
    return (
      <Dropzone
        onFiles={(p) => void files.add(p)}
        accept={acceptFor(tool)}
        title={t('image.dropTitle')}
        buttonLabel={t('image.choose')}
        formatsHint={formatsHint(tool)}
        icon="compress"
        testId="dropzone"
      />
    );
  }

  const quality = preset === 'custom' ? custom : PRESET_QUALITY[preset];
  const targetBytes = target === 'none' ? undefined : target === 'custom' ? (typeof targetKb === 'number' && targetKb > 0 ? targetKb * KB : undefined) : Number(target) * KB;
  const outOptions: Array<{ value: OutChoice; label: string }> = [
    { value: 'auto', label: t('image.autoFormat') },
    { value: 'jpg', label: 'JPG' },
    ...(caps.encodeWebp ? [{ value: 'webp' as const, label: 'WEBP' }] : []),
    ...(caps.encodeAvif ? [{ value: 'avif' as const, label: 'AVIF' }] : []),
  ];

  const run = async () => {
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-compress.title'),
      run: (f) => async (ctx) => {
        const format = out === 'auto' ? autoFormat(f.format, caps) : out;
        const outputs = await runImageJob(f, {}, { format, quality: quality / 100, ...(targetBytes ? { targetBytes, allowDownscale: downscale } : {}) }, ctx, 'compressed');
        if (outputs[0] && outputs[0].size >= f.size) ctx.note(t('note.notSmaller'));
        return outputs;
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('compress.preset')}</div>
            <Segmented
              label={t('compress.preset')}
              value={preset}
              wrap
              onChange={setPreset}
              options={[
                { value: 'max', label: t('compress.max') },
                { value: 'balanced', label: t('compress.balanced') },
                { value: 'small', label: t('compress.small') },
                { value: 'custom', label: t('compress.custom') },
              ]}
            />
          </div>
          {preset === 'custom' ? <Slider label={t('options.quality')} value={custom} min={10} max={100} onChange={setCustom} format={qualityLabel} /> : null}
          <div class="field">
            <div class="field__label">{t('compress.targetSize')}</div>
            <Segmented
              label={t('compress.targetSize')}
              value={target}
              wrap
              onChange={setTarget}
              options={[
                { value: 'none', label: t('compress.noTarget') },
                { value: '100', label: '100 KB' },
                { value: '250', label: '250 KB' },
                { value: '500', label: '500 KB' },
                { value: '1024', label: '1 MB' },
                { value: 'custom', label: t('compress.custom') },
              ]}
            />
          </div>
          {target === 'custom' ? <NumberInput label={t('compress.customTarget')} value={targetKb} onChange={setTargetKb} min={5} suffix="KB" /> : null}
          {target !== 'none' ? <SwitchRow label={t('compress.allowDownscale')} hint={t('compress.allowDownscaleHint')} checked={downscale} onChange={setDownscale} /> : null}
          <div class="field">
            <div class="field__label">{t('compress.outputFormat')}</div>
            <Segmented label={t('compress.outputFormat')} value={out} wrap onChange={setOut} options={outOptions} />
            {out === 'auto' ? <div class="field__hint">{t('compress.autoHint')}</div> : null}
          </div>
          <Button variant="primary" size="lg" block icon="compress" onClick={() => void run()} data-testid="run">
            {tn('compress.runN', files.files.length)}
          </Button>
          <p class="small muted">{t('compress.originalSafe', { format: FORMATS.jpg.label })}</p>
        </OptionsCard>
      }
    />
  );
}
