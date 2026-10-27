"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchRecentForm4Purchases } = require("../lib/sec");
const { insiderSignalEvidence } = require("../lib/analysis");

test("SEC Form 4 parsing keeps open-market purchases and ignores awards", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(`<?xml version="1.0"?>
    <ownershipDocument>
      <reportingOwner><reportingOwnerId><rptOwnerName>Example Director</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
      <nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-08-01</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>12.50</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
      <nonDerivativeTransaction><transactionCoding><transactionCode>A</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>2000</value></transactionShares><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
    </ownershipDocument>`, { status: 200 });
  try {
    const submissions = { filings: { recent: {
      form: ["4"], filingDate: ["2026-08-02"], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["form4.xml"]
    } } };
    const purchases = await fetchRecentForm4Purchases({ cik: "0000000001" }, submissions);
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].name, "Example Director");
    assert.equal(purchases[0].relation, "Director");
    assert.equal(purchases[0].value, 12_500);
    assert.equal(purchases[0].sharesAfter, 5000);
  } finally {
    global.fetch = originalFetch;
  }
});

test("old or token insider purchases do not earn a buying badge", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const purchases = [
    { name: "Director A", date: "2026-03-10", value: 80_000, shares: 1000, sharesAfter: 100_000 },
    { name: "Director B", date: "2026-10-20", value: 2_000, shares: 50, sharesAfter: 20_000 }
  ];
  const evidence = insiderSignalEvidence(purchases, now);
  assert.equal(evidence.recentPurchases.length, 1);
  assert.equal(evidence.materialBuying, false);
  assert.equal(evidence.clusterBuying, false);

  const significant = insiderSignalEvidence([...purchases, {
    name: "Director C", date: "2026-10-22", value: 60_000, shares: 2000, sharesAfter: 30_000
  }], now);
  assert.equal(significant.materialBuying, true);
  assert.equal(significant.latestPurchaseDate, "2026-10-22");
});
