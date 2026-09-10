"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, computeQuality, selectValuationShares } = require("../lib/analysis");

function row(year, revenue, fcf, shares = 100, sbc = 5, dna = 20) {
  return {
    year, revenue, fcf, shares, sbc, dna, capex: 20,
    fcfEconomic: fcf - sbc,
    fcfMargin: fcf / revenue,
    fcfEconomicMargin: (fcf - sbc) / revenue,
    sbcToRevenue: sbc / revenue,
    sbcToFcf: sbc / fcf
  };
}

test("normalization uses the 50/50 blend of simple average and volume-weighted average margin", () => {
  // Years with varying revenue:
  // 2025: rev 200, fcf 20 -> margin 10%
  // 2024: rev 150, fcf 30 -> margin 20%
  // 2023: rev 100, fcf 10 -> margin 10%
  // 2022: rev 100, fcf 10 -> margin 10%
  // 2021: rev 100, fcf 10 -> margin 10%
  // 2020: rev 100, fcf 10 -> margin 10%
  // Total rev = 750, Total fcf = 90
  // Simple avg margin = (0.1 + 0.2 + 0.1 + 0.1 + 0.1 + 0.1) / 6 = 0.7 / 6 = 11.6667%
  // Weighted margin = 90 / 750 = 12%
  // Blended margin = (11.6667% + 12%) / 2 = 11.8333%
  const rows = [
    row(2025, 200, 20), row(2024, 150, 30), row(2023, 100, 10),
    row(2022, 100, 10), row(2021, 100, 10), row(2020, 100, 10)
  ];
  const result = normalize(rows);
  assert.equal(result.usableYears, 6);
  assert.equal(result.latestRevenue, 200);
  assert.ok(Math.abs(result.simpleAverageMargin - (0.7 / 6)) < 1e-12);
  assert.ok(Math.abs(result.weightedMargin - 0.12) < 1e-12);
  const expectedBlended = ((0.7 / 6) + 0.12) / 2;
  assert.ok(Math.abs(result.blendedMargin - expectedBlended) < 1e-12);
  assert.ok(Math.abs(result.normalizedFcf - (200 * expectedBlended)) < 1e-12);
  assert.equal(result.medianMargin, 0.1);
  assert.equal(result.marginAgreement, true);
});

test("comparison between simple average and volume-weighted average tracks divergence", () => {
  // A tiny year with huge margin:
  // 2025: rev 1000, fcf 100 -> 10%
  // 2024: rev 10, fcf 5 -> 50%
  const rows = [
    row(2025, 1000, 100), row(2024, 10, 5), row(2023, 1000, 100),
    row(2022, 1000, 100), row(2021, 1000, 100), row(2020, 1000, 100)
  ];
  const result = normalize(rows);
  // Simple avg = (10*5 + 50) / 6 = 100 / 6 = 16.67%
  // Weighted = 505 / 5010 = 10.08%
  assert.ok(result.simpleVsWeightedGap > 0.6); // >60% difference!
});

test("economic FCF accounts for SBC deduction", () => {
  const rows = [
    row(2025, 100, 20, 100, 5), // FCF 20, SBC 5 -> FCF Economic 15
    row(2024, 100, 20, 100, 5),
    row(2023, 100, 20, 100, 5),
    row(2022, 100, 20, 100, 5),
    row(2021, 100, 20, 100, 5),
    row(2020, 100, 20, 100, 5)
  ];
  const result = normalize(rows);
  assert.equal(result.normalizedFcf, 20);
  assert.equal(result.normalizedEconomicFcf, 15);
});

test("under-investment check flags CapEx well below Depreciation", () => {
  const rows = [
    { fcf: 10, revenue: 100, capex: 10, dna: 30, shares: 100 }, // CapEx / DNA = 33%
    { fcf: 10, revenue: 100, capex: 10, dna: 30, shares: 100 },
    { fcf: 10, revenue: 100, capex: 10, dna: 30, shares: 100 },
    { fcf: 10, revenue: 100, capex: 10, dna: 30, shares: 100 },
    { fcf: 10, revenue: 100, capex: 10, dna: 30, shares: 100 },
    { fcf: 10, revenue: 100, capex: 10, dna: 30, shares: 100 }
  ];
  const quality = computeQuality(rows, { usableYears: 6 });
  assert.ok(quality.capexToDnaRatio < 0.75);
  assert.equal(quality.capexToDnaRatio, 1 / 3);
});

test("buyback allocation audit correctly computes average buyback price and accretive rating", () => {
  const rows = [
    { fcf: 100, revenue: 1000, buybackCash: 50_000_000, buybackShares: 1_000_000, shares: 10_000_000, fcfMargin: 0.1 },
    { fcf: 100, revenue: 1000, buybackCash: 50_000_000, buybackShares: 1_000_000, shares: 11_000_000, fcfMargin: 0.1 }
  ];
  // Total cash = 100M, total shares = 2M -> avg buyback price = $50
  // Current price = $70 -> 50 / 70 = ~0.714 (<= 0.85 -> Accretive)
  const quality = computeQuality(rows, { usableYears: 6 }, 70);
  assert.equal(quality.buybackAudit.totalCashSpent, 100_000_000);
  assert.equal(quality.buybackAudit.totalSharesRepurchased, 2_000_000);
  assert.equal(quality.buybackAudit.averageBuybackPrice, 50);
  assert.equal(quality.buybackAudit.rating, "Accretive");
});

test("FCF trajectory detects deteriorating margin trend", () => {
  const rows = [
    { year: 2025, fcf: 50, revenue: 1000, fcfMargin: 0.05, shares: 100 },
    { year: 2024, fcf: 50, revenue: 1000, fcfMargin: 0.05, shares: 100 },
    { year: 2023, fcf: 60, revenue: 1000, fcfMargin: 0.06, shares: 100 }, // recent 3y avg margin = 5.33%
    { year: 2022, fcf: 150, revenue: 1000, fcfMargin: 0.15, shares: 100 },
    { year: 2021, fcf: 160, revenue: 1000, fcfMargin: 0.16, shares: 100 },
    { year: 2020, fcf: 150, revenue: 1000, fcfMargin: 0.15, shares: 100 }  // baseline avg margin = ~15.33%
  ];
  const quality = computeQuality(rows, { usableYears: 6 }, 50);
  assert.equal(quality.fcfTrajectory, "Deteriorating");
});
