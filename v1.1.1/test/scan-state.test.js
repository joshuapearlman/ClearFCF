"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const scanState = require("../public/scan-state");

const scan = () => scanState.normalize({
  symbols: [{ ticker: "AAPL" }, { ticker: "MSFT" }, { ticker: "OMC" }],
  cursor: 0, allExamined: [], failures: [], results: []
});

test("transient failures stay pending and do not make a scan complete", () => {
  const current = scan();
  const result = scanState.applyBatch(current, ["AAPL", "MSFT"], {
    results: [{ ticker: "AAPL", status: "Idea" }],
    failures: [{ ticker: "MSFT", error: "Upstream request failed (429).", statusCode: 429 }]
  });
  assert.deepEqual(result.retrying, ["MSFT"]);
  assert.deepEqual(current.pending, ["OMC", "MSFT"]);
  assert.equal(current.complete, false);
  assert.deepEqual(scanState.stats(current), { total: 3, analyzed: 1, unresolved: 0, pending: 2 });
  const restored = scanState.normalize(JSON.parse(JSON.stringify(scanState.forStorage(current))));
  assert.deepEqual(restored.pending, ["OMC", "MSFT"]);
  assert.equal(restored.allExamined[0].ticker, "AAPL");
  assert.deepEqual(scanState.nextBatch(restored, 5, restored.retryAt.MSFT - 1).tickers, ["OMC"]);
});

test("permanent failures remain visible and can be retried by the user", () => {
  const current = scan();
  scanState.applyBatch(current, ["AAPL", "MSFT", "OMC"], {
    results: [{ ticker: "AAPL" }, { ticker: "MSFT" }],
    failures: [{ ticker: "OMC", error: "Ticker not found", statusCode: 404 }]
  });
  assert.equal(current.complete, true);
  assert.equal(scanState.stats(current).unresolved, 1);
  scanState.retryFailed(current);
  assert.deepEqual(current.pending, ["OMC"]);
  assert.equal(current.complete, false);
  scanState.applyBatch(current, ["OMC"], { results: [{ ticker: "OMC" }], failures: [] });
  assert.deepEqual(scanState.stats(current), { total: 3, analyzed: 3, unresolved: 0, pending: 0 });
});

test("repeated transient failures stop after the retry limit", () => {
  const current = scan();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    scanState.applyBatch(current, ["AAPL"], { failures: [{ ticker: "AAPL", error: "Timed out", statusCode: 504 }] }, 3, attempt * 1000);
    if (attempt === 1) assert.equal(current.retryAt.AAPL, 2000);
    if (attempt === 2) assert.equal(current.retryAt.AAPL, 4000);
  }
  assert.equal(current.failures.length, 1);
  assert.equal(current.failures[0].attempts, 3);
  assert.equal(current.pending.includes("AAPL"), false);
});

test("legacy saved scans resume after the cursor without duplicating ideas", () => {
  const legacy = scanState.normalize({ symbols: [{ ticker: "AAPL" }, { ticker: "MSFT" }], cursor: 1,
    results: [{ ticker: "AAPL" }], failures: [], complete: false });
  assert.deepEqual(legacy.pending, ["MSFT"]);
  scanState.applyBatch(legacy, ["MSFT"], { results: [{ ticker: "MSFT" }, { ticker: "MSFT" }] });
  assert.equal(legacy.allExamined.length, 2);
  assert.equal(legacy.complete, true);
});
