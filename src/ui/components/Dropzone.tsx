import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { t, useI18n } from '../../i18n';
import { filesFromDataTransfer, filesFromInput, hasFiles, type PickedFile } from '../files';
import { Button } from './controls';
import { Icon, type AnyIcon } from './Icon';

/**
 * Drop area with a "Choose files" button. Also used as the empty state of every tool.
 * `allowFolders` enables folder selection (Create ZIP).
 */
export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  title,
  buttonLabel,
  formatsHint,
  icon = 'upload',
  compact,
  allowFolders,
  children,
  testId,
}: {
  onFiles: (files: PickedFile[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  buttonLabel?: string;
  formatsHint?: string;
  icon?: AnyIcon;
  compact?: boolean;
  allowFolders?: boolean;
  children?: ComponentChildren;
  testId?: string;
}) {
  useI18n();
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  return (
    <div
      class={['dropzone', compact && 'dropzone--compact', active && 'dropzone--active'].filter(Boolean).join(' ')}
      data-testid={testId}
      onDragEnter={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current++;
        setActive(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setActive(false);
      }}
      onDrop={async (e) => {
        if (!e.dataTransfer || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation(); // handled here: don't trigger the global drop handler
        depth.current = 0;
        setActive(false);
        const files = await filesFromDataTransfer(e.dataTransfer);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <div class="dropzone__icon">
        <Icon name={icon} />
      </div>
      <div>
        <div class="dropzone__title">{title ?? t('dropzone.title')}</div>
        {!compact ? <div class="dropzone__or">{t('dropzone.or')}</div> : null}
      </div>
      <div class="row" style={{ justifyContent: 'center' }}>
        <Button variant="primary" icon="folder" onClick={() => input.current?.click()}>
          {buttonLabel ?? t('dropzone.choose')}
        </Button>
        {allowFolders ? (
          <Button icon="folder" onClick={() => folderInput.current?.click()}>
            {t('dropzone.chooseFolder')}
          </Button>
        ) : null}
      </div>
      {formatsHint && !compact ? <div class="dropzone__formats">{formatsHint}</div> : null}
      {!compact ? (
        <div class="dropzone__hint">
          <Icon name="lock" />
          {t('privacy.local')}
        </div>
      ) : null}
      {children}
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          const files = filesFromInput(el);
          el.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {allowFolders ? (
        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            const el = e.currentTarget as HTMLInputElement;
            const files = filesFromInput(el);
            el.value = '';
            if (files.length) onFiles(files);
          }}
        />
      ) : null}
    </div>
  );
}
