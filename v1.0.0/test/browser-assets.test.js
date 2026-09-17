"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("browser screening asset loads before app.js and exposes its API", () => {
  const publicDir = path.resolve(__dirname, "../public");
  const index = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const screeningPosition = index.indexOf("/screening.js?v=2");
  const appPosition = index.indexOf("/app.js?v=5");
  assert.ok(screeningPosition >= 0 && screeningPosition < appPosition);
  assert.match(index, /id="settings-button"/);
  assert.match(index, /id="default-speed-button"/);
  assert.match(fs.readFileSync(path.join(publicDir, "app.js"), "utf8"), /Deep Research/);

  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, "screening.js"), "utf8"), context);
  assert.equal(typeof context.window.ClearFcfScreening?.evaluateCandidate, "function");
});
