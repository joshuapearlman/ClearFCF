"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const crypto = require("node:crypto");
const http = require("node:http");
const fsp = require("node:fs/promises");
const path = require("node:path");

const server = require("./desktop-server");

let mainWindow;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function localServerPort() {
  const hash = crypto.createHash("sha256").update(app.getPath("userData")).digest();
  return 40000 + (hash.readUInt16BE(0) % 20000);
}

ipcMain.handle("clearfcf:save-report-pdf", async (event, options = {}) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("PDF export is unavailable for this window.");
  }
  const ticker = String(options.ticker || "stock").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 16) || "stock";
  const defaultPath = path.join(app.getPath("documents"), `ClearFCF-${ticker}-${new Date().toISOString().slice(0, 10)}.pdf`);
  const selection = await dialog.showSaveDialog(mainWindow, {
    title: "Save ClearFCF report as PDF",
    defaultPath,
    filters: [{ name: "PDF documents", extensions: ["pdf"] }]
  });
  if (selection.canceled || !selection.filePath) return { saved: false };

  const pdf = await event.sender.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    pageSize: "A4",
    margins: { top: 0.4, bottom: 0.45, left: 0.4, right: 0.4 }
  });
  await fsp.writeFile(selection.filePath, pdf);
  return { saved: true, filePath: selection.filePath };
});

function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error("ClearFCF local server did not start in time."));
          return;
        }
        setTimeout(check, 250);
      });

      req.setTimeout(1000, () => {
        req.destroy();
      });
    };

    check();
  });
}

async function createWindow() {
  // A stable origin keeps IndexedDB and localStorage available across Mac app launches.
  const preferredPort = app.isPackaged ? localServerPort() : Number(process.env.PORT) || 0;

  try {
    const appServer = await server.start(preferredPort, { openExternal: (targetUrl) => shell.openExternal(targetUrl) });
    const address = appServer.address();
    const port = typeof address === "object" && address ? address.port : preferredPort;
    const url = `http://127.0.0.1:${port}`;
    await waitForServer(url);

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 980,
      minHeight: 700,
      title: "ClearFCF",
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      try {
        const parsed = new URL(targetUrl);
        const appUrl = new URL(mainWindow.webContents.getURL());
        if (parsed.origin === appUrl.origin && parsed.pathname === "/financial-analysis") {
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              width: 1440,
              height: 900,
              minWidth: 980,
              minHeight: 700,
              title: "ClearFCF Financial Deep Analysis",
              backgroundColor: "#f4f1ea",
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
              }
            }
          };
        }
        if (parsed.protocol === "https:") shell.openExternal(targetUrl);
      } catch {}
      return { action: "deny" };
    });

    await mainWindow.loadURL(url);
  } catch (error) {
    dialog.showErrorBox("ClearFCF could not start", error.message);
    app.quit();
  }
}

if (hasSingleInstanceLock) app.whenReady().then(createWindow);
else app.quit();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  server.stop();
});
