import { useCallback, useEffect, useRef } from 'preact/hooks';
import { detectFile, type DetectedFile } from '../../core/detect';
import { dropTargetStore, takePending } from '../../app/handoff';
import { FORMATS, type FormatId } from '../../registry/formats';
import type { ToolDef } from '../../registry/types';
import { t, tn } from '../../i18n';
import { toast } from '../../ui/components/Toasts';
import type { PickedFile } from '../../ui/files';
import { uid } from '../../utils/id';
import { useSession } from './session';

export interface ToolFile extends DetectedFile {
  id: string;
  /** Relative path (folders dropped into Create ZIP). */
  path: string;
}

export interface UseToolFiles {
  files: ToolFile[];
  add(picked: PickedFile[]): Promise<number>;
  remove(id: string): void;
  move(from: number, to: number): void;
  clear(): void;
  setFiles(files: ToolFile[]): void;
}

/**
 * Manages the input files of a tool: detection (magic bytes), validation against
 * the accepted formats, ordering, global drop/paste and hand-off from other screens.
 */
export function useToolFiles(tool: ToolDef, options: { accepts?: FormatId[] | '*'; multiple?: boolean } = {}): UseToolFiles {
  const accepts = options.accepts ?? tool.accepts;
  const multiple = options.multiple ?? tool.multiple;
  const [files, setFiles] = useSession<ToolFile[]>(tool.id, 'files', []);
  const filesRef = useRef(files);
  filesRef.current = files;

  const add = useCallback(
    async (picked: PickedFile[]): Promise<number> => {
      const detected = await Promise.all(picked.map((p) => detectFile(p.file).then((d) => ({ ...d, id: uid('file'), path: p.path || p.file.name }))));
      const accepted: ToolFile[] = [];
      let empty = 0;
      let unsupported = 0;
      for (const d of detected) {
        if (d.empty) {
          empty++;
          continue;
        }
        if (accepts !== '*' && (!d.format || !accepts.includes(d.format))) {
          unsupported++;
          continue;
        }
        accepted.push(d);
      }
      if (empty) toast(tn('files.rejectedEmpty', empty), 'warning');
      if (unsupported) {
        const list = accepts === '*' ? '' : [...new Set(accepts.map((f) => FORMATS[f].label))].join(', ');
        toast(`${tn('files.rejectedFormat', unsupported)} ${list ? t('files.accepted', { list }) : ''}`.trim(), 'warning');
      }
      if (!accepted.length) return 0;
      setFiles((prev) => (multiple ? [...prev, ...accepted] : accepted.slice(0, 1)));
      return accepted.length;
    },
    [accepts, multiple, setFiles],
  );

  // Files handed over from the detection screen or a previous result.
  useEffect(() => {
    const pending = takePending(tool.id);
    if (pending.length) void add(pending);
  }, [tool.id, add]);

  // While this tool is on screen, globally dropped/pasted files go to it when compatible.
  useEffect(() => {
    const handler = (picked: PickedFile[]): boolean => {
      // Synchronous acceptance check by extension/MIME; detection happens in add().
      const compatible = accepts === '*' || picked.some((p) => {
        const ext = p.file.name.split('.').pop()?.toLowerCase() ?? '';
        return accepts.some((f) => FORMATS[f].extensions.includes(ext) || FORMATS[f].mimes.includes(p.file.type));
      });
      if (!compatible) return false;
      void add(picked);
      return true;
    };
    dropTargetStore.set(() => handler);
    return () => {
      if (dropTargetStore.get() === handler) dropTargetStore.set(null);
    };
  }, [accepts, add]);

  return {
    files,
    add,
    remove: (id) => setFiles((prev) => prev.filter((f) => f.id !== id)),
    move: (from, to) =>
      setFiles((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item!);
        return next;
      }),
    clear: () => setFiles([]),
    setFiles,
  };
}
