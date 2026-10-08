import { useStore } from '../../core/store';
import { settingsStore } from '../../storage/settings';
import { imageOutputs } from '../../registry/matrix';
import { FORMATS } from '../../registry/formats';
import type { ToolProps } from '../../registry/types';
import type { ImageOutputFormat } from '../../engines/image/types';
import { t, tn, useI18n } from '../../i18n';
import { Button, Slider } from '../../ui/components/controls';
import { Dropzone } from '../../ui/components/Dropzone';
import { Notice } from '../../ui/components/feedback';
import { FileList } from '../shared/FileList';
import { JobGroupView } from '../shared/Results';
import { useSession } from '../shared/session';
import { useToolFiles } from '../shared/useToolFiles';
import { OptionsCard, ToolWorkspace, startJobs } from '../shared/workspace';
import { AnimatedBadge, OutputFormatPicker, acceptFor, formatsHint, qualityLabel, runImageJob } from './common';

export default function ImageConvert({ tool }: ToolProps) {
  useI18n();
  const settings = useStore(settingsStore);
  const files = useToolFiles(tool);
  const available = imageOutputs(null) as ImageOutputFormat[];
  const preset = tool.preset?.to as ImageOutputFormat | undefined;
  const [format, setFormat] = useSession<ImageOutputFormat>(tool.id, 'format', preset && available.includes(preset) ? preset : 'jpg');
  const [quality, setQuality] = useSession<number>(tool.id, 'quality', settings.imageQuality);
  const [groupId, setGroupId] = useSession<string | null>(tool.id, 'group', null);

  if (groupId) {
    return <JobGroupView groupId={groupId} zipName="converted-images.zip" onReset={() => { setGroupId(null); files.clear(); }} />;
  }

  const lossy = format !== 'png';
  const run = async () => {
    const id = await startJobs(tool, files.files, {
      pool: 'image',
      operation: (f) => `${f.format ? FORMATS[f.format].label : '?'} → ${FORMATS[format].label}`,
      run: (f) => (ctx) => runImageJob(f, {}, { format, quality: quality / 100 }, ctx),
    });
    if (id) setGroupId(id);
  };

  if (!files.files.length) {
    return (
      <Dropzone
        onFiles={(p) => void files.add(p)}
        accept={acceptFor(tool)}
        multiple
        title={t('image.dropTitle')}
        buttonLabel={t('image.choose')}
        formatsHint={formatsHint(tool)}
        icon="image"
        testId="dropzone"
      />
    );
  }

  return (
    <ToolWorkspace
      main={
        <>
          <Dropzone onFiles={(p) => void files.add(p)} accept={acceptFor(tool)} compact title={t('files.addMore')} buttonLabel={t('files.add')} icon="plus" />
          <FileList files={files.files} onRemove={files.remove} extra={(f) => <AnimatedBadge file={f} />} />
        </>
      }
      panel={
        <OptionsCard>
          <OutputFormatPicker value={format} onChange={setFormat} />
          {lossy ? <Slider label={t('options.quality')} value={quality} min={10} max={100} onChange={setQuality} format={qualityLabel} /> : null}
          {format === 'jpg' ? <Notice tone="neutral">{t('image.jpgNoTransparency')}</Notice> : null}
          <Button variant="primary" size="lg" block icon="convert" onClick={() => void run()} data-testid="run">
            {tn('image.convertN', files.files.length, { format: FORMATS[format].label })}
          </Button>
          <Button variant="ghost" block onClick={files.clear}>
            {t('action.clearAll')}
          </Button>
        </OptionsCard>
      }
    />
  );
}
