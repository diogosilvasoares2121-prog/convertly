import { useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { capabilitiesStore, type CapabilityKey } from '../../core/capabilities';
import { t, useI18n } from '../../i18n';
import licenses from '../../generated/licenses.json';
import { BrandMark } from '../components/Brand';
import { Button } from '../components/controls';
import { Badge } from '../components/feedback';
import { Icon } from '../components/Icon';

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  usage: string;
  homepage: string;
}

const CAPS: Array<[CapabilityKey, string]> = [
  ['wasm', 'WebAssembly'],
  ['worker', 'Web Workers'],
  ['offscreenCanvas', 'OffscreenCanvas'],
  ['encodeJpeg', 'JPEG encoder'],
  ['encodePng', 'PNG encoder'],
  ['encodeWebp', 'WEBP encoder'],
  ['encodeAvif', 'AVIF encoder'],
  ['webAudio', 'Web Audio'],
  ['downloadsApi', 'chrome.downloads'],
];

export function About() {
  useI18n();
  const caps = useStore(capabilitiesStore);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const showLicenses = async () => {
    setLoading(true);
    try {
      // Local file inside the extension package.
      const res = await fetch('/THIRD_PARTY_LICENSES.txt');
      setText(await res.text());
    } catch {
      setText(t('about.licensesMissing'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="stack" style={{ marginTop: '12px', maxWidth: '860px', '--gap': '20px' }}>
      <div class="card card--pad row" style={{ '--gap': '18px' }}>
        <BrandMark size={56} />
        <div class="grow">
          <h1>Convertly</h1>
          <p class="muted" data-testid="version">
            {t('about.version', { version: __APP_VERSION__ })}
          </p>
        </div>
        <a class="btn" href="#/privacy">
          <Icon name="shield" />
          {t('nav.privacy')}
        </a>
      </div>

      <div class="card card--pad stack">
        <h2>{t('about.howTitle')}</h2>
        <ul class="feature-list">
          <li>
            <Icon name="success" />
            {t('about.local')}
          </li>
          <li>
            <Icon name="success" />
            {t('about.noServer')}
          </li>
          <li>
            <Icon name="success" />
            {t('about.noAnalytics')}
          </li>
          <li>
            <Icon name="success" />
            {t('about.offline')}
          </li>
        </ul>
      </div>

      <div class="card card--pad stack">
        <h2>{t('about.browser')}</h2>
        <p class="small muted">{t('about.browserHint')}</p>
        <div class="row" style={{ '--gap': '8px' }}>
          {CAPS.map(([key, label]) => (
            <Badge key={key} tone={caps[key] ? 'success' : 'warning'} icon={caps[key] ? 'check' : 'close'}>
              {label}
            </Badge>
          ))}
          <Badge>{t('about.cores', { n: caps.cores })}</Badge>
        </div>
      </div>

      <div class="card card--pad stack" data-testid="free-software">
        <h2>{t('about.freeSoftware')}</h2>
        <p class="small">{t('about.freeSoftwareBody')}</p>
        {__APP_SOURCE_URL__ ? (
          <a class="btn" href={__APP_SOURCE_URL__} target="_blank" rel="noopener noreferrer" data-testid="source-link" style={{ alignSelf: 'flex-start' }}>
            <Icon name="external" />
            {t('about.sourceCode')}
          </a>
        ) : null}
      </div>

      <div class="card card--pad stack">
        <h2>{t('about.thirdParty')}</h2>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{t('about.library')}</th>
                <th>{t('about.license')}</th>
                <th>{t('about.usage')}</th>
              </tr>
            </thead>
            <tbody>
              {(licenses as LicenseEntry[]).map((l) => (
                <tr key={l.name}>
                  <td>
                    <strong>{l.name}</strong> <span class="muted small">{l.version}</span>
                  </td>
                  <td>
                    <Badge format>{l.license}</Badge>
                  </td>
                  <td class="small">{l.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="small muted">{t('about.gplNote')}</p>
        {text === null ? (
          <div>
            <Button icon="file" loading={loading} onClick={() => void showLicenses()}>
              {t('about.showLicenses')}
            </Button>
          </div>
        ) : (
          <pre class="license-text">{text}</pre>
        )}
      </div>
    </div>
  );
}
