import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import './popup.css';
import { useStore } from '../core/store';
import { detectCapabilities } from '../core/capabilities';
import { loadSettings, settingsStore } from '../storage/settings';
import { loadActivity, recentStore, favoritesStore } from '../storage/activity';
import { getTool, isToolAvailable } from '../registry/tools';
import { toolTitle } from '../registry/search';
import { setLanguage, t, useI18n } from '../i18n';
import { BrandMark } from '../ui/components/Brand';
import { Icon } from '../ui/components/Icon';
import { ToolIcon } from '../ui/components/ToolCard';
import { openApp } from './open-app';

const DEFAULT_TOOLS = ['pdf-merge', 'image-compress', 'png-to-jpg'];

function Popup() {
  useI18n();
  const recent = useStore(recentStore);
  const favorites = useStore(favoritesStore);
  const settings = useStore(settingsStore);
  const ids = [...new Set([...favorites, ...(settings.rememberRecent ? recent.map((r) => r.toolId) : []), ...DEFAULT_TOOLS])];
  const tools = ids
    .map(getTool)
    .filter((tool) => tool && isToolAvailable(tool))
    .slice(0, 5);
  const open = async (hash = '') => {
    await openApp(hash);
    window.close();
  };
  return (
    <div class="popup">
      <div class="popup__brand">
        <BrandMark size={36} />
        <div>
          <div class="brand-name">Convertly</div>
          <div class="brand-tag">{t('brand.tagline')}</div>
        </div>
      </div>
      <button type="button" class="btn btn--primary btn--lg btn--block" onClick={() => void open()} autoFocus data-testid="open-toolbox">
        <Icon name="layers" />
        {t('popup.open')}
      </button>
      <div class="popup__section">{favorites.length ? t('popup.yourTools') : recent.length ? t('popup.recent') : t('popup.suggested')}</div>
      <div class="popup__tools">
        {tools.map((tool) => (
          <button key={tool!.id} type="button" class="result-item" onClick={() => void open(`#/tool/${tool!.id}`)}>
            <ToolIcon tool={tool!} size="sm" />
            <span class="result-item__title">{toolTitle(tool!)}</span>
            <Icon name="chevron-right" />
          </button>
        ))}
      </div>
      <div class="popup__footer">
        <Icon name="lock" />
        {t('privacy.footer')}
      </div>
    </div>
  );
}

async function bootstrap(): Promise<void> {
  const [settings] = await Promise.all([loadSettings(), loadActivity(), detectCapabilities()]);
  setLanguage(settings.language);
  if (settings.theme !== 'system') document.documentElement.dataset.theme = settings.theme;
  render(<Popup />, document.getElementById('root')!);
}

void bootstrap();
