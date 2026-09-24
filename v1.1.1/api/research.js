"use strict";

// Deep Research launches the locally installed Codex executable and therefore
// only runs in the desktop/local server. Keep this Vercel function lightweight
// so hosted screening remains deployable without shipping a native executable.
module.exports = function handler(_req, res) {
  return res.status(501).json({ error: "Deep Research is available in the ClearFCF desktop app." });
};
