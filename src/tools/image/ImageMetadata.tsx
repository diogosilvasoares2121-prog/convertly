import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { settingsStore } from '../../storage/settings';
import { makeOutput } from '../../core/jobs';
import { toAppError, type ErrorCode } from '../../core/errors';
import { getImageInfo, stripImageMetadata } from '../../engines/image/client';
import type { ImageInfo, ImageOutputFormat } from '../../engines/image/types';
import { FORMATS } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { formatBytes } from '../../utils/bytes';
import { renameWithExtension } from '../../utils/filename';
import { Button, Segmented } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, ErrorNotice, Notice, Spinner } from '../../ui/components/feedback';
import { useImagePreview } from '../shared/preview';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles, type ToolFile } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { acceptFor, formatsHint } from './common';
import { IconButton } from '../../ui/components/controls';

function MetadataCard({ file, onRemove }: { file: ToolFile; onRemove: () => void }) {
  useI18n();
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const preview = useImagePreview(file.file, file.format, 200);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    getImageInfo(file.file, file.format!)
      .then((i) => alive && setInfo(i))
      .catch((err: unknown) => alive && setError(toAppError(err).code));
    return () => {
      alive = false;
    };
  }, [file]);
  const m = info?.metadata;
  const flags = m
    ? [
        m.hasExif && 'EXIF',
        m.hasGps && 'GPS',
        m.hasXmp && 'XMP',
        m.hasIptc && 'IPTC',
        m.hasIcc && t('meta.icc'),
        m.hasComments && t('meta.comments'),
      ].filter((x): x is string => !!x)
    : [];
  return (
    <div class="card detect-card" data-testid="metadata-card">
      <div class="detect-card__preview">{preview ? <img src={preview} alt="" /> : null}</div>
      <div class="stack" style={{ '--gap': '10px', minWidth: 0 }}>
        <div class="row row--between">
          <h3 class="truncate" title={file.name}>
            {file.name}
          </h3>
          <IconButton icon="close" label={t('files.remove', { name: file.name })} onClick={onRemove} />
        </div>
        {error ? <ErrorNotice code={error} compact /> : null}
        {!info && !error ? <Spinner label={t('progress.loading')} /> : null}
        {info && m ? (
          <>
            <dl class="kv">
              <dt>{t('meta.format')}</dt>
              <dd>{file.format ? FORMATS[file.format].label : '—'}</dd>
              <dt>{t('meta.dimensions')}</dt>
              <dd>
                {info.width} × {info.height} px
              </dd>
              <dt>{t('meta.fileSize')}</dt>
              <dd>{formatBytes(file.size)}</dd>
              {m.colorSpace ? (
                <>
                  <dt>{t('meta.color')}</dt>
                  <dd>
                    {m.colorSpace}
                    {m.bitDepth ? ` · ${m.bitDepth}-bit` : ''}
                  </dd>
                </>
              ) : null}
              {m.orientation && m.orientation !== 1 ? (
                <>
                  <dt>{t('meta.orientation')}</dt>
                  <dd>{m.orientation}</dd>
                </>
              ) : null}
              {info.animated ? (
                <>
                  <dt>{t('meta.animation')}</dt>
                  <dd>{t('image.animated')}</dd>
                </>
              ) : null}
              {m.entries.map((e, i) => (
                <Fragment key={`${e.key}-${i}`}>
                  <dt>{e.key}</dt>
                  <dd>{e.value}</dd>
                </Fragment>
              ))}
            </dl>
            <div class="row" style={{ '--gap': '6px' }}>
              {flags.length ? flags.map((f) => <Badge key={f} tone={f === 'GPS' ? 'danger' : 'warning'}>{f}</Badge>) : <Badge tone="success" icon="check">{t('meta.none')}</Badge>}
            </div>
            {m.hasGps ? (
              <Notice tone="warning" icon="map-pin">
                {t('meta.gpsWarning')}
              </Notice>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function ImageMetadata({ tool }: ToolProps) {
  useI18n();
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const [fallback, setFallback] = useSession<ImageOutputFormat>(tool.id, 'fallback', 'jpg');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="clean-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} title={t('image.dropTitle')} buttonLabel={t('image.choose')} formatsHint={formatsHint(tool)} icon="metadata" testId="dropzone" />;
  }
  const needsReencode = files.files.some((f) => f.format !== 'jpg' && f.format !== 'png' && f.format !== 'webp');

  const run = async () => {
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: t('tool.image-metadata.title'),
      run: (f) => async (ctx) => {
        ctx.setState('processing');
        const result = await stripImageMetadata(f.file, f.format!, fallback, settings.imageQuality / 100, ctx.signal);
        ctx.note(result.lossless ? t('meta.lossless') : t('meta.reencoded'));
        if (result.removed.length) ctx.note(t('meta.removedList', { list: result.removed.join(', ') }));
        else ctx.note(t('meta.nothingFound'));
        return [makeOutput(renameWithExtension(f.name, FORMATS[result.outputFormat].extensions[0]!, 'clean'), result.blob)];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          {files.files.slice(0, 30).map((f) => (
            <MetadataCard key={f.id} file={f} onRemove={() => files.remove(f.id)} />
          ))}
          {files.files.length > 30 ? <p class="muted small">{tn('meta.moreFiles', files.files.length - 30)}</p> : null}
        </>
      }
      panel={
        <OptionsCard title={t('meta.removeTitle')}>
          <p class="small muted">{t('meta.removeDesc')}</p>
          {needsReencode ? (
            <div class="field">
              <div class="field__label">{t('meta.outputFor')}</div>
              <Segmented label={t('meta.outputFor')} value={fallback} block onChange={setFallback} options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
            </div>
          ) : null}
          <Button variant="primary" size="lg" block icon="shield" onClick={() => void run()} data-testid="run">
            {tn('meta.runN', files.files.length)}
          </Button>
          <p class="small muted">{t('meta.originalUntouched')}</p>
        </OptionsCard>
      }
    />
  );
}
