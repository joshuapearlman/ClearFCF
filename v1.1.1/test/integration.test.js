"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function annualFacts(valueForYear) {
  return Array.from({ length: 6 }, (_, index) => {
    const year = 2020 + index;
    return { start: `${year}-01-01`, end: `${year}-12-31`, val: valueForYear(year), form: "10-K", fp: "FY", fy: year, filed: `${year + 1}-02-15` };
  });
}

test("end-to-end analysis produces an Idea from mocked Yahoo and SEC data", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("company_tickers.json")) return json({ 0: { cik_str: 1, ticker: "TEST", title: "Test Company" } });
    if (href.includes("companyfacts")) return json({ facts: { "us-gaap": {
      Revenues: { label: "Revenue", units: { USD: annualFacts(() => 1_000_000_000) } },
      NetCashProvidedByUsedInOperatingActivities: { label: "OCF", units: { USD: annualFacts(() => 150_000_000) } },
      PaymentsToAcquirePropertyPlantAndEquipment: { label: "CapEx", units: { USD: annualFacts(() => 50_000_000) } },
      ShareBasedCompensation: { label: "SBC", units: { USD: annualFacts(() => 5_000_000) } },
      DepreciationDepletionAndAmortization: { label: "D&A", units: { USD: annualFacts(() => 50_000_000) } },
      InterestExpense: { label: "Interest", units: { USD: annualFacts(() => 10_000_000) } },
      WeightedAverageNumberOfDilutedSharesOutstanding: { label: "Diluted shares", units: { shares: annualFacts(() => 100_000_000) } },
      CommonStockSharesOutstanding: { label: "Shares", units: { shares: [{ end: "2025-12-31", val: 10, form: "10-K", filed: "2026-02-15" }] } },
      CashAndCashEquivalentsAtCarryingValue: { label: "Cash", units: { USD: [{ end: "2025-12-31", val: 200_000_000, form: "10-K", filed: "2026-02-15" }] } },
      DebtAndFinanceLeaseObligations: { label: "Debt", units: { USD: [{ end: "2025-12-31", val: 100_000_000, form: "10-K", filed: "2026-02-15" }] } },
      DebtCurrent: { label: "Current debt", units: { USD: [{ end: "2025-12-31", val: 0, form: "10-K", filed: "2026-02-15" }] } }
    } } });
    if (href.includes("submissions")) return json({ name: "Test Company", sic: "3571", sicDescription: "Electronic Computers", exchanges: ["Nasdaq"], tickers: ["TEST"], filings: { recent: { form: ["10-K"], filingDate: ["2026-02-15"], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["test-2025.htm"] } } });
    if (href.includes("finance/chart")) return json({ chart: { result: [{ meta: { regularMarketPrice: 10, currency: "USD", exchangeName: "NMS", instrumentType: "EQUITY", regularMarketTime: 1771113600 }, indicators: { quote: [{ close: [10] }] } }] } });
    throw new Error(`Unexpected URL: ${href}`);
  };

  try {
    const { analyzeTicker } = require("../lib/analysis");
    const report = await analyzeTicker("TEST");
    assert.equal(report.normalized.usableYears, 6);
    assert.ok(Math.abs(report.normalized.normalizedFcf - 100_000_000) < 0.01);
    assert.ok(Math.abs(report.valuation.priceToNfcf - 10) < 1e-12);
    assert.ok(Math.abs(report.valuation.fcfYield - 0.1) < 1e-12);
    assert.ok(Math.abs(report.valuation.averageFcfYield - 0.1) < 1e-12);
    assert.equal(report.valuation.enterpriseValue, 900_000_000);
    // Unlevered nFCF = 100M + 10M * (1 - 0.21) = 107.9M
    // EV / Unlevered nFCF = 900M / 107.9M = ~8.34x
    assert.ok(report.valuation.evToUnleveredNfcf > 8.3 && report.valuation.evToUnleveredNfcf < 8.4);
    assert.equal(report.valuation.shares, 100_000_000);
    assert.match(report.valuation.shareSource, /annual diluted/);
    assert.equal(report.quality.reliability, "High");
    assert.equal(report.status, "Idea");
  } finally {
    global.fetch = originalFetch;
  }
});
