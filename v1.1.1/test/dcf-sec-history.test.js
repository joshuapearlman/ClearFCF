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

test("latest balance-sheet facts prefer the newest period across fallback tags", () => {
  const facts = { facts: { "us-gaap": {
    CashCashEquivalentsAndShortTermInvestments: {
      label: "Cash and short-term investments",
      units: { USD: [{ end: "2022-12-31", val: 20, form: "10-K", filed: "2023-02-01" }] }
    },
    CashAndCashEquivalentsAtCarryingValue: {
      label: "Cash",
      units: { USD: [{ end: "2025-12-31", val: 50, form: "10-K", filed: "2026-02-01" }] }
    }
  } } };
  const latest = extractFinancials(facts).latest.cash;
  assert.equal(latest.val, 50);
  assert.equal(latest.end, "2025-12-31");
  assert.equal(latest.tag, "CashAndCashEquivalentsAtCarryingValue");
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

test("combined accounts-payable and accrued-liability facts are not double-counted", () => {
  const series = (tag, val) => ({ tag, values: new Map([[2025, { tag, val }]]) });
  const rows = annualRows({
    series: {
      revenue: series("Revenue", 100),
      accountsReceivable: series("AccountsReceivableNetCurrent", 20),
      inventory: series("InventoryNet", 10),
      prepaidExpenses: series("PrepaidExpenseCurrent", 5),
      accountsPayable: series("AccountsPayableAndOtherAccruedLiabilitiesCurrent", 30),
      accruedExpenses: series("AccruedLiabilitiesCurrent", 8)
    }
  });
  assert.equal(rows[0].accountsPayable, 30);
  assert.equal(rows[0].accruedExpenses, null);
  assert.equal(rows[0].operatingCurrentLiabilities, 30);
  assert.equal(rows[0].netWorkingCapital, 5);
});
