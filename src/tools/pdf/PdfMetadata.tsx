import { useEffect, useState } from 'preact/hooks';
import { makeOutput } from '../../core/jobs';
import { writePdfMetadata } from '../../engines/pdf/client';
import type { PdfMetadata as Meta } from '../../engines/pdf/ops';
import type { ToolProps } from '../../registry/types';
import { formatDate, t, tn, useI18n } from '../../i18n';
import { renameWithExtension } from '../../utils/filename';
import { Button, TextInput } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Badge, ErrorNotice, Spinner } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';
import { acceptFor } from '../image/common';
import { usePdfInfo } from './info';

type Editable = Pick<Meta, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>;
const FIELDS: Array<keyof Editable> = ['title', 'author', 'subject', 'keywords', 'creator', 'producer'];

export default function PdfMetadata({ tool }: ToolProps) {
  useI18n();
  const files = useToolFiles(tool, { multiple: false });
  const file = files.files[0] ?? null;
  const { info, error } = usePdfInfo(file?.file ?? null);
  const [fields, setFields] = useState<Editable | null>(null);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  useEffect(() => {
    setFields(info ? { title: info.metadata.title, author: info.metadata.author, subject: info.metadata.subject, keywords: info.metadata.keywords, creator: info.metadata.creator, producer: info.metadata.producer } : null);
  }, [info]);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="pdf.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }
  if (!file) {
    return <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} multiple={false} title={t('pdf.dropOne')} buttonLabel={t('pdf.choosePdf')} icon="metadata" testId="dropzone" />;
  }

  const run = async (removeAll: boolean) => {
    if (!fields) return;
    const values = fields;
    const id = await startCombinedJob(tool, [file], {
      pool: 'pdf',
      operation: removeAll ? t('pdfMeta.removeAll') : t('pdfMeta.save'),
      label: file.name,
      run: async (ctx) => {
        ctx.setState('processing');
        const blob = await writePdfMetadata(file.file, values, removeAll, { signal: ctx.signal });
        if (removeAll) ctx.note(t('pdfMeta.removedNote'));
        return [makeOutput(renameWithExtension(file.name, 'pdf', removeAll ? 'clean' : 'edited'), blob)];
      },
    });
    if (id) setGroupId(id);
  };

  const m = info?.metadata;
  return (
    <ToolWorkspace
      main={
        <>
          <FileList files={files.files} onRemove={files.remove} />
          {error ? <ErrorNotice code={error} /> : null}
          {!info && !error ? <Spinner label={t('progress.reading')} /> : null}
          {info && fields && m ? (
            <div class="card card--pad stack">
              <div class="row row--between">
                <h3>{t('pdfMeta.properties')}</h3>
                <div class="row" style={{ '--gap': '6px' }}>
                  <Badge tone="brand">{tn('pdf.pages', info.pageCount)}</Badge>
                  {info.hasXmpMetadata ? <Badge tone="warning">XMP</Badge> : null}
                </div>
              </div>
              {FIELDS.map((key) => (
                <TextInput key={key} label={t(`pdfMeta.${key}` as never)} value={fields[key]} onChange={(v) => setFields({ ...fields, [key]: v })} />
              ))}
              <dl class="kv">
                <dt>{t('pdfMeta.created')}</dt>
                <dd>{m.creationDate ? formatDate(Date.parse(m.creationDate)) : '—'}</dd>
                <dt>{t('pdfMeta.modified')}</dt>
                <dd>{m.modificationDate ? formatDate(Date.parse(m.modificationDate)) : '—'}</dd>
              </dl>
            </div>
          ) : null}
        </>
      }
      panel={
        <OptionsCard title={t('pdfMeta.actions')}>
          <Button variant="primary" size="lg" block icon="check" disabled={!fields} onClick={() => void run(false)} data-testid="run">
            {t('pdfMeta.save')}
          </Button>
          <Button variant="danger" block icon="shield" disabled={!fields} onClick={() => void run(true)} data-testid="remove-all">
            {t('pdfMeta.removeAll')}
          </Button>
          <p class="small muted">{t('pdfMeta.removeHint')}</p>
        </OptionsCard>
      }
    />
  );
}
