"use strict";

const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  console.error("Mac packages must be built on macOS.");
  process.exit(1);
}

try {
  const codexRoot = path.dirname(require.resolve("@openai/codex/package.json"));
  for (const [arch, triple] of [["arm64", "aarch64-apple-darwin"], ["x64", "x86_64-apple-darwin"]]) {
    const packageFile = require.resolve(`@openai/codex-darwin-${arch}/package.json`, { paths: [codexRoot] });
    const executable = path.join(path.dirname(packageFile), "vendor", triple, "bin", "codex");
    if (!fs.statSync(executable).isFile()) throw new Error(`${arch} Codex executable is missing.`);
  }
} catch (error) {
  console.error(`Both Mac Codex executables are required for a dual-architecture build: ${error.message}`);
  console.error("Install with supportedArchitectures set to darwin and both arm64 and x64 CPUs, then build again.");
  process.exit(1);
}
