import { navigate } from '../../app/router';
import { updateSettings } from '../../storage/settings';
import { t, useI18n } from '../../i18n';
import { BrandMark } from '../components/Brand';
import { Button } from '../components/controls';
import { Icon } from '../components/Icon';

/** First-run screen: one screen, four promises, one button. */
export function Welcome() {
  useI18n();
  const start = () => {
    void updateSettings({ onboardingDone: true });
    navigate('#/');
  };
  return (
    <div class="card" style={{ maxWidth: '560px', margin: '48px auto', padding: '40px 36px', textAlign: 'center' }} data-testid="welcome">
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <BrandMark size={64} />
      </div>
      <h1 style={{ marginTop: '20px', fontSize: '30px' }}>{t('welcome.title')}</h1>
      <p class="hero__subtitle">{t('welcome.subtitle')}</p>
      <ul class="feature-list" style={{ margin: '28px auto', maxWidth: '300px', textAlign: 'left' }}>
        {(['welcome.local', 'welcome.noUploads', 'welcome.noAccount', 'welcome.offline'] as const).map((k) => (
          <li key={k}>
            <Icon name="success" />
            {t(k)}
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" onClick={start} autoFocus data-testid="get-started">
        {t('welcome.start')}
      </Button>
    </div>
  );
}
