import { makeOutput } from '../../core/jobs';
import { getImageInfo, processImage } from '../../engines/image/client';
import { buildIco, ICO_SIZES } from '../../engines/image/ico';
import { rasterizeSvg, svgSize } from '../../engines/image/svg';
import type { ImageOps } from '../../engines/image/types';
import type { FormatId } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, Checkbox, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { useImagePreview } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor, formatsHint } from './common';

type Fit = 'contain' | 'cover';

/** Any image (or SVG) → multi-size Windows/website .ico favicon. */
export default function ImageIco({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const [sizes, setSizes] = useSession<number[]>(tool.id, 'sizes', [16, 32, 48, 64, 128, 256]);
  const [fit, setFit] = useSession<Fit>(tool.id, 'fit', 'contain');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const previewUrl = useImagePreview(file?.file ?? null, file?.format ?? null, 256);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="favicon.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('image.dropOne')} buttonLabel={t('image.chooseOne')} formatsHint={formatsHint(tool)} icon="favicon" testId="dropzone" />;
  }

  const toggle = (s: number) => setSizes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort((a, b) => a - b)));

  const run = async () => {
    const chosen = [...sizes];
    const mode = fit;
    const id = await startCombinedJob(tool, [file], {
      pool: 'image',
      operation: t('tool.image-to-ico.title'),
      label: file.name,
      run: async (ctx) => {
        ctx.setState('preparing');
        let source: Blob = file.file;
        let format: FormatId = file.format!;
        if (format === 'svg') {
          // Vector input: rasterize once at 512 px on the longest side.
          const s = svgSize(await file.file.text());
          const k = 512 / Math.max(s.width, s.height);
          source = await rasterizeSvg(file.file, { width: s.width * k, height: s.height * k, format: 'png', quality: 1, background: null });
          format = 'png';
        }
        const info = await getImageInfo(source, format, ctx.signal);
        const side = Math.min(info.width, info.height);
        ctx.setState('processing');
        const entries: Array<{ size: number; png: Uint8Array }> = [];
        for (const [i, size] of chosen.entries()) {
          const ops: ImageOps =
            mode === 'cover'
              ? { crop: { x: Math.floor((info.width - side) / 2), y: Math.floor((info.height - side) / 2), width: side, height: side }, resize: { width: size, height: size } }
              : { fit: { maxWidth: size, maxHeight: size, allowEnlarge: true }, frame: { width: size, height: size, fit: 'contain' } };
          const r = await processImage(source, format, ops, { format: 'png', quality: 1 }, { signal: ctx.signal });
          entries.push({ size, png: new Uint8Array(await r.blob.arrayBuffer()) });
          ctx.progress((i + 1) / chosen.length);
        }
        ctx.setState('finalizing');
        const ico = buildIco(entries);
        return [makeOutput(renameWithExtension(file.name, 'ico'), new Blob([ico as BlobPart], { type: 'image/x-icon' }), { [t('ico.sizes')]: chosen.map((s) => `${s}`).join(', ') })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} />
          {previewUrl ? (
            <div class="card card--pad stack">
              <div class="field__label">{t('ico.preview')}</div>
              <div class="ico-preview">
                {[16, 32, 48, 64, 128].map((s) => (
                  <figure key={s} class="ico-preview__item">
                    <div class="ico-preview__frame preview-pane--checker" style={{ width: `${s}px`, height: `${s}px` }}>
                      <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: fit }} />
                    </div>
                    <figcaption class="small muted">{s}px</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('ico.sizes')}</div>
            <div class="checkbox-grid">
              {ICO_SIZES.map((s) => (
                <Checkbox key={s} checked={sizes.includes(s)} onChange={() => toggle(s)} label={`${s}×${s}`} />
              ))}
            </div>
            <div class="field__hint">{t('ico.sizesHint')}</div>
          </div>
          <div class="field">
            <div class="field__label">{t('ico.fit')}</div>
            <Segmented label={t('ico.fit')} value={fit} block onChange={setFit} options={[{ value: 'contain', label: t('ico.contain') }, { value: 'cover', label: t('ico.cover') }]} />
          </div>
          <Button variant="primary" size="lg" block icon="favicon" disabled={!sizes.length} onClick={() => void run()} data-testid="run">
            {t('ico.create')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
