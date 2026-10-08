import { categoryHref, routeStore, toolHref } from '../../app/router';
import { useStore } from '../../core/store';
import { SIDEBAR, getTool, isToolAvailable, listedTools, toolsByCategory } from '../../registry/tools';
import { t, useI18n, type MessageKey } from '../../i18n';
import { BrandMark } from '../components/Brand';
import { Icon } from '../components/Icon';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const route = useStore(routeStore);
  const activeTool = route.name === 'tool' ? route.id : null;
  const activeCategory = route.name === 'category' ? route.id : null;
  const current = (href: string, active: boolean) => ({ href, 'aria-current': active ? ('page' as const) : undefined, onClick: onClose });

  return (
    <>
      {open ? <div class="sidebar-backdrop" onClick={onClose} aria-hidden="true" /> : null}
      <aside class={`sidebar${open ? ' sidebar--open' : ''}`} aria-label={t('nav.label')}>
        <a class="sidebar__brand" href="#/" onClick={onClose}>
          <BrandMark />
          <span>
            <span class="brand-name">Convertly</span>
            <span class="brand-tag">{t('brand.tagline')}</span>
          </span>
        </a>
        <nav class="sidebar__nav">
          <a class="nav-link" {...current('#/', route.name === 'home')}>
            <Icon name="home" />
            {t('nav.home')}
          </a>
          <a class="nav-link" {...current('#/tools', route.name === 'tools')} data-testid="nav-all-tools">
            <Icon name="list" />
            {t('nav.allTools')}
            <span class="nav-count">{listedTools().length}</span>
          </a>
          {SIDEBAR.map((section) => {
            const items = section.items.filter((i) => {
              const tool = getTool(i.toolId);
              return tool && isToolAvailable(tool);
            });
            if (!items.length) return null;
            return (
              <div class="nav-section" key={section.category}>
                <a class={`nav-section__title accent-${section.category}`} href={categoryHref(section.category)} onClick={onClose} aria-current={activeCategory === section.category ? 'page' : undefined}>
                  <span class="nav-dot" style={{ color: 'var(--accent)' }} />
                  <span style={{ color: 'var(--text-3)' }}>{t(`category.${section.category}` as MessageKey)}</span>
                  <span class="nav-count nav-count--section" title={t('nav.seeAll')}>{toolsByCategory(section.category).length}</span>
                </a>
                {items.map((item) => {
                  const tool = getTool(item.toolId)!;
                  return (
                    <a key={`${section.category}-${item.toolId}`} class="nav-link nav-link--sub" {...current(toolHref(item.toolId), activeTool === item.toolId)}>
                      <Icon name={tool.icon} />
                      {t(item.labelKey)}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div class="sidebar__footer">
          <a class="nav-link" {...current('#/settings', route.name === 'settings')}>
            <Icon name="settings" />
            {t('nav.settings')}
          </a>
          <a class="nav-link" {...current('#/about', route.name === 'about')}>
            <Icon name="info" />
            {t('nav.about')}
          </a>
          <a class="privacy-pill" href="#/privacy" onClick={onClose}>
            <Icon name="shield" />
            <span>{t('privacy.badge')}</span>
          </a>
        </div>
      </aside>
    </>
  );
}
