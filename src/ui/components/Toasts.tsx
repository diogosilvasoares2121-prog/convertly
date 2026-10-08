import { createStore, useStore } from '../../core/store';
import { uid } from '../../utils/id';
import { Icon, type AnyIcon } from './Icon';

interface Toast {
  id: string;
  message: string;
  icon: AnyIcon;
}

const toastStore = createStore<Toast[]>([]);

export function toast(message: string, icon: AnyIcon = 'success'): void {
  const id = uid('toast');
  toastStore.set((list) => [...list.slice(-2), { id, message, icon }]);
  setTimeout(() => toastStore.set((list) => list.filter((t) => t.id !== id)), 2800);
}

export function Toasts() {
  const toasts = useStore(toastStore);
  return (
    <div class="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} class="toast" role="status">
          <Icon name={t.icon} />
          {t.message}
        </div>
      ))}
    </div>
  );
}
