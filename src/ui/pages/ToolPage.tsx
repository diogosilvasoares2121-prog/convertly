import { Component, type ComponentChildren, type ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { categoryHref } from '../../app/router';
import { useStore } from '../../core/store';
import { capabilitiesStore } from '../../core/capabilities';
import { favoritesStore, toggleFavorite } from '../../storage/activity';
import { getTool, isToolAvailable } from '../../registry/tools';
import { toolTitle } from '../../registry/search';
import type { ToolDef, ToolProps } from '../../registry/types';
import { TOOL_COMPONENTS } from '../../tools';
import { t, useI18n, type MessageKey } from '../../i18n';
import { Button, IconButton } from '../components/controls';
import { Badge, Notice, Spinner } from '../components/feedback';
import { Icon } from '../components/Icon';
import { ToolIcon, toolDescription } from '../components/ToolCard';
import { NotFound } from './NotFound';

class ToolErrorBoundary extends Component<{ children: ComponentChildren; toolId: string }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static override getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { toolId: string }) {
    if (prev.toolId !== this.props.toolId && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (this.state.error) {
      return (
        <Notice tone="danger" title={t('error.ui.title')}>
          <p>{t('error.ui.desc')}</p>
          <div style={{ marginTop: '10px' }}>
            <Button size="sm" icon="retry" onClick={() => this.setState({ error: null })}>
              {t('action.retry')}
            </Button>
          </div>
        </Notice>
      );
    }
    return this.props.children;
  }
}

function LazyTool({ tool }: { tool: ToolDef }) {
  const [Comp, setComp] = useState<ComponentType<ToolProps> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setComp(null);
    setFailed(false);
    TOOL_COMPONENTS[tool.component]()
      .then((c) => alive && setComp(() => c))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [tool.component]);
  if (failed) return <Notice tone="danger" title={t('error.ui.title')}>{t('error.load.desc')}</Notice>;
  if (!Comp) {
    return (
      <div class="row muted">
        <Spinner label={t('progress.loading')} />
        {t('progress.loading')}
      </div>
    );
  }
  return <Comp key={tool.id} tool={tool} />;
}

export function ToolPage({ id }: { id: string }) {
  useI18n();
  useStore(capabilitiesStore);
  const favorites = useStore(favoritesStore);
  const tool = getTool(id);
  useEffect(() => {
    if (tool) document.title = `${toolTitle(tool)} · Convertly`;
    return () => {
      document.title = 'Convertly';
    };
  }, [tool]);
  if (!tool) return <NotFound />;
  const available = isToolAvailable(tool);
  const fav = favorites.includes(tool.id);
  const title = toolTitle(tool);

  return (
    <div>
      <div class="tool-header">
        <ToolIcon tool={tool} size="lg" />
        <div class="tool-header__text">
          <nav class="breadcrumbs" aria-label={t('nav.breadcrumbs')}>
            <a href="#/">{t('nav.home')}</a>
            <Icon name="chevron-right" />
            <a href={categoryHref(tool.category)}>{t(`category.${tool.category}` as MessageKey)}</a>
          </nav>
          <div class="row" style={{ '--gap': '10px' }}>
            <h1>{title}</h1>
            <IconButton icon="star" active={fav} label={fav ? t('fav.remove', { name: title }) : t('fav.add', { name: title })} aria-pressed={fav} onClick={() => void toggleFavorite(tool.id)} />
          </div>
          <p class="tool-header__desc">{toolDescription(tool)}</p>
        </div>
        <Badge tone="brand" icon="lock">
          {t('privacy.short')}
        </Badge>
      </div>
      {available ? (
        <ToolErrorBoundary toolId={tool.id}>
          <LazyTool tool={tool} />
        </ToolErrorBoundary>
      ) : (
        <Notice tone="warning" title={t('tool.unavailable.title')}>
          {t('tool.unavailable.desc')}
        </Notice>
      )}
    </div>
  );
}
