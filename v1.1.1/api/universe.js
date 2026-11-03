"use strict";

const { fetchYahooUniverse, SOURCES } = require("../lib/yahoo");
const { fetchSecUniverse } = require("../lib/sec");
const { fetchIndexUniverse } = require("../lib/indices");
const { setCacheHeaders } = require("../lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET for /api/universe." });
  try {
    const type = String(req.query?.type || "yahoo").toLowerCase();

    if (["sp500", "midcap", "smallcap"].includes(type)) {
      const universe = await fetchIndexUniverse(type);
      setCacheHeaders(res, 3600);
      return res.status(200).json(universe);
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
