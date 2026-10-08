import { makeOutput } from '../../core/jobs';
import { createTar, createZip, gzipFile } from '../../engines/zip/client';
import type { ZipLevel } from '../../engines/zip/writer';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { sanitizeFilename } from '../../utils/filename';
import { Button, Segmented, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';

type Kind = 'zip' | 'tar' | 'tgz' | 'gz';
const EXT: Record<Kind, string> = { zip: '.zip', tar: '.tar', tgz: '.tar.gz', gz: '.gz' };
const STRIP = /\.(zip|tar\.gz|tgz|tar|gz)$/i;

/** Create ZIP (and, in "Create archive", TAR, TAR.GZ or GZ) from files and folders. */
export default function ZipCreate({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool);
  const multiFormat = tool.id !== 'zip-create';
  const [kind, setKind] = useSession<Kind>(tool.id, 'kind', multiFormat ? 'tgz' : 'zip');
  const [level, setLevel] = useSession<ZipLevel>(tool.id, 'level', 'normal');
  const [name, setName] = useSession<string>(tool.id, 'name', '');
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="archive.zip" onReset={() => { setGroupId(null); files.clear(); setName(''); }} resetLabel={t('action.createAnother')} />;
  }
  if (!files.files.length) {
    return <Dropzone onFiles={(p) => void files.add(p)} title={t('zip.dropTitle')} buttonLabel={t('zip.chooseFiles')} icon={multiFormat ? 'package' : 'archive'} allowFolders testId="dropzone" />;
  }

  const single = files.files.length === 1;
  const effective: Kind = kind === 'gz' && !single ? 'tgz' : kind;
  const folder = files.files[0]!.path.includes('/') ? files.files[0]!.path.split('/')[0] : '';
  const defaultBase = effective === 'gz' ? files.files[0]!.name : folder || 'archive';
  const archiveName = sanitizeFilename((name.trim() || defaultBase).replace(STRIP, '') + EXT[effective]);

  const run = async () => {
    const inputs = files.files.map((f) => ({ path: f.path, blob: f.file, lastModified: f.file.lastModified, name: f.name, size: f.size }));
    const entries = inputs.map(({ path, blob, lastModified }) => ({ path, blob, lastModified }));
    const target = effective;
    const id = await startCombinedJob(tool, inputs, {
      pool: 'zip',
      operation: t(`tool.${tool.id}.title` as never),
      label: tn('files.count', inputs.length),
      run: async (ctx) => {
        ctx.setState('processing');
        const opts = { signal: ctx.signal, onProgress: ctx.progress };
        const blob =
          target === 'zip'
            ? await createZip(entries, level, opts)
            : target === 'gz'
              ? await gzipFile(inputs[0]!.blob, level, opts)
              : await createTar(entries, target === 'tgz', level, opts);
        return [makeOutput(archiveName, blob, { [t('zip.entries')]: inputs.length })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" allowFolders />
          <FileList files={files.files} onRemove={files.remove} showPath />
        </>
      }
      panel={
        <OptionsCard>
          {multiFormat ? (
            <div class="field">
              <div class="field__label">{t('archive.format')}</div>
              <Segmented
                label={t('archive.format')}
                value={effective}
                wrap
                onChange={setKind}
                options={[
                  { value: 'zip', label: 'ZIP' },
                  { value: 'tar', label: 'TAR' },
                  { value: 'tgz', label: 'TAR.GZ' },
                  { value: 'gz', label: 'GZ', disabled: !single },
                ]}
              />
              <div class="field__hint">{t(`archive.formatHint.${effective}` as never)}</div>
            </div>
          ) : null}
          <TextInput label={t('zip.name')} value={name} onChange={setName} placeholder={archiveName} hint={archiveName} />
          {effective !== 'tar' ? (
            <div class="field">
              <div class="field__label">{t('zip.level')}</div>
              <Segmented
                label={t('zip.level')}
                value={effective === 'zip' ? level : level === 'store' ? 'normal' : level}
                block
                onChange={setLevel}
                options={[
                  ...(effective === 'zip' ? [{ value: 'store' as const, label: t('zip.store') }] : []),
                  { value: 'normal' as const, label: t('zip.normal') },
                  { value: 'max' as const, label: t('zip.max') },
                ]}
              />
              {effective === 'zip' ? <div class="field__hint">{t(`zip.levelHint.${level}` as never)}</div> : null}
            </div>
          ) : null}
          <Button variant="primary" size="lg" block icon={multiFormat ? 'package' : 'archive'} onClick={() => void run()} data-testid="run">
            {multiFormat ? t('archive.create', { format: EXT[effective].slice(1).toUpperCase() }) : t('zip.create')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
