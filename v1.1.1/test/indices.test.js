"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseIndexTable, validateIndexRows } = require("../lib/indices");

test("index constituent parser reads the named table and decodes company names", () => {
  const html = `
    <table id="unrelated"><tr><td>BAD</td><td>Wrong</td></tr></table>
    <table class="wikitable" id="constituents">
      <tr><th>Symbol</th><th>Security</th></tr>
      <tr><td><a>BRK.B</a></td><td>Berkshire &amp; Hathaway</td></tr>
      <tr><td>ACME</td><td>Acme&nbsp;Corp.</td></tr>
    </table>`;
  assert.deepEqual(parseIndexTable(html), [
    { ticker: "BRK.B", name: "Berkshire & Hathaway" },
    { ticker: "ACME", name: "Acme Corp." }
  ]);
});

test("index validation rejects silently truncated constituent lists", () => {
  const config = { title: "Test index", minCount: 2, maxCount: 3 };
  assert.equal(validateIndexRows([{ ticker: "A" }, { ticker: "B" }], config).length, 2);
  assert.throws(() => validateIndexRows([{ ticker: "A" }], config), /expected 2–3/);
});
