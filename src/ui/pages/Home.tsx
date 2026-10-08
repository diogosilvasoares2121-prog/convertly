import { useMemo, useState } from 'preact/hooks';
import { analyzeFiles } from '../../app/handoff';
import { categoryHref, navigate, toolHref } from '../../app/router';
import { useStore } from '../../core/store';
import { favoritesStore, recentStore } from '../../storage/activity';
import { settingsStore } from '../../storage/settings';
import { CATEGORIES, type Category } from '../../registry/formats';
import { searchTools } from '../../registry/search';
import { getTool, isToolAvailable, listedTools, popularTools, toolsByCategory } from '../../registry/tools';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { Dropzone } from '../components/Dropzone';
import { Icon, type AnyIcon } from '../components/Icon';
import { ToolCard, ToolIcon, toolDescription } from '../components/ToolCard';
import { capabilitiesStore } from '../../core/capabilities';

export const CATEGORY_ICON: Record<Category, AnyIcon> = {
  image: 'image',
  pdf: 'pdf',
  video: 'video',
  audio: 'audio',
  archive: 'archive',
  data: 'json',
};

function HomeSearch() {
  useI18n();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = useMemo(() => (query.trim() ? searchTools(query, 8) : []), [query]);
  return (
    <div class="hero__search">
      <Icon name="search" />
      <input
        type="search"
        placeholder={t('home.searchPlaceholder')}
        aria-label={t('home.searchPlaceholder')}
        value={query}
        autoComplete="off"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="home-search-results"
        onInput={(e) => {
          setQuery((e.currentTarget as HTMLInputElement).value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter' && results[index]) {
            navigate(toolHref(results[index].tool.id));
          } else if (e.key === 'Escape') {
            setQuery('');
          }
        }}
        data-testid="home-search"
      />
      {results.length ? (
        <div class="search-results" id="home-search-results" role="listbox">
          {results.map((r, i) => (
            <a key={r.tool.id + r.label} class="result-item" role="option" aria-selected={i === index} href={toolHref(r.tool.id)} onMouseMove={() => setIndex(i)}>
              <ToolIcon tool={r.tool} size="sm" />
              <span class="grow">
                <span class="result-item__title">{r.label}</span>
                <span class="result-item__desc truncate" style={{ display: 'block' }}>
                  {toolDescription(r.tool)}
                </span>
              </span>
              <span class="result-item__cat">{t(`category.${r.tool.category}` as MessageKey)}</span>
            </a>
          ))}
        </div>
      ) : query.trim() ? (
        <div class="search-results">
          <div class="palette__empty">{t('search.noResults', { query })}</div>
        </div>
      ) : null}
    </div>
  );
}

export function Home() {
  useI18n();
  useStore(capabilitiesStore);
  const favorites = useStore(favoritesStore);
  const recent = useStore(recentStore);
  const settings = useStore(settingsStore);
  const favTools = favorites.map(getTool).filter((x) => x && isToolAvailable(x));
  const recentTools = settings.rememberRecent ? recent.map((r) => getTool(r.toolId)).filter((x) => x && isToolAvailable(x)).slice(0, 6) : [];

  return (
    <div>
      <section class="hero">
        <span class="hero__eyebrow">
          <Icon name="shield" />
          {t('privacy.badge')}
        </span>
        <h1>{t('home.title')}</h1>
        <p class="hero__subtitle">{t('home.subtitle')}</p>
        <HomeSearch />
      </section>

      <section class="section">
        <Dropzone onFiles={(files) => analyzeFiles(files, 'picker')} title={t('home.dropTitle')} formatsHint={t('home.dropHint')} testId="home-dropzone" />
      </section>

      <section class="section" aria-labelledby="quick-tools">
        <div class="section__head">
          <h2 id="quick-tools" class="section__title">
            {t('home.quickTools')}
          </h2>
          <a class="section__link" href="#/tools" data-testid="browse-all">
            {t('home.browseAll', { count: listedTools().length })}
            <Icon name="arrow-right" size={14} />
          </a>
        </div>
        <div class="category-grid">
          {CATEGORIES.map((c) => {
            const count = toolsByCategory(c).length;
            if (!count) return null;
            return (
              <a key={c} class={`category-tile accent-${c}`} href={categoryHref(c)} data-testid={`category-${c}`}>
                <span class="tool-icon">
                  <Icon name={CATEGORY_ICON[c]} />
                </span>
                <span>
                  <span class="category-tile__label">{t(`category.${c}` as MessageKey)}</span>
                  <span class="category-tile__count" style={{ display: 'block' }}>
                    {tn('home.toolCount', count)}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </section>

      {favTools.length ? (
        <section class="section" aria-labelledby="favorites">
          <div class="section__head">
            <h2 id="favorites" class="section__title">
              {t('home.favorites')}
            </h2>
          </div>
          <div class="tool-grid">
            {favTools.map((tool) => (
              <ToolCard key={tool!.id} tool={tool!} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="section" aria-labelledby="popular">
        <div class="section__head">
          <h2 id="popular" class="section__title">
            {t('home.popular')}
          </h2>
        </div>
        <div class="tool-grid">
          {popularTools().map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </section>

      <section class="section" aria-labelledby="recent">
        <div class="section__head">
          <h2 id="recent" class="section__title">
            {t('home.recent')}
          </h2>
          {settings.rememberRecent ? null : (
            <a class="small" href="#/settings">
              {t('home.recentOff')}
            </a>
          )}
        </div>
        {recentTools.length ? (
          <div class="tool-grid">
            {recentTools.map((tool) => (
              <ToolCard key={tool!.id} tool={tool!} />
            ))}
          </div>
        ) : (
          <div class="card empty">
            <Icon name="clock" />
            <div>{settings.rememberRecent ? t('home.recentEmpty') : t('home.recentDisabled')}</div>
          </div>
        )}
      </section>
    </div>
  );
}
