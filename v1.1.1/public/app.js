"use strict";

const $ = (selector) => document.querySelector(selector);
const screening = window.ClearFcfScreening;
const scanState = window.ClearFcfScanState;
const workspaceStorage = window.ClearFcfStorage;
const workspaceModel = window.ClearFcfWorkspaceModel;

if (!screening?.evaluateCandidate || !scanState?.applyBatch || !workspaceStorage?.set || !workspaceModel?.normalize) {
  throw new Error("ClearFCF screening module failed to load. Refresh the page to load the latest application files.");
}

const MC_LEVELS = [0, 250e6, 500e6, 1e9, 2e9, 5e9, 10e9, 50e9, 100e9, 500e9];
const MC_LEVEL_LABELS = ["$0 (All)", "$250M", "$500M", "$1B", "$2B", "$5B", "$10B", "$50B", "$100B", "$500B"];

const MAX_MC_LEVELS = [1e9, 2e9, 5e9, 10e9, 50e9, 200e9, 500e9, 1e12, Infinity];
const MAX_MC_LEVEL_LABELS = ["$1B", "$2B", "$5B", "$10B", "$50B", "$200B", "$500B", "$1T", "Any ($5T+)"];

const PRESETS = {
  default: {
    name: "Default",
    maxMultiple: 15,
    maxEvMultiple: 20,
    minYears: 5,
    maxDebt: 4.0,
    maxSbc: 0.30,
    maxDilution: 0.25,
    minPosFcf: 0.67,
    minMarketCap: 0,
    maxMarketCap: Infinity,
    enforceSolvency: true,
    excludeFinancials: true,
    requireCompleteData: true,
    requireMarginAgreement: true,
    lookbackYears: "all"
  },
  compounder: {
    name: "Quality Compounder",
    maxMultiple: 60,
    maxEvMultiple: 65,
    minYears: 3,
    maxDebt: 6.0,
    maxSbc: 0.40,
    maxDilution: 0.35,
    minPosFcf: 0.67,
    minMarketCap: 0,
    maxMarketCap: Infinity,
    enforceSolvency: false,
    excludeFinancials: true,
    requireCompleteData: true,
    requireMarginAgreement: true,
    lookbackYears: "all"
  },
  "deep-value": {
    name: "Deep Value",
    maxMultiple: 10,
    maxEvMultiple: 12,
    minYears: 6,
    maxDebt: 1.5,
    maxSbc: 0.15,
    maxDilution: 0.10,
    minPosFcf: 0.75,
    minMarketCap: 0,
    maxMarketCap: Infinity,
    enforceSolvency: true,
    excludeFinancials: true,
    requireCompleteData: true,
    requireMarginAgreement: true,
    lookbackYears: "all"
  }
};

const DEFAULT_VISIBLE_COLUMNS = ["ticker", "status", "price", "marketCap", "priceToNfcf", "fcfYield", "dividendYield", "insiderSignal", "usableYears"];
const COLUMN_STORAGE_KEY = "clear-fcf-visible-columns-v1";

const state = {
  auto: null,
  reports: {},
  workspace: workspaceModel.normalize(null),
  activeWatchlistId: null,
  researchReports: {},
  researchJobs: {},
  researchSettings: { model: "gpt-5.6-sol", effort: "high" },
  stopped: false,
  activeFilters: new Set(),
  displayFilters: {
    maxNetDebt: 0,
    maxSbcPercent: 15,
    maxShareChangePercent: 0,
    maxMultiple: 10,
    minDividendYieldPercent: 2
  },
  sortKey: 'priceToNfcf',
  sortAsc: true,
  visibleColumns: new Set(DEFAULT_VISIBLE_COLUMNS),
  activePreset: "default",
  criteria: { ...PRESETS.default }
};

function evaluateReportStatus(row, crit) {
  return screening.evaluateCandidate(row, crit).status;
}

function decisionText(row, evaluation) {
  const selected = evaluation?.selected || screening.selectedMetrics(row, state.criteria);
  const parts = [];
  if (typeof selected.priceToNfcf === "number") parts.push(`${selected.priceToNfcf.toFixed(1)}x normalized FCF`);
  const netDebt = row.netDebtToNfcf ?? row.valuation?.netDebtToNfcf;
  if (typeof netDebt === "number" && netDebt < 0) parts.push("net cash");
  const dividendYield = row.dividendYield ?? row.dividends?.currentYield;
  if (typeof dividendYield === "number" && dividendYield > 0) parts.push(`${(dividendYield * 100).toFixed(1)}% dividend yield`);
  const positiveRatio = row.positiveFcfRatio ?? row.quality?.positiveFcfRatio;
  if (typeof positiveRatio === "number") parts.push(`positive FCF in ${Math.round(positiveRatio * 100)}% of years`);
  if (row.insiderClusterBuying || row.insiders?.clusterBuying) parts.push("cluster insider buying");
  else if (row.insiderBuying || row.insiders?.hasQualifiedBuying) parts.push("recent insider buying");
  const reason = evaluation?.exclusions?.[0] || evaluation?.failures?.[0] || evaluation?.unknowns?.[0] || "all active qualification checks passed";
  const status = evaluation?.status || row.status;
  const summary = `${status}: ${parts.slice(0, 4).join(", ") || reason}.`;
  const reasons = evaluation?.reasons || [];
  return status === "Idea" || !reasons.length ? summary : `${summary} Why not Idea: ${reasons.join("; ")}.`;
}

const STORAGE_KEY = "clear-fcf-auto-v4";
const PERFORMANCE_KEY = "clear-fcf-performance-v1";
const RESEARCH_STORAGE_KEY = "clear-fcf-deep-research-v1";
const RESEARCH_SETTINGS_KEY = "clear-fcf-research-settings-v1";
const WORKSPACE_KEY = "clearfcf-research-workspace-v1";
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const RESEARCH_MODELS = [
  ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ["gpt-5.6-luna", "GPT-5.6 Luna"],
  ["gpt-5.5", "GPT-5.5"]
];
const RESEARCH_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const DEFAULT_PERFORMANCE = { workers: 1, pacingMs: 250, frontendPauseMs: 400, batchSize: 8 };
const PERFORMANCE_FIELDS = {
  workers: { selector: "#scan-workers", min: 1, max: 8 },
  pacingMs: { selector: "#scan-pacing", min: 0, max: 5000 },
  frontendPauseMs: { selector: "#scan-frontend-pause", min: 0, max: 10000 },
  batchSize: { selector: "#scan-batch-size", min: 1, max: 25 }
};

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readPerformanceSettings(normalizeInputs = false) {
  const settings = {};
  for (const [key, config] of Object.entries(PERFORMANCE_FIELDS)) {
    const input = $(config.selector);
    settings[key] = clampInteger(input?.value, DEFAULT_PERFORMANCE[key], config.min, config.max);
    if (normalizeInputs && input) input.value = String(settings[key]);
  }
  try { localStorage.setItem(PERFORMANCE_KEY, JSON.stringify(settings)); } catch {}
  return settings;
}

function initPerformanceSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PERFORMANCE_KEY)) || {}; } catch {}
  for (const [key, config] of Object.entries(PERFORMANCE_FIELDS)) {
    const input = $(config.selector);
    if (!input) continue;
    input.value = String(clampInteger(saved[key], DEFAULT_PERFORMANCE[key], config.min, config.max));
    input.addEventListener("input", () => readPerformanceSettings(false));
    input.addEventListener("change", () => readPerformanceSettings(true));
  }
}

initPerformanceSettings();

function applyPerformanceSettings(settings) {
  for (const [key, config] of Object.entries(PERFORMANCE_FIELDS)) {
    const input = $(config.selector);
    if (input) input.value = String(settings[key]);
  }
  return readPerformanceSettings(true);
}

function openSettings() {
  const modal = $("#settings-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  $("#settings-button")?.setAttribute("aria-expanded", "true");
  $("#scan-workers")?.focus();
}

function closeSettings() {
  readPerformanceSettings(true);
  $("#settings-modal")?.classList.add("hidden");
  $("#settings-button")?.setAttribute("aria-expanded", "false");
  $("#settings-button")?.focus();
}

$("#settings-button")?.setAttribute("aria-expanded", "false");
$("#settings-button")?.addEventListener("click", openSettings);
$("#settings-backdrop")?.addEventListener("click", closeSettings);
$("#settings-close-button")?.addEventListener("click", closeSettings);
$("#settings-done-button")?.addEventListener("click", closeSettings);
$("#default-speed-button")?.addEventListener("click", () => {
  applyPerformanceSettings(DEFAULT_PERFORMANCE);
  setStatus("Default scan speed restored: 1 worker, 250ms pacing, 400ms pause, batch size 8.");
});
window.addEventListener("keydown", (event) => {
  const modal = document.querySelector(".modal:not(.hidden)");
  if (!modal) return;
  if (event.key === "Escape" && modal.id === "settings-modal") {
    closeSettings();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...modal.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && !element.closest(".hidden"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function loadVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY));
    if (Array.isArray(saved) && saved.includes("ticker")) state.visibleColumns = new Set(saved);
  } catch {}
}

function saveVisibleColumns() {
  try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...state.visibleColumns])); } catch {}
}

loadVisibleColumns();
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

async function loadSavedResearch() {
  try {
    const saved = await workspaceStorage.get(RESEARCH_STORAGE_KEY);
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      state.researchReports = { ...saved, ...state.researchReports };
      const ticker = $("#single-ticker")?.value.trim().toUpperCase();
      if (ticker) updateResearchPanel(ticker);
    }
  } catch (error) {
    setStatus(`Saved AI research could not be loaded: ${error.message}`, true);
  }
}

function loadResearchSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(RESEARCH_SETTINGS_KEY)) || {};
    if (RESEARCH_MODELS.some(([id]) => id === saved.model)) state.researchSettings.model = saved.model;
    if (RESEARCH_EFFORTS.includes(saved.effort)) state.researchSettings.effort = saved.effort;
  } catch {}
}

function saveResearchSettings() {
  try { localStorage.setItem(RESEARCH_SETTINGS_KEY, JSON.stringify(state.researchSettings)); } catch {}
}

let researchWriteQueue = Promise.resolve();
async function saveResearchReport(ticker, report) {
  state.researchReports[ticker] = report;
  const entries = Object.entries(state.researchReports)
    .sort((a, b) => String(b[1]?.generatedAt || "").localeCompare(String(a[1]?.generatedAt || "")))
    .slice(0, 10);
  state.researchReports = Object.fromEntries(entries);
  const snapshot = { ...state.researchReports };
  researchWriteQueue = researchWriteQueue.catch(() => {}).then(() => workspaceStorage.set(RESEARCH_STORAGE_KEY, snapshot));
  try { await researchWriteQueue; return true; }
  catch (error) {
    setStatus(`AI research could not be saved: ${error.message}`, true);
    return false;
  }
}

void loadSavedResearch();
loadResearchSettings();

function setStatus(message, error = false) {
  const el = $("#status");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", error);
  el.classList.remove("status-update");
  void el.offsetWidth;
  el.classList.add("status-update");
}

function hideStatus() {
  const el = $("#status");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("error", "status-update");
}

function parseTickers(input) {
  return [...new Set(String(input || "").split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function compact(value, currency = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1e6 ? "compact" : "standard",
    maximumFractionDigits: 2,
    style: currency ? "currency" : "decimal",
    currency: "USD"
  });
  return formatter.format(value);
}

function multiple(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}x` : "—";
}

function percent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "Calculating…";
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function initialIdeaEmptyHtml() {
  return `<div class="empty-state">
    <div class="empty-mark" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="kicker">Your research queue starts here</p>
    <h3>Find durable cash flow at a sensible price</h3>
    <p>Choose a universe and start a scan. ClearFCF will evaluate each company, preserve the evidence, and surface only the candidates that pass your criteria.</p>
    <div class="example-result" aria-label="Example result">
      <span class="ticker">EXAMPLE</span><span class="badge idea">Idea</span><span><small>P/nFCF</small> 11.8x</span><span><small>FCF yield</small> 8.5%</span>
    </div>
  </div>`;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function switchView(viewId) {
  document.querySelectorAll(".nav-button").forEach((item) => {
    const active = item.dataset.view === viewId;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  hideStatus();
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});
document.querySelector('.nav-button[data-view="ideas"]')?.setAttribute("aria-current", "page");

const RESULT_COLUMNS = [
  { key: "ticker", label: "Company", className: "col-company" },
  { key: "status", label: "Status", className: "col-status" },
  { key: "price", label: "Price" },
  { key: "marketCap", label: "Market cap" },
  { key: "priceToNfcf", label: "P/nFCF" },
  { key: "priceToEconomicNfcf", label: "P/Econ nFCF" },
  { key: "evToUnleveredNfcf", label: "EV/Unlevered" },
  { key: "fcfYield", label: "FCF yield" },
  { key: "dividendYield", label: "Dividend yield" },
  { key: "fiveYearDividendYield", label: "5Y div. avg" },
  { key: "shareholderYield", label: "Shareholder yield" },
  { key: "insiderSignal", label: "Insiders" },
  { key: "economicFcfYield", label: "Econ yield" },
  { key: "fcfTrajectory", label: "FCF trend" },
  { key: "buybackRating", label: "Buyback audit" },
  { key: "capexToDnaRatio", label: "CapEx/D&A" },
  { key: "usableYears", label: "History" },
  { key: "netDebtToNfcf", label: "Net debt/nFCF" },
  { key: "normalizedSbcToFcf", label: "3Y SBC/FCF" }
];

function companyCell(row) {
  return `<div class="company-cell-actions"><label title="Select ${escapeHtml(row.ticker)} for comparison"><input type="checkbox" data-compare-ticker="${escapeHtml(row.ticker)}" aria-label="Compare ${escapeHtml(row.ticker)}"></label><button type="button" class="company-link" data-open-report="${escapeHtml(row.ticker)}" aria-label="Open ${escapeHtml(row.ticker)} company report">
    <span class="ticker">${escapeHtml(row.ticker)}</span>
    <span class="subname">${escapeHtml(row.companyName)}</span>
    ${row.netDebtToNfcf !== null && row.netDebtToNfcf < 0 ? '<span class="badge badge-netcash">Net Cash</span>' : ''}
    ${row.fcfTrajectory === 'Expanding' ? '<span class="badge badge-green">Expanding</span>' : ''}
    ${row.insiderBuying ? '<span class="badge badge-green">Insider Buying</span>' : ''}
    <span class="result-summary ${row.status === "Idea" ? "" : "not-qualified"}">${escapeHtml(row.status === "Idea" ? (row.decisionSummary || "Qualified as an Idea") : `Why not Idea: ${row.nonQualificationReason || row.primaryReason || "See screening details"}`)}</span>
  </button><button type="button" class="save-row-button" data-save-to-list="${escapeHtml(row.ticker)}" title="Add ${escapeHtml(row.ticker)} to current watchlist" aria-label="Add ${escapeHtml(row.ticker)} to current watchlist">＋</button></div>`;
}

function resultCell(row, key) {
  const cells = {
    ticker: () => companyCell(row),
    status: () => `<span class="badge ${String(row.status).toLowerCase()}">${escapeHtml(row.status)}</span>`,
    price: () => `${compact(row.price, true)}<small class="cell-note">${row.marketDataAsOf ? `Price as of ${escapeHtml(new Date(row.marketDataAsOf).toLocaleString())} · ${escapeHtml(screening.marketDataFreshness(row.marketDataAsOf))}` : "Price date unavailable"}${row.priceSource ? ` · ${escapeHtml(row.priceSource)}` : ""}</small>`,
    marketCap: () => compact(row.marketCap, true),
    priceToNfcf: () => multiple(row.priceToNfcf),
    priceToEconomicNfcf: () => multiple(row.priceToEconomicNfcf),
    evToUnleveredNfcf: () => multiple(row.evToUnleveredNfcf),
    fcfYield: () => percent(row.fcfYield),
    dividendYield: () => `${percent(row.dividendYield)}${row.dividendCoverage && row.dividendCoverage !== 'No dividend' ? `<small class="cell-note">${escapeHtml(row.dividendCoverage)}</small>` : ''}`,
    fiveYearDividendYield: () => percent(row.fiveYearDividendYield),
    shareholderYield: () => percent(row.shareholderYield),
    insiderSignal: () => `<span class="badge ${row.insiderValueAligned ? 'badge-blue' : row.insiderBuying ? 'badge-green' : ''}">${escapeHtml(row.insiderSignal || 'Unavailable')}</span>${row.latestInsiderPurchaseDate ? `<small class="cell-note">Latest ${escapeHtml(row.latestInsiderPurchaseDate)}</small>` : ''}`,
    economicFcfYield: () => percent(row.economicFcfYield),
    fcfTrajectory: () => `<span class="badge ${row.fcfTrajectory === 'Expanding' ? 'badge-green' : row.fcfTrajectory === 'Deteriorating' ? 'badge-amber' : ''}">${escapeHtml(row.fcfTrajectory || 'Stable')}</span>`,
    buybackRating: () => `<span class="badge ${row.buybackRating === 'Unreliable' ? 'badge-amber' : ''}" title="${escapeHtml(row.buybackAuditReason || '')}">${escapeHtml(row.buybackRating || 'N/A')}</span>`,
    capexToDnaRatio: () => row.capexToDnaRatio ? `${(row.capexToDnaRatio * 100).toFixed(0)}%` : "—",
    usableYears: () => `${escapeHtml(row.usableYears)} yrs`,
    netDebtToNfcf: () => multiple(row.netDebtToNfcf),
    normalizedSbcToFcf: () => percent(row.normalizedSbcToFcf ?? row.latestSbcToFcf)
  };
  return cells[key]?.() || "—";
}

function columnPickerHtml() {
  return `<details class="column-picker">
    <summary>Columns <span>${state.visibleColumns.size}</span></summary>
    <div class="column-menu" role="group" aria-label="Visible result columns">
      ${RESULT_COLUMNS.map((column) => `<label><input type="checkbox" data-column-toggle="${column.key}" aria-label="Show ${column.label} column" ${state.visibleColumns.has(column.key) ? "checked" : ""} ${column.key === "ticker" ? "disabled" : ""}> ${column.label}</label>`).join("")}
      <button type="button" class="text-link" data-reset-columns aria-label="Restore default result columns">Restore defaults</button>
    </div>
  </details>`;
}

function tableHtml(results, title, statusFilter = "All", counts = {}, compareCount = 0) {
  const tabs = `<div class="status-tabs" role="tablist" aria-label="Result status">
    ${["All", "Idea", "Review", "Excluded"].map((status) => `<button type="button" role="tab" aria-selected="${statusFilter === status}" tabindex="${statusFilter === status ? "0" : "-1"}" class="status-tab ${statusFilter === status ? "active" : ""}" data-status-filter="${status}">${status} <span>${counts[status] || 0}</span></button>`).join("")}
  </div>`;
  const tools = `<div class="results-tools">${tabs}${columnPickerHtml()}<button class="compare-button secondary" type="button" ${compareCount < 2 ? "disabled" : ""}>Compare ${compareCount || ""}</button><button class="export" type="button">Export CSV</button></div>`;
  if (!results.length) return `<div class="results-shell">
    <div class="results-head"><h2>${escapeHtml(title)} <small>(${counts.All || 0})</small></h2>${tools}</div>
    <div class="empty-state compact-empty filtered-empty" role="tabpanel" tabindex="0">
      <div class="empty-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <h3>No companies match this view</h3>
      <p>Choose another status tab, clear a display filter, or widen the qualification criteria.</p>
    </div>
  </div>`;
  const columns = RESULT_COLUMNS.filter((column) => state.visibleColumns.has(column.key));
  return `<div class="results-shell">
    <div class="results-head"><h2>${escapeHtml(title)} <small>(${results.length})</small></h2>${tools}</div>
    <div class="table-scroll" role="tabpanel" tabindex="0">
      <table><thead><tr>${columns.map((column) => {
        const sorted = state.sortKey === column.key;
        return `<th scope="col" class="sortable ${column.className || ""} ${sorted ? (state.sortAsc ? "sorted-asc" : "sorted-desc") : ""}" aria-sort="${sorted ? (state.sortAsc ? "ascending" : "descending") : "none"}"><button type="button" class="sort-button" data-sort="${column.key}">${column.label}<span aria-hidden="true"></span></button></th>`;
      }).join("")}</tr></thead>
      <tbody>${results.map((row) => `<tr>${columns.map((column) => `<td class="${column.className || ""}">${resultCell(row, column.key)}</td>`).join("")}</tr>`).join("")}</tbody></table>
    </div>
  </div>`;
}

function attachTableEvents(container, results) {
  container.querySelectorAll("[data-open-report]").forEach((button) => button.addEventListener("click", () => openReport(button.dataset.openReport)));
  container.querySelectorAll("[data-save-to-list]").forEach((button) => button.addEventListener("click", () => void addTickerToCurrentList(button.dataset.saveToList)));
  container.querySelectorAll("[data-compare-ticker]").forEach((input) => {
    input.checked = container._compareSelected?.has(input.dataset.compareTicker) || false;
    input.addEventListener("change", () => {
      container._compareSelected ||= new Set();
      if (input.checked && container._compareSelected.size >= 5) {
        input.checked = false;
        return setStatus("Compare up to five companies at a time.", true);
      }
      if (input.checked) container._compareSelected.add(input.dataset.compareTicker);
      else container._compareSelected.delete(input.dataset.compareTicker);
      const button = container.querySelector(".compare-button");
      button.disabled = container._compareSelected.size < 2;
      button.textContent = `Compare ${container._compareSelected.size || ""}`;
    });
  });
  container.querySelector(".compare-button")?.addEventListener("click", () => openComparison(container));

  container.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
    const sortKey = button.dataset.sort;
    if (state.sortKey === sortKey) state.sortAsc = !state.sortAsc;
    else {
      state.sortKey = sortKey;
      state.sortAsc = true;
    }
    renderTable(container, container._rawResults || results, container._rawTitle || "Results");
  }));

  container.querySelector(".export")?.addEventListener("click", () => exportCsv(applyFilterAndSort(results, container._statusFilter || "All")));
  const statusTabs = [...container.querySelectorAll("[data-status-filter]")];
  statusTabs.forEach((button, index) => {
    button.addEventListener("click", () => {
      container._statusFilter = button.dataset.statusFilter;
      renderTable(container, container._rawResults || results, container._rawTitle || "Results");
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? (index + 1) % statusTabs.length : (index - 1 + statusTabs.length) % statusTabs.length;
      statusTabs[next].focus();
      statusTabs[next].click();
    });
  });

  container.querySelectorAll("[data-column-toggle]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.visibleColumns.add(input.dataset.columnToggle);
    else state.visibleColumns.delete(input.dataset.columnToggle);
    saveVisibleColumns();
    renderTable(container, container._rawResults || results, container._rawTitle || "Results");
  }));
  container.querySelector("[data-reset-columns]")?.addEventListener("click", () => {
    state.visibleColumns = new Set(DEFAULT_VISIBLE_COLUMNS);
    saveVisibleColumns();
    renderTable(container, container._rawResults || results, container._rawTitle || "Results");
  });
}

function applyFilterAndSort(results, statusFilter = "All") {
  let list = [...results];
  const crit = state.criteria;

  // 1. Dynamic Evaluation using User Controlled Criteria
  list = list.map((r) => {
    const evaluation = screening.evaluateCandidate(r, crit);
    return {
      ...r,
      ...evaluation.selected,
      status: evaluation.status,
      evaluation,
      primaryReason: evaluation.exclusions[0] || evaluation.failures[0] || evaluation.unknowns[0] || "All active qualification checks passed",
      nonQualificationReasons: evaluation.reasons || [],
      nonQualificationReason: (evaluation.reasons || []).join("; "),
      decisionSummary: decisionText(r, evaluation),
      passesDefaultIdeaFilter: evaluation.status === "Idea"
    };
  });

  if (statusFilter !== "All") list = list.filter((row) => row.status === statusFilter);

  // 2. Adjustable display filters (never change qualification status)
  if (state.activeFilters.has('net-debt')) {
    list = list.filter((r) => typeof r.netDebtToNfcf === 'number' && r.netDebtToNfcf <= state.displayFilters.maxNetDebt);
  }
  if (state.activeFilters.has('low-sbc')) {
    list = list.filter((r) => typeof (r.normalizedSbcToFcf ?? r.latestSbcToFcf) === 'number' && (r.normalizedSbcToFcf ?? r.latestSbcToFcf) <= state.displayFilters.maxSbcPercent / 100);
  }
  if (state.activeFilters.has('buybacks')) {
    list = list.filter((r) => typeof r.shareChange === 'number' && r.shareChange <= state.displayFilters.maxShareChangePercent / 100);
  }
  if (state.activeFilters.has('multiple')) {
    list = list.filter((r) => typeof r.priceToNfcf === 'number' && r.priceToNfcf <= state.displayFilters.maxMultiple);
  }
  if (state.activeFilters.has('expanding')) {
    list = list.filter((r) => r.fcfTrajectory === 'Expanding');
  }
  if (state.activeFilters.has('insider-buying')) {
    list = list.filter((r) => r.insiderBuying === true);
  }
  if (state.activeFilters.has('dividend')) {
    list = list.filter((r) => typeof r.dividendYield === 'number' && r.dividendYield >= state.displayFilters.minDividendYieldPercent / 100);
  }

  // 3. Column Sorting
  if (state.sortKey) {
    const key = state.sortKey;
    const mult = state.sortAsc ? 1 : -1;
    list.sort((a, b) => {
      const valA = a[key] ?? (state.sortAsc ? Infinity : -Infinity);
      const valB = b[key] ?? (state.sortAsc ? Infinity : -Infinity);
      if (typeof valA === 'string') return mult * valA.localeCompare(valB);
      return mult * (valA - valB);
    });
  }
  return list;
}
function renderTable(container, results, title, defaultStatus = "All") {
  const isFirstRender = !container.querySelector(".results-shell");
  container._rawResults = results;
  container._rawTitle = title;
  if (!container._statusFilter) container._statusFilter = defaultStatus;
  const evaluated = results.map((row) => ({ ...row, status: screening.evaluateCandidate(row, state.criteria).status }));
  const counts = { All: evaluated.length, Idea: 0, Review: 0, Excluded: 0 };
  evaluated.forEach((row) => { if (counts[row.status] !== undefined) counts[row.status] += 1; });
  const filtered = applyFilterAndSort(results, container._statusFilter);
  container.innerHTML = tableHtml(filtered, title, container._statusFilter, counts, container._compareSelected?.size || 0);
  if (isFirstRender) container.querySelector(".results-shell")?.classList.add("reveal");
  attachTableEvents(container, results);
}

function exportCsv(results) {
  const fields = ["ticker", "companyName", "status", "nonQualificationReason", "decisionSummary", "primaryReason", "price", "priceSource", "marketCap", "priceToNfcf", "priceToEconomicNfcf", "evToUnleveredNfcf", "fcfYield", "dividendYield", "fiveYearDividendYield", "dividendPayoutRatio", "dividendGrowth5y", "dividendYearsWithoutCut", "dividendCoverage", "shareholderYield", "buybackCashYield", "sbcYield", "netBuybackYield", "dividendRate", "exDividendDate", "insiderBuying", "insiderPurchaseCount", "insiderNetShares", "insiderAveragePurchasePrice", "insiderClusterBuying", "insiderValueAligned", "insiderSignal", "latestInsiderPurchaseDate", "valuationHistoryContext", "valuationMultiplePercentile", "drawdownFromHigh", "marketDataAsOf", "financialPeriodEnd", "economicFcfYield", "fcfTrajectory", "buybackRating", "buybackAuditReason", "buybackPrice", "capexToDnaRatio", "usableYears", "netDebtToNfcf", "shortDebt", "cash", "shareChange", "shareChangeYears", "shareChangeAnnualized", "normalizedSbcToFcf", "latestSbcToFcf"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.join(","), ...results.map((row) => fields.map((key) => quote(row[key])).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `clear-fcf-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function rowTable(rows) {
  const yearHeading = rows.length && rows.every((row) => row.fiscalYearSource === "SEC filing") ? "Fiscal year" : "Period-end year";
  return `<div class="table-scroll"><table><thead><tr>
    <th>${yearHeading}</th><th>Revenue</th><th>OCF</th><th>CapEx</th><th>Standard FCF</th><th>SBC</th><th>Economic FCF</th><th>D&A</th><th>Share count</th>
  </tr></thead><tbody>${rows.map((row) => `<tr>
    <td title="${escapeHtml([row.periodEnd && (row.fiscalYearSource === "SEC filing" ? `Fiscal ${row.year}, period ended ${row.periodEnd}` : `Period ended ${row.periodEnd}`), ...Object.entries(row.evidence || {}).filter(([, fact]) => fact?.tag).map(([key, fact]) => `${key}: ${fact.taxonomy}:${fact.tag} (${fact.form || "filing"}, filed ${fact.filed || "unknown"})`)].filter(Boolean).join("\n"))}"><strong>${row.year}</strong></td>
    <td>${compact(row.revenue, true)}</td>
    <td>${compact(row.ocf, true)}</td>
    <td>${compact(row.capex, true)}</td>
    <td>${compact(row.fcf, true)}</td>
    <td>${compact(row.sbc, true)}</td>
    <td>${compact(row.fcfEconomic, true)}</td>
    <td>${compact(row.dna, true)}</td>
    <td title="${escapeHtml(row.shareBasis === "period-end outstanding" ? "SEC period-end common shares used because annual diluted weighted-average shares were unavailable" : "Annual diluted weighted-average shares")}">${compact(row.shares)}${row.shareBasis === "period-end outstanding" ? '<small class="cell-note">Period-end fallback</small>' : ""}</td>
  </tr>`).join("")}</tbody></table></div>`;
}

function renderWaterfall(latestRow, normalized) {
  const ocf = latestRow?.ocf || 0;
  const capex = latestRow?.capex || 0;
  const sbc = latestRow?.sbc;
  const econFcf = latestRow?.fcfEconomic;

  if (!ocf || ocf <= 0 || !Number.isFinite(sbc) || !Number.isFinite(econFcf)) return "";

  const capexPct = Math.min(100, Math.max(2, Math.round((capex / ocf) * 100)));
  const sbcPct = Math.min(100, Math.max(2, Math.round((sbc / ocf) * 100)));
  const econPct = Math.max(2, Math.round((econFcf / ocf) * 100));

  return `<div class="report-card report-detail">
    <div class="waterfall-header">
      <div>
        <h3>Visual FCF Waterfall Bridge</h3>
        <p class="muted">Decomposing Operating Cash Flow into Economic Free Cash Flow</p>
      </div>
      <span class="badge ${econFcf > 0 ? 'badge-green' : 'badge-amber'}">${econPct}% FCF Conversion</span>
    </div>
    <div class="waterfall-bar-track">
      <div class="wf-segment wf-econ" style="width:${Math.max(5, econPct)}%" title="Economic FCF: ${compact(econFcf, true)}">
        Econ FCF (${econPct}%)
      </div>
      <div class="wf-segment wf-sbc" style="width:${Math.max(4, sbcPct)}%" title="Stock-Based Comp: -${compact(sbc, true)}">
        SBC (-${sbcPct}%)
      </div>
      <div class="wf-segment wf-capex" style="width:${Math.max(5, capexPct)}%" title="Operational CapEx: -${compact(capex, true)}">
        CapEx (-${capexPct}%)
      </div>
    </div>
    <div class="waterfall-legend">
      <div class="legend-item"><span class="dot dot-ocf"></span> Operating Cash Flow: <strong>${compact(ocf, true)} (100%)</strong></div>
      <div class="legend-item"><span class="dot dot-capex"></span> CapEx (PP&E + Intangibles): <strong>-${compact(capex, true)} (${capexPct}%)</strong></div>
      <div class="legend-item"><span class="dot dot-sbc"></span> Stock-Based Comp: <strong>-${compact(sbc, true)} (${sbcPct}%)</strong></div>
      <div class="legend-item"><span class="dot dot-econ"></span> Economic FCF: <strong>${compact(econFcf, true)} (${econPct}%)</strong></div>
    </div>
  </div>`;
}

function renderReverseDcf(report) {
  const v = report.valuation;
  const selected = screening.selectedMetrics(report, state.criteria);
  const startingFcf = selected.normalizedEconomicFcf;
  if (!v.marketCap || !startingFcf || startingFcf <= 0 || !Number.isFinite(v.netDebt)) return "";

  const hurdle = 0.09;
  const terminalGrowth = 0.025;
  const years = 5;
  function equityValue(growth) {
    let presentValue = 0;
    let cashFlow = startingFcf;
    for (let year = 1; year <= years; year += 1) {
      cashFlow *= 1 + growth;
      presentValue += cashFlow / ((1 + hurdle) ** year);
    }
    const terminalValue = cashFlow * (1 + terminalGrowth) / (hurdle - terminalGrowth);
    return presentValue + terminalValue / ((1 + hurdle) ** years) - v.netDebt;
  }
  let low = -0.50;
  let high = 1.00;
  const target = v.marketCap;
  if (equityValue(low) > target || equityValue(high) < target) return "";
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    if (equityValue(mid) < target) low = mid;
    else high = mid;
  }
  const impliedGrowthRate = (low + high) / 2;
  const impliedGrowth = Math.round(impliedGrowthRate * 1000) / 10;

  return `<div class="report-card report-detail">
    <div class="reverse-dcf-head">
      <div>
        <h3>Reverse DCF & Expectations Investing</h3>
        <p class="muted">What cash flow growth does the current market price require?</p>
      </div>
      <div class="expected-pill">Priced-In Growth: <strong>${impliedGrowth > 0 ? '+' : ''}${impliedGrowth}% / yr</strong></div>
    </div>
    <div class="report-grid">
      <div class="metric">
        <span>Current P/nFCF Multiple</span>
        <strong>${multiple(selected.priceToNfcf)}</strong>
        <small>Selected-lookback Market Cap / nFCF</small>
      </div>
      <div class="metric">
        <span>Assumed Hurdle Rate</span>
        <strong>9.0%</strong>
        <small>2.5% terminal growth; 5-year forecast</small>
      </div>
      <div class="metric">
        <span>Priced-In 5Y Growth</span>
        <strong style="color:${impliedGrowth <= 3 ? 'var(--green)' : impliedGrowth <= 8 ? 'var(--ink)' : 'var(--amber)'}">${impliedGrowth > 0 ? '+' : ''}${impliedGrowth}%</strong>
        <small>${impliedGrowth <= 0 ? 'Market expects contraction (High margin of safety)' : impliedGrowth <= 6 ? 'Modest compound growth' : 'High growth expectation'}</small>
      </div>
      <div class="metric">
        <span>FCF Trajectory</span>
        <strong class="${report.quality.fcfTrajectory === 'Expanding' ? 'badge-green' : report.quality.fcfTrajectory === 'Deteriorating' ? 'badge-amber' : ''}">${escapeHtml(report.quality.fcfTrajectory || 'Stable')}</strong>
        <small>3Y vs. baseline margin trend</small>
      </div>
    </div>
  </div>`;
}

function renderConcernGroups(report, evaluation) {
  const groups = { valuation: [], quality: [], missing: [] };
  const add = (group, message) => {
    if (message && !groups[group].includes(message)) groups[group].push(message);
  };
  const classify = (message) => {
    const text = String(message || "");
    if (/missing|unavailable|unknown|incomplete|no .*data|could not/i.test(text)) return "missing";
    if (/price|market cap|valuation|multiple|enterprise value|net debt|shares|p\/|ev\/|yield/i.test(text)) return "valuation";
    return "quality";
  };

  report.warnings.forEach((message) => add(classify(message), message));
  evaluation.failures.forEach((message) => add(classify(message), `Failed screen: ${message}`));
  evaluation.exclusions.forEach((message) => add("quality", `Excluded: ${message}`));
  evaluation.unknowns.forEach((message) => add("missing", `Unknown: ${message}`));

  const cards = [
    ["valuation", "Valuation concerns", "What could distort the price or multiple", "high"],
    ["quality", "Quality concerns", "Operating, capital-allocation, or eligibility flags", "medium"],
    ["missing", "Missing data", "Evidence that should be verified before relying on the result", "info"]
  ].filter(([key]) => groups[key].length);

  if (!cards.length) return `<div class="concern-clear"><span>✓</span><div><strong>No screening concerns detected</strong><small>All required evidence is available under the active criteria.</small></div></div>`;
  return `<div class="concern-grid">${cards.map(([key, title, subtitle, severity]) => `<section class="concern-card ${severity}">
    <div class="concern-head"><span class="concern-dot"></span><div><strong>${title}</strong><small>${subtitle}</small></div><b>${groups[key].length}</b></div>
    <ul>${groups[key].map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>
  </section>`).join("")}</div>`;
}

function renderOwnerReturns(report) {
  const safety = report.dividendSafety || {};
  const returns = report.shareholderYield || {};
  const history = report.valuationHistory || {};
  return `<div class="report-card report-detail">
    <div class="waterfall-header"><div><h3>Owner Returns & Dividend Safety</h3><p class="muted">Cash returned to owners, adjusted for repurchases and stock compensation</p></div></div>
    <div class="report-grid" style="margin-top:12px;">
      <div class="metric"><span>Dividend coverage</span><strong class="${safety.highYieldRisk ? 'badge-amber' : ''}">${escapeHtml(safety.coverage || 'Unavailable')}</strong><small>${percent(safety.payoutRatio)} of normalized FCF</small></div>
      <div class="metric"><span>5Y dividend growth</span><strong>${percent(safety.fiveYearGrowth)}</strong><small>${safety.yearsWithoutCut || 0} annual periods without a cut</small></div>
      <div class="metric"><span>Shareholder yield</span><strong>${percent(returns.total)}</strong><small>Dividend + gross buybacks − SBC</small></div>
      <div class="metric"><span>Yield components</span><strong>${percent(returns.dividendCashYield)} / ${percent(returns.buybackCashYield)} / −${percent(returns.sbcYield)}</strong><small>Dividend / buyback / SBC yields</small></div>
      <div class="metric"><span>Valuation history</span><strong>${escapeHtml(history.context || 'History unavailable')}</strong><small>${history.multiplePercentile == null ? 'Five-year price history unavailable' : `${(history.multiplePercentile * 100).toFixed(0)}th percentile reported P/FCF`}</small></div>
      <div class="metric"><span>52-week drawdown</span><strong>${percent(history.drawdownFromHigh)}</strong><small>High: ${compact(history.fiftyTwoWeekHigh, true)} • Low: ${compact(history.fiftyTwoWeekLow, true)}</small></div>
    </div>
  </div>`;
}

function renderInsiderEvidence(report) {
  const insider = report.insiders || {};
  const rows = insider.purchases || [];
  return `<div class="report-card report-detail">
    <div class="waterfall-header"><div><h3>Insider Purchase Evidence</h3><p class="muted">${escapeHtml(insider.source || 'Source unavailable')} • ${escapeHtml(insider.signal || 'Unavailable')}</p></div>${insider.clusterBuying ? '<span class="badge badge-blue">Cluster buying</span>' : ''}</div>
    ${rows.length ? `<div class="table-scroll"><table class="compact-evidence-table"><thead><tr><th>Date</th><th>Buyer</th><th>Role</th><th>Shares</th><th>Price</th><th>Value</th><th>Ownership after</th><th>Filing</th></tr></thead><tbody>${rows.map((item) => `<tr>
      <td>${escapeHtml(item.date || '—')}</td><td>${escapeHtml(item.name || 'Unknown')}</td><td>${escapeHtml(item.relation || '—')}</td><td>${compact(item.shares)}</td><td>${compact(item.price, true)}</td><td>${compact(item.value, true)}</td><td>${compact(item.sharesAfter)}</td><td>${item.filingUrl ? `<a class="source-link" href="${escapeHtml(item.filingUrl)}" target="_blank" rel="noopener">SEC Form 4 ↗</a>` : '—'}</td>
    </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No qualifying open-market purchase records were available in the recent transaction feed.</p>'}
    <p class="evidence-caveat">${escapeHtml(insider.caveat || '')}</p>
  </div>`;
}

function renderFreshness(report) {
  return `<div class="freshness-strip">
    <span><b>Market data</b> ${escapeHtml(report.marketDataAsOf ? new Date(report.marketDataAsOf).toLocaleString() : 'date unavailable')} · ${escapeHtml(screening.marketDataFreshness(report.marketDataAsOf))} · ${escapeHtml(report.sources?.price || 'source unavailable')}</span>
    <span><b>Financial period</b> ${escapeHtml(report.rows?.[0]?.evidence?.revenue?.periodEnd || report.rows?.[0]?.year || 'unavailable')}</span>
    <span><b>Latest insider purchase</b> ${escapeHtml(report.insiders?.latestPurchaseDate || 'none found')}</span>
  </div>`;
}

function researchArray(value) {
  return Array.isArray(value) ? value : [];
}

function researchText(value) {
  return escapeHtml(value || "Unavailable").replace(/\n/g, "<br>");
}

function researchList(items, empty = "No material items identified.") {
  const values = researchArray(items).filter(Boolean);
  if (!values.length) return `<p class="research-empty">${escapeHtml(empty)}</p>`;
  return `<ul>${values.map((item) => `<li>${researchText(item)}</li>`).join("")}</ul>`;
}

function researchSourceMap(result) {
  return new Map(researchArray(result?.sources).map((source) => [source.id, source]));
}

function researchCitations(ids, sources) {
  const links = researchArray(ids).map((id) => sources.get(id)).filter(Boolean);
  if (!links.length) return "";
  return `<span class="research-citations">${links.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener" title="${escapeHtml(source.title)}">${escapeHtml(source.id)}</a>`).join("")}</span>`;
}

function renderValuationCase(label, value, sources) {
  const item = value || {};
  return `<article class="research-case research-case-${label.toLowerCase()}">
    <span>${escapeHtml(label)} case</span>
    <strong>${researchText(item.estimatedValue)}</strong>
    ${researchList(item.assumptions, "No assumptions supplied.")}
    <p>${researchText(item.interpretation)}</p>
    ${researchCitations(item.sourceIds, sources)}
  </article>`;
}

function researchSettingsMarkup() {
  const modelOptions = RESEARCH_MODELS.map(([id, label]) => `<option value="${escapeHtml(id)}"${state.researchSettings.model === id ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const effortOptions = researchEffortOptions();
  return `<div class="research-config" aria-label="Deep Research settings">
    <label><span>Model</span><select class="research-model-select">${modelOptions}</select></label>
    <label><span>Effort</span><select class="research-effort-select">${effortOptions}</select></label>
  </div>`;
}

function allowedResearchEfforts(model = state.researchSettings.model) {
  return model === "gpt-5.5" ? RESEARCH_EFFORTS.filter((effort) => effort !== "max") : RESEARCH_EFFORTS;
}

function researchEffortOptions() {
  return allowedResearchEfforts().map((effort) => `<option value="${effort}"${state.researchSettings.effort === effort ? " selected" : ""}>${effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1)}</option>`).join("");
}

function renderResearchResult(result) {
  const sources = researchSourceMap(result);
  const history = result.financialHistory || {};
  const rows = researchArray(history.annualFinancials);
  const recent = researchArray(result.recentDevelopments);
  const risks = researchArray(result.accountingAndCashFlowRisks);
  const business = result.business || {};
  const management = result.managementAndCapitalAllocation || {};
  const industry = result.industryAndPeers || {};

  return `<div class="report-card deep-research-card">
    <div class="research-header">
      <div>
        <p class="kicker">AI-assisted, source-linked investigation</p>
        <h3>AI Deep Analysis</h3>
        <p class="muted">Generated ${escapeHtml(result.generatedAt ? new Date(result.generatedAt).toLocaleString() : "date unavailable")}${result.researchConfiguration ? ` with ${escapeHtml(result.researchConfiguration.model)} at ${escapeHtml(result.researchConfiguration.effort)} effort` : ""}. Verify consequential claims in the linked originals.</p>
      </div>
      <div class="research-verdicts">
        <span class="research-classification">${escapeHtml(result.classification || "Insufficient evidence")}</span>
        <span>${escapeHtml(result.confidence || "Low")} confidence</span>
      </div>
    </div>

    <div class="research-lede">
      <div><span>Executive conclusion</span><p>${researchText(result.executiveSummary)}</p></div>
      <div><span>Investment thesis</span><p>${researchText(result.investmentThesis)}</p></div>
    </div>

    <section class="research-section">
      <h4>Why the stock may be cheap</h4>
      <div class="why-cheap-grid">${researchArray(result.whyCheap).map((item, index) => `<article>
        <span class="research-number">0${index + 1}</span>
        <h5>${researchText(item.hypothesis)}</h5>
        <div class="evidence-columns"><div><b>Evidence for</b>${researchList(item.evidenceFor)}</div><div><b>Evidence against</b>${researchList(item.evidenceAgainst)}</div></div>
        <p><strong>Assessment:</strong> ${researchText(item.assessment)}</p>
        ${researchCitations(item.sourceIds, sources)}
      </article>`).join("") || '<p class="research-empty">No supported explanation was found.</p>'}</div>
    </section>

    <section class="research-section research-two-column">
      <div><h4>Business quality</h4><p>${researchText(business.overview)}</p><h5>Revenue drivers</h5>${researchList(business.revenueDrivers)}<h5>Competitive advantages</h5>${researchList(business.competitiveAdvantages)}<h5>Vulnerabilities</h5>${researchList(business.vulnerabilities)}${researchCitations(business.sourceIds, sources)}</div>
      <div><h4>Industry and peers</h4><p>${researchText(industry.industryContext)}</p>${researchList(industry.peerComparison, "No reliable peer comparison was available.")}${researchCitations(industry.sourceIds, sources)}<h4>Management and capital allocation</h4><p>${researchText(management.assessment)}</p><h5>Strengths</h5>${researchList(management.strengths)}<h5>Concerns</h5>${researchList(management.concerns)}${researchCitations(management.sourceIds, sources)}</div>
    </section>

    <section class="research-section">
      <h4>Long-term financial history</h4>
      <p>${researchText(history.summary)}</p>
      ${researchList(history.trendFlags, "No material trend flags identified.")}
      ${rows.length ? `<div class="table-wrap"><table class="research-financial-table"><thead><tr><th>Year</th><th>Revenue</th><th>Operating CF</th><th>CapEx</th><th>FCF</th><th>Diluted shares</th><th>Debt</th><th>Cash</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.year)}</td><td>${researchText(row.revenue)}</td><td>${researchText(row.operatingCashFlow)}</td><td>${researchText(row.capitalExpenditures)}</td><td>${researchText(row.freeCashFlow)}</td><td>${researchText(row.dilutedShares)}</td><td>${researchText(row.debt)}</td><td>${researchText(row.cash)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="research-empty">No additional verified annual history was available.</p>'}
      ${researchCitations(history.sourceIds, sources)}
    </section>

    <section class="research-section research-two-column">
      <div><h4>Recent developments</h4>${recent.length ? `<ol class="research-timeline">${recent.map((item) => `<li><time>${escapeHtml(item.date)}</time><strong>${researchText(item.title)}</strong><p>${researchText(item.impact)}</p>${researchCitations(item.sourceIds, sources)}</li>`).join("")}</ol>` : '<p class="research-empty">No material recent developments were verified.</p>'}</div>
      <div><h4>Accounting and cash-flow risks</h4>${risks.length ? `<div class="research-risk-list">${risks.map((item) => `<article><span class="risk-${String(item.severity || "low").toLowerCase()}">${escapeHtml(item.severity)}</span><strong>${researchText(item.risk)}</strong><p>${researchText(item.evidence)}</p>${researchCitations(item.sourceIds, sources)}</article>`).join("")}</div>` : '<p class="research-empty">No material accounting flags were verified.</p>'}</div>
    </section>

    <section class="research-section">
      <h4>Valuation scenarios</h4>
      <div class="research-cases">${renderValuationCase("Bear", result.valuationCases?.bear, sources)}${renderValuationCase("Base", result.valuationCases?.base, sources)}${renderValuationCase("Bull", result.valuationCases?.bull, sources)}</div>
    </section>

    <section class="research-section research-three-column">
      <div><h4>Catalysts</h4>${researchList(result.catalysts)}</div>
      <div><h4>Thesis breakers</h4>${researchList(result.thesisBreakers)}</div>
      <div><h4>Unanswered questions</h4>${researchList(result.unansweredQuestions)}</div>
    </section>

    ${researchArray(result.limitations).length ? `<section class="research-limitations"><strong>Research limitations</strong>${researchList(result.limitations)}</section>` : ""}

    <section class="research-section research-sources">
      <h4>Sources</h4>
      <ol>${researchArray(result.sources).map((source) => `<li id="research-source-${escapeHtml(source.id)}"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a><span>${escapeHtml(source.publisher)} • ${escapeHtml(source.publishedAt || "date unavailable")} • ${escapeHtml(source.sourceType)}</span></li>`).join("")}</ol>
    </section>
  </div>`;
}

function renderResearchPanel(ticker) {
  const job = state.researchJobs[ticker];
  const result = state.researchReports[ticker];
  if (job && !["completed"].includes(job.status)) {
    const failed = ["failed", "cancelled"].includes(job.status);
    return `<div class="report-card deep-research-progress ${failed ? "research-failed" : ""}">
      <div class="research-progress-head"><div><p class="kicker">AI Deep Analysis</p><h3>${escapeHtml(job.message || "Preparing research…")}</h3></div><strong>${escapeHtml(job.progress || 0)}%</strong></div>
      <div class="research-progress-track"><span style="width:${Math.max(0, Math.min(100, Number(job.progress) || 0))}%"></span></div>
      ${job.model ? `<p class="research-run-config">${escapeHtml(job.model)} • ${escapeHtml(job.effort || "default")} effort</p>` : ""}
      ${job.error ? `<p class="research-error">${escapeHtml(job.error)}</p>` : `<p class="muted">${job.status === "signing-in" ? "Finish signing in with ChatGPT in the browser window." : "This can take several minutes. You can continue using ClearFCF while it runs."}</p>`}
      ${job.loginUrl ? `<a class="source-link" href="${escapeHtml(job.loginUrl)}" target="_blank" rel="noopener">Continue ChatGPT sign-in ↗</a>` : ""}
      ${failed ? `<button class="secondary deep-research-btn" data-ticker="${escapeHtml(ticker)}" type="button">Try again</button>` : `<button class="secondary research-cancel-btn" data-job-id="${escapeHtml(job.id || "")}" data-ticker="${escapeHtml(ticker)}" type="button">Cancel research</button>`}
    </div>`;
  }
  if (result) return renderResearchResult(result);
  return `<div class="report-card deep-research-intro">
    <div><p class="kicker">Optional second-stage investigation</p><h3>Research what the numbers cannot explain</h3><p>Uses your ChatGPT-connected Codex session to investigate filings, current developments, competitive risks, why the stock may be cheap, and bear/base/bull scenarios with linked sources.</p></div>
    <span>Read-only • Source-linked • No API key</span>
  </div>`;
}

function updateResearchPanel(ticker) {
  const slot = document.querySelector(`.deep-research-slot[data-ticker="${CSS.escape(ticker)}"]`);
  if (slot) slot.innerHTML = renderResearchPanel(ticker);
}

function renderReport(report) {
  const evaluation = screening.evaluateCandidate(report, state.criteria);
  const lookback = screening.lookbackKey(state.criteria);
  const fullN = report.normalized;
  const n = lookback === "3" ? report.normalized3y : lookback === "5" ? report.normalized5y : report.normalized;
  const v = { ...report.valuation, ...evaluation.selected };
  const q = report.quality;
  const filingUrl = report.filing?.url;
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(report.ticker)}`;
  const latestRow = report.rows.find((row) => typeof row.fcf === "number" && typeof row.revenue === "number") || {};
  const liveDecisionSummary = decisionText(report, evaluation);

  return `<div class="report-card report-summary">
    <div class="report-title">
      <div>
        <p class="kicker">${escapeHtml(evaluation.status)} • ${lookback === "all" ? "Full-history" : `${lookback}-year`} screen</p>
        <h2>${escapeHtml(report.ticker)} • ${escapeHtml(report.companyName)}</h2>
        <p class="muted">${escapeHtml(report.company.sicDescription || "Industry unavailable")} • ${escapeHtml(report.quote.exchange || report.company.exchanges?.[0] || "Exchange unavailable")}</p>
        <div class="filing-links">
          ${filingUrl ? `<a class="source-link" href="${escapeHtml(filingUrl)}" target="_blank" rel="noopener">📄 Latest ${escapeHtml(report.filing.form)} filed ${escapeHtml(report.filing.filed)}</a>` : '<span class="muted">SEC filing unavailable</span>'}
          <span class="dot-sep">•</span>
          <a class="source-link yahoo-link" href="${escapeHtml(yahooUrl)}" target="_blank" rel="noopener">📈 View on Yahoo Finance ↗</a>
        </div>
      </div>
      <div class="report-actions">
        ${researchSettingsMarkup()}
        <button type="button" class="btn secondary report-save-list" data-ticker="${escapeHtml(report.ticker)}">＋ Watchlist</button>
        <button type="button" class="btn primary deep-analysis-btn" data-ticker="${escapeHtml(report.ticker)}">✦ Deep Analysis</button>
        <button type="button" class="btn secondary memo-btn" data-ticker="${escapeHtml(report.ticker)}">↓ Save PDF</button>
        <span class="badge ${String(evaluation.status).toLowerCase()}">${escapeHtml(evaluation.status)}</span>
      </div>
    </div>
    <div class="decision-strip">
      <div><span>Decision</span><strong class="decision-${String(evaluation.status).toLowerCase()}">${escapeHtml(evaluation.status)}</strong></div>
      <div><span>Selected P/nFCF</span><strong>${multiple(v.priceToNfcf)}</strong></div>
      <div><span>FCF yield</span><strong>${percent(v.fcfYield)}</strong></div>
      <div><span>Evidence confidence</span><strong>${escapeHtml(report.evidenceConfidence?.level || "Unknown")}</strong></div>
    </div>
    <p class="decision-summary-text">${escapeHtml(liveDecisionSummary)}</p>
    ${evaluation.status === "Idea" ? "" : `<div class="qualification-callout"><strong>Why this is not an Idea</strong><ul>${(evaluation.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>`}
    ${renderFreshness(report)}
    ${renderConcernGroups(report, evaluation)}
  </div>

  <div class="deep-research-slot" data-ticker="${escapeHtml(report.ticker)}">${renderResearchPanel(report.ticker)}</div>

  <div class="report-section-heading"><div><span>01</span><div><p class="kicker">Decision metrics</p><h3>Valuation and cash-flow quality</h3></div></div><small>Click any metric to inspect its calculation</small></div>
  <div class="report-grid core-metrics">
    <div class="metric clickable" data-metric="price"><span>Price</span><strong>${compact(v.price, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="marketCap"><span>Market capitalization</span><strong>${compact(v.marketCap, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="normalizedFcf"><span>Normalized FCF</span><strong>${compact(n.normalizedFcf, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="economicNfcf"><span>Economic nFCF (post-SBC)</span><strong>${compact(n.normalizedEconomicFcf, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="priceToNfcf"><span>P/nFCF</span><strong>${multiple(v.priceToNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="priceToEconomicNfcf"><span>P/Economic nFCF</span><strong>${multiple(v.priceToEconomicNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="evToUnleveredNfcf"><span>EV/Unlevered nFCF</span><strong>${multiple(v.evToUnleveredNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="fcfYield"><span>Normalized FCF yield</span><strong>${percent(v.fcfYield)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="economicFcfYield"><span>Economic FCF yield</span><strong>${percent(v.economicFcfYield)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="dividendYield"><span>Current dividend yield</span><strong>${percent(report.dividends?.currentYield)}</strong><small>${report.dividends?.annualRate ? `${compact(report.dividends.annualRate, true)} indicated annual dividend` : 'No current dividend rate available'}</small><span class="metric-hint">Source and interpretation</span></div>
    <div class="metric clickable" data-metric="fiveYearDividendYield"><span>5-year average dividend yield</span><strong>${percent(report.dividends?.fiveYearAverageYield)}</strong><small>Historical context; not a screening criterion</small><span class="metric-hint">Source and interpretation</span></div>
    <div class="metric clickable" data-metric="insiderActivity"><span>Insider activity</span><strong class="${report.insiders?.valueAligned ? 'badge-blue' : report.insiders?.hasQualifiedBuying ? 'badge-green' : ''}">${escapeHtml(report.insiders?.signal || 'Unavailable')}</strong><small>${report.insiders?.purchaseCount || 0} purchase record${report.insiders?.purchaseCount === 1 ? '' : 's'} in ${escapeHtml(report.insiders?.period || 'the reported period')}</small><span class="metric-hint">Evidence and caveat</span></div>
    <div class="metric clickable" data-metric="fcfTrajectory"><span>FCF Trajectory</span><strong class="${q.fcfTrajectory === 'Expanding' ? 'badge-green' : q.fcfTrajectory === 'Deteriorating' ? 'badge-amber' : ''}">${escapeHtml(q.fcfTrajectory || 'Stable')}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="buybackAudit"><span>Buyback Audit</span><strong class="${q.buybackAudit?.rating === 'Unreliable' ? 'badge-amber' : ''}">${escapeHtml(q.buybackAudit?.rating || 'N/A')}</strong><small>${q.buybackAudit?.averageBuybackPrice ? `Implied avg: $${q.buybackAudit.averageBuybackPrice.toFixed(2)}` : 'No matched repurchases'}</small><span class="metric-hint">Evidence and caveat</span></div>
    <div class="metric clickable" data-metric="capexToDnaRatio"><span>CapEx / D&A</span><strong>${q.capexToDnaRatio ? `${(q.capexToDnaRatio * 100).toFixed(0)}%` : "—"}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="netDebt"><span>Net debt</span><strong>${compact(v.netDebt, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="netDebtToNfcf"><span>Net debt/nFCF</span><strong>${multiple(v.netDebtToNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="shortDebt"><span>Short-term debt</span><strong>${compact(v.shortDebt, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="usableYears"><span>Usable history</span><strong>${n.usableYears} years</strong><span class="metric-hint">How it was calculated</span></div>
  </div>

  <div class="report-section-heading detail-heading"><div><span>02</span><div><p class="kicker">Supporting analysis</p><h3>Evidence and expectations</h3></div></div><small>Detailed audit trail</small></div>

  ${renderOwnerReturns(report)}
  ${renderInsiderEvidence(report)}
  ${renderWaterfall(latestRow, n)}
  ${renderReverseDcf(report)}

  <div class="report-card report-detail">
    <h3>Normalized Margin Architecture (50/50 Equal Weighting)</h3>
    <div class="formulas">
      <div class="formula"><span>Simple average margin</span><strong>${percent(n.simpleAverageMargin)}</strong><small>Arithmetic mean of ${n.usableYears} annual margins</small></div>
      <div class="formula"><span>Volume-weighted margin</span><strong>${percent(n.weightedMargin)}</strong><small>Total FCF (${compact(n.totalFcf, true)}) ÷ Total Rev (${compact(n.totalRevenue, true)})</small></div>
      <div class="formula"><span>50/50 Blended margin</span><strong>${percent(n.blendedMargin)}</strong><small>Applied to current revenue (${compact(n.latestRevenue, true)})</small></div>
    </div>
  </div>

  <div class="report-card report-detail">
    <h3>Annual Filing Evidence</h3>
    ${rowTable(report.rows)}
    <div class="filing-links">
      ${filingUrl ? `<a class="source-link" href="${escapeHtml(filingUrl)}" target="_blank" rel="noopener">📄 Latest ${escapeHtml(report.filing.form)} filed ${escapeHtml(report.filing.filed)}</a>` : '<span class="muted">SEC filing link unavailable</span>'}
      <span class="dot-sep">•</span>
      <a class="source-link yahoo-link" href="${escapeHtml(yahooUrl)}" target="_blank" rel="noopener">📈 View ${escapeHtml(report.ticker)} on Yahoo Finance ↗</a>
    </div>
  </div>

  <div class="report-card report-detail">
    <div class="waterfall-header">
      <div>
        <h3>Lookback Range Comparison (10Y vs. 5Y vs. 3Y)</h3>
        <p class="muted">Compare long-term structural power against recent medium-term cash flow trends</p>
      </div>
    </div>
    <div class="report-grid" style="margin-top:12px;">
      <div class="metric">
        <span>Full History (${fullN.usableYears}Y) Margin</span>
        <strong>${percent(fullN.blendedMargin)}</strong>
        <small>nFCF: ${compact(fullN.normalizedFcf, true)}</small>
      </div>
      <div class="metric">
        <span>5-Year Blended Margin</span>
        <strong>${percent(report.normalized5y?.blendedMargin)}</strong>
        <small>nFCF: ${compact(report.normalized5y?.normalizedFcf, true)}</small>
      </div>
      <div class="metric">
        <span>3-Year Blended Margin</span>
        <strong>${percent(report.normalized3y?.blendedMargin)}</strong>
        <small>nFCF: ${compact(report.normalized3y?.normalizedFcf, true)}</small>
      </div>
      <div class="metric">
        <span>5Y Multiple vs. 10Y</span>
        <strong>${report.valuation.price && report.normalized5y?.normalizedFcf > 0 ? (report.valuation.marketCap / report.normalized5y.normalizedFcf).toFixed(1) + 'x' : '—'}</strong>
        <small>P/nFCF (5Y lookback)</small>
      </div>
    </div>
  </div>

  <div class="report-card report-detail methodology-card">
    <h3>Sources and Methodology</h3>
    <p>Financials: <strong>${escapeHtml(report.sources.financials || "Unavailable")}</strong> (period ended ${escapeHtml(report.rows?.[0]?.evidence?.revenue?.periodEnd || "unavailable")}). Price: <strong>${escapeHtml(report.sources.price || "Unavailable")}</strong> (as of ${report.marketDataAsOf ? escapeHtml(new Date(report.marketDataAsOf).toLocaleString()) : "unavailable"}). Analyzed ${escapeHtml(new Date(report.analyzedAt).toLocaleString())}.</p>
    <p>Debt: <strong>${escapeHtml(report.sources.debt || "Unavailable")}</strong>. Cash: <strong>${escapeHtml(report.sources.cash || "Unavailable")}</strong>. Hover an annual period to inspect the exact XBRL concepts used for that year.</p>
  </div>`;
}

async function openReport(ticker) {
  switchView("analyze");
  if ($("#single-ticker")) $("#single-ticker").value = ticker;
  $("#report").innerHTML = `<div class="panel">Loading <strong>${escapeHtml(ticker)}</strong>...</div>`;
  setStatus(`Loading the full ${ticker} report...`);
  try {
    // Option A: Always fetch a fresh uncached report on click to guarantee live snapshot data
    const report = await request(`/api/analyze?ticker=${encodeURIComponent(ticker)}&_t=${Date.now()}`);
    state.reports[ticker] = report;
    $("#report").innerHTML = renderReport(report);
    $("#report").classList.add("reveal");

    setStatus(`${ticker} analysis complete.`);
  } catch (error) {
    $("#report").innerHTML = "";
    setStatus(error.message, true);
  }
}

$("#analyze-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const ticker = $("#single-ticker").value.trim().toUpperCase();
  if (ticker) openReport(ticker);
});

async function screenInBatches(tickers, onBatch) {
  const all = [];
  const failures = [];
  let index = 0;
  while (index < tickers.length) {
    const performance = readPerformanceSettings(true);
    const batch = tickers.slice(index, index + performance.batchSize);
    const data = await request("/api/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: batch, criteria: state.criteria, performance })
    });
    index += batch.length;
    all.push(...data.results);
    all.sort((a, b) => Number(b.passesDefaultIdeaFilter) - Number(a.passesDefaultIdeaFilter) || (a.priceToNfcf ?? 999) - (b.priceToNfcf ?? 999));
    failures.push(...data.failures);
    Object.assign(state.reports, data.reports);
    if (onBatch) onBatch(index, all, failures);
    if (index < tickers.length && performance.frontendPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, performance.frontendPauseMs));
    }
  }
  return { results: all, failures };
}

$("#screen-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const tickers = parseTickers($("#ticker-list").value);
  if (!tickers.length) return setStatus("Paste at least one ticker.", true);
  if (tickers.length > 50) return setStatus("Screen up to 50 tickers at a time.", true);
  const container = $("#screen-results");
  container.innerHTML = "";
  try {
    setStatus(`Screening ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}...`);
    const data = await screenInBatches(tickers, (done, results) => {
      setStatus(`Analyzed ${done} of ${tickers.length}.`);
      renderTable(container, results, "Watchlist results", "All");
    });
    setStatus(`Finished: ${data.results.length} analyzed, ${data.failures.length} failed.`);
  } catch (error) { setStatus(error.message, true); }
});

let scanWriteQueue = Promise.resolve();
function scanSaveMessage(message, error = false) {
  const indicator = $("#scan-save-state");
  if (!indicator) return;
  indicator.textContent = message;
  indicator.dataset.state = error ? "error" : "saved";
}

function saveAuto() {
  if (!state.auto) return Promise.resolve(true);
  state.auto.criteria = { ...state.criteria };
  state.auto.activePreset = state.activePreset;
  const snapshot = scanState.forStorage(state.auto);
  scanSaveMessage("Saving…");
  scanWriteQueue = scanWriteQueue.catch(() => {}).then(() => workspaceStorage.set(STORAGE_KEY, snapshot));
  return scanWriteQueue.then(() => {
    scanSaveMessage("Saved locally");
    return true;
  }).catch((error) => {
    scanSaveMessage("Save failed — export your work", true);
    setStatus(`Scan could not be saved: ${error.message}`, true);
    return false;
  });
}

function updateAutoUi() {
  const scan = state.auto;
  if (!scan) return;
  const counts = scanState.stats(scan);
  const max = counts.total;
  const accounted = counts.analyzed + counts.unresolved;
  const percentComplete = max ? Math.round((accounted / max) * 100) : 0;
  const completedThisRun = Math.max(0, accounted - Number(scan.runStartCursor || 0));
  const elapsedSeconds = scan.runStartedAt ? (Date.now() - scan.runStartedAt) / 1000 : 0;
  const secondsPerTicker = completedThisRun > 0 ? elapsedSeconds / completedThisRun : NaN;
  const eta = scan.complete ? "Complete" : state.stopped ? "Stopped" : formatDuration(counts.pending * secondsPerTicker);
  $("#progress-wrap").classList.remove("hidden");
  $("#progress-bar").style.width = `${percentComplete}%`;
  $("#progress-text").textContent = `${counts.analyzed} analyzed • ${counts.unresolved} unresolved • ${counts.pending} pending`;
  $("#scan-percent").textContent = `${percentComplete}%`;
  $("#scan-examined").textContent = `${counts.analyzed} / ${max}`;
  const performance = readPerformanceSettings();
  const batchSize = performance.batchSize;
  $("#scan-batch").textContent = accounted ? `${Math.ceil(accounted / batchSize)} / ${Math.ceil(max / batchSize)}` : `— / ${Math.ceil(max / batchSize)}`;
  $("#scan-ideas").textContent = String(scan.results.length);
  $("#scan-pending").textContent = String(counts.pending);
  $("#scan-failures").textContent = String(counts.unresolved);
  $("#scan-eta").textContent = eta;
  $("#scan-state").textContent = scan.complete ? counts.unresolved ? "Scan finished with unresolved tickers" : "Scan complete" : state.stopped ? "Scan stopped" : "Analyzing companies";
  $("#scan-failure-panel").classList.toggle("hidden", counts.unresolved === 0);
  $("#scan-failure-count").textContent = String(counts.unresolved);
  $("#scan-failure-list").innerHTML = scan.failures.map((item) => `<li><strong>${escapeHtml(item.ticker)}</strong> — ${escapeHtml(item.error)}</li>`).join("");
  const health = $("#scan-health");
  health.textContent = scan.rateLimited
    ? "Rate limit pause"
    : `${performance.workers} worker${performance.workers === 1 ? "" : "s"} • ${performance.pacingMs}ms pacing`;
  health.classList.toggle("health-warning", Boolean(scan.rateLimited));
  health.classList.toggle("health-good", !scan.rateLimited);
  if (counts.analyzed > 0) {
    $("#result-filters")?.classList.remove("hidden");
    renderTable($("#idea-results"), scan.allExamined || scan.results, "Analyzed companies", "Idea");
  }
}

async function runAuto() {
  const scan = state.auto;
  scanState.normalize(scan);
  state.stopped = false;
  scan.runStartedAt = Date.now();
  scan.runStartCursor = scan.allExamined.length + scan.failures.length;
  scan.rateLimited = false;
  $("#progress-wrap").classList.add("is-running");
  $("#find-button").classList.add("hidden");
  $("#stop-button").classList.remove("hidden");
  $("#stop-button").disabled = false;
  try {
    while (scan.pending.length && !state.stopped && state.auto === scan) {
      const performance = readPerformanceSettings(true);
      const selection = scanState.nextBatch(scan, performance.batchSize);
      if (!selection.tickers.length) {
        setStatus(`Waiting ${Math.ceil(selection.waitMs / 1000)}s before retrying the data source.`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(selection.waitMs || 1000, 30_000)));
        continue;
      }
      const batch = selection.tickers;
      let data;
      try {
        data = await request("/api/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ tickers: batch, criteria: state.criteria, performance })
        });
      } catch (error) {
        const failure = { error: error.message, statusCode: error.statusCode || null };
        if (!scanState.isTransient(failure)) throw error;
        data = { results: [], reports: {}, failures: batch.map((ticker) => ({ ticker, ...failure })) };
      }
      if (state.auto !== scan) break;
      Object.assign(state.reports, data.reports);
      const outcome = scanState.applyBatch(scan, batch, data);
      scan.results = scan.allExamined.filter((r) => evaluateReportStatus(r, state.criteria) === "Idea");
      const saved = await saveAuto();
      updateAutoUi();
      if (!saved) { state.stopped = true; break; }

      const hasRateLimit = data.failures?.some((failure) => failure.statusCode === 429 || String(failure.error || "").includes("429"));
      if (hasRateLimit) {
        scan.rateLimited = true;
        updateAutoUi();
        setStatus("Data source rate limit reached. Failed tickers are queued for retry.", true);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        scan.rateLimited = false;
        setStatus(`Scan: ${scan.allExamined.length} analyzed, ${outcome.retrying.length} queued for retry, ${scan.failures.length} unresolved.`);
        if (performance.frontendPauseMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, performance.frontendPauseMs));
        }
      }
    }
    if (state.auto !== scan) return;
    scan.complete = scan.pending.length === 0;
    const saved = await saveAuto();
    updateAutoUi();
    if (!saved) return;
    const reason = state.stopped ? "stopped" : "complete";
    setStatus(`Scan ${reason}: ${scan.allExamined.length} analyzed, ${scan.failures.length} unresolved, ${scan.results.length} ideas.`);
  } catch (error) {
    state.stopped = true;
    if (state.auto === scan) updateAutoUi();
    setStatus(`Scan stopped: ${error.message}. Press Resume to continue.`, true);
  } finally {
    $("#progress-wrap").classList.remove("is-running");
    $("#find-button").classList.remove("hidden");
    $("#find-button").disabled = false;
    $("#stop-button").classList.add("hidden");
    $("#stop-button").disabled = true;
    if (state.auto === scan) $("#find-button").textContent = scan.complete ? "Start new scan" : "Resume scan";
  }
}
$("#find-button").addEventListener("click", async () => {
  const universeType = $("#universe-select")?.value || "yahoo";
  if (state.auto && !state.auto.complete && state.auto.universeType === universeType) {
    if (await saveAuto()) return runAuto();
    return;
  }
  try {
    setStatus("Loading idea lists...");
    $("#find-button").disabled = true;
    const universe = await request(`/api/universe?type=${encodeURIComponent(universeType)}&perSource=100`);
    state.auto = scanState.normalize({
      universeType,
      symbols: universe.symbols,
      sources: universe.sources,
      cursor: 0,
      results: [],
      failures: [],
      startedAt: new Date().toISOString(),
      complete: false
    });
    if (!await saveAuto()) {
      $("#find-button").disabled = false;
      return;
    }
    updateAutoUi();
    setStatus(`Loaded ${universe.symbols.length} candidates.`);
    await runAuto();
  } catch (error) {
    $("#find-button").disabled = false;
    setStatus(error.message, true);
  }
});

$("#retry-failed-button")?.addEventListener("click", async () => {
  if (!state.auto || $("#progress-wrap").classList.contains("is-running")) return;
  scanState.retryFailed(state.auto);
  await saveAuto();
  updateAutoUi();
  await runAuto();
});

$("#stop-button").addEventListener("click", () => {
  state.stopped = true;
  $("#stop-button").disabled = true;
  $("#scan-state").textContent = "Stopping after current batch…";
  setStatus("Stopping after the current batch. Your results will be preserved.");
});

// Restore previous scan state if it exists, including scans saved by earlier versions.
void (async () => {
  try {
    const saved = await workspaceStorage.get(STORAGE_KEY);
    if (!saved?.symbols || state.auto) return;
    state.auto = scanState.normalize(saved);
    state.stopped = !saved.complete;
    state.auto.runStartedAt = null;
    if (saved.criteria) {
      state.criteria = {
        ...PRESETS.default,
        ...saved.criteria,
        maxMarketCap: saved.criteria.maxMarketCap == null ? Infinity : saved.criteria.maxMarketCap
      };
      state.activePreset = saved.activePreset || "custom";
      syncCriteriaControls(state.criteria, state.activePreset);
    }
    state.auto.results = state.auto.allExamined.filter((row) => evaluateReportStatus(row, state.criteria) === "Idea");
    if ($("#target")) $("#target").value = String(saved.target);
    $("#find-button").textContent = saved.complete ? "Start new scan" : "Resume scan";
    updateAutoUi();
    scanSaveMessage("Saved locally");
    hideStatus();
  } catch (error) {
    scanSaveMessage("Saved scan could not be loaded", true);
    setStatus(`Saved scan could not be loaded: ${error.message}`, true);
  }
})();

// Result filters and qualification criteria
function initResultFilters() {
  const container = document.querySelector("#result-filters");
  const toggleTolBtn = document.querySelector("#toggle-tolerances");
  const tolDrawer = document.querySelector("#tolerances-drawer");

  container?.querySelectorAll("input[type='checkbox'][data-filter]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.activeFilters.add(input.dataset.filter);
      else state.activeFilters.delete(input.dataset.filter);
      input.closest(".adjustable-filter")?.classList.toggle("active", input.checked);
      refreshActiveTable();
    });
  });

  const valueInputs = {
    "#filter-net-debt": ["maxNetDebt", Number],
    "#filter-sbc": ["maxSbcPercent", Number],
    "#filter-share-change": ["maxShareChangePercent", Number],
    "#filter-multiple": ["maxMultiple", Number],
    "#filter-dividend": ["minDividendYieldPercent", Number]
  };
  Object.entries(valueInputs).forEach(([selector, [key, parse]]) => {
    $(selector)?.addEventListener("input", (event) => {
      const value = parse(event.target.value);
      if (Number.isFinite(value)) state.displayFilters[key] = value;
      refreshActiveTable();
    });
  });

  $("#clear-filters")?.addEventListener("click", () => {
    state.activeFilters.clear();
    container?.querySelectorAll("input[type='checkbox'][data-filter]").forEach((input) => {
      input.checked = false;
      input.closest(".adjustable-filter")?.classList.remove("active");
    });
    refreshActiveTable();
  });

  toggleTolBtn?.addEventListener("click", () => {
    tolDrawer?.classList.toggle("hidden");
    const expanded = !tolDrawer?.classList.contains("hidden");
    toggleTolBtn.setAttribute("aria-expanded", String(expanded));
    toggleTolBtn.textContent = expanded ? "Hide criteria" : "Customize criteria";
  });
}

function refreshActiveTable() {
  const ideaContainer = document.querySelector("#idea-results");
  if (ideaContainer && ideaContainer._rawResults) {
    renderTable(ideaContainer, ideaContainer._rawResults, ideaContainer._rawTitle || "Current ideas");
  }
  const screenContainer = document.querySelector("#screen-results");
  if (screenContainer && screenContainer._rawResults) {
    renderTable(screenContainer, screenContainer._rawResults, screenContainer._rawTitle || "Watchlist results");
  }
}

initResultFilters();

// Command Palette (Cmd+K)
function initCommandPalette() {
  const palette = $("#cmd-palette");
  const input = $("#cmd-input");
  const results = $("#cmd-results");
  if (!palette || !input) return;

  function openPalette() {
    palette._returnFocus = document.activeElement;
    palette.classList.remove("hidden");
    input.value = "";
    renderCmdResults("");
    input.focus();
  }

  function closePalette() {
    palette.classList.add("hidden");
    palette._returnFocus?.focus?.();
  }

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.classList.contains("hidden") ? openPalette() : closePalette();
    }
    if (e.key === "Escape" && !palette.classList.contains("hidden")) {
      closePalette();
    }
  });

  $("#cmd-backdrop")?.addEventListener("click", closePalette);
  $("#cmd-esc-btn")?.addEventListener("click", closePalette);
  document.querySelector(".cmd-hint kbd")?.addEventListener("click", openPalette);

  const actions = [
    { type: "view", title: "Go to Idea Finder", view: "ideas" },
    { type: "view", title: "Go to Watchlist", view: "screen" },
    { type: "view", title: "Go to Analyze Stock", view: "analyze" },
    
    { type: "action", title: "Export CSV Report", run: () => exportCsv(state.auto?.results || []) }
  ];

  function renderCmdResults(query) {
    const q = query.trim().toUpperCase();
    const items = [];

    if (q.length > 0 && /^[A-Z0-9.-]{1,12}$/.test(q)) {
      items.push({
        type: "ticker",
        title: `Analyze Ticker: ${q}`,
        subtitle: `Jump to multi-year normalized FCF report`,
        run: () => { closePalette(); openReport(q); }
      });
    }

    actions.filter((a) => a.title.toUpperCase().includes(q)).forEach((a) => {
      items.push({
        type: a.type,
        title: a.title,
        subtitle: a.view ? `Switch to ${a.view} view` : "Execute action",
        run: () => {
          closePalette();
          if (a.view) document.querySelector(`[data-view="${a.view}"]`)?.click();
          if (a.run) a.run();
        }
      });
    });

    if (!items.length) {
      results.innerHTML = `<div class="cmd-item" style="color:var(--muted)">No matching commands or actions.</div>`;
      return;
    }

    results.innerHTML = items.map((item, idx) => `
      <div class="cmd-item ${idx === 0 ? 'selected' : ''}" data-idx="${idx}">
        <span><strong>${escapeHtml(item.title)}</strong> <small>${escapeHtml(item.subtitle)}</small></span>
        <kbd>↵</kbd>
      </div>
    `).join("");

    results.querySelectorAll(".cmd-item").forEach((el, idx) => {
      el.addEventListener("click", () => items[idx].run());
    });
  }

  input.addEventListener("input", (e) => renderCmdResults(e.target.value));
  input.addEventListener("keydown", (e) => {
    const items = results.querySelectorAll(".cmd-item");
    if (!items.length) return;
    let selectedIdx = Array.from(items).findIndex((el) => el.classList.contains("selected"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[selectedIdx]?.classList.remove("selected");
      selectedIdx = (selectedIdx + 1) % items.length;
      items[selectedIdx]?.classList.add("selected");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[selectedIdx]?.classList.remove("selected");
      selectedIdx = (selectedIdx - 1 + items.length) % items.length;
      items[selectedIdx]?.classList.add("selected");
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[selectedIdx]?.click();
    }
  });
}

initCommandPalette();


// Calculation Breakdown Engine
function getCalculationDetails(metric, report) {
  const lookback = screening.lookbackKey(state.criteria);
  const n = lookback === "3" ? report.normalized3y : lookback === "5" ? report.normalized5y : report.normalized;
  const v = { ...report.valuation, ...screening.selectedMetrics(report, state.criteria) };
  const q = report.quality;
  const latest = report.rows[0] || {};
  const price = v.price ?? 0;
  const shares = v.shares ?? 0;
  const mc = v.marketCap ?? (price * shares);
  const nfcf = n.normalizedFcf ?? 0;
  const econNfcf = n.normalizedEconomicFcf ?? 0;
  const netDebt = v.netDebt ?? 0;
  const ev = v.enterpriseValue ?? (mc + netDebt);

  switch (metric) {
    case 'price':
      return {
        title: 'Current Share Price',
        formula: 'Price = Latest Traded Market Close / Real-Time Quote',
        substitution: `Ticker: ${report.ticker}\nExchange: ${report.quote.exchange || "Major US Exchange"}\nCurrent Price: ${compact(price, true)}\nCurrency: ${report.quote.currency || "USD"}`,
        meaning: 'The current market price per common share. Quotes are retrieved from the primary exchange via Yahoo Finance charts.',
        sources: `Feed: ${report.sources.price || "Yahoo Finance Market Data"}`
      };

    case 'marketCap':
      return {
        title: 'Market Capitalization (Equity Value)',
        formula: 'Market Cap = Current Share Price × Diluted Shares Outstanding',
        substitution: `${compact(price, true)} (Price) × ${compact(shares)} (Shares Outstanding)\n= ${compact(mc, true)} Total Equity Valuation`,
        meaning: 'Represents the aggregate dollar value of all equity shares in the market at current pricing.',
        sources: `Shares: ${v.shareSource || "SEC 10-K Weighted Average Diluted Shares"} • Price: Yahoo Finance`
      };

    case 'dividendYield':
      return {
        title: 'Current Dividend Yield',
        formula: 'Dividend yield = Indicated annual dividend per share ÷ Current share price',
        substitution: `Annual dividend: ${compact(report.dividends?.annualRate, true)}\nCurrent price: ${compact(price, true)}\nCurrent yield: ${percent(report.dividends?.currentYield)}\nEx-dividend date: ${report.dividends?.exDividendDate || 'Unavailable'}`,
        meaning: 'This is the most relevant yield for income available at today’s price. It is informational only and does not change the ClearFCF Idea/Review decision.',
        sources: report.sources.dividends || 'Yahoo Finance summary data'
      };

    case 'fiveYearDividendYield':
      return {
        title: 'Five-Year Average Dividend Yield',
        formula: 'Average of historical dividend yields over five years',
        substitution: `Current yield: ${percent(report.dividends?.currentYield)}\nFive-year average: ${percent(report.dividends?.fiveYearAverageYield)}`,
        meaning: 'Comparing current yield with its five-year average can flag an unusually high yield, but a higher yield may reflect a falling share price or dividend risk. It is context, not a quality score.',
        sources: report.sources.dividends || 'Yahoo Finance summary data'
      };

    case 'insiderActivity':
      return {
        title: 'Recent Insider Purchase Activity',
        formula: 'Signal = disclosed purchase activity + independent P/nFCF valuation check',
        substitution: `Purchase records: ${report.insiders?.purchaseCount || 0}\nNet shares reported: ${compact(report.insiders?.netShares)}\nAverage disclosed purchase price: ${compact(report.insiders?.averagePurchasePrice, true)}\nCurrent price: ${compact(price, true)}\nP/nFCF: ${multiple(v.priceToNfcf)}\nSignal: ${report.insiders?.signal || 'Unavailable'}`,
        meaning: report.insiders?.caveat || 'Insider buying can align incentives, but the transaction disclosure does not prove why the insider bought.',
        sources: report.sources.insiders || 'Yahoo Finance insider transaction data'
      };

    case 'normalizedFcf':
      return {
        title: 'Normalized Free Cash Flow (Equal-Weighted)',
        formula: 'Normalized FCF = 50/50 Blended Margin × Latest Annual Revenue\nBlended Margin = (Simple Average Margin + Aggregate Volume-Weighted Margin) ÷ 2',
        substitution: `1. Simple Avg Margin of ${n.usableYears} Years: ${percent(n.simpleAverageMargin)}\n2. Volume-Weighted Margin (Total FCF ${compact(n.totalFcf, true)} ÷ Total Rev ${compact(n.totalRevenue, true)}): ${percent(n.weightedMargin)}\n3. 50/50 Blended Margin: (${percent(n.simpleAverageMargin)} + ${percent(n.weightedMargin)}) ÷ 2 = ${percent(n.blendedMargin)}\n4. Applied to Latest Revenue: ${percent(n.blendedMargin)} × ${compact(n.latestRevenue, true)} = ${compact(nfcf, true)}`,
        meaning: 'Standard annual FCF can swing drastically with working capital cycles and lumpy CapEx. Equal-weighted normalization blends unit-profitability (simple margin) with long-term capital scale (volume-weighted margin) to estimate sustainable earning power.',
        sources: `SEC EDGAR 10-K Filings (${n.usableYears} Usable Years)`
      };

    case 'economicNfcf':
      return {
        title: 'Economic Normalized FCF (Post-Stock-Based Compensation)',
        formula: 'Economic nFCF = Post-SBC normalized margin × Latest Annual Revenue',
        substitution: `The selected ${lookback === "all" ? "full-history" : `${lookback}-year`} window deducts SBC in each annual period before applying the same 50/50 margin normalization.\nEconomic nFCF = ${compact(econNfcf, true)}`,
        meaning: 'Traditional accounting treats employee stock awards as non-cash and adds them back to operating cash flow. In reality, equity compensation permanently dilutes existing shareholders. Treating SBC as an operational compensation expense reveals the true unencumbered cash return to owners.',
        sources: 'SEC EDGAR Cash Flow Statement: us-gaap/ShareBasedCompensation'
      };

    case 'priceToNfcf':
      return {
        title: 'P/nFCF (Price to Normalized Free Cash Flow)',
        formula: 'P/nFCF = Market Capitalization ÷ Normalized FCF',
        substitution: `${compact(mc, true)} (Market Cap)\n÷ ${compact(nfcf, true)} (Normalized FCF)\n= ${multiple(v.priceToNfcf)}`,
        meaning: 'Shows how many dollars of purchase price you pay for every dollar of sustainable normalized cash generation. Lower multiples provide higher fundamental margin of safety. Deep value threshold: < 10x.',
        sources: 'Derived from Market Capitalization and Normalized FCF'
      };

    case 'priceToEconomicNfcf':
      return {
        title: 'P/Economic nFCF (Dilution-Adjusted Multiple)',
        formula: 'P/Economic nFCF = Market Capitalization ÷ Economic Normalized FCF',
        substitution: `${compact(mc, true)} (Market Cap)\n÷ ${compact(econNfcf, true)} (Economic nFCF post-SBC)\n= ${multiple(v.priceToEconomicNfcf)}`,
        meaning: 'The effective cash valuation multiple after absorbing ongoing stock dilution. For tech companies with heavy equity grants, this multiple is often significantly higher than standard P/FCF.',
        sources: 'Derived from Market Cap and Post-SBC Economic Cash Flow'
      };

    case 'evToUnleveredNfcf':
      return {
        title: 'EV / Unlevered nFCF (Firm Enterprise Multiple)',
        formula: 'EV/Unlevered nFCF = Enterprise Value ÷ Unlevered Normalized FCF\nUnlevered nFCF = Normalized FCF + Net Interest Expense × (1 − 21% Tax)',
        substitution: `1. Enterprise Value: ${compact(mc, true)} (Equity) + ${compact(netDebt, true)} (Net Debt) = ${compact(ev, true)}\n2. Unlevered nFCF: ${compact(nfcf, true)} + (${compact(n.averageInterest, true)} normalized interest × 79%) = ${compact(v.evToUnleveredNfcf ? ev / v.evToUnleveredNfcf : null, true)}\n3. EV Multiple: ${compact(ev, true)} ÷ Unlevered nFCF = ${multiple(v.evToUnleveredNfcf)}`,
        meaning: 'Provides a capital-structure-neutral valuation of the operating business. Adding back after-tax interest allows an apples-to-apples comparison between debt-free and leveraged companies.',
        sources: 'SEC 10-K Balance Sheet (Debt, Cash) and Interest Expense'
      };

    case 'fcfYield':
      return {
        title: 'Normalized Free Cash Flow Yield',
        formula: 'FCF Yield = Normalized FCF ÷ Market Capitalization (or 1 ÷ P/nFCF)',
        substitution: `${compact(nfcf, true)} (Normalized FCF)\n÷ ${compact(mc, true)} (Market Cap)\n= ${percent(v.fcfYield)} Free Cash Flow Yield`,
        meaning: 'The cash return generated per dollar invested in equity at today’s valuation. A 10% FCF yield means the business generates 10 cents of free cash flow for every dollar of equity value.',
        sources: 'Normalized FCF relative to Current Market Capitalization'
      };

    case 'economicFcfYield':
      return {
        title: 'Economic Free Cash Flow Yield (Post-SBC)',
        formula: 'Economic Yield = Economic nFCF ÷ Market Capitalization',
        substitution: `${compact(econNfcf, true)} (Economic nFCF)\n÷ ${compact(mc, true)} (Market Cap)\n= ${percent(v.economicFcfYield)}`,
        meaning: 'The true cash return available for dividends, share buybacks, and balance sheet expansion after accounting for shareholder dilution from compensation packages.',
        sources: 'Economic nFCF relative to Current Market Capitalization'
      };

    case 'fcfTrajectory':
      return {
        title: 'FCF Trajectory & Margin Trend',
        formula: 'Trajectory = 3-Year Avg FCF Margin − Historical Baseline Margin',
        substitution: `• Recent 3-Year Avg Margin: ${percent(q.recent3yAvgMargin)}\n• Historical Baseline Margin: ${percent(q.baselineMargin)}\n• Margin Delta / Slope: ${percent(q.marginSlope)}\n• Classified Trajectory: ${q.fcfTrajectory} (Expanding if slope >= +2%, Deteriorating if slope <= -3%)`,
        meaning: 'Kevin Posen warns that high fixed-cost companies in structural decline can show deceptive average yields until profits suddenly fall off a cliff. Tracking the multi-year trajectory protects against declining value traps.',
        sources: 'Calculated across 3-year trailing vs. 5-10 year baseline 10-K filings'
      };

    case 'buybackAudit':
      const ba = q.buybackAudit || {};
      return {
        title: 'Share Buyback Capital Allocation Audit',
        formula: 'Implied Buyback Price = Matched SEC repurchase cash ÷ matched SEC repurchased shares',
        substitution: `• Matched cash: ${compact(ba.totalCashSpent, true)}\n• Matched shares: ${compact(ba.totalSharesRepurchased)}\n• Implied average: ${ba.averageBuybackPrice ? '$' + ba.averageBuybackPrice.toFixed(2) : 'Unavailable'} per share\n• Current price: ${compact(price, true)}\n• Matched years: ${ba.coverageYears || 0}\n• Audit status: ${ba.rating || 'N/A'}\n• ${ba.reason || 'No reconciliation available.'}${ba.periods?.length ? '\n• Annual implied prices: ' + ba.periods.map((item) => `${item.year}: $${item.impliedPrice.toFixed(2)}`).join(', ') : ''}`,
        meaning: 'This is an implied historical price from structured SEC facts. It is not a measure of value creation and has not been reconciled with the issuer’s repurchase table.',
        sources: 'SEC EDGAR Statements of Cash Flow: us-gaap/PaymentsForRepurchaseOfCommonStock & TreasuryStockSharesAcquired'
      };

    case 'capexToDnaRatio':
      return {
        title: 'CapEx to Depreciation & Amortization Ratio',
        formula: 'CapEx / D&A = Cumulative CapEx ÷ Cumulative D&A (over usable periods)',
        substitution: `• Cumulative Capital Expenditures: ${compact(report.rows.reduce((s, r) => s + (r.capex || 0), 0), true)}\n• Cumulative D&A Charges: ${compact(report.rows.reduce((s, r) => s + (r.dna || 0), 0), true)}\n• Ratio: ${(q.capexToDnaRatio * 100).toFixed(0)}%`,
        meaning: 'For mature tangible businesses, CapEx should roughly match depreciation. Ratios below 70% can indicate maintenance deferral (or asset-light business models). Ratios above 150% indicate major capital expansion.',
        sources: 'SEC 10-K Statements of Cash Flow'
      };

    case 'netDebt':
      return {
        title: 'Net Debt Position',
        formula: 'Net Debt = Total Debt (Short-Term + Long-Term) − Cash & Cash Equivalents',
        substitution: `Total Debt: ${compact(v.debt, true)}\n− Cash & Short-Term Investments: ${compact(v.cash, true)}\n= ${compact(v.netDebt, true)} Net Debt`,
        meaning: 'Financial leverage check. Negative net debt means the company has more liquid cash than its entire debt load (a net-cash fortress balance sheet).',
        sources: `Debt: ${report.sources.debt || "Unavailable"} • Cash: ${report.sources.cash || "Unavailable"}`
      };

    case 'netDebtToNfcf':
      return {
        title: 'Net Debt to Normalized FCF Multiple',
        formula: 'Net Debt / nFCF = Net Debt ÷ Normalized Free Cash Flow',
        substitution: `${compact(v.netDebt, true)} (Net Debt)\n÷ ${compact(nfcf, true)} (Normalized FCF)\n= ${multiple(v.netDebtToNfcf)} Years of Cash Flow`,
        meaning: 'How many years of normalized operating cash flow would be required to extinguish all net debt. Ratios below 3x indicate conservative borrowing; above 5x indicates elevated credit risk.',
        sources: 'Derived from Net Debt and Normalized FCF'
      };

    case 'shortDebt':
      return {
        title: 'Short-Term Debt & Near-Term Liquidity Test',
        formula: 'Short-Term Debt = Current Maturities + Commercial Paper + Short-Term Borrowings',
        substitution: `• Short-Term Debt Due within 12 Months: ${compact(v.shortDebt, true)}\n• Cash & Equivalents on Hand: ${compact(v.cash, true)}\n• Annual FCF Generated: ${compact(n.latestReportedFcf, true)}\n• Total Liquidity Available: ${compact((v.cash || 0) + Math.max(0, n.latestReportedFcf || 0), true)}`,
        meaning: 'Immediate solvency safeguard. If debt maturing within 12 months exceeds cash plus annual cash generation, the company faces immediate refinancing risk during liquidity contractions.',
        sources: 'SEC Balance Sheet: us-gaap/ShortTermBorrowings & DebtCurrent'
      };

    case 'usableYears':
      return {
        title: 'Usable Historical Evidence Depth',
        formula: 'Count of Annual 10-K Periods with Audited Revenue, OCF, and CapEx',
        substitution: `Audited Years Compiled: ${n.includedYears ? n.includedYears.join(', ') : `${n.usableYears} years`}\nTotal Revenue across Period: ${compact(n.totalRevenue, true)}\nTotal FCF across Period: ${compact(n.totalFcf, true)}`,
        meaning: 'ClearFCF requires at least 6 usable annual periods for high reliability to ensure margin calculations capture full economic cycles rather than short-term booms.',
        sources: 'SEC EDGAR XBRL Annual 10-K Concept Filings'
      };

    default:
      return {
        title: 'Calculation Details',
        formula: 'Standard Financial Metric',
        substitution: 'Data derived from SEC EDGAR XBRL filings and market quotes.',
        meaning: 'Detailed financial metric.',
        sources: 'SEC EDGAR & Yahoo Finance'
      };
  }
}

function openCalculationModal(metric, report) {
  const modal = $("#calc-modal");
  if (!modal) return;
  modal._returnFocus = document.activeElement;
  const details = getCalculationDetails(metric, report);

  $("#calc-title").textContent = details.title;
  $("#calc-formula").textContent = details.formula;
  $("#calc-substitution").textContent = details.substitution;
  $("#calc-meaning").textContent = details.meaning;
  $("#calc-sources").textContent = details.sources;

  modal.classList.remove("hidden");
  $("#calc-close-btn")?.focus();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureResearchAuthentication(ticker) {
  const status = await request(`/api/research?action=status&_t=${Date.now()}`);
  if (!status.available) throw new Error(status.message || "Codex is unavailable in this ClearFCF installation.");
  if (status.authenticated) return;

  const login = await request("/api/research?action=login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  state.researchJobs[ticker] = {
    status: "signing-in",
    message: "Waiting for ChatGPT sign-in…",
    progress: 5,
    loginUrl: login.url || null
  };
  updateResearchPanel(ticker);
  setStatus("Complete the ChatGPT sign-in flow in your browser.");

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await wait(2000);
    const refreshed = await request(`/api/research?action=status&force=1&_t=${Date.now()}`);
    if (refreshed.authenticated) return;
  }
  throw new Error("ChatGPT sign-in was not completed within three minutes. Try AI Deep Analysis again when ready.");
}

async function pollResearchJob(ticker, jobId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await wait(2000);
    if (state.researchJobs[ticker]?.id && state.researchJobs[ticker].id !== jobId) return;
    const job = await request(`/api/research?action=job&id=${encodeURIComponent(jobId)}&_t=${Date.now()}`);
    state.researchJobs[ticker] = job;
    updateResearchPanel(ticker);
    if (job.status === "completed") {
      const saved = await saveResearchReport(ticker, {
        ...job.result,
        researchConfiguration: { model: job.model, effort: job.effort }
      });
      delete state.researchJobs[ticker];
      updateResearchPanel(ticker);
      if (saved) setStatus(`${ticker} AI deep analysis complete and saved locally.`);
      return;
    }
    if (["failed", "cancelled"].includes(job.status)) {
      setStatus(job.error || job.message || "Deep research stopped.", job.status === "failed");
      return;
    }
  }
  state.researchJobs[ticker] = { status: "failed", message: "Research timed out.", progress: 0, error: "The research job did not finish within twenty minutes." };
  updateResearchPanel(ticker);
}

async function startDeepResearch(ticker) {
  const report = state.reports[ticker];
  if (!report) return setStatus("Load a company report before starting AI deep analysis.", true);
  const current = state.researchJobs[ticker];
  if (current && !["failed", "cancelled"].includes(current.status)) return;

  state.researchJobs[ticker] = { status: "authenticating", message: "Checking ChatGPT connection…", progress: 3 };
  updateResearchPanel(ticker);
  try {
    await ensureResearchAuthentication(ticker);
    state.researchJobs[ticker] = { status: "queued", message: "Preparing ClearFCF evidence…", progress: 7 };
    updateResearchPanel(ticker);
    const job = await request("/api/research?action=start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report,
        model: state.researchSettings.model,
        effort: state.researchSettings.effort
      })
    });
    state.researchJobs[ticker] = job;
    updateResearchPanel(ticker);
    setStatus(`${ticker} AI deep analysis is running.`);
    await pollResearchJob(ticker, job.id);
  } catch (error) {
    state.researchJobs[ticker] = { status: "failed", message: "Deep research could not start.", progress: 0, error: error.message };
    updateResearchPanel(ticker);
    setStatus(error.message, true);
  }
}

async function cancelDeepResearch(ticker, jobId) {
  if (!jobId) return;
  try {
    const job = await request("/api/research?action=cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId })
    });
    state.researchJobs[ticker] = job;
    updateResearchPanel(ticker);
    setStatus(`${ticker} research cancelled.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveReportPdf(ticker, button) {
  if (!window.clearFcfDesktop?.saveReportPdf) {
    setStatus("PDF export is available in the ClearFCF desktop app.", true);
    return;
  }
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Creating PDF…";
  }
  document.body.classList.add("pdf-exporting");
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = await window.clearFcfDesktop.saveReportPdf({ ticker });
    if (result?.saved) setStatus(`${ticker} report saved as a PDF.`);
    else setStatus("PDF export cancelled.");
  } catch (error) {
    setStatus(error.message || "The PDF could not be created.", true);
  } finally {
    document.body.classList.remove("pdf-exporting");
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

$("#report")?.addEventListener("change", (event) => {
  if (event.target.matches(".research-model-select")) {
    state.researchSettings.model = event.target.value;
    if (!allowedResearchEfforts().includes(state.researchSettings.effort)) state.researchSettings.effort = "xhigh";
    const effortSelect = event.currentTarget.querySelector(".research-effort-select");
    if (effortSelect) effortSelect.innerHTML = researchEffortOptions();
  }
  else if (event.target.matches(".research-effort-select")) state.researchSettings.effort = event.target.value;
  else return;
  saveResearchSettings();
});

function closeDeepAnalysisModal() {
  const modal = $("#deep-analysis-modal");
  modal?.classList.add("hidden");
  modal?._returnFocus?.focus?.();
}

function openDeepAnalysisModal(ticker, returnFocus) {
  const modal = $("#deep-analysis-modal");
  if (!modal) return;
  modal.dataset.ticker = ticker;
  modal._returnFocus = returnFocus;
  $("#deep-analysis-company").textContent = `Choose how you want to analyze ${ticker}. Both paths remain under Deep Analysis.`;
  $("#choose-financial-analysis").href = `/financial-analysis?ticker=${encodeURIComponent(ticker)}`;
  modal.classList.remove("hidden");
  $("#choose-ai-analysis")?.focus();
}

$("#deep-analysis-backdrop")?.addEventListener("click", closeDeepAnalysisModal);
$("#deep-analysis-close")?.addEventListener("click", closeDeepAnalysisModal);
$("#choose-ai-analysis")?.addEventListener("click", () => {
  const ticker = $("#deep-analysis-modal")?.dataset.ticker;
  closeDeepAnalysisModal();
  if (ticker) void startDeepResearch(ticker);
});
$("#choose-financial-analysis")?.addEventListener("click", closeDeepAnalysisModal);

$("#report")?.addEventListener("click", (event) => {
  const saveButton = event.target.closest(".report-save-list[data-ticker]");
  if (saveButton) {
    void addTickerToCurrentList(saveButton.dataset.ticker);
    return;
  }
  const analysisButton = event.target.closest(".deep-analysis-btn[data-ticker]");
  if (analysisButton) {
    openDeepAnalysisModal(analysisButton.dataset.ticker, analysisButton);
    return;
  }
  const researchButton = event.target.closest(".deep-research-btn[data-ticker]");
  if (researchButton) {
    void startDeepResearch(researchButton.dataset.ticker);
    return;
  }
  const cancelButton = event.target.closest(".research-cancel-btn[data-job-id]");
  if (cancelButton) {
    void cancelDeepResearch(cancelButton.dataset.ticker, cancelButton.dataset.jobId);
    return;
  }
  const memoButton = event.target.closest(".memo-btn[data-ticker]");
  if (memoButton) {
    void saveReportPdf(memoButton.dataset.ticker, memoButton);
    return;
  }
  const tile = event.target.closest(".metric.clickable[data-metric]");
  if (!tile) return;
  const ticker = $("#single-ticker")?.value.trim().toUpperCase();
  const report = ticker ? state.reports[ticker] : null;
  if (report) openCalculationModal(tile.dataset.metric, report);
});

function closeCalculationModal() {
  const modal = $("#calc-modal");
  modal?.classList.add("hidden");
  modal?._returnFocus?.focus?.();
}

$("#calc-backdrop")?.addEventListener("click", closeCalculationModal);
$("#calc-close-btn")?.addEventListener("click", closeCalculationModal);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#deep-analysis-modal")?.classList.contains("hidden")) {
    closeDeepAnalysisModal();
    return;
  }
  if (e.key === "Escape" && !$("#calc-modal")?.classList.contains("hidden")) {
    closeCalculationModal();
  }
});






// Global Criteria Controllers & Real-Time Listeners
function syncCriteriaControls(criteria, presetKey = "custom") {
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const active = btn.dataset.preset === presetKey;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  if ($("#tol-multiple")) { $("#tol-multiple").value = criteria.maxMultiple; $("#tol-multiple-val").textContent = `${criteria.maxMultiple}x`; }
  if ($("#tol-ev-multiple")) {
    const evVal = Number.isFinite(criteria.maxEvMultiple) ? criteria.maxEvMultiple : 100;
    $("#tol-ev-multiple").value = Math.min(100, evVal);
    $("#tol-ev-multiple-val").textContent = evVal >= 100 ? "Any (100x+)" : `${evVal}x`;
  }
  const minMcIndex = Math.max(0, MC_LEVELS.indexOf(criteria.minMarketCap));
  const maxMcIndex = criteria.maxMarketCap === Infinity ? 8 : Math.max(0, MAX_MC_LEVELS.indexOf(criteria.maxMarketCap));
  if ($("#tol-min-mc-slider")) { $("#tol-min-mc-slider").value = minMcIndex; $("#tol-min-mc-val").textContent = MC_LEVEL_LABELS[minMcIndex]; }
  if ($("#tol-max-mc-slider")) { $("#tol-max-mc-slider").value = maxMcIndex; $("#tol-max-mc-val").textContent = MAX_MC_LEVEL_LABELS[maxMcIndex]; }
  if ($("#tol-years")) { $("#tol-years").value = criteria.minYears; $("#tol-years-val").textContent = `${criteria.minYears} yrs`; }
  if ($("#tol-debt")) { $("#tol-debt").value = criteria.maxDebt; $("#tol-debt-val").textContent = `${Number(criteria.maxDebt).toFixed(1)}x`; }
  if ($("#tol-sbc")) { $("#tol-sbc").value = Math.round(criteria.maxSbc * 100); $("#tol-sbc-val").textContent = `${Math.round(criteria.maxSbc * 100)}%`; }
  if ($("#tol-dilution")) { $("#tol-dilution").value = Math.round(criteria.maxDilution * 100); $("#tol-dilution-val").textContent = `${Math.round(criteria.maxDilution * 100)}%`; }
  if ($("#tol-posfcf")) { $("#tol-posfcf").value = Math.round(criteria.minPosFcf * 100); $("#tol-posfcf-val").textContent = `${Math.round(criteria.minPosFcf * 100)}%`; }
  if ($("#tol-solvency")) $("#tol-solvency").checked = criteria.enforceSolvency;
  if ($("#tol-financials")) $("#tol-financials").checked = criteria.excludeFinancials;
  if ($("#lookback-select")) $("#lookback-select").value = criteria.lookbackYears || "all";
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  state.activePreset = presetKey;
  state.criteria = { ...PRESETS.default, ...preset };

  syncCriteriaControls(preset, presetKey);
  reEvaluateAll();
}

function markCustom() {
  state.activePreset = "custom";
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  });
  reEvaluateAll();
}

function reEvaluateAll() {
  // If auto scan has examined companies, re-evaluate all against current criteria
  if (state.auto && state.auto.allExamined) {
    state.auto.results = state.auto.allExamined.filter((r) => evaluateReportStatus(r, state.criteria) === "Idea");
    saveAuto();
    updateAutoUi();
  } else {
    refreshActiveTable();
  }

  // If a single company report is open, update its badge & status
  const currentTicker = $("#single-ticker")?.value.trim().toUpperCase();
  if (currentTicker && state.reports[currentTicker] && document.querySelector("#report").innerHTML.includes("report-card")) {
    $("#report").innerHTML = renderReport(state.reports[currentTicker]);
  }
}

// Wire up preset buttons
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
});

// Wire up all sliders with real-time feedback
$("#tol-multiple")?.addEventListener("input", (e) => {
  state.criteria.maxMultiple = Number(e.target.value);
  $("#tol-multiple-val").textContent = `${e.target.value}x`;
  markCustom();
});

$("#tol-years")?.addEventListener("input", (e) => {
  state.criteria.minYears = Number(e.target.value);
  $("#tol-years-val").textContent = `${e.target.value} yrs`;
  markCustom();
});

$("#tol-debt")?.addEventListener("input", (e) => {
  state.criteria.maxDebt = Number(e.target.value);
  $("#tol-debt-val").textContent = `${Number(e.target.value).toFixed(1)}x`;
  markCustom();
});

$("#tol-sbc")?.addEventListener("input", (e) => {
  state.criteria.maxSbc = Number(e.target.value) / 100;
  $("#tol-sbc-val").textContent = `${e.target.value}%`;
  markCustom();
});

$("#tol-dilution")?.addEventListener("input", (e) => {
  state.criteria.maxDilution = Number(e.target.value) / 100;
  $("#tol-dilution-val").textContent = `${e.target.value}%`;
  markCustom();
});

$("#tol-posfcf")?.addEventListener("input", (e) => {
  state.criteria.minPosFcf = Number(e.target.value) / 100;
  $("#tol-posfcf-val").textContent = `${e.target.value}%`;
  markCustom();
});

$("#tol-solvency")?.addEventListener("change", (e) => {
  state.criteria.enforceSolvency = e.target.checked;
  markCustom();
});

$("#tol-financials")?.addEventListener("change", (e) => {
  state.criteria.excludeFinancials = e.target.checked;
  markCustom();
});

$("#lookback-select")?.addEventListener("change", (e) => {
  state.criteria.lookbackYears = e.target.value;
  markCustom();
});

// Reset Search functionality
async function resetSearch() {
  state.stopped = true;
  state.auto = null;
  const container = $("#idea-results");
  if (container) {
    container.innerHTML = initialIdeaEmptyHtml();
    delete container._rawResults;
    delete container._rawTitle;
  }
  $("#progress-wrap")?.classList.remove("is-running");
  $("#progress-wrap")?.classList.add("hidden");
  $("#result-filters")?.classList.add("hidden");
  $("#find-button").disabled = false;
  $("#find-button").classList.remove("hidden");
  $("#stop-button").disabled = true;
  $("#stop-button").classList.add("hidden");
  $("#find-button").textContent = "Start scan";
  try {
    await scanWriteQueue.catch(() => {});
    await workspaceStorage.remove(STORAGE_KEY);
    scanSaveMessage("Not yet saved");
    setStatus("Scan reset. Choose a universe and start when ready.");
  } catch (error) {
    scanSaveMessage("Reset could not be saved", true);
    setStatus(`Saved scan could not be cleared: ${error.message}`, true);
  }
}
$("#reset-search-btn")?.addEventListener("click", resetSearch);


$("#tol-min-mc-slider")?.addEventListener("input", (e) => {
  const idx = Number(e.target.value);
  state.criteria.minMarketCap = MC_LEVELS[idx] || 0;
  $("#tol-min-mc-val").textContent = MC_LEVEL_LABELS[idx] || "$0 (All)";
  markCustom();
});

$("#tol-max-mc-slider")?.addEventListener("input", (e) => {
  const idx = Number(e.target.value);
  state.criteria.maxMarketCap = MAX_MC_LEVELS[idx] ?? Infinity;
  $("#tol-max-mc-val").textContent = MAX_MC_LEVEL_LABELS[idx] || "Any ($5T+)";
  markCustom();
});


$("#tol-ev-multiple")?.addEventListener("input", (e) => {
  const val = Number(e.target.value);
  if (val >= 100) {
    state.criteria.maxEvMultiple = Infinity;
    $("#tol-ev-multiple-val").textContent = "Any (100x+)";
  } else {
    state.criteria.maxEvMultiple = val;
    $("#tol-ev-multiple-val").textContent = `${val}x`;
  }
  markCustom();
});

// Saved research workspace
let watchlistWriteQueue = Promise.resolve();
const watchlistReady = (async () => {
  try {
    state.workspace = workspaceModel.normalize(await workspaceStorage.get(WORKSPACE_KEY));
    state.activeWatchlistId = state.workspace.watchlists[0]?.id || null;
    $("#workspace-save-state").textContent = "Saved locally";
  } catch (error) {
    $("#workspace-save-state").textContent = "Saved work could not be loaded";
    $("#workspace-save-state").dataset.state = "error";
    setStatus(`Watchlists could not be loaded: ${error.message}`, true);
  }
  renderWatchlists();
})();

function currentWatchlist() {
  return state.workspace.watchlists.find((list) => list.id === state.activeWatchlistId) || null;
}

function saveWorkspace() {
  const indicator = $("#workspace-save-state");
  indicator.textContent = "Saving…";
  indicator.dataset.state = "saving";
  const snapshot = workspaceModel.normalize(state.workspace);
  watchlistWriteQueue = watchlistWriteQueue.catch(() => {}).then(() => workspaceStorage.set(WORKSPACE_KEY, snapshot));
  return watchlistWriteQueue.then(() => {
    indicator.textContent = "Saved locally";
    indicator.dataset.state = "saved";
    return true;
  }).catch((error) => {
    indicator.textContent = "Save failed — export your work";
    indicator.dataset.state = "error";
    setStatus(`Watchlist could not be saved: ${error.message}`, true);
    return false;
  });
}

function changeText(change) {
  if (!change) return "First saved screen";
  const parts = [];
  if (change.pricePercent != null) parts.push(`Price ${change.pricePercent >= 0 ? "+" : ""}${percent(change.pricePercent)}`);
  if (change.multipleChange != null) parts.push(`P/nFCF ${change.multipleChange >= 0 ? "+" : ""}${change.multipleChange.toFixed(1)}x`);
  if (change.status) parts.push(change.status);
  if (change.financialPeriodChanged) parts.push("New financial period");
  return parts.join(" · ") || "No tracked change";
}

function renderWatchlists() {
  const selected = currentWatchlist();
  const picker = $("#watchlist-select");
  picker.innerHTML = state.workspace.watchlists.length
    ? state.workspace.watchlists.map((list) => `<option value="${escapeHtml(list.id)}" ${list.id === selected?.id ? "selected" : ""}>${escapeHtml(list.name)} (${list.entries.length})</option>`).join("")
    : '<option value="">Create a watchlist to begin</option>';
  for (const selector of ["#watchlist-rescreen", "#watchlist-delete", "#watchlist-add-tickers", "#watchlist-add-form button"]) {
    const node = $(selector);
    if (node) node.disabled = !selected;
  }
  if (!selected) {
    $("#watchlist-entries").innerHTML = '<p class="workspace-empty">Create a list or add a company from a screen or report.</p>';
    $("#watchlist-run-summary").innerHTML = "";
    return;
  }
  $("#watchlist-entries").innerHTML = selected.entries.length ? `<p class="workspace-alert-hint">Optional alerts run when you click Rescreen list. They do not monitor prices or filings in the background.</p><div class="table-scroll"><table class="watchlist-table"><thead><tr><th>Company</th><th>Review status</th><th>Thesis</th><th>Key risk</th><th>Last reviewed</th><th>Rescreen alert</th><th>Actions</th></tr></thead><tbody>${selected.entries.map((entry) => `<tr>
    <td><button type="button" class="text-link" data-watchlist-report="${escapeHtml(entry.ticker)}">${escapeHtml(entry.ticker)}</button></td>
    <td><select data-entry-field="status" data-entry-ticker="${escapeHtml(entry.ticker)}">${["Watching", "Investigating", "Pass"].map((status) => `<option ${status === entry.status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
    <td><textarea rows="2" maxlength="2000" data-entry-field="thesis" data-entry-ticker="${escapeHtml(entry.ticker)}" aria-label="Thesis for ${escapeHtml(entry.ticker)}" placeholder="Why it may be interesting">${escapeHtml(entry.thesis)}</textarea></td>
    <td><textarea rows="2" maxlength="2000" data-entry-field="risk" data-entry-ticker="${escapeHtml(entry.ticker)}" aria-label="Key risk for ${escapeHtml(entry.ticker)}" placeholder="What could break the thesis">${escapeHtml(entry.risk)}</textarea></td>
    <td>${entry.lastReviewedAt ? escapeHtml(new Date(entry.lastReviewedAt).toLocaleDateString()) : "—"}</td>
    <td><select data-entry-field="alertType" data-entry-ticker="${escapeHtml(entry.ticker)}" aria-label="Rescreen alert for ${escapeHtml(entry.ticker)}">${[["none", "Off"], ["price-below", "Price below"], ["multiple-below", "P/nFCF below"], ["status-change", "Status change"], ["new-period", "New financial period"]].map(([type, label]) => `<option value="${type}" ${type === entry.alert?.type ? "selected" : ""}>${label}</option>`).join("")}</select><input type="number" min="0.01" step="0.01" data-entry-field="alertThreshold" data-entry-ticker="${escapeHtml(entry.ticker)}" aria-label="Alert threshold for ${escapeHtml(entry.ticker)}" placeholder="Threshold" value="${entry.alert?.threshold ?? ""}" ${["price-below", "multiple-below"].includes(entry.alert?.type) ? "" : "disabled"}></td>
    <td><div class="watchlist-actions"><button type="button" data-entry-review="${escapeHtml(entry.ticker)}" class="secondary compact-button">Mark reviewed</button><a href="/financial-analysis?ticker=${encodeURIComponent(entry.ticker)}">DCF ↗</a><button type="button" data-entry-remove="${escapeHtml(entry.ticker)}" class="utility-button">Remove</button></div></td>
  </tr>`).join("")}</tbody></table></div>` : '<p class="workspace-empty">Add tickers to this list, then rescreen it.</p>';
  const run = selected.lastRun;
  if (!run) {
    $("#watchlist-run-summary").innerHTML = '<p class="workspace-empty">No saved screen yet. Rescreen this list to establish a baseline.</p>';
    return;
  }
  const criteriaChanged = selected.previousRun && JSON.stringify(run.criteria) !== JSON.stringify(selected.previousRun.criteria);
  $("#watchlist-run-summary").innerHTML = `<div class="watchlist-run-head"><div><p class="kicker">Saved screen</p><h3>${escapeHtml(new Date(run.at).toLocaleString())}</h3><p class="muted">${run.rows.length} analyzed · ${run.failures.length} unresolved · ${escapeHtml(run.criteria.name || "Custom")} criteria${criteriaChanged ? " · Criteria changed since prior run" : ""}</p></div></div>
    <div class="table-scroll"><table class="watchlist-deltas"><thead><tr><th>Ticker</th><th>Decision</th><th>Price</th><th>P/nFCF</th><th>Evidence</th><th>Financial period</th><th>Since prior run</th></tr></thead><tbody>${run.rows.map((row) => `<tr><td><button class="text-link" type="button" data-watchlist-report="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</button></td><td>${escapeHtml(row.status)}</td><td>${compact(row.price, true)}</td><td>${multiple(row.priceToNfcf)}</td><td>${escapeHtml(row.evidenceConfidence?.level || "Unknown")}</td><td>${escapeHtml(row.financialPeriodEnd || "Unavailable")}</td><td>${escapeHtml(criteriaChanged ? "Criteria changed; compare with care" : changeText(workspaceModel.changeFor(selected, row.ticker)))}</td></tr>`).join("")}</tbody></table></div>
    ${run.alerts.length ? `<div class="workspace-alert-results"><strong>${run.alerts.length} rescreen alert${run.alerts.length === 1 ? "" : "s"}</strong><ul>${run.alerts.map((alert) => `<li>${escapeHtml(alert.ticker)}: ${escapeHtml(alert.reason)}</li>`).join("")}</ul></div>` : ""}
    ${run.failures.length ? `<p class="workspace-failures">Unresolved: ${run.failures.map((failure) => `${escapeHtml(failure.ticker)} (${escapeHtml(failure.error)})`).join(" · ")}</p>` : ""}`;
}

async function addTickerToCurrentList(ticker) {
  await watchlistReady;
  try {
    if (!currentWatchlist()) {
      const created = workspaceModel.addWatchlist(state.workspace, "Research list");
      state.workspace = created.workspace;
      state.activeWatchlistId = created.id;
    }
    workspaceModel.addTickers(currentWatchlist(), [ticker]);
    renderWatchlists();
    if (await saveWorkspace()) setStatus(`${ticker} added to ${currentWatchlist().name}.`);
  } catch (error) { setStatus(error.message, true); }
}

$("#watchlist-create")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await watchlistReady;
  try {
    const created = workspaceModel.addWatchlist(state.workspace, $("#watchlist-name").value);
    state.workspace = created.workspace;
    state.activeWatchlistId = created.id;
    $("#watchlist-name").value = "";
    renderWatchlists();
    await saveWorkspace();
  } catch (error) { setStatus(error.message, true); }
});
$("#watchlist-select")?.addEventListener("change", (event) => {
  state.activeWatchlistId = event.target.value;
  renderWatchlists();
});
$("#watchlist-add-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const list = currentWatchlist();
  if (!list) return;
  try {
    workspaceModel.addTickers(list, parseTickers($("#watchlist-add-tickers").value));
    $("#watchlist-add-tickers").value = "";
    renderWatchlists();
    await saveWorkspace();
  } catch (error) { setStatus(error.message, true); }
});
$("#watchlist-delete")?.addEventListener("click", async () => {
  const list = currentWatchlist();
  if (!list || !window.confirm(`Delete the saved watchlist “${list.name}”?`)) return;
  state.workspace.watchlists = state.workspace.watchlists.filter((item) => item.id !== list.id);
  state.activeWatchlistId = state.workspace.watchlists[0]?.id || null;
  renderWatchlists();
  await saveWorkspace();
});
$("#watchlist-entries")?.addEventListener("change", async (event) => {
  const target = event.target.closest("[data-entry-field]");
  const list = currentWatchlist();
  const entry = list?.entries.find((item) => item.ticker === target?.dataset.entryTicker);
  if (!entry) return;
  if (target.dataset.entryField === "alertType") {
    entry.alert.type = target.value;
    if (!["price-below", "multiple-below"].includes(target.value)) entry.alert.threshold = null;
    renderWatchlists();
  } else if (target.dataset.entryField === "alertThreshold") {
    entry.alert.threshold = Number(target.value) > 0 ? Number(target.value) : null;
  } else entry[target.dataset.entryField] = target.value;
  list.updatedAt = new Date().toISOString();
  await saveWorkspace();
});
$("#watchlist-entries")?.addEventListener("click", async (event) => {
  const reportButton = event.target.closest("[data-watchlist-report]");
  if (reportButton) return void openReport(reportButton.dataset.watchlistReport);
  const list = currentWatchlist();
  if (!list) return;
  const review = event.target.closest("[data-entry-review]");
  const remove = event.target.closest("[data-entry-remove]");
  if (review) list.entries.find((entry) => entry.ticker === review.dataset.entryReview).lastReviewedAt = new Date().toISOString();
  else if (remove) list.entries = list.entries.filter((entry) => entry.ticker !== remove.dataset.entryRemove);
  else return;
  list.updatedAt = new Date().toISOString();
  renderWatchlists();
  await saveWorkspace();
});
$("#watchlist-run-summary")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-watchlist-report]");
  if (button) void openReport(button.dataset.watchlistReport);
});
$("#save-screened-tickers")?.addEventListener("click", async () => {
  const symbols = parseTickers($("#ticker-list").value);
  if (!symbols.length) return setStatus("Paste tickers to add to a watchlist.", true);
  await watchlistReady;
  try {
    if (!currentWatchlist()) {
      const created = workspaceModel.addWatchlist(state.workspace, "Research list");
      state.workspace = created.workspace;
      state.activeWatchlistId = created.id;
    }
    workspaceModel.addTickers(currentWatchlist(), symbols);
    renderWatchlists();
    if (await saveWorkspace()) setStatus(`${symbols.length} tickers added to ${currentWatchlist().name}.`);
  } catch (error) { setStatus(error.message, true); }
});
$("#watchlist-rescreen")?.addEventListener("click", async () => {
  await watchlistReady;
  const list = currentWatchlist();
  if (!list?.entries.length) return setStatus("Add tickers before rescreening the list.", true);
  const button = $("#watchlist-rescreen");
  button.disabled = true;
  try {
    const symbols = list.entries.map((entry) => entry.ticker);
    setStatus(`Rescreening ${list.name}: 0 of ${symbols.length} analyzed.`);
    const data = await screenInBatches(symbols, (done) => setStatus(`Rescreening ${list.name}: ${done} of ${symbols.length} requested.`));
    const rows = data.results.map((row) => ({ ...row, ...screening.evaluateCandidate(row, state.criteria).selected,
      status: screening.evaluateCandidate(row, state.criteria).status }));
    workspaceModel.recordRun(list, rows, state.criteria, data.failures);
    renderWatchlists();
    await saveWorkspace();
    setStatus(`${list.name}: ${rows.length} analyzed, ${data.failures.length} unresolved. Changes are shown below.`);
  } catch (error) { setStatus(`Rescreen stopped: ${error.message}`, true); }
  finally { button.disabled = false; }
});

function openComparison(container) {
  const rows = [...(container._compareSelected || [])].map((ticker) => container._rawResults?.find((row) => row.ticker === ticker)).filter(Boolean);
  if (rows.length < 2 || rows.length > 5) return setStatus("Select two to five companies from the current results.", true);
  const evaluated = rows.map((row) => ({ row, evaluation: screening.evaluateCandidate(row, state.criteria) }));
  const metricRows = [
    ["Decision", ({ evaluation }) => evaluation.status],
    ["Price", ({ row }) => compact(row.price, true)],
    ["Market cap", ({ row }) => compact(row.marketCap, true), true],
    ["P/nFCF", ({ evaluation }) => multiple(evaluation.selected.priceToNfcf), true],
    ["FCF yield", ({ evaluation }) => percent(evaluation.selected.fcfYield), true],
    ["Normalized FCF", ({ evaluation }) => compact(evaluation.selected.normalizedFcf, true), true],
    ["Net debt/nFCF", ({ evaluation }) => multiple(evaluation.selected.netDebtToNfcf), true],
    ["Usable years", ({ row }) => row.usableYears ?? "—", true],
    ["Evidence confidence", ({ row }) => row.evidenceConfidence?.level || "Unknown"],
    ["Quote currency", ({ row }) => row.quoteCurrency || "Unavailable"],
    ["Price as of", ({ row }) => row.marketDataAsOf ? new Date(row.marketDataAsOf).toLocaleString() : "Unavailable"],
    ["Financial period", ({ row }) => row.financialPeriodEnd || "Unavailable"],
    ["Why not Idea", ({ evaluation }) => evaluation.reasons?.join("; ") || "All active checks passed"]
  ];
  $("#compare-content").innerHTML = `<p class="muted compare-criteria">${escapeHtml(state.criteria.name || "Custom")} criteria · ${escapeHtml(screening.lookbackKey(state.criteria))} lookback · Missing and partial-confidence values are marked.</p><table class="comparison-table"><thead><tr><th>Metric</th>${evaluated.map(({ row }) => `<th><button type="button" class="text-link" data-compare-report="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</button><small>${escapeHtml(row.companyName || "")}</small></th>`).join("")}</tr></thead><tbody>${metricRows.map(([label, getter, needsEvidence]) => `<tr><th scope="row">${escapeHtml(label)}</th>${evaluated.map((item) => {
    const value = getter(item);
    const confidence = item.row.evidenceConfidence?.level || "Unknown";
    const note = value === "—" || value === "Unavailable" ? "Missing" : needsEvidence && ["Partial", "Unsafe", "Unknown"].includes(confidence) ? `${confidence} evidence` : "";
    return `<td>${escapeHtml(value)}${note ? `<small class="comparison-note">${escapeHtml(note)}</small>` : ""}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
  $("#compare-modal")._returnFocus = container.querySelector(".compare-button");
  $("#compare-modal").classList.remove("hidden");
  $("#compare-close").focus();
}
function closeComparison() {
  $("#compare-modal").classList.add("hidden");
  $("#compare-modal")._returnFocus?.focus();
}
$("#compare-close")?.addEventListener("click", closeComparison);
$("#compare-backdrop")?.addEventListener("click", closeComparison);
$("#compare-content")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-compare-report]");
  if (button) { closeComparison(); void openReport(button.dataset.compareReport); }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#compare-modal")?.classList.contains("hidden")) closeComparison();
});

function readDcfModels() {
  const models = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("clearfcf-financial-analysis-v2:")) models[key] = JSON.parse(localStorage.getItem(key));
  }
  return models;
}
function downloadWorkspace(value) {
  const body = JSON.stringify(value, null, 2);
  const file = new Blob([body], { type: "application/json" });
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Workspace backup exceeds the 100 MB file limit.");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `clearfcf-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return file.size;
}
$("#workspace-export")?.addEventListener("click", async () => {
  await watchlistReady;
  try {
    await Promise.all([scanWriteQueue.catch(() => {}), watchlistWriteQueue.catch(() => {})]);
    const backup = workspaceModel.validateBackup({ format: "clearfcf-workspace", version: workspaceModel.VERSION,
      exportedAt: new Date().toISOString(), workspace: state.workspace, scan: await workspaceStorage.get(STORAGE_KEY),
      researchReports: state.researchReports, dcfModels: readDcfModels(),
      dcfDefaults: JSON.parse(localStorage.getItem("clearfcf-wacc-defaults-v1") || "null") });
    const bytes = downloadWorkspace(backup);
    setStatus(`Workspace backup downloaded (${(bytes / 1024 / 1024).toFixed(2)} MB). Keep the file somewhere you control.`);
  } catch (error) { setStatus(`Workspace export failed: ${error.message}`, true); }
});
$("#workspace-import")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  await watchlistReady;
  if (file.size > MAX_BACKUP_BYTES) return setStatus("Workspace file exceeds the 100 MB import limit.", true);
  if ($("#progress-wrap")?.classList.contains("is-running")) return setStatus("Stop the current scan before importing a workspace.", true);
  try {
    const incoming = workspaceModel.validateBackup(JSON.parse(await file.text()));
    if (incoming.scan) scanState.normalize(incoming.scan);
    const replace = $("#workspace-import-mode").value === "replace";
    if (replace && !window.confirm("Replace your current watchlists, scan, research reports, and DCF models with this backup?")) return;
    const nextWorkspace = replace ? incoming.workspace : workspaceModel.merge(state.workspace, incoming.workspace);
    const existingModels = readDcfModels();
    const nextModels = replace ? incoming.dcfModels : { ...incoming.dcfModels, ...existingModels };
    const nextResearch = replace ? incoming.researchReports : { ...incoming.researchReports, ...state.researchReports };
    await workspaceStorage.set(WORKSPACE_KEY, nextWorkspace);
    if (replace && !incoming.scan) await workspaceStorage.remove(STORAGE_KEY);
    else if (replace || !state.auto) if (incoming.scan) await workspaceStorage.set(STORAGE_KEY, incoming.scan);
    await workspaceStorage.set(RESEARCH_STORAGE_KEY, nextResearch);
    for (const key of Object.keys(existingModels)) if (replace && !Object.hasOwn(nextModels, key)) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(nextModels)) localStorage.setItem(key, JSON.stringify(value));
    if (incoming.dcfDefaults) localStorage.setItem("clearfcf-wacc-defaults-v1", JSON.stringify(incoming.dcfDefaults));
    else if (replace) localStorage.removeItem("clearfcf-wacc-defaults-v1");
    state.workspace = nextWorkspace;
    state.activeWatchlistId = nextWorkspace.watchlists[0]?.id || null;
    state.researchReports = nextResearch;
    if (replace || !state.auto) state.auto = incoming.scan ? scanState.normalize(incoming.scan) : null;
    if (state.auto) {
      if (state.auto.criteria) {
        state.criteria = { ...PRESETS.default, ...state.auto.criteria,
          maxMarketCap: state.auto.criteria.maxMarketCap == null ? Infinity : state.auto.criteria.maxMarketCap };
        state.activePreset = state.auto.activePreset || "custom";
        syncCriteriaControls(state.criteria, state.activePreset);
      }
      state.auto.results = state.auto.allExamined.filter((row) => evaluateReportStatus(row, state.criteria) === "Idea");
      updateAutoUi();
      $("#find-button").textContent = state.auto.complete ? "Start new scan" : "Resume scan";
      scanSaveMessage("Saved locally");
    } else {
      $("#progress-wrap").classList.add("hidden");
      $("#idea-results").innerHTML = initialIdeaEmptyHtml();
      $("#find-button").textContent = "Start scan";
      scanSaveMessage("Not yet saved");
    }
    renderWatchlists();
    $("#workspace-save-state").textContent = "Saved locally";
    setStatus(`Workspace imported: ${nextWorkspace.watchlists.length} watchlists and ${Object.keys(nextModels).length} DCF models.`);
  } catch (error) { setStatus(`Workspace import failed: ${error.message}`, true); }
});
