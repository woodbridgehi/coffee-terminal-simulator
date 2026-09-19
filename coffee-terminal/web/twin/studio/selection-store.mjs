export function createSelectionStore() {
  let current = null;
  const listeners = new Set();

  const same = (a, b) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

  function emit() {
    for (const listener of listeners) listener(current);
  }

  return {
    get() {
      return current;
    },

    select(ref, source = 'unknown') {
      const next = ref ? {kind: String(ref.kind), id: String(ref.id), source} : null;
      if (same(current, next)) return current;
      current = next;
      emit();
      return current;
    },

    clear(source = 'unknown') {
      return this.select(null, source);
    },

    reconcile(exists, source = 'reconcile') {
      if (current && !exists(current)) this.clear(source);
      return current;
    },

    subscribe(listener, {immediate = false} = {}) {
      listeners.add(listener);
      if (immediate) listener(current);
      return () => listeners.delete(listener);
    }
  };
}
