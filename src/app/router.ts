import { createStore } from '../core/store';
import { CATEGORIES, type Category } from '../registry/formats';

/** Hash-based routing (works for extension pages without any server). */
export type Route =
  | { name: 'home' }
  | { name: 'tool'; id: string }
  | { name: 'category'; id: Category }
  | { name: 'tools' }
  | { name: 'detect' }
  | { name: 'settings' }
  | { name: 'about' }
  | { name: 'privacy' }
  | { name: 'welcome' }
  | { name: 'not-found' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [head, arg] = path.split('/');
  switch (head) {
    case '':
      return { name: 'home' };
    case 'tool':
      return arg ? { name: 'tool', id: decodeURIComponent(arg) } : { name: 'not-found' };
    case 'category':
      return arg && (CATEGORIES as readonly string[]).includes(arg) ? { name: 'category', id: arg as Category } : { name: 'not-found' };
    case 'detect':
      return { name: 'detect' };
    case 'tools':
      return { name: 'tools' };
    case 'settings':
      return { name: 'settings' };
    case 'about':
      return { name: 'about' };
    case 'privacy':
      return { name: 'privacy' };
    case 'welcome':
      return { name: 'welcome' };
    default:
      return { name: 'not-found' };
  }
}

export const routeStore = createStore<Route>(parseRoute(typeof location !== 'undefined' ? location.hash : ''));

export function startRouter(): void {
  window.addEventListener('hashchange', () => {
    routeStore.set(parseRoute(location.hash));
    window.scrollTo({ top: 0 });
  });
}

export function navigate(path: string): void {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === hash) routeStore.set(parseRoute(hash));
  else location.hash = hash;
}

export const toolHref = (id: string) => `#/tool/${encodeURIComponent(id)}`;
export const categoryHref = (id: Category) => `#/category/${id}`;
