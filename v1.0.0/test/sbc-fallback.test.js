"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFinancials, parseInlineAnnualSbc } = require("../lib/sec");

test("AllocatedShareBasedCompensationExpense fills OXY-style annual SBC history", () => {
  const facts = { facts: { "us-gaap": {
    AllocatedShareBasedCompensationExpense: {
      label: "Share-based Payment Arrangement, Expense",
      units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 203_000_000, form: "10-K", fp: "FY", fy: 2025, filed: "2026-02-18" },
        { start: "2024-01-01", end: "2024-12-31", val: 213_000_000, form: "10-K", fp: "FY", fy: 2025, filed: "2026-02-18" },
        { start: "2025-01-01", end: "2025-12-31", val: 234_000_000, form: "10-K", fp: "FY", fy: 2025, filed: "2026-02-18" }
      ] }
    }
  } } };
  const extracted = extractFinancials(facts);
  assert.equal(extracted.series.sbc.values.get(2025).val, 234_000_000);
  assert.equal(extracted.series.sbc.values.size, 3);
});

test("inline XBRL parser recovers recent VZ-style annual SBC disclosure", () => {
  const html = `
    <xbrli:context id="c-530"><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="c-531"><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="c-532"><xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <ix:nonFraction unitRef="usd" contextRef="c-530" name="us-gaap:ShareBasedCompensation" scale="6">815</ix:nonFraction>
    <ix:nonFraction unitRef="usd" contextRef="c-531" name="us-gaap:ShareBasedCompensation" scale="6">795</ix:nonFraction>
    <ix:nonFraction unitRef="usd" contextRef="c-532" name="us-gaap:ShareBasedCompensation" scale="6">533</ix:nonFraction>`;
  const series = parseInlineAnnualSbc(html, { form: "10-K", filed: "2026-02-17", accession: "test" });
  assert.equal(series.values.get(2025).val, 815_000_000);
  assert.equal(series.values.get(2024).val, 795_000_000);
  assert.equal(series.values.get(2023).val, 533_000_000);
});
