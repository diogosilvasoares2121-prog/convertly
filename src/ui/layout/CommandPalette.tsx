import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { navigate, toolHref } from '../../app/router';
import { useStore } from '../../core/store';
import { recentStore, favoritesStore } from '../../storage/activity';
import { searchTools, toolTitle, type SearchResult } from '../../registry/search';
import { getTool, isToolAvailable, popularTools } from '../../registry/tools';
import { t, useI18n, type MessageKey } from '../../i18n';
import { Modal } from '../components/Modal';
import { Icon, type AnyIcon } from '../components/Icon';
import { ToolIcon, toolDescription } from '../components/ToolCard';

interface Item {
  id: string;
  label: string;
  desc: string;
  href: string;
  group: string;
  result?: SearchResult;
  icon?: AnyIcon;
}

const PAGES: Array<{ id: string; key: MessageKey; href: string; icon: AnyIcon; words: string }> = [
  { id: 'page-settings', key: 'nav.settings', href: '#/settings', icon: 'settings', words: 'settings preferences theme dark light language definicoes tema idioma' },
  { id: 'page-privacy', key: 'nav.privacy', href: '#/privacy', icon: 'shield', words: 'privacy privacidade data offline' },
  { id: 'page-about', key: 'nav.about', href: '#/about', icon: 'info', words: 'about sobre licenses licencas version versao' },
  { id: 'page-home', key: 'nav.home', href: '#/', icon: 'home', words: 'home inicio start' },
];

/** Ctrl/Cmd+K command palette with full keyboard navigation. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const recent = useStore(recentStore);
  const favorites = useStore(favoritesStore);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    if (!q) {
      const seen = new Set<string>();
      const list: Item[] = [];
      const add = (id: string, group: string) => {
        const tool = getTool(id);
        if (!tool || !isToolAvailable(tool) || seen.has(id)) return;
        seen.add(id);
        list.push({ id, label: toolTitle(tool), desc: toolDescription(tool), href: toolHref(id), group });
      };
      favorites.forEach((id) => add(id, t('home.favorites')));
      recent.forEach((r) => add(r.toolId, t('home.recent')));
      popularTools().forEach((tool) => add(tool.id, t('home.popular')));
      return list.slice(0, 14);
    }
    const tools: Item[] = searchTools(q, 40).map((r) => ({ id: r.tool.id, label: r.label, desc: toolDescription(r.tool), href: toolHref(r.tool.id), group: t('search.tools'), result: r }));
    const lower = q.toLowerCase();
    const pages: Item[] = PAGES.filter((p) => t(p.key).toLowerCase().includes(lower) || p.words.includes(lower)).map((p) => ({ id: p.id, label: t(p.key), desc: '', href: p.href, group: t('search.pages'), icon: p.icon }));
    return [...tools, ...pages];
  }, [query, recent, favorites]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.href);
  };

  let lastGroup = '';
  return (
    <Modal open={open} onClose={onClose} class="palette" labelledBy="palette-label">
      <div class="palette__input">
        <Icon name="search" />
        <label id="palette-label" class="sr-only" for="palette-input">
          {t('search.placeholder')}
        </label>
        <input
          id="palette-input"
          autoFocus
          autoComplete="off"
          spellcheck={false}
          placeholder={t('search.palettePlaceholder')}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[index] ? `palette-item-${index}` : undefined}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(items[index]);
            }
          }}
          data-testid="palette-input"
        />
      </div>
      <div class="palette__list" id="palette-list" role="listbox" ref={listRef}>
        {items.length ? (
          items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const tool = getTool(item.id);
            return (
              <div key={item.id + item.label}>
                {header ? <div class="palette__group">{header}</div> : null}
                <a
                  id={`palette-item-${i}`}
                  data-index={i}
                  class="result-item"
                  role="option"
                  aria-selected={i === index}
                  href={item.href}
                  onMouseMove={() => setIndex(i)}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item);
                  }}
                >
                  {tool ? <ToolIcon tool={tool} size="sm" /> : <span class="tool-icon tool-icon--sm"><Icon name={item.icon ?? 'info'} /></span>}
                  <span class="grow">
                    <span class="result-item__title">{item.label}</span>
                    {item.desc ? <span class="result-item__desc truncate" style={{ display: 'block' }}>{item.desc}</span> : null}
                  </span>
                  {tool ? <span class="result-item__cat">{t(`category.${tool.category}` as MessageKey)}</span> : null}
                </a>
              </div>
            );
          })
        ) : (
          <div class="palette__empty">{t('search.noResults', { query })}</div>
        )}
      </div>
      <div class="palette__footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t('search.navigate')}
        </span>
        <span>
          <kbd>Enter</kbd> {t('search.open')}
        </span>
        <span>
          <kbd>Esc</kbd> {t('search.close')}
        </span>
      </div>
    </Modal>
  );
}
