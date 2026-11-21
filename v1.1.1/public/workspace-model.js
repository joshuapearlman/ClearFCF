"use strict";

(function expose(factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ClearFcfWorkspaceModel = api;
})(function createWorkspaceModel() {
  const VERSION = 1;
  const ticker = (value) => String(value || "").trim().toUpperCase();
  const validTicker = (value) => /^[A-Z0-9.-]{1,12}$/.test(ticker(value));

  function normalize(input) {
    if (input == null) return { version: VERSION, watchlists: [] };
    if (input.version !== VERSION || !Array.isArray(input.watchlists)) throw new Error("Unsupported workspace format.");
    if (input.watchlists.length > 30) throw new Error("Workspace has too many watchlists.");
    const ids = new Set();
    const watchlists = input.watchlists.map((list) => {
      if (!list || typeof list.id !== "string" || !list.id || ids.has(list.id) || typeof list.name !== "string" || !list.name.trim()) {
        throw new Error("A watchlist name or ID is invalid.");
      }
      ids.add(list.id);
      if (!Array.isArray(list.entries) || list.entries.length > 200) throw new Error("A watchlist has too many entries.");
      const seen = new Set();
      const entries = list.entries.map((entry) => {
        const symbol = ticker(entry?.ticker);
        if (!validTicker(symbol) || seen.has(symbol)) throw new Error("A watchlist ticker is invalid or duplicated.");
        seen.add(symbol);
        return {
          ticker: symbol,
          status: ["Watching", "Investigating", "Pass"].includes(entry.status) ? entry.status : "Watching",
          thesis: String(entry.thesis || "").slice(0, 2000),
          risk: String(entry.risk || "").slice(0, 2000),
          lastReviewedAt: typeof entry.lastReviewedAt === "string" ? entry.lastReviewedAt : null,
          alert: { type: ["none", "price-below", "multiple-below", "status-change", "new-period"].includes(entry.alert?.type) ? entry.alert.type : "none",
            threshold: Number.isFinite(Number(entry.alert?.threshold)) && Number(entry.alert?.threshold) > 0 ? Number(entry.alert.threshold) : null }
        };
      });
      const normalizeRun = (run) => run && typeof run === "object" && Array.isArray(run.rows)
        ? { at: typeof run.at === "string" ? run.at : null, criteria: run.criteria && typeof run.criteria === "object" ? run.criteria : {},
          rows: run.rows.filter((row) => validTicker(row?.ticker)).slice(0, 200),
          failures: Array.isArray(run.failures) ? run.failures.filter((failure) => validTicker(failure?.ticker)).slice(0, 200).map((failure) => ({ ticker: ticker(failure.ticker), error: String(failure.error || "Analysis failed.").slice(0, 500) })) : [],
          alerts: Array.isArray(run.alerts) ? run.alerts.filter((alert) => validTicker(alert?.ticker)).slice(0, 200).map((alert) => ({ ticker: ticker(alert.ticker), reason: String(alert.reason || "Alert triggered.").slice(0, 500) })) : [] }
        : null;
      return { id: list.id, name: list.name.trim().slice(0, 80), entries,
        createdAt: typeof list.createdAt === "string" ? list.createdAt : null,
        updatedAt: typeof list.updatedAt === "string" ? list.updatedAt : null,
        lastRun: normalizeRun(list.lastRun), previousRun: normalizeRun(list.previousRun) };
    });
    return { version: VERSION, watchlists };
  }

  function addWatchlist(workspace, name, tickers = [], now = new Date().toISOString()) {
    const model = normalize(workspace);
    const cleaned = String(name || "").trim().slice(0, 80);
    if (!cleaned) throw new Error("Enter a watchlist name.");
    if (model.watchlists.length >= 30) throw new Error("The workspace already has 30 watchlists.");
    const id = `${Date.parse(now) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entries = [...new Set(tickers.map(ticker).filter(validTicker))].slice(0, 200)
      .map((symbol) => ({ ticker: symbol, status: "Watching", thesis: "", risk: "", lastReviewedAt: null, alert: { type: "none", threshold: null } }));
    model.watchlists.unshift({ id, name: cleaned, entries, createdAt: now, updatedAt: now, lastRun: null, previousRun: null });
    return { workspace: model, id };
  }

  function addTickers(list, tickers, now = new Date().toISOString()) {
    const seen = new Set(list.entries.map((entry) => entry.ticker));
    for (const symbol of tickers.map(ticker).filter(validTicker)) {
      if (!seen.has(symbol)) {
        if (list.entries.length >= 200) throw new Error("A watchlist can hold up to 200 tickers.");
        list.entries.push({ ticker: symbol, status: "Watching", thesis: "", risk: "", lastReviewedAt: null, alert: { type: "none", threshold: null } });
        seen.add(symbol);
      }
    }
    list.updatedAt = now;
    return list;
  }

  function recordRun(list, rows, criteria, failures = [], now = new Date().toISOString()) {
    const allowed = new Set(list.entries.map((entry) => entry.ticker));
    const nextRows = rows.filter((row) => allowed.has(ticker(row?.ticker)));
    const previous = list.lastRun;
    const alerts = list.entries.map((entry) => {
      const currentRow = nextRows.find((row) => row.ticker === entry.ticker);
      const previousRow = previous?.rows.find((row) => row.ticker === entry.ticker);
      const reason = alertFor(entry, currentRow, previousRow);
      return reason ? { ticker: entry.ticker, reason } : null;
    }).filter(Boolean);
    list.previousRun = previous;
    list.lastRun = { at: now, criteria: { ...criteria }, rows: nextRows,
      failures: failures.filter((failure) => allowed.has(ticker(failure?.ticker))), alerts };
    list.updatedAt = now;
    return list;
  }

  function alertFor(entry, current, previous) {
    if (!current) return null;
    const rule = entry.alert || {};
    const threshold = Number(rule.threshold);
    if (rule.type === "price-below" && threshold > 0 && typeof current.price === "number" && current.price < threshold
      && !(typeof previous?.price === "number" && previous.price < threshold)) return `Price fell below ${threshold.toFixed(2)} (now ${current.price.toFixed(2)}).`;
    if (rule.type === "multiple-below" && threshold > 0 && typeof current.priceToNfcf === "number" && current.priceToNfcf < threshold
      && !(typeof previous?.priceToNfcf === "number" && previous.priceToNfcf < threshold)) return `P/nFCF fell below ${threshold.toFixed(1)}x (now ${current.priceToNfcf.toFixed(1)}x).`;
    if (rule.type === "status-change" && previous && current.status !== previous.status) return `Screening status changed from ${previous.status} to ${current.status}.`;
    if (rule.type === "new-period" && previous && current.financialPeriodEnd !== previous.financialPeriodEnd) return `Financial period changed from ${previous.financialPeriodEnd || "unavailable"} to ${current.financialPeriodEnd || "unavailable"}.`;
    return null;
  }

  function changeFor(list, symbol) {
    const current = list.lastRun?.rows.find((row) => row.ticker === symbol);
    const previous = list.previousRun?.rows.find((row) => row.ticker === symbol);
    if (!current || !previous) return null;
    return {
      pricePercent: typeof current.price === "number" && typeof previous.price === "number" && previous.price > 0
        ? current.price / previous.price - 1 : null,
      multipleChange: typeof current.priceToNfcf === "number" && typeof previous.priceToNfcf === "number"
        ? current.priceToNfcf - previous.priceToNfcf : null,
      status: current.status !== previous.status ? `${previous.status} → ${current.status}` : null,
      financialPeriodChanged: current.financialPeriodEnd !== previous.financialPeriodEnd
    };
  }

  function validateBackup(input) {
    if (!input || input.format !== "clearfcf-workspace" || ![0, VERSION].includes(input.version)) throw new Error("Unsupported ClearFCF backup version.");
    if (input.version === VERSION && (!input.workspace || !Array.isArray(input.workspace.watchlists))) throw new Error("Backup workspace is missing.");
    const workspace = input.version === 0
      ? normalize({ version: VERSION, watchlists: (input.watchlists || []).map((list) => ({ ...list, entries: list.entries || (list.tickers || []).map((symbol) => ({ ticker: symbol })) })) })
      : normalize(input.workspace);
    if (input.scan != null && (!Array.isArray(input.scan.symbols) || input.scan.symbols.length > 20_000 || !input.scan.symbols.every(validTicker))) throw new Error("Backup scan is invalid.");
    if (input.researchReports != null && (typeof input.researchReports !== "object" || Array.isArray(input.researchReports) || Object.keys(input.researchReports).length > 100)) throw new Error("Backup research is invalid.");
    if (input.dcfModels != null && (typeof input.dcfModels !== "object" || Array.isArray(input.dcfModels) || Object.keys(input.dcfModels).length > 200 || Object.keys(input.dcfModels).some((key) => !key.startsWith("clearfcf-financial-analysis-v2:")))) throw new Error("Backup models are invalid.");
    if (input.dcfDefaults != null && (typeof input.dcfDefaults !== "object" || Array.isArray(input.dcfDefaults))) throw new Error("Backup DCF defaults are invalid.");
    return { format: "clearfcf-workspace", version: VERSION, exportedAt: input.exportedAt || null, workspace, scan: input.scan || null,
      researchReports: input.researchReports || {}, dcfModels: input.dcfModels || {}, dcfDefaults: input.dcfDefaults || null };
  }

  function merge(current, imported) {
    const existing = normalize(current);
    const incoming = normalize(imported);
    const ids = new Set(existing.watchlists.map((list) => list.id));
    for (const list of incoming.watchlists) {
      if (existing.watchlists.length >= 30) throw new Error("Merged workspace would exceed 30 watchlists.");
      const copy = { ...list };
      if (ids.has(copy.id)) copy.id = `${copy.id}-imported-${Math.random().toString(36).slice(2, 7)}`;
      ids.add(copy.id);
      existing.watchlists.push(copy);
    }
    return existing;
  }

  return { VERSION, normalize, addWatchlist, addTickers, recordRun, changeFor, alertFor, validateBackup, merge, validTicker };
});
