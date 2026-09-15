"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCandidate, selectedMetrics } = require("../public/screening");

function completeReport() {
  return {
    company: { sic: "3571" },
    quote: { currency: "USD" },
    currencyConversionValid: true,
    normalized: { usableYears: 8, normalizedFcf: 100e6, normalizedEconomicFcf: 90e6, averageInterest: 5e6, latestReportedFcf: 100e6, marginAgreement: true },
    normalized5y: { normalizedFcf: 80e6, normalizedEconomicFcf: 70e6, averageInterest: 4e6 },
    normalized3y: { normalizedFcf: 50e6, normalizedEconomicFcf: 40e6, averageInterest: 3e6 },
    quality: { latestSbcToFcf: 0.10, shareChange: 0, positiveFcfRatio: 1 },
    valuation: { marketCap: 900e6, enterpriseValue: 950e6, netDebt: 50e6, debt: 100e6, shortDebt: 0, cash: 50e6, shares: 100e6 }
  };
}

test("lookback selection changes the actual screening multiple", () => {
  const report = completeReport();
  assert.equal(selectedMetrics(report, { lookbackYears: "all" }).priceToNfcf, 9);
  assert.equal(selectedMetrics(report, { lookbackYears: "3" }).priceToNfcf, 18);
  assert.equal(evaluateCandidate(report, { lookbackYears: "all", maxMultiple: 15 }).status, "Idea");
  assert.equal(evaluateCandidate(report, { lookbackYears: "3", maxMultiple: 15 }).status, "Review");
});

test("missing valuation-critical evidence cannot qualify automatically", () => {
  const report = completeReport();
  report.quality.latestSbcToFcf = null;
  const result = evaluateCandidate(report, {});
  assert.equal(result.status, "Review");
  assert.ok(result.unknowns.some((reason) => reason.includes("SBC")));
});

test("financial institutions are explicitly excluded", () => {
  const report = completeReport();
  report.company.sic = "6021";
  const result = evaluateCandidate(report, {});
  assert.equal(result.status, "Excluded");
  assert.ok(result.exclusions.length > 0);
});
