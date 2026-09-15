"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function annual(tag, value) {
  const dates = ["2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"];
  return {
    meta: { symbol: ["FALL"], type: [tag] },
    timestamp: dates.map((date) => Date.parse(date) / 1000),
    [tag]: dates.map((asOfDate) => ({
      asOfDate,
      periodType: "12M",
      currencyCode: "USD",
      reportedValue: { raw: value }
    }))
  };
}

test("analysis falls back to Yahoo fundamentals when SEC returns 403", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("sec.gov")) return json({ error: "blocked" }, 403);
    if (href.includes("quoteSummary")) return json({ quoteSummary: { result: [{
      price: { regularMarketPrice: { raw: 10 }, marketCap: { raw: 1_000_000_000 }, currency: "USD", quoteType: "EQUITY", longName: "Fallback Company" },
      defaultKeyStatistics: { sharesOutstanding: { raw: 100_000_000 } },
      financialData: { totalDebt: { raw: 100_000_000 }, totalCash: { raw: 200_000_000 } },
      assetProfile: { sector: "Technology", industry: "Software" }
    }] } });
    if (href.includes("fundamentals-timeseries")) {
      const quarterly = (tag, value) => ({ meta: { symbol: ["FALL"], type: [tag] }, [tag]: [{ asOfDate: "2025-12-31", periodType: "3M", currencyCode: "USD", reportedValue: { raw: value } }] });
      return json({ timeseries: { result: [
        annual("annualTotalRevenue", 1_000_000_000),
        annual("annualOperatingCashFlow", 150_000_000),
        annual("annualCapitalExpenditure", -50_000_000),
        annual("annualStockBasedCompensation", 5_000_000),
        annual("annualDilutedAverageShares", 100_000_000),
        annual("annualDepreciationAndAmortization", 50_000_000),
        annual("annualInterestExpense", 10_000_000),
        quarterly("quarterlyCashCashEquivalentsAndShortTermInvestments", 200_000_000),
        quarterly("quarterlyTotalDebt", 100_000_000),
        quarterly("quarterlyCurrentDebt", 0)
      ] } });
    }
    if (href === "https://fc.yahoo.com") return new Response("", { status: 200 });
    throw new Error(`Unexpected URL: ${href}`);
  };

  try {
    const { analyzeTicker } = require("../lib/analysis");
    const report = await analyzeTicker("FALL");
    assert.equal(report.normalized.usableYears, 6);
    assert.equal(report.sources.financials, "Yahoo Finance fundamentals fallback");
    assert.equal(report.evidenceConfidence.level, "Partial");
    assert.equal(report.status, "Idea");
    assert.ok(report.warnings.some((warning) => warning.includes("SEC filing data was unavailable")));
  } finally {
    global.fetch = originalFetch;
  }
});
