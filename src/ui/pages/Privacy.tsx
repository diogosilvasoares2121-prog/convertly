import { t, useI18n } from '../../i18n';
import { Icon } from '../components/Icon';

/** Privacy policy shown inside the extension (also published as docs/PRIVACY.md). */
export function Privacy() {
  useI18n();
  const sections: Array<[string, string]> = [
    ['privacy.p.files.title', 'privacy.p.files.body'],
    ['privacy.p.network.title', 'privacy.p.network.body'],
    ['privacy.p.storage.title', 'privacy.p.storage.body'],
    ['privacy.p.analytics.title', 'privacy.p.analytics.body'],
    ['privacy.p.permissions.title', 'privacy.p.permissions.body'],
    ['privacy.p.offline.title', 'privacy.p.offline.body'],
  ];
  return (
    <div class="stack" style={{ marginTop: '12px' }}>
      <div class="row" style={{ '--gap': '14px' }}>
        <span class="tool-icon tool-icon--lg">
          <Icon name="shield" />
        </span>
        <div>
          <h1>{t('privacy.title')}</h1>
          <p class="muted">{t('privacy.tagline')}</p>
        </div>
      </div>
      <div class="card card--pad prose">
        <p>
          <strong>{t('privacy.intro')}</strong>
        </p>
        {sections.map(([title, body]) => (
          <div key={title}>
            <h2>{t(title as never)}</h2>
            {t(body as never)
              .split('\n')
              .map((line) => (
                <p key={line}>{line}</p>
              ))}
          </div>
        ))}
        <h2>{t('privacy.p.never.title')}</h2>
        <ul>
          {t('privacy.p.never.list')
            .split('\n')
            .map((item) => (
              <li key={item}>{item}</li>
            ))}
        </ul>
        <p class="small muted" style={{ marginTop: '18px' }}>
          {t('privacy.updated')}
        </p>
      </div>
    </div>
  );
}
