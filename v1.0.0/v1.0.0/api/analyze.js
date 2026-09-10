"use strict";

const { analyzeTicker } = require("../lib/analysis");
const { setCacheHeaders } = require("../lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET for /api/analyze." });
  try {
    const ticker = String(req.query?.ticker || "").trim().toUpperCase();
    const report = await analyzeTicker(ticker, { price: req.query?.price });
    setCacheHeaders(res, 900);
    return res.status(200).json(report);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Analysis failed." });
  }
};