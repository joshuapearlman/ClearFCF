"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../public/workspace-model");

test("watchlists preserve notes and track changes across runs", () => {
  const { workspace, id } = model.addWatchlist(null, "Value candidates", ["aapl", "MSFT"]);
  const list = workspace.watchlists.find((item) => item.id === id);
  list.entries[0].thesis = "Cash conversion";
  list.entries[0].risk = "Demand decline";
  model.recordRun(list, [{ ticker: "AAPL", price: 100, priceToNfcf: 12, status: "Idea", financialPeriodEnd: "2025-12-31" }], {}, []);
  model.recordRun(list, [{ ticker: "AAPL", price: 110, priceToNfcf: 13, status: "Review", financialPeriodEnd: "2026-03-31" }], {}, []);
  const restored = model.normalize(JSON.parse(JSON.stringify(workspace))).watchlists[0];
  assert.equal(restored.entries[0].thesis, "Cash conversion");
  assert.equal(restored.entries[0].risk, "Demand decline");
  const change = model.changeFor(restored, "AAPL");
  assert.ok(Math.abs(change.pricePercent - 0.1) < 1e-10);
  assert.equal(change.multipleChange, 1);
  assert.equal(change.status, "Idea → Review");
  assert.equal(change.financialPeriodChanged, true);
});

test("legacy backup migrates and merge preserves current lists", () => {
  const legacy = model.validateBackup({ format: "clearfcf-workspace", version: 0, watchlists: [{ id: "old", name: "Old", tickers: ["MSFT"] }] });
  assert.equal(legacy.workspace.watchlists[0].entries[0].ticker, "MSFT");
  const current = model.addWatchlist(null, "Current", ["AAPL"]).workspace;
  const combined = model.merge(current, legacy.workspace);
  assert.deepEqual(combined.watchlists.map((list) => list.name), ["Current", "Old"]);
});

test("invalid and oversized backup content is rejected", () => {
  assert.throws(() => model.validateBackup({ format: "clearfcf-workspace", version: 7 }), /Unsupported/);
  assert.throws(() => model.validateBackup({ format: "clearfcf-workspace", version: 1, workspace: { version: 1, watchlists: [] }, scan: { symbols: ["BAD TICKER"] } }), /scan is invalid/);
  assert.throws(() => model.normalize({ version: 1, watchlists: [{ id: "x", name: "X", entries: [{ ticker: "AAPL" }, { ticker: "AAPL" }] }] }), /duplicated/);
});

test("rescreen alerts fire on a threshold crossing and can be turned off", () => {
  const { workspace } = model.addWatchlist(null, "Alerts", ["AAPL"]);
  const list = workspace.watchlists[0];
  list.entries[0].alert = { type: "price-below", threshold: 100 };
  model.recordRun(list, [{ ticker: "AAPL", price: 110 }], {}, []);
  assert.equal(list.lastRun.alerts.length, 0);
  model.recordRun(list, [{ ticker: "AAPL", price: 95 }], {}, []);
  assert.match(list.lastRun.alerts[0].reason, /fell below 100/);
  model.recordRun(list, [{ ticker: "AAPL", price: 90 }], {}, []);
  assert.equal(list.lastRun.alerts.length, 0);
  list.entries[0].alert.type = "none";
  model.recordRun(list, [{ ticker: "AAPL", price: 105 }], {}, []);
  model.recordRun(list, [{ ticker: "AAPL", price: 94 }], {}, []);
  assert.equal(list.lastRun.alerts.length, 0);
});

test("versioned workspace backup retains scan, research, DCF cases, and defaults", () => {
  const workspace = model.addWatchlist(null, "Investigation", ["AAPL"]).workspace;
  workspace.watchlists[0].entries[0].alert = { type: "new-period", threshold: null };
  const source = { format: "clearfcf-workspace", version: 1, workspace,
    scan: { symbols: ["AAPL"], pending: [], allExamined: [{ ticker: "AAPL" }] },
    researchReports: { AAPL: { verdict: "Review" } },
    dcfModels: { "clearfcf-financial-analysis-v2:AAPL": { cases: { base: { wacc: 0.1 } } } },
    dcfDefaults: { riskFreeRate: 0.04, assumptionDates: { riskFreeRate: "2026-11-20" } } };
  const restored = model.validateBackup(JSON.parse(JSON.stringify(source)));
  assert.equal(restored.workspace.watchlists[0].entries[0].alert.type, "new-period");
  assert.equal(restored.scan.allExamined[0].ticker, "AAPL");
  assert.equal(restored.researchReports.AAPL.verdict, "Review");
  assert.equal(restored.dcfModels["clearfcf-financial-analysis-v2:AAPL"].cases.base.wacc, 0.1);
  assert.equal(restored.dcfDefaults.assumptionDates.riskFreeRate, "2026-11-20");
});
