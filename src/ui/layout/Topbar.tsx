import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { isActive, jobsStore } from '../../core/jobs';
import { settingsStore, updateSettings, type ThemePreference } from '../../storage/settings';
import { t, useI18n } from '../../i18n';
import { Button, IconButton } from '../components/controls';
import { Icon, type AnyIcon } from '../components/Icon';

const NEXT_THEME: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON: Record<ThemePreference, AnyIcon> = { system: 'monitor', light: 'sun', dark: 'moon' };

export function Topbar({ onMenu, onSearch, onJobs, onOpenFiles }: { onMenu: () => void; onSearch: () => void; onJobs: () => void; onOpenFiles: () => void }) {
  useI18n();
  const settings = useStore(settingsStore);
  const activeCount = useStore(jobsStore, (jobs) => jobs.filter((j) => isActive(j) || j.state === 'queued').length);
  const [scrolled, setScrolled] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header class={`topbar${scrolled ? ' topbar--scrolled' : ''}`}>
      <IconButton class="topbar__menu" icon="menu" label={t('nav.openMenu')} onClick={onMenu} />
      <button type="button" class="topbar__search" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K" data-testid="open-palette">
        <Icon name="search" />
        <span>{t('search.placeholder')}</span>
        <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd>K</kbd>
      </button>
      <div class="topbar__spacer" />
      <div class="topbar__actions">
        <Button variant="ghost" size="sm" icon="folder" onClick={onOpenFiles} aria-keyshortcuts="Control+O Meta+O" title={`${t('action.openFiles')} (${isMac ? '⌘' : 'Ctrl'}+O)`}>
          <span class="hide-sm">{t('action.openFiles')}</span>
        </Button>
        <span class="jobs-button">
          <IconButton icon="layers" label={t('jobs.title')} onClick={onJobs} data-testid="open-jobs" />
          {activeCount ? <span class="jobs-button__count">{activeCount}</span> : null}
        </span>
        <IconButton
          icon={THEME_ICON[settings.theme]}
          label={t('theme.toggle', { theme: t(`theme.${settings.theme}`) })}
          onClick={() => void updateSettings({ theme: NEXT_THEME[settings.theme] })}
        />
      </div>
    </header>
  );
}
