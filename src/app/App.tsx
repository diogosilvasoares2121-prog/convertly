import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '../core/store';
import { settingsStore } from '../storage/settings';
import { t, useI18n } from '../i18n';
import { filesFromDataTransfer, filesFromInput, hasFiles, type PickedFile } from '../ui/files';
import { Sidebar } from '../ui/layout/Sidebar';
import { Topbar } from '../ui/layout/Topbar';
import { CommandPalette } from '../ui/layout/CommandPalette';
import { JobsDrawer } from '../ui/layout/JobsDrawer';
import { Toasts } from '../ui/components/Toasts';
import { Icon } from '../ui/components/Icon';
import { Home } from '../ui/pages/Home';
import { ToolPage } from '../ui/pages/ToolPage';
import { CategoryPage } from '../ui/pages/CategoryPage';
import { AllToolsPage } from '../ui/pages/AllTools';
import { DetectPage } from '../ui/pages/DetectPage';
import { Settings } from '../ui/pages/Settings';
import { About } from '../ui/pages/About';
import { Privacy } from '../ui/pages/Privacy';
import { Welcome } from '../ui/pages/Welcome';
import { NotFound } from '../ui/pages/NotFound';
import { ConfirmHost } from './confirm';
import { analyzeFiles, dropTargetStore, openToolWith } from './handoff';
import { getTool } from '../registry/tools';
import { FORMATS } from '../registry/formats';
import { navigate, routeStore, type Route } from './router';

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'tool':
      return <ToolPage id={route.id} />;
    case 'category':
      return <CategoryPage id={route.id} />;
    case 'detect':
      return <DetectPage />;
    case 'tools':
      return <AllToolsPage />;
    case 'settings':
      return <Settings />;
    case 'about':
      return <About />;
    case 'privacy':
      return <Privacy />;
    case 'welcome':
      return <Welcome />;
    default:
      return <NotFound />;
  }
}

/** Sends files to the tool on screen when it accepts them, otherwise to the detection screen. */
function routeFiles(files: PickedFile[], source: 'drop' | 'paste' | 'picker'): void {
  if (!files.length) return;
  const route = routeStore.get();
  if (route.name === 'tool') {
    const target = dropTargetStore.get();
    if (target) {
      if (target(files)) return;
    } else {
      // The tool UI is still loading: queue compatible files for it.
      const tool = getTool(route.id);
      const accepts = tool?.accepts;
      const compatible = accepts === '*' || (accepts ?? []).some((f) => files.some((p) => FORMATS[f].extensions.includes(p.file.name.split('.').pop()?.toLowerCase() ?? '')));
      if (tool && compatible) {
        openToolWith(tool.id, files);
        return;
      }
    }
  }
  analyzeFiles(files, source);
}

export function App() {
  useI18n();
  const route = useStore(routeStore);
  const settings = useStore(settingsStore);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);

  // First run → welcome screen (once).
  useEffect(() => {
    if (!settings.onboardingDone && route.name === 'home') navigate('#/welcome');
  }, [settings.onboardingDone, route.name]);

  // Global drag & drop, paste and keyboard shortcuts.
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const onDrop = async (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault(); // never let the browser navigate to a dropped file
      routeFiles(await filesFromDataTransfer(e.dataTransfer!), 'drop');
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      // Only reads what the user explicitly pasted (Ctrl+V); the clipboard is never polled.
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      routeFiles(
        files.map((file) => ({ file, path: file.name })),
        'paste',
      );
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        picker.current?.click();
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => setMenuOpen(false), [route]);

  const showChrome = route.name !== 'welcome';
  return (
    <div class={`app${showChrome ? '' : ' app--bare'}`}>
      <a class="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('nav.skip')}
      </a>
      {showChrome ? <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} /> : null}
      <div class="main">
        {showChrome ? <Topbar onMenu={() => setMenuOpen(true)} onSearch={() => setPaletteOpen(true)} onJobs={() => setJobsOpen(true)} onOpenFiles={() => picker.current?.click()} /> : null}
        <main id="main" class="content" tabIndex={-1}>
          <Page route={route} />
        </main>
        <footer class="page-footer">
          <span>
            <Icon name="lock" /> {t('privacy.footer')}
          </span>
          <a href="#/privacy">{t('nav.privacy')}</a>
          <a href="#/about">{t('nav.about')}</a>
          <span>v{__APP_VERSION__}</span>
        </footer>
      </div>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        data-testid="global-file-input"
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          const files = filesFromInput(el);
          el.value = '';
          routeFiles(files, 'picker');
        }}
      />
      {dragging ? (
        <div class="drop-overlay" aria-hidden="true">
          <div class="drop-overlay__panel">
            <Icon name="upload" />
            <h2>{t('drop.overlayTitle')}</h2>
            <p class="muted">{t('privacy.local')}</p>
          </div>
        </div>
      ) : null}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <JobsDrawer open={jobsOpen} onClose={() => setJobsOpen(false)} />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
