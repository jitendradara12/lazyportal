const RELOADED = "juet.chunk-reload";

/**
 * Wrap a dynamic import so a deployment that replaced this hashed chunk under a long-open tab
 * recovers by reloading once into the new shell, instead of surfacing a load error.
 */
export function lazyImport<T>(factory: () => Promise<T>, id: string): () => Promise<T> {
  return () => factory().then(
    (module) => {
      try { if (sessionStorage.getItem(RELOADED) === id) sessionStorage.removeItem(RELOADED); } catch {}
      return module;
    },
    (error) => {
      try {
        if (!sessionStorage.getItem(RELOADED)) {
          sessionStorage.setItem(RELOADED, id);
          location.reload();
          return new Promise<never>(() => {});
        }
      } catch {}
      throw error;
    },
  );
}
