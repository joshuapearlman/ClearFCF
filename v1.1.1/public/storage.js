"use strict";

(function expose(factory) {
  const api = factory(typeof indexedDB === "undefined" ? null : indexedDB,
    typeof localStorage === "undefined" ? null : localStorage);
  if (typeof module !== "undefined" && module.exports) module.exports = factory;
  if (typeof window !== "undefined") window.ClearFcfStorage = api;
})(function createStorage(indexedDb, local) {
  let databasePromise;
  function database() {
    if (!indexedDb) return Promise.reject(new Error("IndexedDB is unavailable."));
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDb.open("clearfcf-workspace", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("records");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open local workspace."));
        request.onblocked = () => reject(new Error("Local workspace is blocked by another window."));
      });
    }
    return databasePromise;
  }

  async function transact(key, mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("records", mode);
      const request = operation(transaction.objectStore("records"), key);
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Workspace storage failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error("Workspace storage was interrupted."));
    });
  }

  async function get(key) {
    try {
      const value = await transact(key, "readonly", (store, id) => store.get(id));
      if (value !== undefined) return value;
    } catch {}
    if (!local) return null;
    const value = local.getItem(key);
    return value === null ? null : JSON.parse(value);
  }

  async function set(key, value) {
    try {
      await transact(key, "readwrite", (store, id) => store.put(value, id));
      try { local?.removeItem(key); } catch {}
      return "indexeddb";
    } catch (indexedDbError) {
      if (!local) throw indexedDbError;
      local.setItem(key, JSON.stringify(value));
      return "localstorage";
    }
  }

  async function remove(key) {
    let indexedError;
    try { await transact(key, "readwrite", (store, id) => store.delete(id)); }
    catch (error) { indexedError = error; }
    if (local) local.removeItem(key);
    else if (indexedError) throw indexedError;
  }

  return { get, set, remove };
});
