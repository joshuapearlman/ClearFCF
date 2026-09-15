"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { debtValue, reconcileBalanceSheet } = require("../lib/analysis");

test("debtValue takes Math.max of totalDebt and short+long debt", () => {
  // Test that debtValue logic doesn't truncate debt when short and long debt are present
  const latest1 = {
    totalDebt: { val: 10_000_000_000 },
    shortDebt: { val: 50_000_000_000 },
    longDebt: { val: 95_000_000_000 }
  };
  assert.equal(debtValue(latest1), 145_000_000_000);
});

test("debt reconciliation uses Yahoo totalDebt when SEC debt is missing or severely understated", () => {
  const result = reconcileBalanceSheet(
    { totalDebt: { val: 10_000_000_000 }, cash: { val: 30_000_000_000 } },
    { totalDebt: 145_000_000_000 }
  );
  assert.equal(result.debt, 145_000_000_000);
  assert.equal(result.reconciled, true);
});

test("cash reconciliation takes comprehensive liquid cash including marketable securities", () => {
  const result = reconcileBalanceSheet(
    { totalDebt: { val: 10_000_000_000 }, cash: { val: 30_000_000_000 } },
    { totalCash: 65_000_000_000 }
  );
  assert.equal(result.cash, 65_000_000_000);
  assert.match(result.cashSource, /Yahoo/);
});

test("missing debt remains unknown instead of being inferred as zero from cash", () => {
  assert.equal(debtValue({ cash: { val: 1_000_000_000 } }), null);
});
