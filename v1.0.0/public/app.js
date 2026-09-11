"use strict";

const $ = (selector) => document.querySelector(selector);

const MC_LEVELS = [0, 500e6, 1e9, 2e9, 5e9, 10e9, 50e9, 100e9, 500e9];
const MC_LEVEL_LABELS = ["$0 (All)", "$500M", "$1B", "$2B", "$5B", "$10B", "$50B", "$100B", "$500B"];

const MAX_MC_LEVELS = [1e9, 2e9, 5e9, 10e9, 50e9, 200e9, 500e9, 1e12, Infinity];
const MAX_MC_LEVEL_LABELS = ["$1B", "$2B", "$5B", "$10B", "$50B", "$200B", "$500B", "$1T", "Any ($5T+)"];

const PRESETS = {
  default: {
    name: "Default",
    maxMultiple: 15,
    maxEvMultiple: 20,
    minYears: 6,
    maxDebt: 4.0,
    maxSbc: 0.30,
    maxDilution: 0.25,
    minPosFcf: 0.67,
    minMarketCap: 0,
    maxMarketCap: Infinity,
    enforceSolvency: true,
    excludeFinancials: true
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
    enforceSolvency: false,
    excludeFinancials: true
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
    enforceSolvency: true,
    excludeFinancials: true
  }
};

const state = {
  auto: null,
  reports: {},
  stopped: false,
  activeFilters: new Set(),
  sortKey: 'priceToNfcf',
  sortAsc: true,
  activePreset: "default",
  criteria: { ...PRESETS.default }
};

function evaluateReportStatus(row, crit) {
  const isFin = row.isFinancial || (row.company && row.company.sic >= 6000 && row.company.sic <= 6799);
  if (crit.excludeFinancials && isFin) return "Excluded";

  const mc = Number(row.marketCap ?? row.valuation?.marketCap ?? 0);
  if (crit.minMarketCap && mc < crit.minMarketCap) return "Excluded";
  if (Number.isFinite(crit.maxMarketCap) && mc > crit.maxMarketCap) return "Excluded";

  const usableYears = Number(row.usableYears ?? row.normalized?.usableYears ?? 0);
  if (usableYears < (crit.minYears || 3)) return "Excluded";

  const pToNfcf = Number(row.priceToNfcf ?? row.valuation?.priceToNfcf);
  if (!Number.isFinite(pToNfcf) || pToNfcf <= 0) return "Review";

  const maxP = Number(crit.maxMultiple ?? 15);
  if (pToNfcf > maxP) return "Review";

  if (Number.isFinite(crit.maxEvMultiple)) {
    const evMultiple = Number(row.evToUnleveredNfcf ?? row.valuation?.evToUnleveredNfcf);
    if (!Number.isFinite(evMultiple) || evMultiple > crit.maxEvMultiple) return "Review";
  }

  const netDebtToNfcf = Number(row.netDebtToNfcf ?? row.valuation?.netDebtToNfcf);
  if (Number.isFinite(netDebtToNfcf) && netDebtToNfcf > (crit.maxDebt || 4)) return "Review";

  const sbcToFcf = Number(row.latestSbcToFcf ?? row.quality?.latestSbcToFcf);
  if (Number.isFinite(sbcToFcf) && sbcToFcf > (crit.maxSbc || 0.30)) return "Review";

  const dilution = Number(row.shareChange ?? row.quality?.shareChange);
  if (Number.isFinite(dilution) && dilution > (crit.maxDilution || 0.25)) return "Review";

  const posRatio = Number(row.positiveFcfRatio ?? row.quality?.positiveFcfRatio);
  if (Number.isFinite(posRatio) && posRatio < (crit.minPosFcf || 0.67)) return "Review";

  if (crit.enforceSolvency) {
    const shortDebt = Number(row.shortDebt ?? row.valuation?.shortDebt ?? 0);
    const cash = Number(row.cash ?? row.valuation?.cash ?? 0);
    const latestFcf = Number(row.latestFcf ?? row.normalized?.latestReportedFcf ?? 0);
    if (shortDebt > 0 && shortDebt > (cash + Math.max(0, latestFcf))) return "Review";
  }

  return "Idea";
}

const STORAGE_KEY = "clear-fcf-auto-v3";
const REVIEWED_KEY = "clear-fcf-reviewed-v2";

function getReviewedTickers() {
  try { return new Set(JSON.parse(localStorage.getItem(REVIEWED_KEY)) || []); }
  catch { return new Set(); }
}

function saveReviewedTickers(set) {
  try { localStorage.setItem(REVIEWED_KEY, JSON.stringify([...set])); } catch {}
}

function markTickerReviewed(ticker) {
  const set = getReviewedTickers();
  set.add(String(ticker).toUpperCase());
  saveReviewedTickers(set);
  updateSeenBadge();
}

function updateSeenBadge() {
  const set = getReviewedTickers();
  const el = $("#seen-count-badge");
  if (!el) return;
  el.innerHTML = `Hiding <strong>${set.size}</strong> reviewed stocks • <button id="reset-seen-btn" type="button" class="text-link">Reset history</button>`;
  $("#reset-seen-btn")?.addEventListener("click", resetReviewedHistory);
}

function resetReviewedHistory() {
  const set = getReviewedTickers();
  if (!set.size) return setStatus("No reviewed stocks to reset.");
  if (confirm(`Reset ${set.size} previously reviewed stocks so they can appear in scans again?`)) {
    saveReviewedTickers(new Set());
    updateSeenBadge();
    setStatus(`Reset complete. All ${set.size} stocks can now be scanned again.`);
  }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function setStatus(message, error = false) {
  const el = $("#status");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", error);
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

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function switchView(viewId) {
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));

  if (viewId === "ideas") {
    if (state.auto && state.auto.results && state.auto.results.length) {
      setStatus(`Idea Finder: ${state.auto.results.length} ideas found from ${state.auto.cursor} companies.`);
    } else {
      setStatus("Ready.");
    }
  } else if (viewId === "screen") {
    setStatus("Paste up to 50 tickers to screen your watchlist.");
  } else if (viewId === "analyze") {
    const currentTicker = $("#single-ticker")?.value.trim().toUpperCase();
    if (currentTicker && state.reports[currentTicker]) {
      setStatus(`${currentTicker} analysis complete.`);
    } else {
      setStatus("Enter a ticker symbol to view its complete normalized FCF report.");
    }
  }
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

function tableHtml(results, title) {
  if (!results.length) return `<div class="results-shell"><div class="empty">No results matching current criteria.</div></div>`;
  return `<div class="results-shell">
    <div class="results-head">
      <h2>${escapeHtml(title)} <small>(${results.length})</small></h2>
      <button class="export" type="button">Export CSV</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th class="sortable" data-sort="ticker">Company</th>
            <th class="sortable" data-sort="status">Status</th>
            <th class="sortable" data-sort="price">Price</th>
            <th class="sortable" data-sort="marketCap">Market cap</th>
            <th class="sortable" data-sort="priceToNfcf">P/nFCF</th>
            <th class="sortable" data-sort="priceToEconomicNfcf">P/Econ nFCF</th>
            <th class="sortable" data-sort="evToUnleveredNfcf">EV/Unlevered</th>
            <th class="sortable" data-sort="fcfYield">FCF yield</th>
            <th class="sortable" data-sort="economicFcfYield">Econ yield</th>
            <th class="sortable" data-sort="fcfTrajectory">FCF Trend</th>
            <th class="sortable" data-sort="buybackRating">Buyback Audit</th>
            <th class="sortable" data-sort="capexToDnaRatio">CapEx/D&A</th>
            <th class="sortable" data-sort="usableYears">History</th>
            <th class="sortable" data-sort="netDebtToNfcf">Net debt/nFCF</th>
            <th class="sortable" data-sort="latestSbcToFcf">SBC/FCF</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((row) => `<tr data-ticker="${escapeHtml(row.ticker)}">
            <td><button class="btn-action btn-dismiss" data-dismiss="${escapeHtml(row.ticker)}" title="Dismiss this stock from future scans">✕ Pass</button></td>
            <td>
              <span class="ticker">${escapeHtml(row.ticker)}</span>
              <span class="subname">${escapeHtml(row.companyName)}</span>
              ${row.netDebtToNfcf !== null && row.netDebtToNfcf < 0 ? '<span class="badge badge-netcash" title="Net cash position">Net Cash</span>' : ''}
              ${row.fcfTrajectory === 'Expanding' ? '<span class="badge badge-green" title="3-year margin expanding">Expanding</span>' : ''}
              ${row.buybackRating === 'Accretive' ? '<span class="badge badge-blue" title="Historical buybacks executed at a discount">Accretive Buyback</span>' : ''}
              ${row.latestSbcToFcf && row.latestSbcToFcf > 0.25 ? '<span class="badge badge-amber" title="SBC absorbs >25% of FCF">High SBC</span>' : ''}
            </td>
            <td><span class="badge ${String(row.status).toLowerCase()}">${escapeHtml(row.status)}</span></td>
            <td>${compact(row.price, true)}</td>
            <td>${compact(row.marketCap, true)}</td>
            <td>${multiple(row.priceToNfcf)}</td>
            <td>${multiple(row.priceToEconomicNfcf)}</td>
            <td>${multiple(row.evToUnleveredNfcf)}</td>
            <td>${percent(row.fcfYield)}</td>
            <td>${percent(row.economicFcfYield)}</td>
            <td><span class="badge ${row.fcfTrajectory === 'Expanding' ? 'badge-green' : row.fcfTrajectory === 'Deteriorating' ? 'badge-amber' : ''}">${escapeHtml(row.fcfTrajectory || 'Stable')}</span></td>
            <td><span class="badge ${row.buybackRating === 'Accretive' ? 'badge-green' : row.buybackRating === 'Value Destructive' ? 'badge-amber' : ''}">${escapeHtml(row.buybackRating || 'N/A')}</span></td>
            <td>${row.capexToDnaRatio ? `${(row.capexToDnaRatio * 100).toFixed(0)}%` : "—"}</td>
            <td>${escapeHtml(row.usableYears)} yrs</td>
            <td>${multiple(row.netDebtToNfcf)}</td>
            <td>${percent(row.latestSbcToFcf)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

function attachTableEvents(container, results) {
  container.querySelectorAll("tbody tr").forEach((row) => row.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    openReport(row.dataset.ticker);
  }));

  container.querySelectorAll("button[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ticker = btn.dataset.dismiss;
      markTickerReviewed(ticker);
      if (state.auto?.results) {
        state.auto.results = state.auto.results.filter((r) => r.ticker !== ticker);
        saveAuto();
        updateAutoUi();
      } else {
        btn.closest("tr")?.remove();
      }
      setStatus(`Dismissed ${ticker}. It will be skipped on future scans.`);
    });
  });

  container.querySelectorAll("th.sortable").forEach((th) => {
    const sortKey = th.dataset.sort;
    if (state.sortKey === sortKey) {
      th.classList.add(state.sortAsc ? 'sorted-asc' : 'sorted-desc');
    }
    th.addEventListener("click", () => {
      if (state.sortKey === sortKey) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortKey = sortKey;
        state.sortAsc = true;
      }
      renderTable(container, container._rawResults || results, container._rawTitle || "Results");
    });
  });

  container.querySelector(".export")?.addEventListener("click", () => exportCsv(applyFilterAndSort(results)));
}

function applyFilterAndSort(results) {
  let list = [...results];
  const crit = state.criteria;

  // 1. Dynamic Evaluation using User Controlled Criteria
  list = list.map((r) => {
    const dynamicStatus = evaluateReportStatus(r, crit);
    return { ...r, status: dynamicStatus, passesDefaultIdeaFilter: dynamicStatus === "Idea" };
  });

  // Filter based on active criteria thresholds
  list = list.filter((r) => {
    const mc = Number(r.marketCap ?? r.valuation?.marketCap ?? 0);
    if (crit.minMarketCap && mc < crit.minMarketCap) return false;
    const p = Number(r.priceToNfcf ?? r.valuation?.priceToNfcf);
    const maxP = Number(crit.maxMultiple ?? 15);
    if (Number.isFinite(p) && p > maxP) return false;

    if (Number.isFinite(crit.maxEvMultiple)) {
      const ev = Number(r.evToUnleveredNfcf ?? r.valuation?.evToUnleveredNfcf);
      if (!Number.isFinite(ev) || ev > crit.maxEvMultiple) return false;
    }

    const sbc = Number(r.latestSbcToFcf ?? r.quality?.latestSbcToFcf);
    if (Number.isFinite(sbc) && sbc > crit.maxSbc) return false;

    const nd = Number(r.netDebtToNfcf ?? r.valuation?.netDebtToNfcf);
    if (Number.isFinite(nd) && nd > crit.maxDebt) return false;

    const yrs = Number(r.usableYears ?? r.normalized?.usableYears ?? 0);
    if (yrs < crit.minYears) return false;

    return true;
  });

  // 2. Quick Filter Pills
  if (state.activeFilters.has('net-cash')) {
    list = list.filter((r) => typeof r.netDebtToNfcf === 'number' && r.netDebtToNfcf < 0);
  }
  if (state.activeFilters.has('low-sbc')) {
    list = list.filter((r) => r.latestSbcToFcf === null || r.latestSbcToFcf < 0.15);
  }
  if (state.activeFilters.has('buybacks')) {
    list = list.filter((r) => typeof r.shareChange === 'number' && r.shareChange < 0);
  }
  if (state.activeFilters.has('sub-10')) {
    list = list.filter((r) => typeof r.priceToNfcf === 'number' && r.priceToNfcf < 10);
  }
  if (state.activeFilters.has('expanding')) {
    list = list.filter((r) => r.fcfTrajectory === 'Expanding');
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
function renderTable(container, results, title) {
  container._rawResults = results;
  container._rawTitle = title;
  const filtered = applyFilterAndSort(results);
  container.innerHTML = tableHtml(filtered, title);
  attachTableEvents(container, results);
}

function exportCsv(results) {
  const fields = ["ticker", "companyName", "status", "price", "marketCap", "priceToNfcf", "priceToEconomicNfcf", "evToUnleveredNfcf", "fcfYield", "economicFcfYield", "fcfTrajectory", "buybackRating", "buybackPrice", "capexToDnaRatio", "usableYears", "netDebtToNfcf", "shortDebt", "cash", "shareChange", "latestSbcToFcf"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.join(","), ...results.map((row) => fields.map((key) => quote(row[key])).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `clear-fcf-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function rowTable(rows, ttm) {
  const allRows = ttm ? [{ ...ttm, year: 'TTM (Last 12M)' }, ...rows] : rows;
  return `<div class="table-scroll"><table><thead><tr>
    <th>Period</th><th>Revenue</th><th>OCF</th><th>CapEx</th><th>Standard FCF</th><th>SBC</th><th>Economic FCF</th><th>D&A</th><th>Diluted Shares</th>
  </tr></thead><tbody>${allRows.map((row) => `<tr class="${row.isTtm ? 'ttm-row' : ''}">
    <td><strong>${row.year}</strong> ${row.isTtm ? '★' : ''}</td>
    <td>${compact(row.revenue, true)}</td>
    <td>${compact(row.ocf, true)}</td>
    <td>${compact(row.capex, true)}</td>
    <td>${compact(row.fcf, true)}</td>
    <td>${compact(row.sbc, true)}</td>
    <td>${compact(row.fcfEconomic, true)}</td>
    <td>${compact(row.dna, true)}</td>
    <td>${compact(row.shares)}</td>
  </tr>`).join("")}</tbody></table></div>`;
}

function renderWaterfall(latestRow, normalized) {
  const ocf = latestRow?.ocf || 0;
  const capex = latestRow?.capex || 0;
  const sbc = latestRow?.sbc || 0;
  const econFcf = latestRow?.fcfEconomic ?? (latestRow?.fcf ? latestRow.fcf - sbc : 0);

  if (!ocf || ocf <= 0) return "";

  const capexPct = Math.min(100, Math.max(2, Math.round((capex / ocf) * 100)));
  const sbcPct = Math.min(100, Math.max(2, Math.round((sbc / ocf) * 100)));
  const econPct = Math.max(2, Math.round((econFcf / ocf) * 100));

  return `<div class="report-card">
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
  const n = report.normalized;
  if (!v.marketCap || !n.normalizedFcf || n.normalizedFcf <= 0) return "";

  const currentMultiple = v.marketCap / n.normalizedFcf;
  // Approximated implied 5-year compound growth rate priced into current multiple at a 9% hurdle rate:
  const hurdle = 0.09;
  const impliedGrowth = Math.round(((1 / currentMultiple + 0.025 - hurdle) * -1) * 1000) / 10;

  return `<div class="report-card">
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
        <strong>${multiple(v.priceToNfcf)}</strong>
        <small>Market Cap / Normalized FCF</small>
      </div>
      <div class="metric">
        <span>Assumed Hurdle Rate</span>
        <strong>9.0%</strong>
        <small>Target annual investor return</small>
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

function renderReport(report) {
  const v = report.valuation;
  const n = report.normalized;
  const q = report.quality;
  const filingUrl = report.filing?.url;
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(report.ticker)}`;
  const latestRow = report.rows.find((row) => typeof row.fcf === "number" && typeof row.revenue === "number") || {};

  return `<div class="report-card">
    <div class="report-title">
      <div>
        <p class="kicker">${escapeHtml(evaluateReportStatus(report, state.criteria))}</p>
        <h2>${escapeHtml(report.ticker)} • ${escapeHtml(report.companyName)}</h2>
        <p class="muted">${escapeHtml(report.company.sicDescription || "Industry unavailable")} • ${escapeHtml(report.quote.exchange || report.company.exchanges?.[0] || "Exchange unavailable")}</p>
        <div class="filing-links">
          ${filingUrl ? `<a class="source-link" href="${escapeHtml(filingUrl)}" target="_blank" rel="noopener">📄 Latest ${escapeHtml(report.filing.form)} filed ${escapeHtml(report.filing.filed)}</a>` : '<span class="muted">SEC filing unavailable</span>'}
          <span class="dot-sep">•</span>
          <a class="source-link yahoo-link" href="${escapeHtml(yahooUrl)}" target="_blank" rel="noopener">📈 View on Yahoo Finance ↗</a>
        </div>
      </div>
      <div class="report-actions">
        <button type="button" class="btn secondary memo-btn" onclick="window.print()">📄 Print Memo</button>
        <span class="badge ${String(evaluateReportStatus(report, state.criteria)).toLowerCase()}">${escapeHtml(evaluateReportStatus(report, state.criteria))}</span>
      </div>
    </div>
    ${report.warnings.length ? `<div class="warnings"><strong>Check before relying on this result</strong><ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
  </div>

  <div class="report-grid">
    <div class="metric clickable" data-metric="price"><span>Price</span><strong>${compact(v.price, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="marketCap"><span>Market capitalization</span><strong>${compact(v.marketCap, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="normalizedFcf"><span>Normalized FCF</span><strong>${compact(n.normalizedFcf, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="economicNfcf"><span>Economic nFCF (post-SBC)</span><strong>${compact(n.normalizedEconomicFcf, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="priceToNfcf"><span>P/nFCF</span><strong>${multiple(v.priceToNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="priceToEconomicNfcf"><span>P/Economic nFCF</span><strong>${multiple(v.priceToEconomicNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="evToUnleveredNfcf"><span>EV/Unlevered nFCF</span><strong>${multiple(v.evToUnleveredNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="fcfYield"><span>Normalized FCF yield</span><strong>${percent(v.fcfYield)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="economicFcfYield"><span>Economic FCF yield</span><strong>${percent(v.economicFcfYield)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="fcfTrajectory"><span>FCF Trajectory</span><strong class="${q.fcfTrajectory === 'Expanding' ? 'badge-green' : q.fcfTrajectory === 'Deteriorating' ? 'badge-amber' : ''}">${escapeHtml(q.fcfTrajectory || 'Stable')}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="buybackAudit"><span>Buyback Audit</span><strong class="${q.buybackAudit?.rating === 'Accretive' ? 'badge-green' : q.buybackAudit?.rating === 'Value Destructive' ? 'badge-amber' : ''}">${escapeHtml(q.buybackAudit?.rating || 'N/A')}</strong><small>${q.buybackAudit?.averageBuybackPrice ? `Avg paid: $${q.buybackAudit.averageBuybackPrice.toFixed(2)}` : 'No major repurchases'}</small><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="capexToDnaRatio"><span>CapEx / D&A</span><strong>${q.capexToDnaRatio ? `${(q.capexToDnaRatio * 100).toFixed(0)}%` : "—"}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="netDebt"><span>Net debt</span><strong>${compact(v.netDebt, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="netDebtToNfcf"><span>Net debt/nFCF</span><strong>${multiple(v.netDebtToNfcf)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="shortDebt"><span>Short-term debt</span><strong>${compact(v.shortDebt, true)}</strong><span class="metric-hint">How it was calculated</span></div>
    <div class="metric clickable" data-metric="usableYears"><span>Usable history</span><strong>${n.usableYears} years</strong><span class="metric-hint">How it was calculated</span></div>
  </div>

  ${renderWaterfall(latestRow, n)}
  ${renderReverseDcf(report)}

  <div class="report-card">
    <h3>Normalized Margin Architecture (50/50 Equal Weighting)</h3>
    <div class="formulas">
      <div class="formula"><span>Simple average margin</span><strong>${percent(n.simpleAverageMargin)}</strong><small>Arithmetic mean of ${n.usableYears} annual margins</small></div>
      <div class="formula"><span>Volume-weighted margin</span><strong>${percent(n.weightedMargin)}</strong><small>Total FCF (${compact(n.totalFcf, true)}) ÷ Total Rev (${compact(n.totalRevenue, true)})</small></div>
      <div class="formula"><span>50/50 Blended margin</span><strong>${percent(n.blendedMargin)}</strong><small>Applied to current revenue (${compact(n.latestRevenue, true)})</small></div>
    </div>
  </div>

  <div class="report-card">
    <h3>Annual Evidence & TTM Overlay</h3>
    ${rowTable(report.rows, report.ttm)}
    <div class="filing-links">
      ${filingUrl ? `<a class="source-link" href="${escapeHtml(filingUrl)}" target="_blank" rel="noopener">📄 Latest ${escapeHtml(report.filing.form)} filed ${escapeHtml(report.filing.filed)}</a>` : '<span class="muted">SEC filing link unavailable</span>'}
      <span class="dot-sep">•</span>
      <a class="source-link yahoo-link" href="${escapeHtml(yahooUrl)}" target="_blank" rel="noopener">📈 View ${escapeHtml(report.ticker)} on Yahoo Finance ↗</a>
    </div>
  </div>

  <div class="report-card">
    <div class="waterfall-header">
      <div>
        <h3>Lookback Range Comparison (10Y vs. 5Y vs. 3Y)</h3>
        <p class="muted">Compare long-term structural power against recent medium-term cash flow trends</p>
      </div>
    </div>
    <div class="report-grid" style="margin-top:12px;">
      <div class="metric">
        <span>Full History (${n.usableYears}Y) Margin</span>
        <strong>${percent(n.blendedMargin)}</strong>
        <small>nFCF: ${compact(n.normalizedFcf, true)}</small>
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

  <div class="report-card">
    <h3>Sources and Methodology</h3>
    <p>Financials: <strong>SEC Company Facts</strong>. Price: <strong>${escapeHtml(report.sources.price || "Unavailable")}</strong>. Analyzed ${escapeHtml(new Date(report.analyzedAt).toLocaleString())}.</p>
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

    // Directly bind metric tiles to calculation breakdown modal
    document.querySelectorAll(".metric.clickable[data-metric]").forEach((tile) => {
      tile.addEventListener("click", () => {
        openCalculationModal(tile.dataset.metric, report);
      });
    });

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
  for (let index = 0; index < tickers.length; index += 10) {
    const batch = tickers.slice(index, index + 10);
    const data = await request("/api/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: batch, criteria: state.criteria })
    });
    all.push(...data.results);
    all.sort((a, b) => Number(b.passesDefaultIdeaFilter) - Number(a.passesDefaultIdeaFilter) || (a.priceToNfcf ?? 999) - (b.priceToNfcf ?? 999));
    failures.push(...data.failures);
    Object.assign(state.reports, data.reports);
    if (onBatch) onBatch(index + batch.length, all, failures);
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
      renderTable(container, results, "Watchlist results");
    });
    setStatus(`Finished: ${data.results.length} analyzed, ${data.failures.length} failed.`);
  } catch (error) { setStatus(error.message, true); }
});

function saveAuto() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.auto)); } catch {}
}

function updateAutoUi() {
  const scan = state.auto;
  if (!scan) return;
  const max = Math.min(scan.maxExamine, scan.symbols.length);
  const examined = Math.min(scan.cursor, max);
  $("#progress-wrap").classList.remove("hidden");
  $("#progress-bar").style.width = `${max ? (examined / max) * 100 : 0}%`;
  $("#progress-text").textContent = `${examined}/${max} examined • ${scan.results.length} ideas found`;
  renderTable($("#idea-results"), scan.results, "Current ideas");
}

async function runAuto() {
  const scan = state.auto;
  state.stopped = false;
  $("#find-button").disabled = true;
  $("#stop-button").disabled = false;
  const max = Math.min(scan.maxExamine, scan.symbols.length);
  try {
    const skipSeen = $("#skip-seen")?.checked ?? true;
    const reviewed = skipSeen ? getReviewedTickers() : new Set();
    scan.allExamined = scan.allExamined || [];

    while (scan.cursor < max && !state.stopped) {
      const batchRows = scan.symbols.slice(scan.cursor, scan.cursor + 5);
      scan.cursor += batchRows.length;
      const unreviewedRows = batchRows.filter((item) => !reviewed.has(item.ticker));
      if (!unreviewedRows.length) {
        updateAutoUi();
        continue;
      }
      const batch = unreviewedRows.map((item) => item.ticker);
      const data = await request("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: batch,
          quotes: unreviewedRows.map(({ ticker, price, marketCap }) => ({ ticker, price, marketCap })),
          criteria: state.criteria
        })
      });
      Object.assign(state.reports, data.reports);

      // Store in allExamined
      const existingExamined = new Set(scan.allExamined.map((r) => r.ticker));
      for (const row of data.results) {
        if (!existingExamined.has(row.ticker)) {
          scan.allExamined.push(row);
          existingExamined.add(row.ticker);
        }
      }

      // Re-filter ideas from all examined based on active criteria
      scan.results = scan.allExamined.filter((r) => evaluateReportStatus(r, state.criteria) === "Idea");
      scan.failures.push(...data.failures);
      saveAuto();
      updateAutoUi();

      const hasRateLimit = data.failures?.some((f) => String(f.error || "").includes("429"));
      if (hasRateLimit) {
        setStatus("SEC rate limit reached. Pausing 2.5s...", true);
        await new Promise((r) => setTimeout(r, 2500));
      } else {
        setStatus(`Auto Finder: examined ${scan.cursor} and found ${scan.results.length} ideas.`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    scan.complete = scan.cursor >= max;
    saveAuto();
    const reason = state.stopped ? "stopped" : "universe completed";
    setStatus(`Auto Finder ${reason}: ${scan.results.length} ideas from ${scan.cursor} companies.`);
  } catch (error) {
    setStatus(`Scan paused: ${error.message}. Press Resume to continue.`, true);
  } finally {
    $("#find-button").disabled = false;
    $("#stop-button").disabled = true;
    $("#find-button").textContent = scan.complete ? "Start new scan" : "Resume scan";
  }
}
$("#find-button").addEventListener("click", async () => {
  const maxExamine = Number($("#max-examine")?.value || 5000);
  if (state.auto && !state.auto.complete && state.auto.maxExamine === maxExamine) return runAuto();
  try {
    setStatus("Loading idea lists...");
    $("#find-button").disabled = true;
    const universeType = $("#universe-select")?.value || "yahoo";
    const universe = await request(`/api/universe?type=${encodeURIComponent(universeType)}&perSource=100`);
    state.auto = {
      universeType,
      symbols: universe.symbols,
      sources: universe.sources,
      maxExamine,
      cursor: 0,
      results: [],
      failures: [],
      startedAt: new Date().toISOString(),
      complete: false
    };
    saveAuto();
    updateAutoUi();
    setStatus(`Loaded ${universe.symbols.length} candidates.`);
    await runAuto();
  } catch (error) {
    $("#find-button").disabled = false;
    setStatus(error.message, true);
  }
});

$("#stop-button").addEventListener("click", () => {
  state.stopped = true;
  $("#stop-button").disabled = true;
});

// Restore previous scan state if exists
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved?.symbols && Array.isArray(saved.results)) {
    state.auto = saved;
    $("#target").value = String(saved.target);
    $("#max-examine").value = String(saved.maxExamine);
    $("#find-button").textContent = saved.complete ? "Start new scan" : "Resume scan";
    updateAutoUi();
    setStatus(saved.complete ? `Previous scan found ${saved.results.length} ideas.` : `Saved scan can resume at ${saved.cursor} examined.`);
  }
} catch {
  localStorage.removeItem(STORAGE_KEY);
}

updateSeenBadge();

// Quick Filters & Tolerances
function initFilterChips() {
  const container = document.querySelector("#filter-chips");
  if (!container) return;
  const chips = container.querySelectorAll(".chip[data-filter]");
  const clearBtn = document.querySelector("#clear-chips");
  const toggleTolBtn = document.querySelector("#toggle-tolerances");
  const tolDrawer = document.querySelector("#tolerances-drawer");

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const filter = chip.dataset.filter;
      if (state.activeFilters.has(filter)) {
        state.activeFilters.delete(filter);
        chip.classList.remove("active");
      } else {
        state.activeFilters.add(filter);
        chip.classList.add("active");
      }
      clearBtn?.classList.toggle("hidden", state.activeFilters.size === 0);
      refreshActiveTable();
    });
  });

  clearBtn?.addEventListener("click", () => {
    state.activeFilters.clear();
    chips.forEach((c) => c.classList.remove("active"));
    clearBtn.classList.add("hidden");
    refreshActiveTable();
  });

  toggleTolBtn?.addEventListener("click", () => {
    tolDrawer?.classList.toggle("hidden");
    toggleTolBtn.classList.toggle("active", !tolDrawer?.classList.contains("hidden"));
  });

  function applyPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    state.activePreset = presetKey;
    state.criteria = { ...preset };

    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === presetKey);
    });

    // Update UI controls to match preset
    if ($("#tol-multiple")) { $("#tol-multiple").value = preset.maxMultiple; $("#tol-multiple-val").textContent = `${preset.maxMultiple}x`; }
  if ($("#tol-ev-multiple")) {
    const evVal = Number.isFinite(preset.maxEvMultiple) ? preset.maxEvMultiple : 100;
    $("#tol-ev-multiple").value = Math.min(100, evVal);
    $("#tol-ev-multiple-val").textContent = evVal >= 100 ? "Any (100x+)" : `${evVal}x`;
  }
  if ($("#tol-min-mc-slider")) { $("#tol-min-mc-slider").value = 0; $("#tol-min-mc-val").textContent = "$0 (All)"; }
  if ($("#tol-max-mc-slider")) { $("#tol-max-mc-slider").value = 8; $("#tol-max-mc-val").textContent = "Any ($5T+)"; }
    if ($("#tol-years")) { $("#tol-years").value = preset.minYears; $("#tol-years-val").textContent = `${preset.minYears} yrs`; }
    if ($("#tol-debt")) { $("#tol-debt").value = preset.maxDebt; $("#tol-debt-val").textContent = `${Number(preset.maxDebt).toFixed(1)}x`; }
    if ($("#tol-sbc")) { $("#tol-sbc").value = Math.round(preset.maxSbc * 100); $("#tol-sbc-val").textContent = `${Math.round(preset.maxSbc * 100)}%`; }
    if ($("#tol-dilution")) { $("#tol-dilution").value = Math.round(preset.maxDilution * 100); $("#tol-dilution-val").textContent = `${Math.round(preset.maxDilution * 100)}%`; }
    if ($("#tol-posfcf")) { $("#tol-posfcf").value = Math.round(preset.minPosFcf * 100); $("#tol-posfcf-val").textContent = `${Math.round(preset.minPosFcf * 100)}%`; }
    if ($("#tol-solvency")) { $("#tol-solvency").checked = preset.enforceSolvency; }
    if ($("#tol-financials")) { $("#tol-financials").checked = preset.excludeFinancials; }

    refreshActiveTable();
    updateActiveReportIfOpen();
  }

  function markCustom() {
    state.activePreset = "custom";
    document.querySelectorAll(".preset-btn").forEach((btn) => btn.classList.remove("active"));
    refreshActiveTable();
    updateActiveReportIfOpen();
  }

  function updateActiveReportIfOpen() {
    const currentTicker = $("#single-ticker")?.value.trim().toUpperCase();
    if (currentTicker && state.reports[currentTicker] && document.querySelector("#report").innerHTML.includes("report-card")) {
      $("#report").innerHTML = renderReport(state.reports[currentTicker]);
    }
  }

  // Presets buttons
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  // Slider inputs
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

initFilterChips();

// Command Palette (Cmd+K)
function initCommandPalette() {
  const palette = $("#cmd-palette");
  const input = $("#cmd-input");
  const results = $("#cmd-results");
  if (!palette || !input) return;

  function openPalette() {
    palette.classList.remove("hidden");
    input.value = "";
    renderCmdResults("");
    input.focus();
  }

  function closePalette() {
    palette.classList.add("hidden");
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
    { type: "view", title: "Go to Watchlist / Paste Tickers", view: "screen" },
    { type: "view", title: "Go to Analyze Stock", view: "analyze" },
    
    { type: "action", title: "Export CSV Report", run: () => exportCsv(state.auto?.results || []) },
    { type: "action", title: "Reset Reviewed History", run: resetReviewedHistory }
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
  const v = report.valuation;
  const n = report.normalized;
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
        formula: 'Economic nFCF = Normalized FCF − Stock-Based Compensation (SBC)',
        substitution: `${compact(nfcf, true)} (Standard nFCF)\n− ${compact(latest.sbc || 0, true)} (Latest Annual Stock-Based Compensation)\n= ${compact(econNfcf, true)} Economic Free Cash Flow`,
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
        substitution: `1. Enterprise Value: ${compact(mc, true)} (Equity) + ${compact(netDebt, true)} (Net Debt) = ${compact(ev, true)}\n2. Unlevered nFCF: ${compact(nfcf, true)} + (${compact(latest.interest || 0, true)} Interest × 79%) = ${compact(v.evToUnleveredNfcf ? ev / v.evToUnleveredNfcf : 0, true)}\n3. EV Multiple: ${compact(ev, true)} ÷ Unlevered nFCF = ${multiple(v.evToUnleveredNfcf)}`,
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
        formula: 'Avg Buyback Price = Cumulative Cash Spent on Repurchases ÷ Gross Shares Acquired',
        substitution: `• Total Cash Spent on Buybacks: ${compact(ba.totalCashSpent, true)}\n• Total Shares Repurchased: ${compact(ba.totalSharesRepurchased)}\n• Implied Average Price Paid: $${(ba.averageBuybackPrice || 0).toFixed(2)} per share\n• Current Share Price: ${compact(price, true)}\n• Price Ratio (Paid vs. Current): ${ba.buybackPriceVsCurrent ? (ba.buybackPriceVsCurrent * 100).toFixed(0) + '%' : 'N/A'}\n• Capital Allocation Rating: ${ba.rating || 'N/A'}`,
        meaning: 'Buybacks only create value if repurchased at a discount to intrinsic value. Repurchases at peak valuations destroy capital. Accretive rating indicates shares were bought back below current value.',
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
        sources: 'SEC 10-K Balance Sheet Instant Facts'
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
  const details = getCalculationDetails(metric, report);

  $("#calc-title").textContent = details.title;
  $("#calc-formula").textContent = details.formula;
  $("#calc-substitution").textContent = details.substitution;
  $("#calc-meaning").textContent = details.meaning;
  $("#calc-sources").textContent = details.sources;

  modal.classList.remove("hidden");
}

function closeCalculationModal() {
  $("#calc-modal")?.classList.add("hidden");
}

$("#calc-backdrop")?.addEventListener("click", closeCalculationModal);
$("#calc-close-btn")?.addEventListener("click", closeCalculationModal);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#calc-modal")?.classList.contains("hidden")) {
    closeCalculationModal();
  }
});






// Global Criteria Controllers & Real-Time Listeners
function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  state.activePreset = presetKey;
  state.criteria = { ...preset };

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === presetKey);
  });

  if ($("#tol-multiple")) { $("#tol-multiple").value = preset.maxMultiple; $("#tol-multiple-val").textContent = `${preset.maxMultiple}x`; }
  if ($("#tol-ev-multiple")) {
    const evVal = Number.isFinite(preset.maxEvMultiple) ? preset.maxEvMultiple : 100;
    $("#tol-ev-multiple").value = Math.min(100, evVal);
    $("#tol-ev-multiple-val").textContent = evVal >= 100 ? "Any (100x+)" : `${evVal}x`;
  }
  if ($("#tol-min-mc-slider")) { $("#tol-min-mc-slider").value = 0; $("#tol-min-mc-val").textContent = "$0 (All)"; }
  if ($("#tol-max-mc-slider")) { $("#tol-max-mc-slider").value = 8; $("#tol-max-mc-val").textContent = "Any ($5T+)"; }
  if ($("#tol-years")) { $("#tol-years").value = preset.minYears; $("#tol-years-val").textContent = `${preset.minYears} yrs`; }
  if ($("#tol-debt")) { $("#tol-debt").value = preset.maxDebt; $("#tol-debt-val").textContent = `${Number(preset.maxDebt).toFixed(1)}x`; }
  if ($("#tol-sbc")) { $("#tol-sbc").value = Math.round(preset.maxSbc * 100); $("#tol-sbc-val").textContent = `${Math.round(preset.maxSbc * 100)}%`; }
  if ($("#tol-dilution")) { $("#tol-dilution").value = Math.round(preset.maxDilution * 100); $("#tol-dilution-val").textContent = `${Math.round(preset.maxDilution * 100)}%`; }
  if ($("#tol-posfcf")) { $("#tol-posfcf").value = Math.round(preset.minPosFcf * 100); $("#tol-posfcf-val").textContent = `${Math.round(preset.minPosFcf * 100)}%`; }
  if ($("#tol-solvency")) { $("#tol-solvency").checked = preset.enforceSolvency; }
  if ($("#tol-financials")) { $("#tol-financials").checked = preset.excludeFinancials; }

  reEvaluateAll();
}

function markCustom() {
  state.activePreset = "custom";
  document.querySelectorAll(".preset-btn").forEach((btn) => btn.classList.remove("active"));
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
function resetSearch() {
  state.stopped = true;
  state.auto = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  const container = $("#idea-results");
  if (container) container.innerHTML = "";
  $("#progress-wrap")?.classList.add("hidden");
  $("#find-button").disabled = false;
  $("#stop-button").disabled = true;
  $("#find-button").textContent = "Find stocks";
  setStatus("Search reset. Select universe and criteria, then click Find stocks to scan.");
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
