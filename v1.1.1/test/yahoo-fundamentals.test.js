"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FUNDAMENTAL_TYPES } = require("../lib/yahoo");

test("Yahoo fallback requests every income-statement series it consumes", () => {
  for (const type of ["annualGrossProfit", "annualOperatingIncome", "annualPretaxIncome", "annualTaxProvision", "annualNetIncome"]) {
    assert.ok(FUNDAMENTAL_TYPES.includes(type), `${type} should be requested`);
  }
});
