"use strict";

const { fetchJson } = require("./utils");

const CACHE_MS = 12 * 60 * 60 * 1000;
const USER_AGENT = "ClearFCF/1.1 (index constituent lookup; https://github.com/joshuapearlman/ClearFCF)";
const INDEX_CONFIGS = Object.freeze({
  sp500: Object.freeze({
    page: "List_of_S%26P_500_companies",
    title: "S&P 500 (Large Cap)",
    source: "Wikipedia S&P 500 constituent table",
    minCount: 450,
    maxCount: 550
  }),
  midcap: Object.freeze({
    page: "List_of_S%26P_400_companies",
    title: "S&P 400 (Mid Cap)",
    source: "Wikipedia S&P 400 constituent table",
    minCount: 350,
    maxCount: 450
  }),
  smallcap: Object.freeze({
    page: "List_of_S%26P_600_companies",
    title: "S&P 600 (Small Cap)",
    source: "Wikipedia S&P 600 constituent table",
    minCount: 550,
    maxCount: 650
  })
});

const cache = new Map();

function decodeHtml(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function cellText(cell) {
  return decodeHtml(String(cell || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseIndexTable(html) {
  const table = String(html || "").match(/<table\b(?=[^>]*\bid=["']constituents["'])[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error("The upstream index page did not contain a constituents table.");

  const rows = [];
  const seen = new Set();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cellText(match[1]));
    if (cells.length < 2) continue;
    const ticker = cells[0].replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    rows.push({ ticker, name: cells[1] || ticker });
  }
  return rows;
}

function validateIndexRows(rows, config) {
  if (!Array.isArray(rows) || rows.length < config.minCount || rows.length > config.maxCount) {
    const error = new Error(`The ${config.title} source returned ${rows?.length || 0} valid constituents; expected ${config.minCount}–${config.maxCount}.`);
    error.statusCode = 502;
    throw error;
  }
  if (new Set(rows.map((row) => row.ticker)).size !== rows.length) {
    const error = new Error(`The ${config.title} source contained duplicate tickers.`);
    error.statusCode = 502;
    throw error;
  }
  return rows;
}

async function fetchIndexUniverse(type) {
  const config = INDEX_CONFIGS[type];
  if (!config) {
    const error = new Error("Unknown index universe.");
    error.statusCode = 400;
    throw error;
  }
  const cached = cache.get(type);
  if (cached && Date.now() - cached.cachedAt < CACHE_MS) return cached.value;

  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${config.page}&prop=text&format=json&formatversion=2`;
  const response = await fetchJson(url, { headers: { "User-Agent": USER_AGENT } }, 15000);
  const rows = validateIndexRows(parseIndexTable(response?.parse?.text), config);
  const fetchedAt = new Date().toISOString();
  const value = {
    symbols: rows.map((row) => ({ ...row, source: config.title })),
    sources: [{ id: type, title: config.title, count: rows.length, source: config.source }],
    fetchedAt
  };
  cache.set(type, { cachedAt: Date.now(), value });
  return value;
}

module.exports = { INDEX_CONFIGS, fetchIndexUniverse, parseIndexTable, validateIndexRows };
