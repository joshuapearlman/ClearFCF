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

test("annual rows display issuer fiscal years while retaining period-end alignment", () => {
  const annual = (start, end, val, fy, filed) => ({ start, end, val, fy, filed, form: "10-K", fp: "FY" });
  const facts = { facts: { "us-gaap": {
    Revenues: {
      label: "Revenue",
      units: { USD: [
        annual("2024-01-29", "2025-02-02", 10_588_126, 2024, "2025-03-20"),
        annual("2024-01-29", "2025-02-02", 10_588_126, 2025, "2026-03-17"),
        annual("2025-02-03", "2026-02-01", 11_102_600, 2025, "2026-03-17")
      ] }
    },
    AssetsCurrent: {
      label: "Current assets",
      units: { USD: [
        { end: "2025-02-02", val: 20, fy: 2025, filed: "2026-03-17", form: "10-K" },
        { end: "2026-02-01", val: 25, fy: 2025, filed: "2026-03-17", form: "10-K" }
      ] }
    }
  } } };

  const extracted = extractFinancials(facts);
  assert.equal(extracted.series.revenue.values.get(2026).fiscalYear, 2025);
  assert.equal(extracted.series.revenue.values.get(2025).fiscalYear, 2024);
  const rows = annualRows(extracted);
  assert.equal(rows[0].fiscalYearSource, "SEC filing");
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.year, row.periodEndYear, row.periodEnd, row.revenue, row.currentAssets]), [
    [2025, 2026, "2026-02-01", 11_102_600, 25],
    [2024, 2025, "2025-02-02", 10_588_126, 20]
  ]);
});

test("calendar-year issuers keep their existing fiscal-year labels", () => {
  const facts = { facts: { "us-gaap": { Revenues: {
    label: "Revenue",
    units: { USD: [
      { start: "2024-01-01", end: "2024-12-31", val: 90, fy: 2024, filed: "2025-02-01", form: "10-K", fp: "FY" },
      { start: "2024-01-01", end: "2024-12-31", val: 90, fy: 2025, filed: "2026-02-01", form: "10-K", fp: "FY" },
      { start: "2025-01-01", end: "2025-12-31", val: 100, fy: 2025, filed: "2026-02-01", form: "10-K", fp: "FY" }
    ] }
  } } } };
  assert.deepEqual(annualRows(extractFinancials(facts)).slice(0, 2).map((row) => row.year), [2025, 2024]);
});

test("annual data without an SEC fiscal-year label is identified as period-end based", () => {
  const series = { values: new Map([[2026, { val: 100, end: "2026-02-01" }]]) };
  const row = annualRows({ series: { revenue: series } })[0];
  assert.equal(row.year, 2026);
  assert.equal(row.fiscalYearSource, "period end");
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
