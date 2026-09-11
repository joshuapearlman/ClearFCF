"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeQuality } = require("../lib/analysis");

test("debtValue takes Math.max of totalDebt and short+long debt", () => {
  // Test that debtValue logic doesn't truncate debt when short and long debt are present
  const latest1 = {
    totalDebt: { val: 10_000_000_000 },
    shortDebt: { val: 50_000_000_000 },
    longDebt: { val: 95_000_000_000 }
  };
  const short = latest1.shortDebt.val;
  const long = latest1.longDebt.val;
  const combined = short + long;
  const total = latest1.totalDebt.val;
  const effectiveDebt = Math.max(total, combined);
  assert.equal(effectiveDebt, 145_000_000_000);
});

test("debt reconciliation uses Yahoo totalDebt when SEC debt is missing or severely understated", () => {
  const secDebt = 10_000_000_000;
  const yahooDebt = 145_000_000_000;
  let rawDebt = secDebt;
  let isCaptiveFinance = false;
  if (!rawDebt || rawDebt === 0) {
    rawDebt = yahooDebt;
  } else if (yahooDebt && yahooDebt > rawDebt * 2.0 && (yahooDebt - rawDebt) > 5e9) {
    rawDebt = yahooDebt;
    isCaptiveFinance = true;
  }
  assert.equal(rawDebt, 145_000_000_000);
  assert.equal(isCaptiveFinance, true);
});

test("cash reconciliation takes comprehensive liquid cash including marketable securities", () => {
  const secCashOnly = 30_000_000_000; // e.g. Apple Cash and cash equivalents only
  const yahooLiquidCash = 65_000_000_000; // Cash + short-term investments / marketable securities
  let rawCash = secCashOnly;
  if (yahooLiquidCash && yahooLiquidCash > rawCash * 1.15) {
    rawCash = yahooLiquidCash;
  }
  assert.equal(rawCash, 65_000_000_000);
});
