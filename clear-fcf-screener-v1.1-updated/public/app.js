"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { auto: null, reports: {}, stopped: false };
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
  el.textContent = message;
  el.classList.toggle("error", error);
}

function parseTickers(input) {
  return [...new Set(String(input || "").split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function compact(value, currency = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 1e6 ? "compact" : "standard", maximumFractionDigits: 2, style: currency ? "currency" : "decimal", currency: "USD" });
  return formatter.format(value);
}

function multiple(value) { return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}×` : "—"; }
function percent(value) { return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—"; }

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
}));

function tableHtml(results, title) {
  if (!results.length) return `<div class="results-shell"><div class="empty">No results yet.</div></div>`;
  return `<div class="results-shell">
    <div class="results-head"><h2>${escapeHtml(title)} <small>(${results.length})</small></h2><button class="export" type="button">Export CSV</button></div>
    <div class="table-scroll"><table><thead><tr>
      <th>Action</th><th>Company</th><th>Status</th><th>Price</th><th>Market cap</th><th>P/nFCF</th><th>P/Econ nFCF</th><th>EV/Unlevered</th><th>FCF yield</th><th>Econ yield</th><th>CapEx/D&A</th><th>Simple/Wtd gap</th><th>History</th><th>Reliability</th><th>Net debt/nFCF</th><th>SBC/FCF</th>
    </tr></thead><tbody>${results.map((row) => `<tr data-ticker="${escapeHtml(row.ticker)}">
      <td><button class="btn-action btn-dismiss" data-dismiss="${escapeHtml(row.ticker)}" title="Dismiss this stock so it is not shown on future scans">✕ Pass</button></td>
      <td><span class="ticker">${escapeHtml(row.ticker)}</span><span class="subname">${escapeHtml(row.companyName)}</span></td>
      <td><span class="badge ${String(row.status).toLowerCase()}">${escapeHtml(row.status)}</span></td>
      <td>${compact(row.price, true)}</td><td>${compact(row.marketCap, true)}</td>
      <td>${multiple(row.priceToNfcf)}</td><td>${multiple(row.priceToEconomicNfcf)}</td><td>${multiple(row.evToUnleveredNfcf)}</td>
      <td>${percent(row.fcfYield)}</td><td>${percent(row.economicFcfYield)}</td>
      <td>${row.capexToDnaRatio ? `${(row.capexToDnaRatio * 100).toFixed(0)}%` : "—"}</td>
      <td>${percent(row.simpleVsWeightedGap)}</td>
      <td>${escapeHtml(row.usableYears)} yrs</td><td>${escapeHtml(row.reliability)}</td>
      <td>${multiple(row.netDebtToNfcf)}</td><td>${percent(row.latestSbcToFcf)}</td>
    </tr>`).join("")}</tbody></table></div></div>`;
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
  container.querySelector(".export")?.addEventListener("click", () => exportCsv(results));
}

function renderTable(container, results, title) {
  container.innerHTML = tableHtml(results, title);
  attachTableEvents(container, results);
}

function exportCsv(results) {
  const fields = ["ticker", "companyName", "status", "price", "marketCap", "latestRevenue", "averageAnnualFcf", "simpleAverageMargin", "weightedMargin", "blendedMargin", "simpleVsWeightedGap", "priceToNfcf", "priceToEconomicNfcf", "evToUnleveredNfcf", "fcfYield", "economicFcfYield", "capexToDnaRatio", "usableYears", "reliability", "netDebtToNfcf", "shortDebt", "cash", "shareChange", "latestSbcToFcf"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.join(","), ...results.map((row) => fields.map((key) => quote(row[key])).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `clear-fcf-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function rowTable(rows) {
  return `<div class="table-scroll"><table><thead><tr><th>Year</th><th>Revenue</th><th>OCF</th><th>CapEx (PP&E+Intang)</th><th>Standard FCF</th><th>SBC</th><th>Economic FCF</th><th>D&A</th><th>Diluted shares</th></tr></thead><tbody>${rows.map((row) => `<tr>
    <td>${row.year}</td><td>${compact(row.revenue, true)}</td><td>${compact(row.ocf, true)}</td>
    <td>${compact(row.capex, true)}</td><td>${compact(row.fcf, true)}</td><td>${compact(row.sbc, true)}</td>
    <td>${compact(row.fcfEconomic, true)}</td><td>${compact(row.dna, true)}</td><td>${compact(row.shares)}</td>
  </tr>`).join("")}</tbody></table></div>`;
}

function renderReport(report) {
  const v = report.valuation;
  const n = report.normalized;
  const q = report.quality;
  const filing = report.filing?.url ? `<a class="source-link" href="${escapeHtml(report.filing.url)}" target="_blank" rel="noopener">Open latest ${escapeHtml(report.filing.form)} filed ${escapeHtml(report.filing.filed)}</a>` : "Latest annual filing link unavailable";
  const latestRow = report.rows.find((row) => typeof row.fcf === "number" && typeof row.revenue === "number") || {};
  const marketCapMath = report.sources.marketCap === "Yahoo screener market cap"
    ? `Yahoo market cap = ${compact(v.marketCap, true)}`
    : `${compact(v.price, true)} × ${compact(v.shares)} shares = ${compact(v.marketCap, true)}`;

  return `<div class="report-card">
    <div class="report-title"><div><p class="kicker">${escapeHtml(report.status)}</p><h2>${escapeHtml(report.ticker)} — ${escapeHtml(report.companyName)}</h2><p class="muted">${escapeHtml(report.company.sicDescription || "Industry unavailable")} • ${escapeHtml(report.quote.exchange || report.company.exchanges?.[0] || "Exchange unavailable")}</p></div><span class="badge ${String(report.status).toLowerCase()}">${escapeHtml(report.status)}</span></div>
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
    <div class="metric"><span>CapEx / D&A</span><strong>${q.capexToDnaRatio ? `${(q.capexToDnaRatio * 100).toFixed(0)}%` : "—"}</strong></div>
    <div class="metric"><span>Simple vs. Wtd Gap</span><strong>${percent(n.simpleVsWeightedGap)}</strong></div>
    <div class="metric"><span>Short-term debt</span><strong>${compact(v.shortDebt, true)}</strong></div>
    <div class="metric"><span>Cash & equivalents</span><strong>${compact(v.cash, true)}</strong></div>
    <div class="metric"><span>Net debt</span><strong>${compact(v.netDebt, true)}</strong></div>
    <div class="metric"><span>Net debt/nFCF</span><strong>${multiple(v.netDebtToNfcf)}</strong></div>
    <div class="metric"><span>Usable history</span><strong>${n.usableYears} years</strong></div>
  </div>
  <div class="report-card"><h3>Normalized Margin Architecture (Equal Weighting)</h3><div class="formulas">
    <div class="formula"><span>Simple average margin</span><strong>${percent(n.simpleAverageMargin)}</strong><small>Arithmetic mean of ${n.usableYears} annual margins</small></div>
    <div class="formula"><span>Volume-weighted margin</span><strong>${percent(n.weightedMargin)}</strong><small>Total FCF (${compact(n.totalFcf, true)}) ÷ Total Rev (${compact(n.totalRevenue, true)})</small></div>
    <div class="formula"><span>50/50 Blended margin</span><strong>${percent(n.blendedMargin)}</strong><small>Equal weight applied to current revenue (${compact(n.latestRevenue, true)})</small></div>
  </div><p class="footnote">Simple vs. Weighted Divergence: ${percent(n.simpleVsWeightedGap)} gap. Median check: ${percent(n.medianMargin)} median margin (${percent(n.averageMedianGap)} gap — <strong>${n.marginAgreement ? "passes" : "fails"}</strong> 20% limit).</p></div>
  <div class="report-card"><h3>Calculation audit</h3><div class="audit-list">
    <div><span>Reported FCF bridge</span><code>${compact(latestRow.ocf, true)} OCF − ${compact(latestRow.capex, true)} CapEx = ${compact(latestRow.fcf, true)} Standard FCF</code><small>CapEx includes tangible PP&E and capitalized software/intangibles.</small></div>
    <div><span>Economic FCF bridge</span><code>${compact(latestRow.fcf, true)} Standard FCF − ${compact(latestRow.sbc, true)} SBC = ${compact(latestRow.fcfEconomic, true)} Economic FCF</code><small>SBC is treated as an ongoing economic compensation expense.</small></div>
    <div><span>Equal-weighted margin</span><code>(${percent(n.simpleAverageMargin)} simple + ${percent(n.weightedMargin)} weighted) ÷ 2 = ${percent(n.blendedMargin)} blended</code></div>
    <div><span>Normalized FCF</span><code>${percent(n.blendedMargin)} blended × ${compact(n.latestRevenue, true)} revenue = ${compact(n.normalizedFcf, true)}</code></div>
    <div><span>Enterprise value</span><code>${compact(v.marketCap, true)} market cap + ${compact(v.debt, true)} debt − ${compact(v.cash, true)} cash = ${compact(v.enterpriseValue, true)}</code></div>
    <div><span>Unlevered EV multiple</span><code>${compact(v.enterpriseValue, true)} EV ÷ Unlevered nFCF = ${multiple(v.evToUnleveredNfcf)}</code><small>Adds back after-tax net interest to ensure an apples-to-apples firm valuation.</small></div>
    <div><span>Liquidity & Solvency</span><code>Cash: ${compact(v.cash, true)} vs. Short-term debt due: ${compact(v.shortDebt, true)}</code><small>Checks near-term debt maturity to guard against sudden refinancing cliffs.</small></div>
  </div></div>
  <div class="report-card"><h3>Annual evidence</h3>${rowTable(report.rows)}<p>${filing}</p></div>
  <div class="report-card"><h3>Sources and methodology</h3><p>Financials: <strong>SEC Company Facts</strong>. Price: <strong>${escapeHtml(report.sources.price || "Unavailable")}</strong>. Analyzed ${escapeHtml(new Date(report.analyzedAt).toLocaleString())}.</p></div>`;
}

async function openReport(ticker) {
  document.querySelector('[data-view="analyze"]').click();
  $("#single-ticker").value = ticker;
  $("#report").innerHTML = `<div class="panel">Loading ${escapeHtml(ticker)}…</div>`;
  setStatus(`Loading the full ${ticker} report…`);
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
    const data = await request("/api/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: batch }) });
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
    setStatus(`Screening ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}…`);
    const data = await screenInBatches(tickers, (done, results) => {
      setStatus(`Analyzed ${done} of ${tickers.length}.`);
      renderTable(container, results, "Watchlist results");
    });
    setStatus(`Finished: ${data.results.length} analyzed, ${data.failures.length} failed.`);
  } catch (error) { setStatus(error.message, true); }
});

function saveAuto() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.auto)); } catch { /* storage may be disabled */ }
}

function updateAutoUi() {
  const scan = state.auto;
  if (!scan) return;
  const max = Math.min(scan.maxExamine, scan.symbols.length);
  const examined = Math.min(scan.cursor, max);
  $("#progress-wrap").classList.remove("hidden");
  $("#progress-bar").style.width = `${max ? examined / max * 100 : 0}%`;
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
      const data = await request("/api/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: batch, quotes: unreviewedRows.map(({ ticker, price, marketCap }) => ({ ticker, price, marketCap })) }) });
      Object.assign(state.reports, data.reports);
      const existing = new Set(scan.results.map((row) => row.ticker));
      scan.results.push(...data.results.filter((row) => row.passesDefaultIdeaFilter && !existing.has(row.ticker)));
      scan.failures.push(...data.failures);
      saveAuto();
      updateAutoUi();

      // Check if SEC rate limited us
      const hasRateLimit = data.failures?.some((f) => String(f.error || "").includes("429"));
      if (hasRateLimit) {
        setStatus("SEC rate limit reached. Pausing 2.5s to respect fair access limits...", true);
        await new Promise((r) => setTimeout(r, 2500));
      } else {
        setStatus(`Auto Finder: examined ${scan.cursor} and found ${scan.results.length} ideas.`);
        // Healthy 350ms breather between batches
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    scan.complete = scan.results.length >= scan.target || scan.cursor >= max;
    saveAuto();
    const reason = state.stopped ? "stopped" : scan.results.length >= scan.target ? "target reached" : "universe exhausted";
    setStatus(`Auto Finder ${reason}: ${scan.results.length} ideas from ${scan.cursor} companies.`);
  } catch (error) { setStatus(`Scan paused: ${error.message}. Press Resume to continue.`, true); }
  finally {
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
    setStatus("Loading changing Yahoo idea lists…");
    $("#find-button").disabled = true;
    const universeType = $("#universe-select")?.value || "yahoo";
    const universe = await request(`/api/universe?type=${encodeURIComponent(universeType)}&perSource=100`);
    state.auto = { universeType, symbols: universe.symbols, sources: universe.sources, target, maxExamine, cursor: 0, results: [], failures: [], startedAt: new Date().toISOString(), complete: false };
    saveAuto();
    updateAutoUi();
    setStatus(`Loaded ${universe.symbols.length} unique Yahoo candidates from ${universe.sources.length} lists.`);
    await runAuto();
  } catch (error) {
    $("#find-button").disabled = false;
    setStatus(error.message, true);
  }
});

$("#stop-button").addEventListener("click", () => { state.stopped = true; $("#stop-button").disabled = true; });

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved?.symbols && Array.isArray(saved.results)) {
    state.auto = saved;
    $("#target").value = String(saved.target);
    $("#max-examine").value = String(saved.maxExamine);
    $("#find-button").textContent = saved.complete ? "Start new scan" : "Resume scan";
    updateAutoUi();
    setStatus(saved.complete ? `Previous scan found ${saved.results.length} ideas.` : `A saved scan can resume at ${saved.cursor} examined.`);
  }
} catch { localStorage.removeItem(STORAGE_KEY); }

updateSeenBadge();
