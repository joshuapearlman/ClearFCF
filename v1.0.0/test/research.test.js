"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESEARCH_SCHEMA_VERSION,
  buildResearchPrompt,
  buildResearchSnapshot,
  safeWebUrl,
  validateResearchResult
} = require("../lib/research");

function sampleReport() {
  return {
    ticker: "TEST",
    companyName: "Test Company",
    analyzedAt: "2026-09-17T12:00:00.000Z",
    company: { sicDescription: "Widgets", exchanges: ["NYSE"] },
    quote: { currency: "USD", marketTime: "2026-09-17T11:00:00.000Z" },
    filing: { form: "10-K", url: "https://www.sec.gov/example" },
    normalized: { normalizedFcf: 100, usableYears: 2 },
    valuation: { price: 10, marketCap: 1000, debt: 20, cash: 30 },
    quality: { reliability: "High" },
    warnings: ["Example warning"],
    rows: [
      { year: 2025, revenue: 500, ocf: 120, capex: 20, fcf: 100, sbc: 5, shares: 50 },
      { year: 2024, revenue: 450, ocf: 105, capex: 20, fcf: 85, sbc: 4, shares: 49 }
    ],
    sources: { financials: "SEC Company Facts" }
  };
}

function sampleResult() {
  return {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    ticker: "TEST",
    companyName: "Test Company",
    generatedAt: "2026-09-17T12:30:00.000Z",
    classification: "Needs investigation",
    confidence: "Medium",
    executiveSummary: "Summary",
    investmentThesis: "Thesis",
    whyCheap: [],
    business: { overview: "Overview", revenueDrivers: [], competitiveAdvantages: [], vulnerabilities: [], sourceIds: ["S1"] },
    financialHistory: { summary: "History", yearsReviewed: [2025], annualFinancials: [], trendFlags: [], sourceIds: ["S1"] },
    recentDevelopments: [],
    accountingAndCashFlowRisks: [],
    managementAndCapitalAllocation: { assessment: "Mixed", strengths: [], concerns: [], sourceIds: ["S1"] },
    industryAndPeers: { industryContext: "Context", peerComparison: [], sourceIds: ["S1"] },
    valuationCases: {
      bear: { assumptions: [], estimatedValue: "$8", interpretation: "Downside", sourceIds: [] },
      base: { assumptions: [], estimatedValue: "$12", interpretation: "Base", sourceIds: [] },
      bull: { assumptions: [], estimatedValue: "$16", interpretation: "Upside", sourceIds: [] }
    },
    catalysts: [],
    thesisBreakers: [],
    unansweredQuestions: [],
    sources: [{ id: "S1", title: "Annual report", url: "https://www.sec.gov/example", publisher: "SEC", publishedAt: "2026-02-01", sourceType: "SEC filing" }],
    limitations: []
  };
}

test("research snapshot preserves the auditable ClearFCF starting evidence", () => {
  const snapshot = buildResearchSnapshot(sampleReport());
  assert.equal(snapshot.ticker, "TEST");
  assert.equal(snapshot.annualHistory.length, 2);
  assert.equal(snapshot.annualHistory[0].freeCashFlow, 100);
  assert.equal(snapshot.sources.financials, "SEC Company Facts");
});

test("research prompt marks input as untrusted and requires current cited research", () => {
  const prompt = buildResearchPrompt(buildResearchSnapshot(sampleReport()), new Date("2026-09-17T13:00:00.000Z"));
  assert.match(prompt, /untrusted financial content/i);
  assert.match(prompt, /current web research/i);
  assert.match(prompt, /Every material externally researched claim must cite/i);
  assert.match(prompt, /"ticker":"TEST"/);
});

test("research validation accepts HTTPS sources and rejects unsafe source sets", () => {
  const valid = validateResearchResult(sampleResult(), "TEST");
  assert.equal(valid.sources[0].url, "https://www.sec.gov/example");
  const invalid = sampleResult();
  invalid.sources[0].url = "javascript:alert(1)";
  assert.throws(() => validateResearchResult(invalid, "TEST"), /valid HTTPS sources/);
  assert.equal(safeWebUrl("http://example.com"), null);
});
