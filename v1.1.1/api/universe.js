"use strict";

const { fetchYahooUniverse, SOURCES } = require("../lib/yahoo");
const { fetchSecUniverse } = require("../lib/sec");
const { SP500, MIDCAP, SMALLCAP } = require("../lib/indices");
const { setCacheHeaders } = require("../lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET for /api/universe." });
  try {
    const type = String(req.query?.type || "yahoo").toLowerCase();

    if (type === "sp500") {
      const symbols = SP500.map((ticker) => ({ ticker, name: ticker, source: "S&P 500" }));
      setCacheHeaders(res, 3600);
      return res.status(200).json({ symbols, sources: [{ id: "sp500", title: "S&P 500 (Large Cap)", count: symbols.length }], fetchedAt: new Date().toISOString() });
    }

    if (type === "midcap") {
      const symbols = MIDCAP.map((ticker) => ({ ticker, name: ticker, source: "S&P 400 MidCap" }));
      setCacheHeaders(res, 3600);
      return res.status(200).json({ symbols, sources: [{ id: "midcap", title: "S&P 400 MidCap", count: symbols.length }], fetchedAt: new Date().toISOString() });
    }

    if (type === "smallcap") {
      const symbols = SMALLCAP.map((ticker) => ({ ticker, name: ticker, source: "Small-Cap Index" }));
      setCacheHeaders(res, 3600);
      return res.status(200).json({ symbols, sources: [{ id: "smallcap", title: "Small-Cap Universe", count: symbols.length }], fetchedAt: new Date().toISOString() });
    }

    if (type === "sec_all") {
      const symbols = await fetchSecUniverse();
      setCacheHeaders(res, 3600);
      return res.status(200).json({ symbols, sources: [{ id: "sec_all", title: "Full SEC Operating Directory", count: symbols.length }], fetchedAt: new Date().toISOString() });
    }

    // Default: Yahoo Discovery
    const requested = String(req.query?.sources || "").split(",").filter(Boolean);
    const universe = await fetchYahooUniverse({ sources: requested.length ? requested : SOURCES, perSource: req.query?.perSource });
    setCacheHeaders(res, 600);
    return res.status(200).json(universe);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Could not load universe." });
  }
};
