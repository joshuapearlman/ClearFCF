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
  const financialIndex = read("dcf-public/index.html");
  const server = read("server.js");
  const desktopServer = read("desktop-server.js");
  const electronMain = read("electron-main.js");
  const packageJson = JSON.parse(read("package.json"));

  assert.match(mainIndex, /id="deep-analysis-modal"/);
  assert.match(mainIndex, /href="\/financial-analysis"/);
  assert.match(mainIndex, /id="choose-financial-analysis"[^>]+target="_blank"/);
  assert.match(mainApp, /\/financial-analysis\?ticker=/);
  assert.doesNotMatch(mainApp, /:3001\/\?ticker=/);

  assert.match(financialIndex, /\/financial-analysis\/styles\.css/);
  assert.match(financialIndex, /\/financial-analysis\/engine\.js/);
  assert.match(financialIndex, /\/financial-analysis\/app\.js/);
  assert.match(financialIndex, /href="\/"/);

  for (const source of [server, desktopServer]) {
    assert.match(source, /"\/financial-analysis": "index\.html"/);
    assert.match(source, /"\/financial-analysis\/app\.js": "app\.js"/);
    assert.match(source, /"\/financial-analysis\/engine\.js": "engine\.js"/);
  }
  assert.ok(packageJson.build.files.includes("dcf-public/**/*"));
  assert.match(electronMain, /parsed\.pathname === "\/financial-analysis"/);
  assert.match(electronMain, /action: "allow"/);
});
