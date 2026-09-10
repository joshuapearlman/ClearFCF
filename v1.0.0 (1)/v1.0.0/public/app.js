"use strict";

const $ = (selector) => document.querySelector(selector);
const state = {
  auto: null,
  reports: {},
  stopped: false,
  activeFilters: new Set(),
  sortKey: 'priceToNfcf',
  sortAsc: true,
  tolerances: {
    maxMultiple: 15,
    maxSbc: 0.30,
    maxDebt: 4.0,
    minYears: 6
  }
};

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

// Navigation Tabs
document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
}));

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
  // 1. Quick Filters
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

  // 2. Interactive Tolerances
  const tol = state.tolerances;
  list = list.filter((r) => {
    if (typeof r.priceToNfcf === 'number' && r.priceToNfcf > tol.maxMultiple) return false;
    if (typeof r.latestSbcToFcf === 'number' && r.latestSbcToFcf > tol.maxSbc) return false;
    if (typeof r.netDebtToNfcf === 'number' && r.netDebtToNfcf > tol.maxDebt) return false;
    if (typeof r.usableYears === 'number' && r.usableYears < tol.minYears) return false;
    return true;
  });

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
        <p class="kicker">${escapeHtml(report.status)}</p>
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
        <span class="badge ${String(report.status).toLowerCase()}">${escapeHtml(report.status)}</span>
      </div>
    </div>
    ${report.warnings.length ? `<div class="warnings"><strong>Check before relying on this result</strong><ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
  </div>

  <div class="report-grid">
    <div class="metric"><span>Price</span><strong>${compact(v.price, true)}</strong></div>
    <div class="metric"><span>Market capitalization</span><strong>${compact(v.marketCap, true)}</strong></div>
    <div class="metric"><span>Normalized FCF</span><strong>${compact(n.normalizedFcf, true)}</strong></div>
    <div class="metric"><span>Economic nFCF (post-SBC)</span><strong>${compact(n.normalizedEconomicFcf, true)}</strong></div>
    <div class="metric"><span>P/nFCF</span><strong>${multiple(v.priceToNfcf)}</strong></div>
    <div class="metric"><span>P/Economic nFCF</span><strong>${multiple(v.priceToEconomicNfcf)}</strong></div>
    <div class="metric"><span>EV/Unlevered nFCF</span><strong>${multiple(v.evToUnleveredNfcf)}</strong></div>
    <div class="metric"><span>Normalized FCF yield</span><strong>${percent(v.fcfYield)}</strong></div>
    <div class="metric"><span>Economic FCF yield</span><strong>${percent(v.economicFcfYield)}</strong></div>
    <div class="metric"><span>FCF Trajectory</span><strong class="${q.fcfTrajectory === 'Expanding' ? 'badge-green' : q.fcfTrajectory === 'Deteriorating' ? 'badge-amber' : ''}">${escapeHtml(q.fcfTrajectory || 'Stable')}</strong></div>
    <div class="metric"><span>Buyback Audit</span><strong class="${q.buybackAudit?.rating === 'Accretive' ? 'badge-green' : q.buybackAudit?.rating === 'Value Destructive' ? 'badge-amber' : ''}">${escapeHtml(q.buybackAudit?.rating || 'N/A')}</strong><small>${q.buybackAudit?.averageBuybackPrice ? `Avg paid: $${q.buybackAudit.averageBuybackPrice.toFixed(2)}` : 'No major repurchases'}</small></div>
    <div class="metric"><span>CapEx / D&A</span><strong>${q.capexToDnaRatio ? `${(q.capexToDnaRatio * 100).toFixed(0)}%` : "—"}</strong></div>
    <div class="metric"><span>Net debt</span><strong>${compact(v.netDebt, true)}</strong></div>
    <div class="metric"><span>Net debt/nFCF</span><strong>${multiple(v.netDebtToNfcf)}</strong></div>
    <div class="metric"><span>Short-term debt</span><strong>${compact(v.shortDebt, true)}</strong></div>
    <div class="metric"><span>Usable history</span><strong>${n.usableYears} years</strong></div>
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
    <h3>Sources and Methodology</h3>
    <p>Financials: <strong>SEC Company Facts</strong>. Price: <strong>${escapeHtml(report.sources.price || "Unavailable")}</strong>. Analyzed ${escapeHtml(new Date(report.analyzedAt).toLocaleString())}.</p>
  </div>`;
}

async function openReport(ticker) {
  document.querySelector('[data-view="analyze"]').click();
  $("#single-ticker").value = ticker;
  $("#report").innerHTML = `<div class="panel">Loading <strong>${escapeHtml(ticker)}</strong>...</div>`;
  setStatus(`Loading the full ${ticker} report...`);
  try {
    const report = state.reports[ticker] || await request(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
    state.reports[ticker] = report;
    $("#report").innerHTML = renderReport(report);
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
      body: JSON.stringify({ tickers: batch })
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
  $("#progress-text").textContent = `${examined}/${max} examined • ${scan.results.length}/${scan.target} ideas`;
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
    while (scan.cursor < max && scan.results.length < scan.target && !state.stopped) {
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
          quotes: unreviewedRows.map(({ ticker, price, marketCap }) => ({ ticker, price, marketCap }))
        })
      });
      Object.assign(state.reports, data.reports);
      const existing = new Set(scan.results.map((row) => row.ticker));
      scan.results.push(...data.results.filter((row) => row.passesDefaultIdeaFilter && !existing.has(row.ticker)));
      scan.failures.push(...data.failures);
      saveAuto();
      updateAutoUi();

      const hasRateLimit = data.failures?.some((f) => String(f.error || "").includes("429"));
      if (hasRateLimit) {
        setStatus("SEC rate limit reached. Pausing 2.5s...", true);
        await new Promise((r) => setTimeout(r, 2500));
      } else {
        setStatus(`Auto Finder: examined ${scan.cursor} and found ${scan.results.length} ideas.`);
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    scan.complete = scan.results.length >= scan.target || scan.cursor >= max;
    saveAuto();
    const reason = state.stopped ? "stopped" : scan.results.length >= scan.target ? "target reached" : "universe exhausted";
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
  const target = Number($("#target").value);
  const maxExamine = Number($("#max-examine").value);
  if (state.auto && !state.auto.complete && state.auto.target === target && state.auto.maxExamine === maxExamine) return runAuto();
  try {
    setStatus("Loading idea lists...");
    $("#find-button").disabled = true;
    const universeType = $("#universe-select")?.value || "yahoo";
    const universe = await request(`/api/universe?type=${encodeURIComponent(universeType)}&perSource=100`);
    state.auto = {
      universeType,
      symbols: universe.symbols,
      sources: universe.sources,
      target,
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

  // Sliders
  $("#tol-multiple")?.addEventListener("input", (e) => {
    state.tolerances.maxMultiple = Number(e.target.value);
    $("#tol-multiple-val").textContent = `${e.target.value}x`;
    refreshActiveTable();
  });

  $("#tol-sbc")?.addEventListener("input", (e) => {
    state.tolerances.maxSbc = Number(e.target.value) / 100;
    $("#tol-sbc-val").textContent = `${e.target.value}%`;
    refreshActiveTable();
  });

  $("#tol-debt")?.addEventListener("input", (e) => {
    state.tolerances.maxDebt = Number(e.target.value);
    $("#tol-debt-val").textContent = `${Number(e.target.value).toFixed(1)}x`;
    refreshActiveTable();
  });

  $("#tol-years")?.addEventListener("input", (e) => {
    state.tolerances.minYears = Number(e.target.value);
    $("#tol-years-val").textContent = `${e.target.value} yrs`;
    refreshActiveTable();
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
    { type: "view", title: "Go to Method & Architecture", view: "method" },
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
