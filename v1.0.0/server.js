"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const analyze = require("./api/analyze");
const screen = require("./api/screen");
const universe = require("./api/universe");

function resolvePublicDir() {
  const candidates = [
    path.join(__dirname, "public"),
    path.join(process.cwd(), "public"),
    path.join(__dirname, "v1.0.0", "public"),
    path.join(process.cwd(), "v1.0.0", "public")
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(__dirname, "public");
}

const publicDir = resolvePublicDir();
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

function createAppServer() {
  return http.createServer(async (req, rawRes) => {
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

    const names = {
    "/": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
    "/audit.css": "audit.css",
    "/favicon.ico": "favicon.ico",
    "/favicon.png": "favicon.png",
    "/favicon-16.png": "favicon-16.png",
    "/favicon-32.png": "favicon-32.png",
    "/apple-touch-icon.png": "apple-touch-icon.png",
    "/logo.png": "logo.png",
    "/logo-trimmed.png": "logo-trimmed.png",
    "/icon-mark.png": "icon-mark.png"
  };
  const name = names[url.pathname];
  if (!name) { rawRes.statusCode = 404; return rawRes.end("Not found"); }

  const filePath = path.join(publicDir, name);
  if (!fs.existsSync(filePath)) {
    rawRes.statusCode = 404;
    return rawRes.end("Not found: " + name);
  }

  const type = name.endsWith(".css") ? "text/css"
    : name.endsWith(".js") ? "text/javascript"
    : name.endsWith(".svg") ? "image/svg+xml"
    : name.endsWith(".png") ? "image/png"
    : name.endsWith(".ico") ? "image/x-icon"
    : "text/html";
  rawRes.setHeader("Content-Type", type);
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    rawRes.statusCode = 500;
    rawRes.end("Internal error loading asset");
  });
  stream.pipe(rawRes);
  });
}

let activeServer = null;

function start(port = process.env.PORT || 3000) {
  if (activeServer) return Promise.resolve(activeServer);

  return new Promise((resolve, reject) => {
    const server = createAppServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      activeServer = server;
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : port;
      console.log(`Clear FCF Screener running at http://127.0.0.1:${activePort}`);
      resolve(server);
    });
  });
}

function stop() {
  if (!activeServer) return;
  activeServer.close();
  activeServer = null;
}

if (require.main === module) {
  start();
}

module.exports = { createAppServer, start, stop };
