import { useEffect, useMemo, useState } from 'preact/hooks';
import { detectionStore, openToolWith } from '../../app/handoff';
import { navigate } from '../../app/router';
import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { detectFile, isAnimatedImage, type DetectedFile } from '../../core/detect';
import { makeOutput } from '../../core/jobs';
import { processImage } from '../../engines/image/client';
import { imagesToPdf } from '../../engines/pdf/client';
import { FORMATS, type FormatId } from '../../registry/formats';
import { conversionTargets } from '../../registry/matrix';
import { getTool, pairTool, toolsAccepting } from '../../registry/tools';
import { toolTitle } from '../../registry/search';
import type { ToolDef } from '../../registry/types';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { formatBytes } from '../../utils/bytes';
import { renameWithExtension } from '../../utils/filename';
import type { PickedFile } from '../files';
import { Button } from '../components/controls';
import { Badge, ErrorNotice, Notice, Spinner } from '../components/feedback';
import { Icon } from '../components/Icon';
import { Dropzone } from '../components/Dropzone';
import { useImagePreview } from '../../tools/shared/preview';
import { setSessionValue } from '../../tools/shared/session';
import { JobGroupView } from '../../tools/shared/Results';
import { startJobs } from '../../tools/shared/workspace';
import { prepareImagesForPdf } from '../../tools/image/pdf-images';
import { CATEGORY_ICON } from './Home';

/** Generic tools already covered by the "Convert to" row. */
const CONVERT_COMPONENTS = new Set(['image-convert', 'media-convert', 'images-to-pdf', 'video-gif', 'pdf-to-image', 'svg-convert', 'image-ico']);

interface Group {
  format: FormatId | null;
  items: Array<DetectedFile & { path: string }>;
}

/** Opens the best tool for a conversion target, pre-selecting the output format. */
function openConversion(from: FormatId, to: FormatId, files: PickedFile[]): void {
  const category = FORMATS[from].category;
  if (to === 'ico') {
    openToolWith('image-to-ico', files.slice(0, 1));
    return;
  }
  if (from === 'svg') {
    setSessionValue('svg-convert', 'format', to);
    openToolWith('svg-convert', files);
    return;
  }
  if (to === 'pdf') {
    openToolWith('images-to-pdf', files);
    return;
  }
  if (category === 'pdf') {
    setSessionValue('pdf-to-image', 'format', to);
    openToolWith('pdf-to-image', files);
    return;
  }
  if (FORMATS[to].category === 'image' && category === 'image') {
    setSessionValue('image-convert', 'format', to);
    openToolWith(files.length > 1 ? 'image-convert' : (pairTool(from, to)?.id ?? 'image-convert'), files);
    return;
  }
  if (to === 'gif') {
    openToolWith('video-to-gif', files);
    return;
  }
  if (FORMATS[to].category === 'audio') {
    const toolId = category === 'video' ? 'video-to-audio' : 'audio-convert';
    setSessionValue(toolId, 'target', to);
    openToolWith(toolId, files);
    return;
  }
  setSessionValue('video-convert', 'target', to);
  openToolWith('video-convert', files);
}

function Preview({ file }: { file: DetectedFile }) {
  const url = useImagePreview(file.category === 'image' ? file.file : null, file.format, 240);
  return (
    <div class="detect-card__preview">
      {url ? <img src={url} alt="" /> : <Icon name={file.category ? CATEGORY_ICON[file.category] : 'file'} />}
    </div>
  );
}

function AnimatedHint({ file }: { file: DetectedFile }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    let alive = true;
    if (file.format === 'gif' || file.format === 'webp' || file.format === 'png') void isAnimatedImage(file.file, file.format).then((a) => alive && setAnimated(a));
    return () => {
      alive = false;
    };
  }, [file]);
  return animated ? (
    <Badge tone="warning" icon="layers">
      {t('image.animated')}
    </Badge>
  ) : (
    file.format === 'gif' ? <Badge>{t('image.static')}</Badge> : null
  );
}

/** Clipboard image: one-click "Save as" through the job system. */
function ClipboardActions({ file }: { file: DetectedFile }) {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const [groupId, setGroupId] = useState<string | null>(null);
  const tool = getTool('image-convert')!;
  if (groupId) return <JobGroupView groupId={groupId} zipName="clipboard.zip" onReset={() => setGroupId(null)} resetLabel={t('clipboard.another')} showOriginal={false} />;
  const save = async (to: 'png' | 'jpg' | 'webp' | 'pdf') => {
    const base = `clipboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
    const id = await startJobs(tool, [{ name: `${base}.png`, size: file.size }], {
      pool: 'image',
      operation: `${t('clipboard.title')} → ${to.toUpperCase()}`,
      skipSizeCheck: true,
      run: () => async (ctx) => {
        ctx.setState('processing');
        if (to === 'pdf') {
          const prepared = await prepareImagesForPdf([{ file: file.file, format: file.format! }], ctx.signal, () => {});
          const blob = await imagesToPdf(prepared, { pageSize: 'auto', orientation: 'auto', margin: 'none', fit: 'contain' }, { signal: ctx.signal });
          return [makeOutput(`${base}.pdf`, blob)];
        }
        const r = await processImage(file.file, file.format!, {}, { format: to, quality: 0.92 }, { signal: ctx.signal, onProgress: ctx.progress });
        return [makeOutput(renameWithExtension(`${base}.png`, to), r.blob)];
      },
    });
    if (id) setGroupId(id);
  };
  return (
    <div class="action-group">
      <div class="action-group__label">{t('clipboard.saveAs')}</div>
      <div class="chips">
        <button type="button" class="chip chip--format" data-testid="save-png" onClick={() => void save('png')}>PNG</button>
        <button type="button" class="chip chip--format" data-testid="save-jpg" onClick={() => void save('jpg')}>JPG</button>
        {caps.encodeWebp ? <button type="button" class="chip chip--format" data-testid="save-webp" onClick={() => void save('webp')}>WEBP</button> : null}
        <button type="button" class="chip chip--format" data-testid="save-pdf" onClick={() => void save('pdf')}>PDF</button>
      </div>
    </div>
  );
}

function GroupCard({ group, source }: { group: Group; source: string }) {
  useI18n();
  useStore(capabilitiesStore);
  const first = group.items[0]!;
  const picked: PickedFile[] = group.items.map((i) => ({ file: i.file, path: i.path }));
  const format = group.format;
  const many = group.items.length > 1;
  const empty = group.items.every((i) => i.empty);
  const targets = format ? conversionTargets(format) : [];
  const actions: ToolDef[] = format ? toolsAccepting(format).filter((tool) => !CONVERT_COMPONENTS.has(tool.component) || tool.preset?.mode === 'bitrate') : [];
  const anyTools = [getTool('zip-create'), getTool('file-to-base64')].filter((x): x is ToolDef => !!x);
  const label = format ? FORMATS[format].label : t('detect.unknown');
  const kind = format ? t(`detect.kind.${FORMATS[format].category}` as MessageKey) : '';
  const total = group.items.reduce((n, i) => n + i.size, 0);

  return (
    <div class="card detect-card" data-testid="detect-card" data-format={format ?? 'unknown'}>
      <Preview file={first} />
      <div style={{ minWidth: 0 }}>
        <h2 class="truncate" title={first.name}>
          {source === 'paste' && first.category === 'image' ? t('clipboard.detected') : many ? tn('detect.manyFiles', group.items.length, { format: label }) : t('detect.detected', { format: label, kind })}
        </h2>
        <div class="row" style={{ '--gap': '8px', marginTop: '6px' }}>
          {!many ? <span class="muted truncate">{first.name}</span> : null}
          <span class="muted">{formatBytes(total)}</span>
          {format ? <Badge format>{label}</Badge> : null}
          {first.sizeClass !== 'light' ? <Badge tone={first.sizeClass === 'medium' ? 'warning' : 'danger'}>{t(`size.${first.sizeClass}` as MessageKey)}</Badge> : null}
          {first.extensionMismatch ? <Badge tone="warning" icon="warning">{t('files.mismatch', { real: label })}</Badge> : null}
          {!many && first.category === 'image' ? <AnimatedHint file={first} /> : null}
        </div>
        {empty ? <div style={{ marginTop: '12px' }}><ErrorNotice code="empty-file" /></div> : null}
        {!format && !empty ? <div style={{ marginTop: '12px' }}><ErrorNotice code="unsupported-format" /></div> : null}
        {source === 'paste' && first.category === 'image' && !many && !empty ? <ClipboardActions file={first} /> : null}
        {targets.length && !empty && !(source === 'paste' && first.category === 'image') ? (
          <div class="action-group">
            <div class="action-group__label">{many ? t('detect.convertAllTo') : t('detect.convertTo')}</div>
            <div class="chips">
              {targets.map((to) => (
                <button key={to} type="button" class="chip chip--format" onClick={() => openConversion(format!, to, picked)} data-testid={`convert-${to}`}>
                  {FORMATS[to].label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {actions.length && !empty ? (
          <div class="action-group">
            <div class="action-group__label">{t('detect.other')}</div>
            <div class="chips">
              {actions.map((tool) => (
                <button key={tool.id} type="button" class="chip" onClick={() => openToolWith(tool.id, picked)}>
                  <Icon name={tool.icon} />
                  {toolTitle(tool)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!empty ? (
          <div class="action-group">
            <div class="action-group__label">{t('detect.anyFile')}</div>
            <div class="chips">
              {anyTools.map((tool) => (
                <button key={tool.id} type="button" class="chip" onClick={() => openToolWith(tool.id, picked)}>
                  <Icon name={tool.icon} />
                  {toolTitle(tool)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DetectPage() {
  useI18n();
  const detection = useStore(detectionStore);
  const [groups, setGroups] = useState<Group[] | null>(null);

  useEffect(() => {
    let alive = true;
    setGroups(null);
    if (!detection) return;
    void Promise.all(detection.files.map((p) => detectFile(p.file).then((d) => ({ ...d, path: p.path })))).then((all) => {
      if (!alive) return;
      const map = new Map<string, Group>();
      for (const d of all) {
        const key = d.empty ? '__empty' : (d.format ?? '__unknown');
        if (!map.has(key)) map.set(key, { format: d.empty ? null : d.format, items: [] });
        map.get(key)!.items.push(d);
      }
      setGroups([...map.values()]);
    });
    return () => {
      alive = false;
    };
  }, [detection]);

  const count = detection?.files.length ?? 0;
  const formats = useMemo(() => groups?.length ?? 0, [groups]);

  if (!detection) {
    return (
      <div class="stack" style={{ marginTop: '24px' }}>
        <h1>{t('detect.title')}</h1>
        <Dropzone onFiles={(files) => detectionStore.set({ files, source: 'picker' })} title={t('home.dropTitle')} />
      </div>
    );
  }

  return (
    <div class="stack" style={{ marginTop: '12px' }}>
      <div class="row row--between">
        <div>
          <h1>{t('detect.title')}</h1>
          <p class="muted">{groups ? tn('detect.summary', count, { formats }) : t('progress.reading')}</p>
        </div>
        <Button icon="close" variant="ghost" onClick={() => { detectionStore.set(null); navigate('#/'); }}>
          {t('action.clear')}
        </Button>
      </div>
      {!groups ? <Spinner label={t('progress.reading')} /> : groups.map((g, i) => <GroupCard key={`${g.format}-${i}`} group={g} source={detection.source} />)}
      <Notice tone="success" icon="lock">
        {t('privacy.detectNote')}
      </Notice>
    </div>
  );
}
