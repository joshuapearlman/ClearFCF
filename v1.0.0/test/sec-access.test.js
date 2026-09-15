"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("SEC requests identify ClearFCF with a contact email and use all required endpoints", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ href, headers: options.headers || {} });
    if (href.includes("company_tickers.json")) return json({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
    if (href.includes("companyfacts")) return json({ facts: {} });
    if (href.includes("submissions")) return json({ name: "Apple Inc.", filings: { recent: {} } });
    throw new Error(`Unexpected URL: ${href}`);
  };

  try {
    const { fetchSecCompany } = require("../lib/sec");
    await fetchSecCompany("AAPL");
    assert.equal(requests.length, 3);
    assert.ok(requests.some(({ href }) => href.includes("companyfacts")));
    assert.ok(requests.some(({ href }) => href.includes("submissions")));
    for (const request of requests) {
      assert.match(request.headers["User-Agent"], /^ClearFCF\/1\.0 .+@.+\..+$/);
      assert.equal(request.headers.Accept, "application/json");
    }
  } finally {
    global.fetch = originalFetch;
  }
});
