"use strict";

const { fetchJson, clamp, finite } = require("./utils");

const HEADERS = { "User-Agent": "Mozilla/5.0 ClearFCFScreener/1.0", Accept: "application/json" };
const SOURCES = [
  "undervalued_large_caps", "undervalued_growth_stocks", "day_losers",
  "most_actives", "aggressive_small_caps", "small_cap_gainers"
];

async function fetchYahooQuote(ticker) {
  const symbol = encodeURIComponent(ticker);
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`, { headers: HEADERS });
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const lastClose = [...closes].reverse().find(finite);
  const price = finite(meta.regularMarketPrice) ? meta.regularMarketPrice : lastClose;
  return {
    price: finite(price) ? price : null,
    currency: meta.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    instrumentType: meta.instrumentType || null,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    source: "Yahoo Finance chart"
  };
}

async function fetchSource(source, count) {
  const url = `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${encodeURIComponent(source)}&count=${count}`;
  const data = await fetchJson(url, { headers: HEADERS });
  const result = data?.finance?.result?.[0];
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  return {
    id: source,
    title: result?.title || source.replaceAll("_", " "),
    symbols: quotes.filter((quote) =>
      quote.quoteType === "EQUITY" && finite(quote.regularMarketPrice) && finite(quote.marketCap) && quote.marketCap > 50_000_000
    ).map((quote) => ({
      ticker: String(quote.symbol || "").toUpperCase(),
      name: quote.shortName || quote.longName || quote.symbol,
      price: quote.regularMarketPrice,
      marketCap: quote.marketCap,
      exchange: quote.fullExchangeName || quote.exchange || null,
      source
    })).filter((quote) => /^[A-Z0-9.-]{1,12}$/.test(quote.ticker))
  };
}

async function fetchYahooUniverse(options = {}) {
  const count = clamp(Number(options.perSource) || 100, 25, 250);
  const requested = Array.isArray(options.sources) ? options.sources.filter((value) => SOURCES.includes(value)) : SOURCES;
  const settled = await Promise.allSettled(requested.map((source) => fetchSource(source, count)));
  const sources = [];
  const failures = [];
  const byTicker = new Map();
  const successfulLists = [];

  for (const result of settled) {
    if (result.status === "rejected") {
      failures.push(result.reason?.message || "Yahoo list failed.");
      continue;
    }
    sources.push({ id: result.value.id, title: result.value.title, count: result.value.symbols.length });
    successfulLists.push(result.value.symbols);
    for (const quote of result.value.symbols) {
      const existing = byTicker.get(quote.ticker);
      if (existing) existing.sources.push(quote.source);
      else byTicker.set(quote.ticker, { ...quote, sources: [quote.source] });
    }
  }

  const orderedTickers = [];
  const seen = new Set();
  const longest = Math.max(0, ...successfulLists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of successfulLists) {
      const ticker = list[index]?.ticker;
      if (ticker && !seen.has(ticker)) { seen.add(ticker); orderedTickers.push(ticker); }
    }
  }

  const symbols = orderedTickers.map((ticker) => byTicker.get(ticker));
  return { symbols, sources, failures, fetchedAt: new Date().toISOString() };
}

module.exports = { SOURCES, fetchYahooQuote, fetchYahooUniverse };
