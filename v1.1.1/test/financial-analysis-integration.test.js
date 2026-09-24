"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("Financial Deep Analysis is served by the main ClearFCF application", () => {
  const mainIndex = read("public/index.html");
  const mainApp = read("public/app.js");
  const financialIndex = read("public/financial-analysis/index.html");
  const server = read("server.js");
  const desktopServer = read("desktop-server.js");
  const electronMain = read("electron-main.js");
  const packageJson = JSON.parse(read("package.json"));
  const vercel = JSON.parse(read("vercel.json"));
  const financialApp = read("public/financial-analysis/app.js");

  assert.match(mainIndex, /id="deep-analysis-modal"/);
  assert.match(mainIndex, /href="\/financial-analysis"/);
  assert.doesNotMatch(mainIndex, /id="choose-financial-analysis"[^>]+target="_blank"/);
  assert.match(mainApp, /\/financial-analysis\?ticker=/);
  assert.doesNotMatch(mainApp, /:3001\/\?ticker=/);

  assert.match(financialIndex, /\/financial-analysis\/styles\.css/);
  assert.match(financialIndex, /\/financial-analysis\/engine\.js/);
  assert.match(financialIndex, /\/financial-analysis\/app\.js/);
  assert.match(financialIndex, /id="driver-history-table"/);
  assert.match(financialApp, /dnaMarginMethod/);
  assert.match(financialApp, /capexMarginMethod/);
  assert.match(financialApp, /nwcMethod/);
  assert.match(financialApp, /apply-ratio-method/);
  assert.match(financialApp, /percentagePointChange/);
  const collapsibleSections = [...financialIndex.matchAll(/data-collapse-id="([^"]+)" data-collapse-targets="([^"]+)"/g)];
  assert.equal(collapsibleSections.length, 14);
  for (const [, id, selectors] of collapsibleSections) {
    assert.ok(id.length > 0);
    for (const selector of selectors.split(",")) assert.match(financialIndex, new RegExp(`id="${selector.trim().replace(/^#/, "")}"`));
  }
  assert.match(financialIndex, /id="collapse-all"/);
  assert.match(financialIndex, /id="expand-all"/);
  assert.match(financialApp, /target\.hidden = collapsed/);
  assert.match(financialApp, /COLLAPSE_STORAGE_KEY/);
  assert.match(financialApp, /initializeCollapsibleSections\(\)/);
  assert.match(financialIndex, /href="\/"/);
  assert.match(financialApp, /syncVisibleDriverInputs\(model\)/);
  assert.match(financialApp, /save\(\);\s*showMessage\(`Updated the \$\{CASE_LABELS\[state\.activeCase\]\} assumption/);
  assert.doesNotMatch(financialApp, /save\(\);\s*renderAll\(\);\s*showMessage\(`Updated the \$\{CASE_LABELS\[state\.activeCase\]\} assumption/);

  for (const source of [server, desktopServer]) {
    assert.match(source, /"\/financial-analysis": "index\.html"/);
    assert.match(source, /"\/financial-analysis\/app\.js": "app\.js"/);
    assert.match(source, /"\/financial-analysis\/engine\.js": "engine\.js"/);
  }
  assert.ok(packageJson.build.files.includes("public/**/*"));
  assert.match(electronMain, /parsed\.pathname === "\/financial-analysis"/);
  assert.match(electronMain, /action: "allow"/);

  const rewrites = new Map(vercel.rewrites.map(({ source, destination }) => [source, destination]));
  assert.equal(rewrites.get("/financial-analysis"), "/public/financial-analysis/index.html");
  assert.equal(rewrites.get("/financial-analysis/"), "/public/financial-analysis/index.html");
  assert.equal(rewrites.get("/financial-analysis/app.js"), "/public/financial-analysis/app.js");
  assert.equal(rewrites.get("/financial-analysis/engine.js"), "/public/financial-analysis/engine.js");
  assert.equal(rewrites.get("/financial-analysis/styles.css"), "/public/financial-analysis/styles.css");
});
