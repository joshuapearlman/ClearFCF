"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFinancials } = require("../lib/sec");

test("period-end common shares fill missing diluted-share history without replacing preferred diluted facts", () => {
  const annual = (year, val) => ({
    start: `${year}-01-01`, end: `${year}-12-31`, val, form: "10-K", fy: year, fp: "FY", filed: `${year + 1}-02-20`
  });
  const instant = (year, val) => ({
    end: `${year}-12-31`, val, form: "10-K", fy: year, fp: "FY", filed: `${year + 1}-02-20`
  });
  const facts = { facts: {
    "us-gaap": {
      WeightedAverageNumberOfDilutedSharesOutstanding: {
        label: "Weighted Average Number of Shares Outstanding, Diluted",
        units: { shares: [annual(2025, 95_000_000)] }
      },
      CommonStockSharesOutstanding: {
        label: "Common Stock, Shares, Outstanding",
        units: { shares: [instant(2024, 105_000_000), instant(2025, 100_000_000)] }
      }
    },
    dei: {
      EntityCommonStockSharesOutstanding: {
        label: "Entity Common Stock, Shares Outstanding",
        units: { shares: [{ end: "2024-02-20", val: 110_000_000, form: "10-K", fy: 2023, fp: "FY", filed: "2024-02-22" }] }
      }
    }
  } };

  const shares = extractFinancials(facts).series.dilutedShares.values;
  assert.equal(shares.get(2025).val, 95_000_000);
  assert.equal(shares.get(2025).shareBasis, "weighted-average diluted");
  assert.equal(shares.get(2024).val, 105_000_000);
  assert.equal(shares.get(2024).shareBasis, "period-end outstanding");
  assert.equal(shares.get(2023).val, 110_000_000);
  assert.match(shares.get(2023).label, /period-end fallback/);
});
