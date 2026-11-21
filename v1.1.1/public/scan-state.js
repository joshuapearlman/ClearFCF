"use strict";

(function expose(factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ClearFcfScanState = api;
})(function createScanState() {
  const tickerOf = (item) => String(typeof item === "string" ? item : item?.ticker || "").toUpperCase();

  function normalize(scan) {
    if (!scan || !Array.isArray(scan.symbols)) throw new Error("Scan data is incomplete.");
    scan.allExamined = Array.isArray(scan.allExamined) ? scan.allExamined : Array.isArray(scan.results) ? scan.results : [];
    scan.failures = Array.isArray(scan.failures) ? scan.failures : [];
    scan.attempts = scan.attempts && typeof scan.attempts === "object" ? scan.attempts : {};
    scan.retryAt = scan.retryAt && typeof scan.retryAt === "object" ? scan.retryAt : {};
    if (!Array.isArray(scan.pending)) {
      scan.pending = scan.symbols.slice(Math.max(0, Number(scan.cursor) || 0)).map(tickerOf);
    }
    scan.pending = [...new Set(scan.pending.map(tickerOf).filter(Boolean))];
    const complete = new Set(scan.allExamined.map(tickerOf));
    scan.pending = scan.pending.filter((ticker) => !complete.has(ticker));
    scan.failures = scan.failures.filter((failure) => !complete.has(tickerOf(failure)));
    scan.cursor = Math.max(0, scan.symbols.length - scan.pending.length);
    scan.complete = scan.pending.length === 0;
    return scan;
  }

  function isTransient(failure) {
    const code = Number(failure?.statusCode);
    if (code === 429 || code === 502 || code === 503 || code === 504) return true;
    if (code >= 500 && code !== 501) return true;
    return /\b(429|5\d\d|timed out|timeout|network|ECONN|fetch failed|rate limit)\b/i.test(String(failure?.error || ""));
  }

  function nextBatch(scan, limit, now = Date.now()) {
    normalize(scan);
    const ready = scan.pending.filter((ticker) => (Number(scan.retryAt[ticker]) || 0) <= now).slice(0, limit);
    const next = Math.min(...scan.pending.map((ticker) => Number(scan.retryAt[ticker]) || 0).filter((time) => time > now));
    return { tickers: ready, waitMs: ready.length ? 0 : Number.isFinite(next) ? Math.max(0, next - now) : 0 };
  }

  function applyBatch(scan, requested, payload, maxAttempts = 3, now = Date.now()) {
    normalize(scan);
    const batch = [...new Set(requested.map(tickerOf))];
    const batchSet = new Set(batch);
    const pendingSet = new Set(scan.pending);
    if (batch.some((ticker) => !pendingSet.has(ticker))) throw new Error("Scan batch is not pending.");
    scan.pending = scan.pending.filter((ticker) => !batchSet.has(ticker));
    const results = new Map((payload?.results || []).map((row) => [tickerOf(row), row]));
    const failures = new Map((payload?.failures || []).map((row) => [tickerOf(row), row]));
    const existing = new Map(scan.allExamined.map((row) => [tickerOf(row), row]));
    const retrying = [];
    const unresolved = [];
    for (const ticker of batch) {
      const attempts = (Number(scan.attempts[ticker]) || 0) + 1;
      scan.attempts[ticker] = attempts;
      if (results.has(ticker)) {
        existing.set(ticker, results.get(ticker));
        scan.failures = scan.failures.filter((failure) => tickerOf(failure) !== ticker);
        delete scan.retryAt[ticker];
        continue;
      }
      const failure = failures.get(ticker) || { ticker, error: "No result returned for this ticker." };
      if (isTransient(failure) && attempts < maxAttempts) {
        scan.pending.push(ticker);
        scan.retryAt[ticker] = now + Math.min(30_000, 1000 * 2 ** (attempts - 1));
        retrying.push(ticker);
      } else {
        delete scan.retryAt[ticker];
        scan.failures = scan.failures.filter((item) => tickerOf(item) !== ticker);
        const item = { ticker, error: String(failure.error || "Analysis failed."), statusCode: failure.statusCode || null, attempts };
        scan.failures.push(item);
        unresolved.push(item);
      }
    }
    scan.allExamined = [...existing.values()];
    scan.cursor = Math.max(0, scan.symbols.length - scan.pending.length);
    scan.complete = scan.pending.length === 0;
    return { retrying, unresolved, completed: batch.length - retrying.length - unresolved.length };
  }

  function retryFailed(scan) {
    normalize(scan);
    const pending = new Set(scan.pending);
    for (const failure of scan.failures) {
      const ticker = tickerOf(failure);
      if (ticker && !pending.has(ticker)) {
        scan.pending.push(ticker);
        pending.add(ticker);
      }
      delete scan.attempts[ticker];
      delete scan.retryAt[ticker];
    }
    scan.failures = [];
    scan.cursor = Math.max(0, scan.symbols.length - scan.pending.length);
    scan.complete = scan.pending.length === 0;
    return scan;
  }

  function stats(scan) {
    normalize(scan);
    return {
      total: scan.symbols.length,
      analyzed: scan.allExamined.length,
      unresolved: scan.failures.length,
      pending: scan.pending.length
    };
  }

  function forStorage(scan) {
    const { results, runStartedAt, runStartCursor, rateLimited, ...saved } = normalize(scan);
    return saved;
  }

  return { normalize, nextBatch, applyBatch, retryFailed, stats, forStorage, isTransient };
});
