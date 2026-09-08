"use strict";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 2) {
  if (!finite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function standardDeviation(values) {
  const clean = values.filter(finite);
  if (clean.length < 2) return 0;
  const average = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - average) ** 2, 0) / (clean.length - 1));
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Upstream request failed (${response.status}).`);
      error.statusCode = response.status === 404 ? 404 : 502;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Upstream data request timed out.");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function setCacheHeaders(res, seconds = 900) {
  res.setHeader("Cache-Control", `s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`);
}

module.exports = { finite, round, median, clamp, standardDeviation, fetchJson, setCacheHeaders };
