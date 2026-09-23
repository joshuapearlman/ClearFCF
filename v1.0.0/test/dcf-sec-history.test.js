"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFinancials } = require("../lib/sec");

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
