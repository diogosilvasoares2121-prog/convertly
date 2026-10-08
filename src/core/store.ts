import { useEffect, useReducer, useRef } from 'preact/hooks';

/** Minimal observable store. Keeps UI state predictable without a framework dependency. */
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribes a component to a store (optionally to a derived slice). */
export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S;
export function useStore<T, S>(store: Store<T>, selector?: (state: T) => S): T | S {
  const select = (selector ?? ((s: T) => s as unknown as S)) as (state: T) => S;
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selectedRef = useRef<S>(select(store.get()));
  const selectRef = useRef(select);
  selectRef.current = select;
  selectedRef.current = select(store.get());

  useEffect(() => {
    const check = () => {
      const next = selectRef.current(store.get());
      if (!Object.is(next, selectedRef.current)) {
        selectedRef.current = next;
        force(0);
      }
    };
    const unsubscribe = store.subscribe(check);
    check();
    return unsubscribe;
  }, [store]);

  return selectedRef.current;
}
