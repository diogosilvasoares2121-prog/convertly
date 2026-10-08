import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { settingsStore, updateSettings, sanitizeFolder, type LanguagePreference, type ThemePreference } from '../../storage/settings';
import { clearRecent, recentStore } from '../../storage/activity';
import { setLanguage, t, tn, useI18n } from '../../i18n';
import { Button, Segmented, Slider, SwitchRow, TextInput } from '../components/controls';
import { Notice } from '../components/feedback';
import { toast } from '../components/Toasts';

export function Settings() {
  useI18n();
  const s = useStore(settingsStore);
  const recent = useStore(recentStore);
  const [folder, setFolder] = useState(s.downloadFolder);
  useEffect(() => setFolder(s.downloadFolder), [s.downloadFolder]);

  return (
    <div class="stack" style={{ maxWidth: '720px', marginTop: '12px', '--gap': '20px' }}>
      <div>
        <h1>{t('settings.title')}</h1>
        <p class="muted" style={{ marginTop: '6px' }}>
          {t('settings.subtitle')}
        </p>
      </div>

      <section class="card card--pad stack">
        <h2>{t('settings.appearance')}</h2>
        <div class="field">
          <div class="field__label">{t('settings.theme')}</div>
          <Segmented<ThemePreference>
            label={t('settings.theme')}
            value={s.theme}
            onChange={(theme) => void updateSettings({ theme })}
            options={[
              { value: 'system', label: t('theme.system'), icon: 'monitor' },
              { value: 'light', label: t('theme.light'), icon: 'sun' },
              { value: 'dark', label: t('theme.dark'), icon: 'moon' },
            ]}
          />
        </div>
        <div class="field">
          <div class="field__label">{t('settings.language')}</div>
          <Segmented<LanguagePreference>
            label={t('settings.language')}
            value={s.language}
            onChange={(language) => {
              void updateSettings({ language });
              setLanguage(language);
            }}
            options={[
              { value: 'auto', label: t('settings.languageAuto') },
              { value: 'en', label: 'English' },
              { value: 'pt', label: 'Português' },
            ]}
          />
        </div>
      </section>

      <section class="card card--pad stack">
        <h2>{t('settings.conversion')}</h2>
        <Slider label={t('settings.imageQuality')} value={s.imageQuality} min={10} max={100} onChange={(imageQuality) => void updateSettings({ imageQuality })} format={(v) => `${v}%`} hint={t('settings.imageQualityHint')} />
        <SwitchRow label={t('settings.confirmLarge')} hint={t('settings.confirmLargeHint')} checked={s.confirmLargeFiles} onChange={(confirmLargeFiles) => void updateSettings({ confirmLargeFiles })} />
      </section>

      <section class="card card--pad stack">
        <h2>{t('settings.downloads')}</h2>
        <form
          class="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            void updateSettings({ downloadFolder: folder });
            toast(t('settings.saved'));
          }}
        >
          <div class="grow">
            <TextInput label={t('settings.folder')} value={folder} onChange={setFolder} placeholder="Convertly" hint={t('settings.folderHint', { path: sanitizeFolder(folder) ? `Downloads/${sanitizeFolder(folder)}/` : 'Downloads/' })} />
          </div>
          <Button type="submit" disabled={sanitizeFolder(folder) === s.downloadFolder}>
            {t('action.save')}
          </Button>
        </form>
        <SwitchRow label={t('settings.askWhere')} hint={t('settings.askWhereHint')} checked={s.askWhereToSave} onChange={(askWhereToSave) => void updateSettings({ askWhereToSave })} />
      </section>

      <section class="card card--pad stack">
        <h2>{t('settings.privacy')}</h2>
        <SwitchRow label={t('settings.rememberRecent')} hint={t('settings.rememberRecentHint')} checked={s.rememberRecent} onChange={(rememberRecent) => void updateSettings({ rememberRecent })} />
        <div class="row row--between">
          <span class="muted small">{tn('settings.recentCount', recent.length)}</span>
          <Button
            icon="trash"
            variant="danger"
            disabled={!recent.length}
            onClick={() => {
              void clearRecent();
              toast(t('settings.activityCleared'));
            }}
          >
            {t('settings.clearActivity')}
          </Button>
        </div>
        <Notice tone="success" icon="lock">
          {t('settings.storageNote')}
        </Notice>
      </section>

      <section class="card card--pad row row--between">
        <div>
          <h3>{t('settings.welcomeAgain')}</h3>
          <p class="small muted">{t('settings.welcomeAgainHint')}</p>
        </div>
        <a class="btn" href="#/welcome">
          {t('settings.showWelcome')}
        </a>
      </section>
    </div>
  );
}
