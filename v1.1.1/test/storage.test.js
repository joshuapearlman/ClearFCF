"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createStorage = require("../public/storage");

test("workspace storage falls back to local storage and reports quota errors", async () => {
  const values = new Map();
  const local = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const storage = createStorage(null, local);
  assert.equal(await storage.set("scan", { pending: ["AAPL"] }), "localstorage");
  assert.deepEqual(await storage.get("scan"), { pending: ["AAPL"] });
  await storage.remove("scan");
  assert.equal(await storage.get("scan"), null);

  const failed = createStorage(null, { ...local, setItem: () => { throw new Error("Quota exceeded"); } });
  await assert.rejects(failed.set("scan", {}), /Quota exceeded/);
});

test("disabled storage rejects writes and corrupt legacy data is surfaced", async () => {
  const disabled = createStorage(null, null);
  await assert.rejects(disabled.set("scan", {}), /IndexedDB is unavailable/);
  await assert.rejects(disabled.remove("scan"), /IndexedDB is unavailable/);
  const corrupt = createStorage(null, { getItem: () => "{not-json", setItem: () => {}, removeItem: () => {} });
  await assert.rejects(corrupt.get("scan"), SyntaxError);
});
