"use strict";

const { analyzeBatch } = require("../lib/analysis");

function parseTickers(value) {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(parts.map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST for /api/screen." });
  try {
    const tickers = parseTickers(req.body?.tickers || req.body?.input);
    if (!tickers.length) return res.status(400).json({ error: "Provide at least one ticker." });
    if (tickers.length > 25) return res.status(400).json({ error: "Send no more than 25 tickers per batch." });
    const invalid = tickers.filter((ticker) => !/^[A-Z0-9.-]{1,12}$/.test(ticker));
    if (invalid.length) return res.status(400).json({ error: `Invalid ticker: ${invalid.join(", ")}` });
    const quoteRows = Array.isArray(req.body?.quotes) ? req.body.quotes : [];
    const quotes = Object.fromEntries(quoteRows.filter((item) => tickers.includes(String(item?.ticker || "").toUpperCase())).map((item) => [String(item.ticker).toUpperCase(), {
      price: Number.isFinite(Number(item.price)) && Number(item.price) > 0 ? Number(item.price) : undefined,
      marketCap: Number.isFinite(Number(item.marketCap)) && Number(item.marketCap) > 0 ? Number(item.marketCap) : undefined
    }]));
    const criteria = req.body?.criteria;
    const performance = req.body?.performance || {};
    const workers = boundedInteger(performance.workers, 1, 1, 8);
    const pacingMs = boundedInteger(performance.pacingMs, 250, 0, 5000);
    const result = await analyzeBatch(tickers, { quotes, criteria, workers, pacingMs });
    return res.status(200).json({ ...result, requested: tickers.length, analyzedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Screen failed." });
  }
};

module.exports.parseTickers = parseTickers;
module.exports.boundedInteger = boundedInteger;
