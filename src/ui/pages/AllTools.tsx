import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { CATEGORIES } from '../../registry/formats';
import { listedTools, toolsByCategory } from '../../registry/tools';
import { searchTools } from '../../registry/search';
import { categoryHref } from '../../app/router';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { Icon } from '../components/Icon';
import { ToolCard } from '../components/ToolCard';
import { CATEGORY_ICON } from './Home';
import { ToolSections } from './CategoryPage';

/** Every tool, by category and section, with an instant filter. */
export function AllToolsPage() {
  useI18n();
  useStore(capabilitiesStore);
  const [query, setQuery] = useState('');
  const total = listedTools().length;
  const results = useMemo(() => (query.trim() ? searchTools(query, 60) : null), [query]);

  return (
    <div>
      <div class="tool-header">
        <span class="tool-icon tool-icon--lg accent-brand">
          <Icon name="list" />
        </span>
        <div class="tool-header__text">
          <nav class="breadcrumbs" aria-label={t('nav.breadcrumbs')}>
            <a href="#/">{t('nav.home')}</a>
          </nav>
          <h1>{t('allTools.title')}</h1>
          <p class="tool-header__desc">{t('allTools.desc', { count: total })}</p>
        </div>
      </div>
      <div class="filter-bar">
        <Icon name="search" />
        <input type="search" value={query} placeholder={t('allTools.filter')} aria-label={t('allTools.filter')} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} data-testid="tools-filter" />
      </div>
      <nav class="jump-links" aria-label={t('allTools.jump')}>
        {CATEGORIES.map((c) => (
          <a key={c} class={`chip accent-${c}`} href={categoryHref(c)}>
            <Icon name={CATEGORY_ICON[c]} />
            {t(`category.${c}` as MessageKey)}
            <span class="chip__count">{toolsByCategory(c).length}</span>
          </a>
        ))}
      </nav>
      {results ? (
        results.length ? (
          <div class="tool-grid" style={{ marginTop: '16px' }} data-testid="tools-results">
            {results.map((r) => (
              <ToolCard key={r.tool.id + r.label} tool={r.tool} label={r.label} />
            ))}
          </div>
        ) : (
          <div class="card empty" style={{ marginTop: '16px' }}>
            <Icon name="search" />
            <div>{t('search.noResults', { query })}</div>
          </div>
        )
      ) : (
        CATEGORIES.map((c) => {
          const tools = toolsByCategory(c);
          if (!tools.length) return null;
          return (
            <section key={c} class="category-block" aria-labelledby={`all-${c}`} data-testid={`all-${c}`}>
              <div class="category-block__head">
                <span class={`tool-icon accent-${c}`}>
                  <Icon name={CATEGORY_ICON[c]} />
                </span>
                <h2 id={`all-${c}`}>
                  <a href={categoryHref(c)}>{t(`category.${c}.title` as MessageKey)}</a>
                </h2>
                <span class="muted small">{tn('home.toolCount', tools.length)}</span>
              </div>
              <ToolSections tools={tools} category={c} />
            </section>
          );
        })
      )}
    </div>
  );
}
