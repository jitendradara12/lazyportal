// Runs before the live bootstrap and every official script. This origin is
// disposable: tokens and any subsequent portal writes must never reach disk.
(() => {
  "use strict";
  const memoryStorage = () => {
    const values = new Map();
    const methods = {
      getItem: (key) => values.get(String(key)) ?? null,
      setItem: (key, value) => { values.set(String(key), String(value)); },
      removeItem: (key) => { values.delete(String(key)); },
      clear: () => values.clear(),
      key: (index) => [...values.keys()][Number(index) >>> 0] ?? null,
    };
    // Named properties, enumeration and methods match Storage without changing
    // Storage.prototype (which official libraries and Zone.js may also use).
    return new Proxy(Object.create(Storage.prototype), {
      get: (_, key) => key === "length" ? values.size :
        Object.prototype.hasOwnProperty.call(methods, key) ? methods[key] : values.get(key),
      set: (_, key, value) => { values.set(String(key), String(value)); return true; },
      deleteProperty: (_, key) => { values.delete(key); return true; },
      has: (_, key) => key === "length" || Object.prototype.hasOwnProperty.call(methods, key) || values.has(key),
      ownKeys: () => [...values.keys()],
      getOwnPropertyDescriptor: (_, key) => values.has(key) ?
        { value: values.get(key), writable: true, enumerable: true, configurable: true } : undefined,
      defineProperty: (_, key, descriptor) => {
        if (!("value" in descriptor) || descriptor.configurable === false) return false;
        values.set(String(key), String(descriptor.value)); return true;
      },
    });
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    // Remove leftovers from old APKs before replacing the real storage getter.
    window[name].clear();
    Object.defineProperty(window, name, { value: memoryStorage(), configurable: false, writable: false });
  }
})();
