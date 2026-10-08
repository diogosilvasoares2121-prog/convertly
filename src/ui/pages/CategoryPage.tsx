import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import type { Category } from '../../registry/formats';
import { availableTools, toolsByCategory } from '../../registry/tools';
import { toolTitle } from '../../registry/search';
import type { ToolDef, ToolGroup } from '../../registry/types';
import { toolHref } from '../../app/router';
import { t, tn, useI18n, type MessageKey } from '../../i18n';
import { Icon } from '../components/Icon';
import { ToolCard } from '../components/ToolCard';
import { CATEGORY_ICON } from './Home';

/** Display order of the sections on category pages. */
export const GROUP_ORDER: ToolGroup[] = ['convert', 'optimize', 'edit', 'organize', 'create', 'extract', 'format', 'security'];

export function groupTools(tools: ToolDef[]): Array<{ group: ToolGroup; tools: ToolDef[] }> {
  return GROUP_ORDER.map((group) => ({ group, tools: tools.filter((tool) => (tool.group ?? 'convert') === group) })).filter((g) => g.tools.length);
}

export function ToolSections({ tools, category }: { tools: ToolDef[]; category: Category }) {
  useI18n();
  return (
    <>
      {groupTools(tools).map(({ group, tools: list }) => (
        <section class="tool-section" key={group} aria-labelledby={`sec-${category}-${group}`}>
          <h3 class="tool-section__title" id={`sec-${category}-${group}`}>
            {t(`group.${group}` as MessageKey)}
          </h3>
          <div class="tool-grid">
            {list.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function CategoryPage({ id }: { id: Category }) {
  useI18n();
  useStore(capabilitiesStore);
  const tools = toolsByCategory(id);
  const pairs = availableTools().filter((tool) => tool.pair && tool.category === id);
  return (
    <div>
      <div class="tool-header">
        <span class={`tool-icon tool-icon--lg accent-${id}`}>
          <Icon name={CATEGORY_ICON[id]} />
        </span>
        <div class="tool-header__text">
          <nav class="breadcrumbs" aria-label={t('nav.breadcrumbs')}>
            <a href="#/">{t('nav.home')}</a>
            <Icon name="chevron-right" size={12} />
            <a href="#/tools">{t('nav.allTools')}</a>
          </nav>
          <h1>{t(`category.${id}.title` as MessageKey)}</h1>
          <p class="tool-header__desc">
            {t(`category.${id}.desc` as MessageKey)} <span class="muted">· {tn('home.toolCount', tools.length)}</span>
          </p>
        </div>
      </div>
      <ToolSections tools={tools} category={id} />
      {pairs.length ? (
        <section class="tool-section">
          <h3 class="tool-section__title">{t('category.conversions')}</h3>
          <div class="chips">
            {pairs.map((tool) => (
              <a key={tool.id} class="chip chip--format" href={toolHref(tool.id)}>
                {toolTitle(tool)}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
