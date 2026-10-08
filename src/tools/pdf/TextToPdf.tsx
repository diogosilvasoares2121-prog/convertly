import { useEffect, useRef } from 'preact/hooks';
import { makeOutput } from '../../core/jobs';
import { dropTargetStore, takePending } from '../../app/handoff';
import { textToPdf } from '../../engines/pdf/client';
import type { TextToPdfOptions } from '../../engines/pdf/edit';
import type { ToolProps } from '../../registry/types';
import { t, tn, useI18n } from '../../i18n';
import { MB, formatBytes } from '../../utils/bytes';
import { sanitizeFilename, splitName } from '../../utils/filename';
import { Button, Segmented, Slider, TextInput } from '../../ui/components/controls';
import { toast } from '../../ui/components/Toasts';
import type { PickedFile } from '../../ui/files';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { OptionsCard, ToolWorkspace, startCombinedJob } from '../shared/workspace';

/** Plain text (typed, pasted or opened from .txt/.md/.csv…) → paginated PDF. */
export default function TextToPdf({ tool }: ToolProps) {
  useI18n();
  const [text, setText] = useSession<string>(tool.id, 'text', '');
  const [name, setName] = useSession<string>(tool.id, 'name', '');
  const [pageSize, setPageSize] = useSession<TextToPdfOptions['pageSize']>(tool.id, 'pageSize', 'a4');
  const [font, setFont] = useSession<TextToPdfOptions['font']>(tool.id, 'font', 'sans');
  const [fontSize, setFontSize] = useSession<number>(tool.id, 'fontSize', 11);
  const [margin, setMargin] = useSession<number>(tool.id, 'margin', 56);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    if (file.size > 20 * MB) {
      toast(t('data.tooLarge'), 'warning');
      return;
    }
    setText(await file.text());
    setName(splitName(file.name).base);
  };

  useEffect(() => {
    const pending = takePending(tool.id);
    if (pending[0]) void load(pending[0].file);
    const handler = (files: PickedFile[]) => {
      if (!files[0]) return false;
      void load(files[0].file);
      return true;
    };
    dropTargetStore.set(() => handler);
    return () => {
      if (dropTargetStore.get() === handler) dropTargetStore.set(null);
    };
  }, [tool.id]);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="text.zip" onReset={() => setGroupId(null)} resetLabel={t('action.createAnother')} />;
  }

  const fileName = `${sanitizeFilename(name.trim() || 'document')}.pdf`;
  const run = async () => {
    const options: TextToPdfOptions = { pageSize, font, fontSize, margin, title: name.trim() || 'document' };
    const content = text;
    const id = await startCombinedJob(tool, [{ name: fileName, size: content.length }], {
      pool: 'pdf',
      operation: t('tool.text-to-pdf.title'),
      label: fileName,
      skipSizeCheck: true,
      run: async (ctx) => {
        ctx.setState('processing');
        const r = await textToPdf(content, options, { signal: ctx.signal });
        if (r.replaced) ctx.note(tn('textPdf.replaced', r.replaced));
        return [makeOutput(fileName, r.blob, { [t('meta.pages')]: r.pages })];
      },
    });
    if (id) setGroupId(id);
  };

  return (
    <ToolWorkspace
      main={
        <div class="stack" style={{ '--gap': '8px' }}>
          <div class="row row--between">
            <label class="field__label" for="text-to-pdf-input">
              {t('textPdf.text')}
            </label>
            <div class="row" style={{ '--gap': '4px' }}>
              <Button size="sm" variant="ghost" icon="folder" onClick={() => fileInput.current?.click()}>
                {t('data.openFile')}
              </Button>
              <Button size="sm" variant="ghost" icon="trash" disabled={!text} onClick={() => setText('')}>
                {t('action.clear')}
              </Button>
            </div>
          </div>
          <textarea
            id="text-to-pdf-input"
            class="textarea textarea--wrap"
            style={{ minHeight: '420px' }}
            value={text}
            placeholder={t('textPdf.placeholder')}
            data-testid="data-input"
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          />
          <div class="small muted">
            {formatBytes(new Blob([text]).size)} · {tn('textPdf.lines', text ? text.split('\n').length : 0)}
          </div>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.log,.html,text/*"
            onChange={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              const f = el.files?.[0];
              el.value = '';
              if (f) void load(f);
            }}
          />
        </div>
      }
      panel={
        <OptionsCard>
          <TextInput label={t('zip.name')} value={name} onChange={setName} placeholder="document" hint={fileName} />
          <div class="field">
            <div class="field__label">{t('imagesPdf.pageSize')}</div>
            <Segmented label={t('imagesPdf.pageSize')} value={pageSize} block onChange={setPageSize} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
          </div>
          <div class="field">
            <div class="field__label">{t('textPdf.font')}</div>
            <Segmented
              label={t('textPdf.font')}
              value={font}
              block
              onChange={setFont}
              options={[
                { value: 'sans', label: t('textPdf.sans') },
                { value: 'serif', label: t('textPdf.serif') },
                { value: 'mono', label: t('textPdf.mono') },
              ]}
            />
          </div>
          <Slider label={t('pageNum.fontSize')} value={fontSize} min={7} max={24} onChange={setFontSize} format={(v) => `${v} pt`} />
          <Slider label={t('pageNum.margin')} value={margin} min={18} max={108} step={2} onChange={setMargin} format={(v) => `${Math.round(v / (72 / 25.4))} mm`} />
          <p class="small muted">{t('textPdf.fontNote')}</p>
          <Button variant="primary" size="lg" block icon="pdf" disabled={!text.trim()} onClick={() => void run()} data-testid="run">
            {t('textPdf.run')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
