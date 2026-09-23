"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const analyze = require("./api/analyze");

const publicDir = path.join(__dirname, "dcf-public");
const sharedPublicDir = path.join(__dirname, "public");
const port = Number(process.env.DCF_PORT || 3001);

function responseAdapter(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
  };
  return res;
}

const assets = {
  "/": [publicDir, "index.html"],
  "/app.js": [publicDir, "app.js"],
  "/engine.js": [publicDir, "engine.js"],
  "/styles.css": [publicDir, "styles.css"],
  "/financial-analysis/app.js": [publicDir, "app.js"],
  "/financial-analysis/engine.js": [publicDir, "engine.js"],
  "/financial-analysis/styles.css": [publicDir, "styles.css"],
  "/icon-mark.png": [sharedPublicDir, "icon-mark.png"],
  "/logo-trimmed.png": [sharedPublicDir, "logo-trimmed.png"]
};

http.createServer(async (req, rawRes) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/analyze") {
    req.query = Object.fromEntries(url.searchParams);
    return analyze(req, responseAdapter(rawRes));
  }
  const asset = assets[url.pathname];
  if (!asset) {
    rawRes.statusCode = 404;
    return rawRes.end("Not found");
  }
  const filePath = path.join(asset[0], asset[1]);
  const type = filePath.endsWith(".css") ? "text/css; charset=utf-8"
    : filePath.endsWith(".js") ? "text/javascript; charset=utf-8"
      : filePath.endsWith(".png") ? "image/png"
        : "text/html; charset=utf-8";
  rawRes.setHeader("Content-Type", type);
  rawRes.setHeader("Cache-Control", "no-store");
  fs.createReadStream(filePath).on("error", () => {
    rawRes.statusCode = 500;
    rawRes.end("Could not load asset");
  }).pipe(rawRes);
}).listen(port, "127.0.0.1", () => {
  console.log(`ClearFCF Financial Deep Analysis running at http://127.0.0.1:${port}`);
});
