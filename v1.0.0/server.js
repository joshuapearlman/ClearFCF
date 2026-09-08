"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const analyze = require("./api/analyze");
const screen = require("./api/screen");
const universe = require("./api/universe");

const publicDir = path.join(__dirname, "public");
const handlers = {
  "/api/analyze": analyze,
  "/api/screen": screen,
  "/api/universe": universe
};

function responseAdapter(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  };
  return res;
}

http.createServer(async (req, rawRes) => {
  const url = new URL(req.url, "http://localhost");
  const handler = handlers[url.pathname];
  if (handler) {
    req.query = Object.fromEntries(url.searchParams);
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try { req.body = body ? JSON.parse(body) : {}; }
      catch { return responseAdapter(rawRes).status(400).json({ error: "Invalid JSON." }); }
    }
    return handler(req, responseAdapter(rawRes));
  }

  const names = { "/": "index.html", "/app.js": "app.js", "/styles.css": "styles.css", "/audit.css": "audit.css" };
  const name = names[url.pathname];
  if (!name) { rawRes.statusCode = 404; return rawRes.end("Not found"); }
  const type = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html";
  rawRes.setHeader("Content-Type", type);
  fs.createReadStream(path.join(publicDir, name)).pipe(rawRes);
}).listen(process.env.PORT || 3000, () => {
  console.log(`Clear FCF Screener running at http://localhost:${process.env.PORT || 3000}`);
});