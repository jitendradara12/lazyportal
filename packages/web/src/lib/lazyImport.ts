const RELOADED = "juet.chunk-reload";

/**
 * Wrap a dynamic import so a deployment that replaced this hashed chunk under a long-open tab
 * recovers by reloading once into the new shell, instead of surfacing a load error.
 */
export function lazyImport<T>(factory: () => Promise<T>): () => Promise<T> {
  return () => factory().then(
    (module) => {
      try { sessionStorage.removeItem(RELOADED); } catch {}
      return module;
    },
    (error) => {
      try {
        if (!sessionStorage.getItem(RELOADED)) {
          sessionStorage.setItem(RELOADED, "1");
          location.reload();
          return new Promise<never>(() => {});
        }
      } catch {}
      throw error;
    },
  );
}
