import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { makeOutput } from '../../core/jobs';
import { settingsStore } from '../../storage/settings';
import { splitImage } from '../../engines/image/client';
import type { ToolProps } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { splitName } from '../../utils/filename';
import { Button, NumberInput, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { useImagePreview } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { EXT, acceptFor, formatsHint } from './common';
import { sameOrFallback } from './ImageResize';

type Preset = '1x2' | '1x3' | '2x1' | '2x2' | '3x3' | 'custom';
const PRESETS: Record<Exclude<Preset, 'custom'>, [number, number]> = { '1x2': [1, 2], '1x3': [1, 3], '2x1': [2, 1], '2x2': [2, 2], '3x3': [3, 3] };

/** Cuts an image into a grid of tiles (Instagram carousels/grids, printing posters). */
export default function ImageSplit({ tool }: ToolProps) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const [preset, setPreset] = useSession<Preset>(tool.id, 'preset', '1x3');
  const [rows, setRows] = useSession<number | ''>(tool.id, 'rows', 2);
  const [cols, setCols] = useSession<number | ''>(tool.id, 'cols', 2);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const previewUrl = useImagePreview(file?.file ?? null, file?.format ?? null, 900);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName={`${splitName(file?.name ?? 'image').base}-tiles.zip`} onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('image.dropOne')} buttonLabel={t('image.chooseOne')} formatsHint={formatsHint(tool)} icon="grid" testId="dropzone" />;
  }

  const [r, c] = preset === 'custom' ? [Number(rows) || 0, Number(cols) || 0] : PRESETS[preset];
  const invalid = r < 1 || c < 1 || r > 20 || c > 20 || r * c < 2;

  const run = async () => {
    const out = sameOrFallback(file.format, caps);
    const base = splitName(file.name).base || 'image';
    const id = await startCombinedJob(tool, [file], {
      pool: 'image',
      operation: t('tool.image-split.title'),
      label: file.name,
      run: async (ctx) => {
        ctx.setState('processing');
        const tiles = await splitImage(file.file, file.format!, r, c, { format: out, quality: settings.imageQuality / 100 }, { signal: ctx.signal, onProgress: ctx.progress });
        return tiles.map((tile, i) =>
          makeOutput(`${base}-${String(i + 1).padStart(2, '0')}-r${tile.row}c${tile.col}.${EXT[out]}`, tile.blob, { [t('meta.dimensions')]: `${tile.width}×${tile.height}` }),
        );
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} />
          <div class="preview-pane" style={{ minHeight: '300px' }}>
            {previewUrl ? (
              <div class="split-preview">
                <img src={previewUrl} alt={t('split.preview')} />
                {!invalid ? (
                  <div class="split-preview__grid" style={{ gridTemplateColumns: `repeat(${c}, 1fr)`, gridTemplateRows: `repeat(${r}, 1fr)` }} aria-hidden="true">
                    {Array.from({ length: r * c }, (_, i) => (
                      <span key={i}>{i + 1}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <Spinner label={t('progress.loading')} />
            )}
          </div>
        </>
      }
      panel={
        <OptionsCard>
          <div class="field">
            <div class="field__label">{t('split.grid')}</div>
            <Segmented
              label={t('split.grid')}
              value={preset}
              wrap
              onChange={setPreset}
              options={[
                { value: '1x2', label: '1 × 2' },
                { value: '1x3', label: '1 × 3' },
                { value: '2x1', label: '2 × 1' },
                { value: '2x2', label: '2 × 2' },
                { value: '3x3', label: '3 × 3' },
                { value: 'custom', label: t('compress.custom') },
              ]}
            />
            <div class="field__hint">{t('split.gridHint')}</div>
          </div>
          {preset === 'custom' ? (
            <div class="row" style={{ alignItems: 'flex-start' }}>
              <div class="grow">
                <NumberInput label={t('split.rows')} value={rows} onChange={setRows} min={1} max={20} />
              </div>
              <div class="grow">
                <NumberInput label={t('split.cols')} value={cols} onChange={setCols} min={1} max={20} />
              </div>
            </div>
          ) : null}
          {invalid ? <div class="field__error">{t('split.invalid')}</div> : null}
          <Button variant="primary" size="lg" block icon="grid" disabled={invalid} onClick={() => void run()} data-testid="run">
            {t('split.run', { count: r * c })}
          </Button>
        </OptionsCard>
      }
    />
  );
}
