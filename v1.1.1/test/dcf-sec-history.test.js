"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFinancials } = require("../lib/sec");
const { annualRows } = require("../lib/analysis");

test("historical instant facts use period-end year instead of the filing fiscal-year label", () => {
  const facts = {
    facts: {
      "us-gaap": {
        AssetsCurrent: {
          label: "Current assets",
          units: {
            USD: [
              { end: "2024-09-28", val: 100, form: "10-K", fy: 2025, filed: "2025-10-31" },
              { end: "2025-09-27", val: 120, form: "10-K", fy: 2025, filed: "2025-10-31" }
            ]
          }
        }
      }
    }
  };
  const series = extractFinancials(facts).series.currentAssets;
  assert.equal(series.values.get(2024).val, 100);
  assert.equal(series.values.get(2025).val, 120);
});

test("annual rows calculate operating NWC and its change from disclosed components", () => {
  const series = (values) => ({ values: new Map(Object.entries(values).map(([year, val]) => [Number(year), { val }])) });
  const rows = annualRows({
    series: {
      revenue: series({ 2025: 100, 2024: 90 }),
      accountsReceivable: series({ 2025: 20, 2024: 18 }),
      inventory: series({ 2025: 10, 2024: 9 }),
      prepaidExpenses: series({ 2025: 5, 2024: 4 }),
      accountsPayable: series({ 2025: 12, 2024: 11 }),
      accruedExpenses: series({ 2025: 8, 2024: 7 })
    }
  });
  assert.equal(rows[0].operatingCurrentAssets, 35);
  assert.equal(rows[0].operatingCurrentLiabilities, 20);
  assert.equal(rows[0].netWorkingCapital, 15);
  assert.equal(rows[1].netWorkingCapital, 13);
  assert.equal(rows[0].changeInNwc, 2);
  assert.equal(rows[1].changeInNwc, null);
});
