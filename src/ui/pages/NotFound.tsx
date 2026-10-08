import { t, useI18n } from '../../i18n';
import { Icon } from '../components/Icon';

export function NotFound() {
  useI18n();
  return (
    <div class="card empty" style={{ marginTop: '40px', padding: '48px 16px' }}>
      <Icon name="search" />
      <h2>{t('notFound.title')}</h2>
      <p>{t('notFound.desc')}</p>
      <a class="btn btn--primary" href="#/">
        {t('nav.home')}
      </a>
    </div>
  );
}
