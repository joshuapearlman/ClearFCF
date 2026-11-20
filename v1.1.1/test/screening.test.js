"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCandidate, selectedMetrics, marketDataFreshness, isMarketSession, latestExpectedSession } = require("../public/screening");

function completeReport() {
  return {
    company: { sic: "3571" },
    quote: { currency: "USD" },
    currencyConversionValid: true,
    normalized: { usableYears: 8, normalizedFcf: 100e6, normalizedEconomicFcf: 90e6, averageInterest: 5e6, latestReportedFcf: 100e6, marginAgreement: true },
    normalized5y: { normalizedFcf: 80e6, normalizedEconomicFcf: 70e6, averageInterest: 4e6 },
    normalized3y: { normalizedFcf: 50e6, normalizedEconomicFcf: 40e6, averageInterest: 3e6 },
    quality: { latestSbcToFcf: 0.10, normalizedSbcToFcf: 0.10, shareChange: 0, shareChangeYears: 8, shareChangeAnnualized: 0, positiveFcfRatio: 1 },
    valuation: { price: 9, marketCap: 900e6, enterpriseValue: 950e6, netDebt: 50e6, debt: 100e6, shortDebt: 0, cash: 50e6, shares: 100e6 }
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

test("normalized margin disagreement blocks qualification unless explicitly disabled", () => {
  const report = completeReport();
  report.normalized.marginAgreement = false;
  const required = evaluateCandidate(report, {});
  assert.equal(required.status, "Review");
  assert.ok(required.failures.includes("Normalized margins do not agree"));
  assert.equal(evaluateCandidate(report, { requireMarginAgreement: false }).status, "Idea");
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

test("market freshness respects a Monday holiday before Tuesday trading", () => {
  const tuesdayMorning = "2026-09-08T12:00:00Z";
  assert.equal(isMarketSession("2026-09-07"), false);
  assert.equal(latestExpectedSession(tuesdayMorning), "2026-09-04");
  assert.equal(marketDataFreshness("2026-09-04T20:00:00Z", tuesdayMorning), "fresh");
  assert.equal(marketDataFreshness("2026-09-03T20:00:00Z", tuesdayMorning), "stale");
});

test("market freshness advances after an early close", () => {
  const beforeClose = "2026-11-27T17:00:00Z";
  const afterClose = "2026-11-27T19:00:00Z";
  assert.equal(latestExpectedSession(beforeClose), "2026-11-25");
  assert.equal(latestExpectedSession(afterClose), "2026-11-27");
  assert.equal(marketDataFreshness("2026-11-25T21:00:00Z", beforeClose), "delayed");
  assert.equal(marketDataFreshness("2026-11-25T21:00:00Z", afterClose), "stale");
});

test("exceptional market closures can be supplied by a calendar", () => {
  const calendar = { closedDates: new Set(["2026-10-26"]) };
  assert.equal(latestExpectedSession("2026-10-27T12:00:00Z", calendar), "2026-10-23");
  assert.equal(marketDataFreshness("2026-10-23T20:00:00Z", "2026-10-27T12:00:00Z", calendar), "fresh");
});

test("an intraday lag is delayed, and a prior session quote becomes stale after the close", () => {
  assert.equal(marketDataFreshness("2026-10-27T14:00:00Z", "2026-10-27T14:30:00Z"), "delayed");
  assert.equal(marketDataFreshness("2026-10-26T20:00:00Z", "2026-10-27T14:30:00Z"), "delayed");
  assert.equal(marketDataFreshness("2026-10-26T20:00:00Z", "2026-10-27T21:00:00Z"), "stale");
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
