/** Topmost overlays handle Back before the page. Removing one never consumes another. */
export function createBackHandlers(onEnabledChange = () => {}) {
  const handlers = new Map();
  let sequence = 0;
  return {
    get enabled() { return handlers.size > 0; },
    add(callback, priority = 0) {
      const id = ++sequence;
      handlers.set(id, { callback, priority });
      onEnabledChange(handlers.size > 0);
      return () => {
        handlers.delete(id);
        onEnabledChange(handlers.size > 0);
      };
    },
    dispatch() {
      const next = [...handlers.entries()].sort(([a, left], [b, right]) => right.priority - left.priority || b - a)[0];
      if (!next) return false;
      next[1].callback();
      return true;
    },
  };
}
