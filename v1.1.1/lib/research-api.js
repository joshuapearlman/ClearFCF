"use strict";

const path = require("node:path");
const os = require("node:os");
const { CodexResearchService } = require("./research");

const packaged = __dirname.includes(`${path.sep}app.asar${path.sep}`);
const workspaceRoot = packaged ? os.tmpdir() : path.resolve(__dirname, "..");
const service = new CodexResearchService({ workspaceRoot });

async function handler(req, res) {
  const action = String(req.query?.action || "status").toLowerCase();
  try {
    if (req.method === "GET" && action === "status") {
      return res.status(200).json(await service.status(req.query?.force === "1"));
    }
    if (req.method === "POST" && action === "login") {
      return res.status(202).json(await service.login());
    }
    if (req.method === "POST" && action === "start") {
      return res.status(202).json(service.start(req.body?.report, {
        model: req.body?.model,
        effort: req.body?.effort
      }));
    }
    if (req.method === "GET" && action === "job") {
      const job = service.get(String(req.query?.id || ""));
      return job ? res.status(200).json(job) : res.status(404).json({ error: "Research job not found." });
    }
    if (req.method === "POST" && action === "cancel") {
      const job = service.cancel(String(req.body?.id || ""));
      return job ? res.status(200).json(job) : res.status(404).json({ error: "Research job not found." });
    }
    return res.status(405).json({ error: "Unsupported research action." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Research request failed." });
  }
}

handler.service = service;
module.exports = handler;
