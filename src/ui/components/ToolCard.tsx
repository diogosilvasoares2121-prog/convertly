import { toolHref } from '../../app/router';
import { useStore } from '../../core/store';
import { favoritesStore, toggleFavorite } from '../../storage/activity';
import { toolTitle } from '../../registry/search';
import type { ToolDef } from '../../registry/types';
import { t, useI18n } from '../../i18n';
import { Icon } from './Icon';

export function ToolIcon({ tool, size }: { tool: ToolDef; size?: 'sm' | 'lg' }) {
  return (
    <span class={`tool-icon accent-${tool.category}${size ? ` tool-icon--${size}` : ''}`}>
      <Icon name={tool.icon} />
    </span>
  );
}

export function toolDescription(tool: ToolDef): string {
  return t(tool.description.key, tool.description.params);
}

export function ToolCard({ tool, label }: { tool: ToolDef; label?: string }) {
  useI18n();
  const favorites = useStore(favoritesStore);
  const fav = favorites.includes(tool.id);
  const title = label ?? toolTitle(tool);
  return (
    <a class={`tool-card accent-${tool.category}`} href={toolHref(tool.id)} data-testid={`tool-card-${tool.id}`}>
      <ToolIcon tool={tool} />
      <div class="grow" style={{ paddingRight: '22px' }}>
        <div class="tool-card__title">{title}</div>
        <div class="tool-card__desc">{toolDescription(tool)}</div>
      </div>
      <button
        type="button"
        class={`icon-btn tool-card__fav${fav ? ' icon-btn--active' : ''}`}
        aria-pressed={fav}
        aria-label={fav ? t('fav.remove', { name: title }) : t('fav.add', { name: title })}
        title={fav ? t('fav.remove', { name: title }) : t('fav.add', { name: title })}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggleFavorite(tool.id);
        }}
      >
        <Icon name="star" />
      </button>
    </a>
  );
}
