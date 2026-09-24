"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("browser screening asset loads before app.js and exposes its API", () => {
  const publicDir = path.resolve(__dirname, "../public");
  const index = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const screeningPosition = index.indexOf("/screening.js?v=3");
  const appPosition = index.indexOf("/app.js?v=8");
  assert.ok(screeningPosition >= 0 && screeningPosition < appPosition);
  assert.match(index, /id="settings-button"/);
  assert.match(index, /id="default-speed-button"/);
  assert.match(index, /id="stop-button"/);
  assert.match(index, />Watchlist</);
  assert.match(index, /\$0 \(All\)/);
  assert.doesNotMatch(index, /id="max-examine"/);
  assert.doesNotMatch(index, /id="skip-seen"/);
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /Deep Research/);
  assert.match(app, /GPT-5\.6 Sol/);
  assert.match(app, /saveReportPdf/);
  assert.match(app, /Why this is not an Idea/);
  assert.match(app, /nonQualificationReason/);
  assert.match(app, /COLUMN_STORAGE_KEY/);
  assert.match(app, /aria-selected/);
  assert.doesNotMatch(app, /✕ Pass/);
  assert.doesNotMatch(app, /window\.print\(\)/);

  const preload = fs.readFileSync(path.resolve(__dirname, "../preload.js"), "utf8");
  assert.match(preload, /clearFcfDesktop/);
  assert.match(preload, /clearfcf:save-report-pdf/);

  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, "screening.js"), "utf8"), context);
  assert.equal(typeof context.window.ClearFcfScreening?.evaluateCandidate, "function");
});
