import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/tools.css';
import { loadSettings } from '../storage/settings';
import { loadActivity } from '../storage/activity';
import { detectCapabilities } from '../core/capabilities';
import { setLanguage } from '../i18n';
import { startRouter } from './router';
import { App } from './App';

async function bootstrap(): Promise<void> {
  const [settings] = await Promise.all([loadSettings(), loadActivity(), detectCapabilities()]);
  setLanguage(settings.language);
  if (settings.theme !== 'system') document.documentElement.dataset.theme = settings.theme;
  startRouter();
  const root = document.getElementById('root');
  if (!root) return;
  root.textContent = '';
  render(<App />, root);
}

void bootstrap();
