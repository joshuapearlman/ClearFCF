"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCandidate, selectedMetrics, marketDataFreshness } = require("../public/screening");

function completeReport() {
  return {
    company: { sic: "3571" },
    quote: { currency: "USD" },
    currencyConversionValid: true,
    normalized: { usableYears: 8, normalizedFcf: 100e6, normalizedEconomicFcf: 90e6, averageInterest: 5e6, latestReportedFcf: 100e6, marginAgreement: true },
    normalized5y: { normalizedFcf: 80e6, normalizedEconomicFcf: 70e6, averageInterest: 4e6 },
    normalized3y: { normalizedFcf: 50e6, normalizedEconomicFcf: 40e6, averageInterest: 3e6 },
    quality: { latestSbcToFcf: 0.10, normalizedSbcToFcf: 0.10, shareChange: 0, shareChangeYears: 8, shareChangeAnnualized: 0, positiveFcfRatio: 1 },
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
  report.quality.normalizedSbcToFcf = null;
  const result = evaluateCandidate(report, {});
  assert.equal(result.status, "Review");
  assert.ok(result.unknowns.some((reason) => reason.includes("SBC")));
  assert.ok(result.reasons.some((reason) => reason.startsWith("Missing:") && reason.includes("SBC")));
});

test("screen uses normalized recent SBC burden instead of one depressed annual ratio", () => {
  const report = completeReport();
  report.quality.latestSbcToFcf = 5.8;
  report.quality.normalizedSbcToFcf = 0.07;
  const result = evaluateCandidate(report, {});
  assert.equal(result.status, "Idea");
  assert.ok(result.passes.some((reason) => reason.includes("SBC")));
});

test("dilution failure states cumulative period and annualized rate", () => {
  const report = completeReport();
  report.quality.shareChange = 0.309;
  report.quality.shareChangeYears = 9;
  report.quality.shareChangeAnnualized = 0.0303;
  const result = evaluateCandidate(report, {});
  assert.equal(result.status, "Review");
  assert.ok(result.failures.some((reason) => reason.includes("30.9% over 9 years; 3.0% annualized")));
});

test("financial institutions are explicitly excluded", () => {
  const report = completeReport();
  report.company.sic = "6021";
  const result = evaluateCandidate(report, {});
  assert.equal(result.status, "Excluded");
  assert.ok(result.exclusions.length > 0);
  assert.ok(result.reasons.some((reason) => reason.startsWith("Excluded:")));
});

test("quote freshness allows the prior trading session and gates older quotes", () => {
  const tuesdayMorning = "2026-10-27T12:00:00Z";
  assert.equal(marketDataFreshness("2026-10-26T20:00:00Z", tuesdayMorning), "fresh");
  assert.equal(marketDataFreshness("2026-10-23T20:00:00Z", tuesdayMorning), "stale");
  assert.equal(marketDataFreshness(null, tuesdayMorning), "missing");
});

test("missing or stale market data cannot appear as an Idea", () => {
  const report = completeReport();
  report.marketDataAsOf = null;
  assert.equal(evaluateCandidate(report).status, "Review");
  report.marketDataAsOf = "2020-10-23T20:00:00Z";
  assert.equal(evaluateCandidate(report).status, "Review");
  report.marketDataAsOf = new Date().toISOString();
  assert.equal(evaluateCandidate(report).status, "Idea");
  report.quote.instrumentType = "MUTUALFUND";
  assert.equal(evaluateCandidate(report).status, "Excluded");
  delete report.quote.instrumentType;
  report.quoteInstrumentType = "MUTUALFUND";
  assert.equal(evaluateCandidate(report).status, "Excluded");
});
