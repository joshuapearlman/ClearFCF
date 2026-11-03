"use strict";

const DEFAULT_JSON_LIMIT_BYTES = 1024 * 1024;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJsonBody(req, limitBytes = DEFAULT_JSON_LIMIT_BYTES) {
  const contentLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw httpError(413, "Request body is too large.");
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limitBytes) throw httpError(413, "Request body is too large.");
    chunks.push(bytes);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON.");
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function isTrustedLocalRequest(req) {
  const host = String(req.headers?.host || "");
  let requestHost;
  try {
    requestHost = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (!isLoopbackHostname(requestHost)) return false;

  const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(String(origin));
    return parsed.protocol === "http:" && parsed.host === host && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_JSON_LIMIT_BYTES,
  isLoopbackHostname,
  isTrustedLocalRequest,
  readJsonBody
};
