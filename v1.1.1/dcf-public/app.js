"use strict";

const dcf = window.ClearFcfDcf;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const CASES = ["bear", "base", "bull"];
const CASE_LABELS = { bear: "Bear", base: "Base", bull: "Bull" };
const STORAGE_PREFIX = "clearfcf-financial-analysis-v2:";

const state = {
  report: null,
  historicalYears: 5,
  forecastYears: 5,
  convention: "year-end",
  activeCase: "base",
  cases: {},
  bridge: {},
  bridgeSources: {},
  snapshots: []
};

function finite(value) { return value !== null && value !== "" && Number.isFinite(Number(value)); }
function number(value, fallback = 0) { return finite(value) ? Number(value) : fallback; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function compact(value, currency = true) {
  if (!finite(value)) return "—";
  const numeric = Number(value);
  const absolute = Math.abs(numeric);
  const sign = numeric < 0 ? "-" : "";
  const prefix = currency ? "$" : "";
  if (absolute >= 1e12) return `${sign}${prefix}${(absolute / 1e12).toFixed(2)}T`;
  if (absolute >= 1e9) return `${sign}${prefix}${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${sign}${prefix}${(absolute / 1e6).toFixed(1)}M`;
  return `${sign}${prefix}${absolute.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function percent(value, digits = 1) { return finite(value) ? `${(Number(value) * 100).toFixed(digits)}%` : "—"; }
function perShare(value) { return finite(value) ? `$${Number(value).toFixed(2)}` : "—"; }
function millions(value) { return finite(value) ? Number(value) / 1e6 : ""; }
function fromMillions(value) { return finite(value) ? Number(value) * 1e6 : 0; }
function percentInput(value) { return finite(value) ? (Number(value) * 100).toFixed(2).replace(/\.00$/, "") : ""; }
function average(values) { return dcf.average(values) ?? null; }
function ratio(numerator, denominator) { return finite(numerator) && number(denominator) ? number(numerator) / number(denominator) : null; }
function growth(current, prior) { return finite(current) && number(prior) ? number(current) / number(prior) - 1 : null; }
function change(current, prior) { return finite(current) && finite(prior) ? number(current) - number(prior) : null; }
function signedCompact(value) {
  if (!finite(value)) return "—";
  return `${number(value) > 0 ? "+" : ""}${compact(value)}`;
}

function showMessage(text, error = false) {
  const node = $("#message");
  node.textContent = text;
  node.className = `message${error ? " error" : ""}`;
}
function clearMessage() { $("#message").className = "message hidden"; }

function defaultWacc(report) {
  const recent = report.rows.slice(0, state.historicalYears);
  const taxRate = Math.min(0.45, Math.max(0, average(recent.map((row) => row.effectiveTaxRate)) ?? 0.21));
  const interest = recent.find((row) => finite(row.interest))?.interest;
  const debt = number(report.valuation?.debt);
  const estimatedDebtCost = debt > 0 && finite(interest) ? Math.min(0.20, Math.max(0.01, Math.abs(interest) / debt)) : 0.05;
  const yahooBeta = report.quote?.beta;
  return {
    mode: "calculated",
    riskFreeRate: 0.0425,
    beta: finite(yahooBeta) ? number(yahooBeta) : 1,
    equityRiskPremium: 0.05,
    additionalPremium: 0,
    preTaxCostOfDebt: estimatedDebtCost,
    taxRate,
    equityValue: number(report.valuation?.marketCap),
    debtValue: debt,
    manualWacc: 0.09,
    sources: {
      riskFreeRate: "Model starting assumption — replace with the current Treasury yield",
      beta: finite(yahooBeta) ? "Yahoo Finance beta" : "Model fallback because Yahoo beta was unavailable",
      equityRiskPremium: "Model starting assumption — user editable",
      additionalPremium: "User input",
      preTaxCostOfDebt: debt > 0 && finite(interest) ? "Latest SEC interest expense ÷ debt" : "Model fallback because debt cost inputs were unavailable",
      taxRate: "Average effective tax rate from selected SEC history",
      equityValue: report.valuation?.marketCapSource || report.sources?.marketCap || "ClearFCF market data",
      debtValue: report.valuation?.debtSource || report.sources?.debt || "ClearFCF balance-sheet data",
      manualWacc: "User input"
    }
  };
}

function defaultDrivers() {
  return {
    revenueMethod: "cagr5",
    terminalRevenueGrowth: 0.03,
    ebitMarginMethod: "average5",
    terminalEbitMargin: null,
    dnaMargin: null,
    capexMargin: null,
    accountsReceivableMargin: null,
    inventoryMargin: null,
    prepaidExpensesMargin: null,
    accountsPayableMargin: null,
    accruedExpensesMargin: null
  };
}

function bridgeSourceMap(report) {
  return {
    cash: report.valuation?.cashSource || report.sources?.cash || "ClearFCF balance-sheet data",
    nonOperatingAssets: report.valuation?.otherNonOperatingAssetsSource || report.sources?.otherNonOperatingAssets || "Not available — review before relying on the bridge",
    debt: report.valuation?.debtSource || report.sources?.debt || "ClearFCF balance-sheet data",
    preferredStock: report.valuation?.preferredStockSource || report.sources?.preferredStock || "Not available — review before relying on the bridge",
    minorityInterest: report.valuation?.minorityInterestSource || report.sources?.minorityInterest || "Not available — review before relying on the bridge",
    shares: report.valuation?.sharesSource || report.sources?.shares || "ClearFCF diluted-share data",
    currentPrice: report.valuation?.priceSource || report.sources?.price || "Yahoo Finance market price"
  };
}

function makeCase(name, report) {
  const terminalDefaults = { bear: [0.02, 10], base: [0.025, 12], bull: [0.03, 14] }[name];
  const drivers = defaultDrivers();
  return {
    drivers,
    forecast: dcf.autoForecastWithDrivers(report.rows.slice(0, state.historicalYears), state.forecastYears, name, drivers),
    wacc: defaultWacc(report),
    terminal: { method: "perpetuity", growthRate: terminalDefaults[0], exitMetric: "ebit", exitMultiple: terminalDefaults[1] }
  };
}

function initializeModel(report) {
  const stored = loadStored(report.ticker);
  if (stored) {
    state.historicalYears = Math.min(10, Math.max(1, number(stored.historicalYears, 5)));
    state.forecastYears = Math.min(10, Math.max(1, number(stored.forecastYears, 5)));
    state.convention = stored.convention === "mid-year" ? "mid-year" : "year-end";
    state.cases = stored.cases;
    state.bridge = stored.bridge;
    state.bridgeSources = stored.bridgeSources || {};
    state.snapshots = Array.isArray(stored.snapshots) ? stored.snapshots : [];
    for (const name of CASES) if (!state.cases?.[name]) state.cases[name] = makeCase(name, report);
  } else {
    state.cases = Object.fromEntries(CASES.map((name) => [name, makeCase(name, report)]));
    state.bridge = {
      cash: number(report.valuation?.cash),
      nonOperatingAssets: finite(report.valuation?.otherNonOperatingAssets) ? number(report.valuation.otherNonOperatingAssets) : null,
      debt: number(report.valuation?.debt),
      preferredStock: finite(report.valuation?.preferredStock) ? number(report.valuation.preferredStock) : null,
      minorityInterest: finite(report.valuation?.minorityInterest) ? number(report.valuation.minorityInterest) : null,
      shares: number(report.valuation?.shares),
      currentPrice: number(report.valuation?.price)
    };
    state.bridgeSources = bridgeSourceMap(report);
    state.snapshots = [];
  }
  state.bridgeSources = { ...bridgeSourceMap(report), ...state.bridgeSources };
  for (const name of CASES) {
    state.cases[name].drivers = { ...defaultDrivers(), ...(state.cases[name].drivers || {}) };
    if (state.cases[name].terminal?.exitMetric === "ebitda") state.cases[name].terminal.exitMetric = "ebit";
  }
  normalizeForecastLengths();
}

function loadStored(ticker) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + ticker)); }
  catch { return null; }
}
function save() {
  if (!state.report) return;
  localStorage.setItem(STORAGE_PREFIX + state.report.ticker, JSON.stringify({
    historicalYears: state.historicalYears,
    forecastYears: state.forecastYears,
    convention: state.convention,
    cases: state.cases,
    bridge: state.bridge,
    bridgeSources: state.bridgeSources,
    snapshots: state.snapshots
  }));
  const node = $("#save-state");
  node.textContent = "Saved locally";
  clearTimeout(save.timer);
  save.timer = setTimeout(() => { node.textContent = "Changes save locally"; }, 1200);
}

function normalizeForecastLengths() {
  for (const name of CASES) {
    const current = state.cases[name].forecast || [];
    if (current.length === state.forecastYears) continue;
    const generated = dcf.autoForecastWithDrivers(state.report.rows.slice(0, state.historicalYears), state.forecastYears, name, state.cases[name].drivers);
    state.cases[name].forecast = generated.map((row, index) => current[index] ? { ...row, ...current[index], year: row.year } : row);
  }
}

function recalculateForecastWorkingCapital(model) {
  const latestHistorical = state.report.rows.slice(0, state.historicalYears).find((row) => finite(row.netWorkingCapital));
  let priorNwc = number(latestHistorical?.netWorkingCapital);
  for (const row of model.forecast) {
    row.operatingCurrentAssets = number(row.accountsReceivable) + number(row.inventory) + number(row.prepaidExpenses);
    row.operatingCurrentLiabilities = number(row.accountsPayable) + number(row.accruedExpenses);
    row.netWorkingCapital = row.operatingCurrentAssets - row.operatingCurrentLiabilities;
    row.changeInNwc = row.netWorkingCapital - priorNwc;
    priorNwc = row.netWorkingCapital;
    row.sources = {
      ...(row.sources || {}),
      operatingCurrentAssets: "A/R + inventory + prepaids",
      operatingCurrentLiabilities: "A/P + accrued expenses",
      netWorkingCapital: "Operating current assets − liabilities",
      changeInNwc: "Current operating NWC − prior operating NWC"
    };
  }
}

async function loadTicker(rawTicker, refresh = false) {
  const ticker = String(rawTicker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) return showMessage("Enter a valid ticker symbol.", true);
  showMessage(`Loading ${ticker} from ClearFCF’s SEC analysis…`);
  $("#workspace").classList.add("hidden");
  $("#empty").classList.add("hidden");
  try {
    const response = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}${refresh ? `&_t=${Date.now()}` : ""}`);
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || "Analysis request failed.");
    state.report = report;
    initializeModel(report);
    $("#ticker").value = ticker;
    $("#refresh-sec").disabled = false;
    $("#auto-all").disabled = false;
    clearMessage();
    renderAll();
    $("#workspace").classList.remove("hidden");
  } catch (error) {
    $("#empty").classList.remove("hidden");
    showMessage(error.message || "Could not load the company.", true);
  }
}

function renderSelectors() {
  const options = Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("");
  $("#historical-years").innerHTML = options;
  $("#forecast-years").innerHTML = options;
  $("#historical-years").value = state.historicalYears;
  $("#forecast-years").value = state.forecastYears;
  $("#discount-convention").value = state.convention;
}

function evidenceTitle(row, key) {
  const item = row.evidence?.[key];
  if (!item) return "No structured source was available for this value.";
  return [item.taxonomy && item.tag ? `${item.taxonomy}:${item.tag}` : item.label, item.form, item.filed && `filed ${item.filed}`, item.periodEnd && `period ended ${item.periodEnd}`].filter(Boolean).join(" • ");
}

function renderHistorical() {
  const rows = state.report.rows.slice(0, state.historicalYears).reverse();
  const metrics = [
    ["Revenue", "revenue", compact],
    ["EBIT", "ebit", compact],
    ["EBIT margin", "ebit", (value, row) => finite(value) && number(row.revenue) ? percent(value / row.revenue) : "—"],
    ["Effective tax rate", "effectiveTaxRate", percent],
    ["D&A", "dna", compact],
    ["Capital expenditures", "capex", compact],
    ["Accounts receivable", "accountsReceivable", compact],
    ["Inventory", "inventory", compact],
    ["Prepaid expenses", "prepaidExpenses", compact],
    ["Operating current assets", "operatingCurrentAssets", compact],
    ["Accounts payable", "accountsPayable", compact],
    ["Accrued expenses", "accruedExpenses", compact],
    ["Operating current liabilities", "operatingCurrentLiabilities", compact],
    ["Operating NWC", "netWorkingCapital", compact],
    ["Change in NWC", "changeInNwc", compact]
  ];
  $("#historical-table").innerHTML = `<table><thead><tr><th>Reported metric</th>${rows.map((row) => `<th>${row.year}</th>`).join("")}</tr></thead><tbody>${metrics.map(([label, key, formatter]) => `<tr><td class="row-label">${label}</td>${rows.map((row) => {
    const value = row[key];
    const evidenceKey = key === "ebit" ? "operatingIncome"
      : key === "effectiveTaxRate" ? "incomeTaxExpense"
        : key === "operatingCurrentAssets" ? "accountsReceivable"
          : key === "operatingCurrentLiabilities" ? "accountsPayable"
            : key === "netWorkingCapital" || key === "changeInNwc" ? "accountsReceivable" : key;
    return `<td class="${finite(value) ? "" : "missing"}" title="${escapeHtml(evidenceTitle(row, evidenceKey))}">${formatter(value, row)}${finite(value) ? '<i class="source-dot"></i>' : ""}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderTrends() {
  const rows = state.report.rows.slice(0, state.historicalYears).reverse();
  const body = rows.map((row, index) => {
    const prior = rows[index - 1];
    return `<tr>
      <td class="row-label">${row.year}</td>
      <td>${compact(row.revenue)}</td><td class="${number(change(row.revenue, prior?.revenue)) >= 0 ? "positive" : "negative"}">${signedCompact(change(row.revenue, prior?.revenue))}</td><td>${percent(growth(row.revenue, prior?.revenue))}</td>
      <td>${compact(row.ebit)}</td><td class="${number(change(row.ebit, prior?.ebit)) >= 0 ? "positive" : "negative"}">${signedCompact(change(row.ebit, prior?.ebit))}</td><td>${percent(growth(row.ebit, prior?.ebit))}</td><td>${percent(ratio(row.ebit, row.revenue))}</td>
      <td>${compact(row.ocf)}</td><td>${compact(row.fcf)}</td><td>${percent(ratio(row.fcf, row.revenue))}</td><td>${percent(growth(row.shares, prior?.shares))}</td>
    </tr>`;
  }).join("");
  $("#trend-table").innerHTML = `<table class="wide-table"><thead><tr><th>Year</th><th>Revenue</th><th>Δ revenue</th><th>Revenue growth</th><th>EBIT</th><th>Δ EBIT</th><th>EBIT growth</th><th>EBIT margin</th><th>Operating cash flow</th><th>FCF</th><th>FCF margin</th><th>Share change</th></tr></thead><tbody>${body}</tbody></table>`;
}

function methodLabel(method, type) {
  const labels = type === "revenue" ? {
    cagr5: "5-year CAGR", cagr3: "3-year CAGR", latest: "Latest YoY growth", average: "Average YoY growth", median: "Median YoY growth", fade: "Fade to a long-run rate"
  } : {
    average5: "5-year average margin", average3: "3-year average margin", latest: "Latest margin", median: "Median margin", fade: "Fade to a target margin"
  };
  return labels[method] || method;
}

function renderDrivers() {
  const model = state.cases[state.activeCase];
  const drivers = model.drivers;
  const rows = state.report.rows.slice(0, state.historicalYears);
  const growthRates = dcf.historicalGrowthRates(rows, 5);
  const margins = rows.filter((row) => finite(row.ebit) && number(row.revenue)).slice(0, 5).map((row) => row.ebit / row.revenue);
  const assumptions = dcf.historicalAssumptions(rows);
  if (!finite(drivers.terminalEbitMargin)) drivers.terminalEbitMargin = margins[0] ?? average(margins) ?? 0.12;
  for (const key of ["dnaMargin", "capexMargin", "accountsReceivableMargin", "inventoryMargin", "prepaidExpensesMargin", "accountsPayableMargin", "accruedExpensesMargin"]) {
    if (!finite(drivers[key])) drivers[key] = assumptions[key];
  }
  const revenueOptions = [["cagr5", "5-year CAGR"], ["cagr3", "3-year CAGR"], ["latest", "Latest YoY growth"], ["average", "Average YoY growth"], ["median", "Median YoY growth"], ["fade", "Fade to long-run rate"]];
  const marginOptions = [["average5", "5-year average"], ["average3", "3-year average"], ["latest", "Latest margin"], ["median", "Median margin"], ["fade", "Fade to target margin"]];
  $("#driver-card").innerHTML = `<div class="driver-grid">
    <div class="driver-block"><p class="eyebrow">Top-line method</p><h3>Revenue growth</h3>${field("Forecast method", "revenueMethod", drivers.revenueMethod, { group: "driver", select: revenueOptions })}${field("Long-run revenue growth", "terminalRevenueGrowth", drivers.terminalRevenueGrowth, { group: "driver", percent: true, hint: "Used when the fade method is selected." })}<p class="method-note">Active rule: <strong>${escapeHtml(methodLabel(drivers.revenueMethod, "revenue"))}</strong>. Rebuilding applies this rule to every forecast year.</p></div>
    <div class="driver-block"><p class="eyebrow">Profitability method</p><h3>EBIT margin</h3>${field("Forecast method", "ebitMarginMethod", drivers.ebitMarginMethod, { group: "driver", select: marginOptions })}${field("Target EBIT margin", "terminalEbitMargin", drivers.terminalEbitMargin, { group: "driver", percent: true, hint: "Used when the fade method is selected." })}<p class="method-note">Active rule: <strong>${escapeHtml(methodLabel(drivers.ebitMarginMethod, "margin"))}</strong>. Bear and bull cases retain their explicit margin adjustments.</p></div>
    <div class="driver-block full"><p class="eyebrow">Reinvestment and working-capital drivers</p><h3>Forecast D&A, CapEx and operating NWC</h3>
      ${field("D&A / revenue", "dnaMargin", drivers.dnaMargin, { group: "driver", percent: true, hint: "Historical average from the selected years." })}
      ${field("CapEx / revenue", "capexMargin", drivers.capexMargin, { group: "driver", percent: true, hint: "Historical average from the selected years." })}
      ${field("Accounts receivable / revenue", "accountsReceivableMargin", drivers.accountsReceivableMargin, { group: "driver", percent: true })}
      ${field("Inventory / revenue", "inventoryMargin", drivers.inventoryMargin, { group: "driver", percent: true })}
      ${field("Prepaid expenses / revenue", "prepaidExpensesMargin", drivers.prepaidExpensesMargin, { group: "driver", percent: true })}
      ${field("Accounts payable / revenue", "accountsPayableMargin", drivers.accountsPayableMargin, { group: "driver", percent: true })}
      ${field("Accrued expenses / revenue", "accruedExpensesMargin", drivers.accruedExpensesMargin, { group: "driver", percent: true })}
      <p class="method-note"><strong>Operating NWC = A/R + inventory + prepaids − A/P − accrued expenses.</strong> Change in NWC is the current period’s operating NWC minus the prior period’s operating NWC and is subtracted in FCFF. Edit these ratios, then click Rebuild this case.</p>
    </div>
    <div class="anchor-strip"><div><span>Latest growth</span><strong>${percent(growthRates[0])}</strong></div><div><span>3Y revenue CAGR</span><strong>${percent(dcf.cagr(rows, 3))}</strong></div><div><span>5Y revenue CAGR</span><strong>${percent(dcf.cagr(rows, 5))}</strong></div><div><span>Median YoY growth</span><strong>${percent(dcf.median(growthRates))}</strong></div><div><span>Latest EBIT margin</span><strong>${percent(margins[0])}</strong></div><div><span>5Y average margin</span><strong>${percent(average(margins))}</strong></div></div>
  </div>`;
}

function renderBacktest() {
  const backtest = dcf.backtestForecast(state.report.rows, state.cases[state.activeCase].drivers);
  if (!backtest.results.length) {
    $("#backtest-card").innerHTML = '<div class="empty-inline">At least four comparable annual periods are required for a walk-forward backtest.</div>';
    return;
  }
  $("#backtest-card").innerHTML = `<div class="kpi-strip"><div><span>Revenue MAPE</span><strong>${percent(backtest.revenueMape)}</strong></div><div><span>Revenue bias</span><strong>${percent(backtest.revenueBias)}</strong></div><div><span>EBIT MAPE</span><strong>${percent(backtest.ebitMape)}</strong></div><div><span>EBIT bias</span><strong>${percent(backtest.ebitBias)}</strong></div></div><table><thead><tr><th>Test year</th><th>Forecast revenue</th><th>Actual revenue</th><th>Revenue error</th><th>Forecast EBIT</th><th>Actual EBIT</th><th>EBIT error</th></tr></thead><tbody>${backtest.results.map((row) => `<tr><td class="row-label">${row.year}</td><td>${compact(row.predictedRevenue)}</td><td>${compact(row.actualRevenue)}</td><td>${percent(row.revenueError)}</td><td>${compact(row.predictedEbit)}</td><td>${compact(row.actualEbit)}</td><td>${percent(row.ebitError)}</td></tr>`).join("")}</tbody></table><p class="table-note">MAPE is the average absolute forecast error. Bias above zero means the method tended to over-forecast; below zero means it tended to under-forecast.</p>`;
}

function forecastCell(row, index, field, type = "money") {
  const raw = row[field];
  const value = type === "percent" ? percentInput(raw) : millions(raw);
  const source = row.sources?.[field] || row.source || "User input";
  return `<td><input class="${type === "percent" ? "percent-input" : ""}" type="number" step="${type === "percent" ? "0.1" : "0.1"}" value="${value}" data-forecast-index="${index}" data-forecast-field="${field}" data-input-type="${type}" aria-label="${escapeHtml(field)} ${row.year}"><small>${escapeHtml(source)}</small></td>`;
}

function renderForecast() {
  const model = state.cases[state.activeCase];
  const result = dcf.calculateCase(model, state.bridge, state.convention);
  $("#forecast-title").textContent = `${CASE_LABELS[state.activeCase]} forecast`;
  const rows = model.forecast;
  const inputRows = [
    ["Revenue", "revenue", "money"],
    ["Revenue growth", "revenueGrowth", "percent"],
    ["EBIT", "ebit", "money"],
    ["EBIT margin", "ebitMargin", "calculated"],
    ["Tax rate", "taxRate", "percent"],
    ["NOPAT", "nopat", "calculated"],
    ["D&A", "dna", "money"],
    ["Capital expenditures", "capex", "money"],
    ["Accounts receivable", "accountsReceivable", "money"],
    ["Inventory", "inventory", "money"],
    ["Prepaid expenses", "prepaidExpenses", "money"],
    ["Operating current assets", "operatingCurrentAssets", "calculated"],
    ["Accounts payable", "accountsPayable", "money"],
    ["Accrued expenses", "accruedExpenses", "money"],
    ["Operating current liabilities", "operatingCurrentLiabilities", "calculated"],
    ["Operating NWC", "netWorkingCapital", "calculated"],
    ["Change in NWC", "changeInNwc", "calculated"],
    ["Unlevered FCFF", "fcff", "calculated"],
    ["Discount factor", "discountFactor", "factor"],
    ["Present value", "presentValue", "calculated"]
  ];
  $("#forecast-table").innerHTML = `<table class="forecast-table"><thead><tr><th>Forecast metric</th>${rows.map((row) => `<th>${row.year}</th>`).join("")}</tr></thead><tbody>${inputRows.map(([label, field, type]) => `<tr><td class="row-label">${label}${field === "fcff" ? '<small>EBIT × (1 − tax) + D&A − CapEx − ΔNWC</small>' : ""}</td>${rows.map((row, index) => {
    if (type === "money" || type === "percent") return forecastCell(row, index, field, type);
    const calculated = result.years[index] || {};
    const output = field === "ebitMargin" ? (number(calculated.revenue) ? percent(calculated.ebit / calculated.revenue) : "—")
      : field === "discountFactor" ? (finite(calculated.discountFactor) ? calculated.discountFactor.toFixed(4) : "—")
        : compact(calculated[field]);
    return `<td class="calculated">${output}<small>Calculated</small></td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
}

function field(label, key, value, options = {}) {
  const percentField = options.percent === true;
  const displayValue = options.money ? millions(value) : percentField ? percentInput(value) : finite(value) ? value : "";
  return `<label class="field ${options.wide ? "wide" : ""}"><span>${label}</span>${options.select
    ? `<select data-${options.group}="${key}">${options.select.map(([id, name]) => `<option value="${id}" ${String(value) === id ? "selected" : ""}>${name}</option>`).join("")}</select>`
    : `<input type="number" step="${percentField ? "0.05" : "0.01"}" value="${displayValue}" data-${options.group}="${key}" data-input-type="${options.money ? "money" : percentField ? "percent" : "number"}">`}${options.hint ? `<small class="hint">${options.hint}</small>` : ""}</label>`;
}

function renderWacc() {
  const model = state.cases[state.activeCase];
  const wacc = dcf.calculateWacc(model.wacc);
  const sources = model.wacc.sources || {};
  $("#wacc-card").innerHTML = `<div class="form-grid">
    ${field("WACC mode", "mode", model.wacc.mode, { group: "wacc", select: [["calculated", "Calculate from inputs"], ["manual", "Manual WACC"]], wide: true })}
    ${field("Risk-free rate", "riskFreeRate", model.wacc.riskFreeRate, { group: "wacc", percent: true, hint: sources.riskFreeRate })}
    ${field("Beta", "beta", model.wacc.beta, { group: "wacc", hint: sources.beta })}
    ${field("Equity risk premium", "equityRiskPremium", model.wacc.equityRiskPremium, { group: "wacc", percent: true, hint: sources.equityRiskPremium })}
    ${field("Additional premium", "additionalPremium", model.wacc.additionalPremium, { group: "wacc", percent: true, hint: sources.additionalPremium })}
    ${field("Pre-tax cost of debt", "preTaxCostOfDebt", model.wacc.preTaxCostOfDebt, { group: "wacc", percent: true, hint: sources.preTaxCostOfDebt })}
    ${field("Tax rate", "taxRate", model.wacc.taxRate, { group: "wacc", percent: true, hint: sources.taxRate })}
    ${field("Market value of equity ($M)", "equityValue", model.wacc.equityValue, { group: "wacc", money: true, hint: sources.equityValue })}
    ${field("Debt value ($M)", "debtValue", model.wacc.debtValue, { group: "wacc", money: true, hint: sources.debtValue })}
    ${model.wacc.mode === "manual" ? field("Manual WACC", "manualWacc", model.wacc.manualWacc, { group: "wacc", percent: true, wide: true, hint: sources.manualWacc }) : ""}
    <div class="formula-box"><strong>Calculated WACC</strong><span>E ÷ (D + E) × cost of equity + D ÷ (D + E) × pre-tax debt cost × (1 − tax rate)</span><small>Cost of equity = risk-free rate + beta × equity risk premium + additional premium.</small></div>
    <div class="calculation-strip"><div><span>Cost of equity</span><strong>${percent(wacc.costOfEquity, 2)}</strong></div><div><span>After-tax debt cost</span><strong>${percent(wacc.afterTaxCostOfDebt, 2)}</strong></div><div><span>Active WACC</span><strong>${percent(wacc.wacc, 2)}</strong></div></div>
  </div>`;
}

function renderTerminal() {
  const model = state.cases[state.activeCase];
  const result = dcf.calculateCase(model, state.bridge, state.convention);
  const terminal = model.terminal;
  const finalYear = result.years.at(-1) || {};
  const terminalFormula = terminal.method === "perpetuity"
    ? `TV = final-year FCFF × (1 + g) ÷ (WACC − g) = ${compact(finalYear.fcff)} × (1 + ${percent(terminal.growthRate, 2)}) ÷ (${percent(result.wacc, 2)} − ${percent(terminal.growthRate, 2)})`
    : `TV = final-year ${terminal.exitMetric === "fcff" ? "FCFF" : "EBIT"} × exit multiple`;
  $("#terminal-card").innerHTML = `<div class="form-grid">
    ${field("Terminal method", "method", terminal.method, { group: "terminal", select: [["perpetuity", "Perpetuity growth"], ["exit", "Exit multiple"]], wide: true })}
    ${terminal.method === "perpetuity"
      ? field("Terminal growth rate", "growthRate", terminal.growthRate, { group: "terminal", percent: true, wide: true, hint: `Must remain below the active WACC of ${percent(result.wacc, 2)}.` })
      : `${field("Exit metric", "exitMetric", terminal.exitMetric, { group: "terminal", select: [["ebit", "EV / EBIT"], ["fcff", "EV / FCFF"]] })}${field("Exit multiple", "exitMultiple", terminal.exitMultiple, { group: "terminal" })}`}
    <div class="formula-box"><strong>Terminal-value formula</strong><span>${terminalFormula}</span><small>WACC reference: ${percent(result.wacc, 2)} from the active case’s WACC section. There is no separate terminal discount-rate input.</small></div>
    <div class="calculation-strip"><div><span>Terminal value</span><strong>${compact(result.terminalValue)}</strong></div><div><span>Present value</span><strong>${compact(result.terminalPresentValue)}</strong></div><div><span>Share of EV</span><strong>${percent(result.terminalShare)}</strong></div></div>
  </div>`;
}

function renderBridge() {
  const fields = [
    ["Cash", "cash"], ["Other non-operating assets", "nonOperatingAssets"], ["Debt", "debt"],
    ["Preferred stock", "preferredStock"], ["Non-controlling interest", "minorityInterest"], ["Diluted shares", "shares"]
  ];
  const source = (key) => state.bridgeSources[key] || "Source unavailable — review this input";
  $("#bridge-card").innerHTML = `<div class="bridge-grid">${fields.map(([label, key]) => field(key === "shares" ? "Diluted shares (M)" : `${label} ($M)`, key, state.bridge[key], { group: "bridge", money: true, hint: source(key) })).join("")}${field("Current share price", "currentPrice", state.bridge.currentPrice, { group: "bridge", hint: source("currentPrice") })}<div class="formula-box bridge-formula"><strong>Enterprise value to equity value</strong><span>Equity value = enterprise value + cash + other non-operating assets − debt − preferred stock − non-controlling interest.</span><small>${finite(state.report.quote?.enterpriseValue) ? `Yahoo Finance reported enterprise-value cross-check: ${compact(state.report.quote.enterpriseValue)}.` : "Yahoo Finance reported enterprise value was unavailable for this company."}</small></div></div>`;
}

function renderOutputs() {
  const result = dcf.calculateCase(state.cases[state.activeCase], state.bridge, state.convention);
  const items = [
    ["PV of forecast FCFF", compact(result.forecastPresentValue)],
    ["PV of terminal value", compact(result.terminalPresentValue)],
    ["Enterprise value", compact(result.enterpriseValue)],
    ["Equity value", compact(result.equityValue)],
    ["Implied share price", perShare(result.impliedSharePrice), "primary"],
    ["Upside / downside", percent(result.upside), finite(result.upside) ? (result.upside >= 0 ? "positive" : "negative") : ""]
  ];
  $("#valuation-output").innerHTML = items.map(([label, value, className = ""]) => `<div class="output-card ${className}"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderComparison() {
  const results = Object.fromEntries(CASES.map((name) => [name, dcf.calculateCase(state.cases[name], state.bridge, state.convention)]));
  const rows = [
    ["Final-year revenue", (name) => compact(results[name].years.at(-1)?.revenue)],
    ["Final-year EBIT", (name) => compact(results[name].years.at(-1)?.ebit)],
    ["Final-year FCFF", (name) => compact(results[name].years.at(-1)?.fcff)],
    ["WACC", (name) => percent(results[name].wacc, 2)],
    ["PV of terminal value", (name) => compact(results[name].terminalPresentValue)],
    ["Enterprise value", (name) => compact(results[name].enterpriseValue)],
    ["Equity value", (name) => compact(results[name].equityValue)],
    ["Implied share price", (name) => perShare(results[name].impliedSharePrice)],
    ["Upside / downside", (name) => percent(results[name].upside)]
  ];
  $("#comparison").innerHTML = `<table><thead><tr><th>Output</th>${CASES.map((name) => `<th>${CASE_LABELS[name]}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><td class="row-label">${label}</td>${CASES.map((name) => `<td>${getter(name)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderSensitivity() {
  const model = state.cases[state.activeCase];
  const sensitivity = dcf.sensitivity(model, state.bridge, state.convention);
  $("#sensitivity-description").textContent = sensitivity.isExit ? "Implied share price across WACC and exit-multiple assumptions." : "Implied share price across WACC and perpetual-growth assumptions.";
  $("#sensitivity").innerHTML = `<table class="sensitivity"><thead><tr><th>${sensitivity.isExit ? "Exit multiple" : "Terminal growth"} ↓ / WACC →</th>${sensitivity.waccValues.map((value) => `<th>${percent(value, 2)}</th>`).join("")}</tr></thead><tbody>${sensitivity.terminalValues.map((terminal, rowIndex) => `<tr><td class="row-label">${sensitivity.isExit ? `${terminal.toFixed(1)}x` : percent(terminal, 2)}</td>${sensitivity.cells[rowIndex].map((value, columnIndex) => `<td class="${rowIndex === 2 && columnIndex === 2 ? "near" : ""}">${perShare(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderQuality() {
  const rows = state.report.rows.slice(0, state.historicalYears).reverse();
  const latest = rows.at(-1) || {};
  const prior = rows.at(-2) || {};
  const conversion = ratio(latest.ocf, latest.netIncome);
  const shareChange = growth(latest.shares, prior.shares);
  $("#quality-card").innerHTML = `<div class="kpi-strip"><div><span>Latest OCF / net income</span><strong>${finite(conversion) ? `${conversion.toFixed(2)}x` : "—"}</strong></div><div><span>CapEx / revenue</span><strong>${percent(ratio(latest.capex, latest.revenue))}</strong></div><div><span>SBC / revenue</span><strong>${percent(ratio(latest.sbc, latest.revenue))}</strong></div><div><span>Latest share change</span><strong>${percent(shareChange)}</strong></div></div><table><thead><tr><th>Year</th><th>Net income</th><th>Operating cash flow</th><th>OCF / net income</th><th>CapEx / revenue</th><th>SBC / revenue</th><th>FCF</th><th>Buybacks</th><th>Dividends</th><th>Share change</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td class="row-label">${row.year}</td><td>${compact(row.netIncome)}</td><td>${compact(row.ocf)}</td><td>${finite(ratio(row.ocf, row.netIncome)) ? `${ratio(row.ocf, row.netIncome).toFixed(2)}x` : "—"}</td><td>${percent(ratio(row.capex, row.revenue))}</td><td>${percent(ratio(row.sbc, row.revenue))}</td><td>${compact(row.fcf)}</td><td>${compact(row.buybackCash)}</td><td>${compact(row.dividendsPaid)}</td><td>${percent(growth(row.shares, rows[index - 1]?.shares))}</td></tr>`).join("")}</tbody></table><p class="table-note">Share change uses comparable annual diluted-share observations. Positive change indicates dilution; negative change indicates net share-count reduction.</p>`;
}

function saveSnapshot() {
  const model = state.cases[state.activeCase];
  const result = dcf.calculateCase(model, state.bridge, state.convention);
  const lastYear = result.years.at(-1) || {};
  state.snapshots.unshift({
    id: `${Date.now()}-${state.activeCase}`,
    savedAt: new Date().toISOString(),
    caseName: state.activeCase,
    impliedSharePrice: result.impliedSharePrice,
    upside: result.upside,
    enterpriseValue: result.enterpriseValue,
    finalRevenue: lastYear.revenue,
    finalEbitMargin: ratio(lastYear.ebit, lastYear.revenue),
    forecastYears: state.forecastYears,
    drivers: { ...model.drivers }
  });
  state.snapshots = state.snapshots.slice(0, 20);
  updateAndRender();
  showMessage(`Saved the ${CASE_LABELS[state.activeCase]} forecast snapshot.`);
}

function renderSnapshots() {
  if (!state.snapshots.length) {
    $("#snapshot-card").innerHTML = '<div class="empty-inline">No saved forecasts yet. Save the current case before earnings or after an assumption change to preserve a scorecard.</div>';
    return;
  }
  $("#snapshot-card").innerHTML = `<div class="snapshot-list">${state.snapshots.map((item) => `<article class="snapshot"><div><p class="eyebrow">${escapeHtml(CASE_LABELS[item.caseName] || item.caseName)} case · ${item.forecastYears} years</p><h3>${new Date(item.savedAt).toLocaleString()}</h3><p>${escapeHtml(methodLabel(item.drivers?.revenueMethod, "revenue"))} · ${escapeHtml(methodLabel(item.drivers?.ebitMarginMethod, "margin"))}</p></div><dl><div><dt>Implied price</dt><dd>${perShare(item.impliedSharePrice)}</dd></div><div><dt>Upside / downside</dt><dd>${percent(item.upside)}</dd></div><div><dt>Terminal-year revenue</dt><dd>${compact(item.finalRevenue)}</dd></div><div><dt>Terminal EBIT margin</dt><dd>${percent(item.finalEbitMargin)}</dd></div></dl></article>`).join("")}</div>`;
}

function renderAudit() {
  const result = dcf.calculateCase(state.cases[state.activeCase], state.bridge, state.convention);
  const report = state.report;
  const missing = ["ebit", "effectiveTaxRate", "dna", "capex", "accountsReceivable", "inventory", "prepaidExpenses", "accountsPayable", "accruedExpenses"].filter((key) => !report.rows.slice(0, state.historicalYears).some((row) => finite(row[key])));
  const warnings = [...result.warnings];
  if (missing.length) warnings.push(`Historical SEC coverage is incomplete for: ${missing.join(", ")}. Automatic defaults were used where necessary.`);
  if (report.isFinancial) warnings.push("Conventional industrial-company FCFF is generally unsuitable for banking and insurance businesses.");
  const forecast = result.years;
  const historicalMargins = report.rows.slice(0, state.historicalYears).map((row) => ratio(row.ebit, row.revenue)).filter(finite);
  const maximumMargin = historicalMargins.length ? Math.max(...historicalMargins) : null;
  const finalMargin = ratio(forecast.at(-1)?.ebit, forecast.at(-1)?.revenue);
  if (finite(maximumMargin) && finite(finalMargin) && finalMargin > maximumMargin + 0.05) warnings.push("The terminal-year EBIT margin is more than five points above the selected historical maximum.");
  if (forecast.some((row) => number(row.capex) + Math.abs(number(row.revenue)) * 0.001 < number(row.dna))) warnings.push("At least one forecast year has capital expenditures below D&A; confirm that long-run reinvestment is sufficient.");
  if (forecast.some((row) => number(row.taxRate) < 0 || number(row.taxRate) > 0.45)) warnings.push("At least one forecast tax rate is outside the 0%–45% review range.");
  const caseResults = Object.fromEntries(CASES.map((name) => [name, dcf.calculateCase(state.cases[name], state.bridge, state.convention)]));
  const prices = CASES.map((name) => caseResults[name].impliedSharePrice);
  if (prices.every(finite) && !(prices[0] <= prices[1] && prices[1] <= prices[2])) warnings.push("Scenario ordering is inconsistent: Bear ≤ Base ≤ Bull does not hold for implied share price.");
  $("#audit").innerHTML = `<div class="audit-grid"><div><h3>Model methodology</h3><p><strong>FCFF:</strong> EBIT × (1 − tax rate) + D&A − CapEx − change in operating NWC.</p><p><strong>Operating current assets:</strong> accounts receivable + inventory + prepaid expenses.</p><p><strong>Operating current liabilities:</strong> accounts payable + accrued expenses.</p><p><strong>Operating NWC:</strong> operating current assets − operating current liabilities. Change in NWC equals current-period NWC minus prior-period NWC.</p><p><strong>Equity bridge:</strong> enterprise value + cash + other non-operating assets − debt − preferred stock − non-controlling interest.</p><p>Financial data source: <strong>${escapeHtml(report.sources?.financials || "Unavailable")}</strong>. Market data source: <strong>${escapeHtml(report.sources?.price || "Unavailable")}</strong>.</p></div><div><h3>Checks</h3><div class="warning-list">${warnings.length ? warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("") : '<div class="ok">No calculation errors detected for this case.</div>'}</div></div></div>`;
}

function renderAll() {
  if (!state.report) return;
  renderSelectors();
  $("#company-chip").innerHTML = `<strong>${escapeHtml(state.report.ticker)} · ${escapeHtml(state.report.companyName)}</strong><small>${escapeHtml(state.report.company?.sicDescription || "Industry unavailable")} · ${escapeHtml(state.report.financialCurrency || "USD")} statements</small>`;
  $$(".case-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.case === state.activeCase));
  renderTrends();
  renderHistorical();
  renderDrivers();
  renderForecast();
  renderBacktest();
  renderWacc();
  renderTerminal();
  renderBridge();
  renderOutputs();
  renderComparison();
  renderSensitivity();
  renderQuality();
  renderAudit();
  renderSnapshots();
}

function updateAndRender() {
  save();
  renderAll();
}

function syncVisibleDriverInputs(model) {
  $$("#driver-card [data-driver]").forEach((target) => {
    const key = target.dataset.driver;
    model.drivers[key] = target.tagName === "SELECT" ? target.value
      : target.dataset.inputType === "percent" ? number(target.value) / 100
        : number(target.value);
  });
}

$("#ticker-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadTicker($("#ticker").value);
});
$("#refresh-sec").addEventListener("click", () => loadTicker(state.report?.ticker, true));
$("#historical-years").addEventListener("change", (event) => { state.historicalYears = Number(event.target.value); updateAndRender(); });
$("#forecast-years").addEventListener("change", (event) => {
  state.forecastYears = Number(event.target.value);
  normalizeForecastLengths();
  updateAndRender();
});
$("#discount-convention").addEventListener("change", (event) => { state.convention = event.target.value; updateAndRender(); });
$("#auto-case").addEventListener("click", () => {
  const model = state.cases[state.activeCase];
  syncVisibleDriverInputs(model);
  model.forecast = dcf.autoForecastWithDrivers(state.report.rows.slice(0, state.historicalYears), state.forecastYears, state.activeCase, model.drivers);
  updateAndRender();
  showMessage(`Rebuilt the ${CASE_LABELS[state.activeCase]} case from the current assumptions.`);
});
$("#auto-all").addEventListener("click", () => {
  syncVisibleDriverInputs(state.cases[state.activeCase]);
  for (const name of CASES) state.cases[name].forecast = dcf.autoForecastWithDrivers(state.report.rows.slice(0, state.historicalYears), state.forecastYears, name, state.cases[name].drivers);
  updateAndRender();
  showMessage("Rebuilt Bear, Base, and Bull from their current assumptions.");
});
$("#save-snapshot").addEventListener("click", saveSnapshot);
$(".case-tabs").addEventListener("click", (event) => {
  const name = event.target.closest("button")?.dataset.case;
  if (!name) return;
  state.activeCase = name;
  renderAll();
});

$("#workspace").addEventListener("change", (event) => {
  const target = event.target;
  const model = state.cases[state.activeCase];
  if (target.dataset.forecastIndex != null) {
    const row = model.forecast[Number(target.dataset.forecastIndex)];
    const fieldName = target.dataset.forecastField;
    row[fieldName] = target.dataset.inputType === "money" ? fromMillions(target.value)
      : target.dataset.inputType === "percent" ? number(target.value) / 100
        : number(target.value);
    row.sources = { ...(row.sources || {}), [fieldName]: "User input" };
    if (fieldName === "revenue") {
      const rowIndex = Number(target.dataset.forecastIndex);
      const priorRevenue = rowIndex > 0 ? model.forecast[rowIndex - 1]?.revenue : state.report.rows.find((item) => finite(item.revenue))?.revenue;
      row.revenueGrowth = number(priorRevenue) ? row.revenue / priorRevenue - 1 : null;
      row.sources.revenueGrowth = "Calculated from revenue";
    } else if (fieldName === "revenueGrowth") {
      const rowIndex = Number(target.dataset.forecastIndex);
      const priorRevenue = rowIndex > 0 ? model.forecast[rowIndex - 1]?.revenue : state.report.rows.find((item) => finite(item.revenue))?.revenue;
      row.revenue = number(priorRevenue) * (1 + row.revenueGrowth);
      row.sources.revenue = "Calculated from growth";
    }
    if (["accountsReceivable", "inventory", "prepaidExpenses", "accountsPayable", "accruedExpenses"].includes(fieldName)) {
      recalculateForecastWorkingCapital(model);
    }
  } else if (target.dataset.wacc) {
    model.wacc[target.dataset.wacc] = target.tagName === "SELECT" ? target.value
      : target.dataset.inputType === "money" ? fromMillions(target.value)
        : target.dataset.inputType === "percent" ? number(target.value) / 100
          : number(target.value);
    if (target.dataset.wacc !== "mode") model.wacc.sources = { ...(model.wacc.sources || {}), [target.dataset.wacc]: "User input" };
  } else if (target.dataset.terminal) {
    model.terminal[target.dataset.terminal] = target.tagName === "SELECT" ? target.value
      : target.dataset.inputType === "percent" ? number(target.value) / 100
        : number(target.value);
  } else if (target.dataset.bridge) {
    state.bridge[target.dataset.bridge] = target.dataset.inputType === "money" ? fromMillions(target.value) : number(target.value);
    state.bridgeSources[target.dataset.bridge] = "User input";
  } else if (target.dataset.driver) {
    const key = target.dataset.driver;
    model.drivers[key] = target.tagName === "SELECT" ? target.value
      : target.dataset.inputType === "percent" ? number(target.value) / 100
        : number(target.value);
    save();
    renderAll();
    showMessage(`Updated the ${CASE_LABELS[state.activeCase]} assumption. Click “Rebuild this case” to apply it to the forecast.`);
    return;
  } else return;
  updateAndRender();
});

renderSelectors();
const requestedTicker = new URLSearchParams(window.location.search).get("ticker");
if (requestedTicker) loadTicker(requestedTicker);
