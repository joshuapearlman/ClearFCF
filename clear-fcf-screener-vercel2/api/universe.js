"use strict";

const { fetchYahooUniverse, SOURCES } = require("../lib/yahoo");
const { setCacheHeaders } = require("../lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET for /api/universe." });
  try {
    const requested = String(req.query?.sources || "").split(",").filter(Boolean);
    const universe = await fetchYahooUniverse({ sources: requested.length ? requested : SOURCES, perSource: req.query?.perSource });
    setCacheHeaders(res, 600);
    return res.status(200).json(universe);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Could not load Yahoo idea lists." });
  }
};