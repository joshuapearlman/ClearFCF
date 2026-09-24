"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clearFcfDesktop", {
  saveReportPdf: (options) => ipcRenderer.invoke("clearfcf:save-report-pdf", options)
});
