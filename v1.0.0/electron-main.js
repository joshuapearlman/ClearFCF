"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("node:http");

const server = require("./desktop-server");

let mainWindow;

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
  const preferredPort = Number(process.env.PORT) || 0;

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
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      let safe = false;
      try {
        const parsed = new URL(targetUrl);
        safe = parsed.protocol === "https:";
      } catch {}
      if (safe) shell.openExternal(targetUrl);
      return { action: "deny" };
    });

    await mainWindow.loadURL(url);
    checkForUpdates();
  } catch (error) {
    dialog.showErrorBox("ClearFCF could not start", error.message);
    app.quit();
  }
}

function checkForUpdates() {
  if (!app.isPackaged || process.env.CLEARFCF_DISABLE_UPDATES === "1") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.warn("ClearFCF update check failed:", error.message);
  });

  autoUpdater.on("update-downloaded", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "ClearFCF update ready",
      message: "A new version of ClearFCF has been downloaded.",
      detail: "Restart the app to finish syncing to the latest version."
    });

    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.warn("ClearFCF update check failed:", error.message);
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  server.stop();
});
