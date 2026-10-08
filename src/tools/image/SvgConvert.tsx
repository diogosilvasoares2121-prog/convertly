import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { makeOutput } from '../../core/jobs';
import { settingsStore } from '../../storage/settings';
import { rasterizeSvg, svgSize, type SvgSize } from '../../engines/image/svg';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, NumberInput, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { useImagePreview } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from './common';

type Out = 'png' | 'jpg' | 'webp';
type SizeMode = 'scale' | 'width';
const MAX = 16384;

function outputSize(size: SvgSize, mode: SizeMode, scale: number, width: number): { width: number; height: number } {
  const k = mode === 'scale' ? scale : width / size.width;
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}

/** SVG → PNG/JPG/WEBP at any resolution (vector graphics stay sharp when enlarged). */
export default function SvgConvert({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const outputs: Out[] = caps.encodeWebp ? ['png', 'jpg', 'webp'] : ['png', 'jpg'];
  const preset = tool.preset?.to;
  const [format, setFormat] = useSession<Out>(tool.id, 'format', preset === 'jpg' || preset === 'webp' ? preset : 'png');
  const [mode, setMode] = useSession<SizeMode>(tool.id, 'sizeMode', 'scale');
  const [scale, setScale] = useSession<number>(tool.id, 'scale', 2);
  const [width, setWidth] = useSession<number | ''>(tool.id, 'width', 1024);
  const [background, setBackground] = useSession<'transparent' | 'white'>(tool.id, 'bg', 'transparent');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const first = files.files[0] ?? null;
  const previewUrl = useImagePreview(first?.file ?? null, first ? 'svg' : null, 480);
  const [firstSize, setFirstSize] = useState<SvgSize | null>(null);

  useEffect(() => {
    let alive = true;
    setFirstSize(null);
    if (first) void first.file.text().then((s) => alive && setFirstSize(svgSize(s)));
    return () => {
      alive = false;
    };
  }, [first]);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="svg-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('svg.dropTitle')} buttonLabel={t('svg.choose')} formatsHint={formatsHint(tool)} icon="shapes" testId="dropzone" />;
  }

  const widthValue = typeof width === 'number' ? width : 0;
  const invalid = mode === 'width' && (widthValue < 1 || widthValue > MAX);
  const result = firstSize ? outputSize(firstSize, mode, scale, widthValue || 1) : null;
  const tooLarge = !!result && (result.width > MAX || result.height > MAX);

  const run = async () => {
    const out = format;
    const opts = { mode, scale, width: widthValue };
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: `SVG → ${out.toUpperCase()}`,
      run: (f) => async (ctx) => {
        ctx.setState('processing');
        const size = outputSize(svgSize(await f.file.text()), opts.mode, opts.scale, opts.width);
        const blob = await rasterizeSvg(f.file, { ...size, format: out, quality: settings.imageQuality / 100, background: background === 'white' ? '#ffffff' : null });
        ctx.setState('finalizing');
        if (out === 'jpg' && background === 'transparent') ctx.note(t('note.transparencyFlattened'));
        return [makeOutput(renameWithExtension(f.name, out), blob, { [t('meta.dimensions')]: `${size.width}×${size.height}` })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          {previewUrl ? (
            <div class="preview-pane preview-pane--checker" style={{ minHeight: '240px' }}>
              <img src={previewUrl} alt={t('svg.preview')} style={{ maxHeight: '240px', maxWidth: '100%' }} />
            </div>
          ) : null}
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} />
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('options.convertTo')}</div>
            <Segmented label={t('options.convertTo')} value={format} block onChange={setFormat} options={outputs.map((f) => ({ value: f, label: f.toUpperCase() }))} />
          </div>
          <div class="field">
            <div class="field__label">{t('svg.size')}</div>
            <Segmented label={t('svg.size')} value={mode} block onChange={setMode} options={[{ value: 'scale', label: t('svg.scale') }, { value: 'width', label: t('svg.width') }]} />
          </div>
          {mode === 'scale' ? (
            <Segmented label={t('svg.scale')} value={scale} block onChange={setScale} options={[1, 2, 3, 4, 8].map((s) => ({ value: s, label: `${s}×` }))} />
          ) : (
            <NumberInput label={t('resize.width')} value={width} onChange={setWidth} min={1} max={MAX} suffix="px" />
          )}
          <div class="field">
            <div class="field__label">{t('svg.background')}</div>
            <Segmented
              label={t('svg.background')}
              value={format === 'jpg' ? 'white' : background}
              block
              onChange={setBackground}
              options={[
                { value: 'transparent', label: t('svg.transparent'), disabled: format === 'jpg' },
                { value: 'white', label: t('svg.white') },
              ]}
            />
          </div>
          {result ? (
            <dl class="kv">
              <dt>{t('meta.original')}</dt>
              <dd>
                {Math.round(firstSize!.width)} × {Math.round(firstSize!.height)}
              </dd>
              <dt>{t('meta.result')}</dt>
              <dd data-testid="svg-result-size">
                {result.width} × {result.height}
              </dd>
            </dl>
          ) : null}
          {tooLarge ? <div class="field__error">{t('svg.tooLarge')}</div> : null}
          <p class="small muted">{t('svg.safeNote')}</p>
          <Button variant="primary" size="lg" block icon="convert" disabled={invalid || tooLarge} onClick={() => void run()} data-testid="run">
            {tn('svg.runN', files.files.length, { format: format.toUpperCase() })}
          </Button>
        </OptionsCard>
      }
    />
  );
}
