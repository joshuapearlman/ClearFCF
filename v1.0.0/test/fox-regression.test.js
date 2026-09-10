"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, selectValuationShares } = require("../lib/analysis");

test("FOX-style anomalous share fact cannot create a near-zero P/nFCF", () => {
  const source = [
    [2026, 17.13, 1.97, 0.502, 439], [2025, 16.30, 3.32, 0.331, 461],
    [2024, 13.98, 1.84, 0.345, 480], [2023, 14.91, 1.80, 0.357, 531],
    [2022, 13.97, 1.88, 0.307, 570], [2021, 12.91, 2.64, 0.484, 595],
    [2020, 12.30, 2.37, 0.359, 616]
  ];
  const rows = source.map(([year, revenue, ocf, capex, shares]) => ({
    year, revenue: revenue * 1e9, ocf: ocf * 1e9, capex: capex * 1e9,
    fcf: (ocf - capex) * 1e9, fcfMargin: (ocf - capex) / revenue,
    shares: shares * 1e6, sbc: null
  }));
  const normalized = normalize(rows);
  const selection = selectValuationShares(rows, { val: 10, end: "2026-06-30" });
  const marketCap = 61.05 * selection.shares;
  const priceToNfcf = marketCap / normalized.normalizedFcf;
  const fcfYield = normalized.normalizedFcf / marketCap;

  assert.equal(selection.shares, 439_000_000);
  assert.ok(normalized.simpleAverageMargin > 0.130 && normalized.simpleAverageMargin < 0.132);
  assert.ok(normalized.averageMedianGap > 0.16 && normalized.averageMedianGap < 0.17);
  assert.equal(normalized.marginAgreement, true);
  assert.ok(normalized.normalizedFcf > 2.2e9 && normalized.normalizedFcf < 2.3e9);
  assert.ok(priceToNfcf > 11.5 && priceToNfcf < 12.5);
  assert.ok(fcfYield > 0.08 && fcfYield < 0.09);
  assert.ok(Math.abs(priceToNfcf * fcfYield - 1) < 1e-12);
});
