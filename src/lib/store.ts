import { useSyncExternalStore } from 'react';

/**
 * Minimal external store: the realtime engine writes low-frequency UI state
 * here, React subscribes with selectors. Setting an unchanged value is a no-op,
 * so a 30 Hz writer does not cause 30 Hz renders.
 */
export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set = (patch: Partial<T>): void => {
    let changed = false;
    for (const key in patch) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

/** Subscribe to a slice. The selector must return a primitive or a stable reference. */
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
