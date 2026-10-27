"use strict";

(function expose(factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ClearFcfScreening = api;
})(function createScreening() {
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function value(row, summaryKey, reportPath) {
    if (row?.[summaryKey] !== undefined) return row[summaryKey];
    return reportPath.reduce((current, key) => current?.[key], row);
  }

  function lookbackKey(criteria = {}) {
    const requested = String(criteria.lookbackYears ?? "all");
    return requested === "3" || requested === "5" ? requested : "all";
  }

  function marketDate(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }

  function marketDataFreshness(asOf, now = Date.now()) {
    if (!asOf) return "missing";
    const quoteTime = Date.parse(asOf);
    const currentTime = new Date(now).getTime();
    if (!Number.isFinite(quoteTime) || !Number.isFinite(currentTime)) return "missing";
    if (quoteTime > currentTime + 5 * 60 * 1000) return "stale";
    const quoteDate = marketDate(quoteTime);
    const currentDate = marketDate(currentTime);
    if (!quoteDate || !currentDate || quoteDate > currentDate) return "stale";
    let businessDays = 0;
    const cursor = new Date(`${quoteDate}T12:00:00Z`);
    const end = new Date(`${currentDate}T12:00:00Z`);
    while (cursor < end) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) businessDays += 1;
      if (businessDays > 1) return "stale";
    }
    return "fresh";
  }

  function selectedMetrics(row, criteria = {}) {
    const lookback = lookbackKey(criteria);
    const nested = row?.valuation?.lookbacks?.[lookback];
    if (nested) return { ...nested, lookback };

    const marketCap = number(value(row, "marketCap", ["valuation", "marketCap"]));
    const enterpriseValue = number(value(row, "enterpriseValue", ["valuation", "enterpriseValue"]));
    const normalizedFcf = number(lookback === "3"
      ? row?.normalizedFcf3y ?? row?.normalized3y?.normalizedFcf
      : lookback === "5"
        ? row?.normalizedFcf5y ?? row?.normalized5y?.normalizedFcf
        : row?.normalizedFcf ?? row?.normalized?.normalizedFcf);
    const normalizedEconomicFcf = number(lookback === "3"
      ? row?.normalizedEconomicFcf3y ?? row?.normalized3y?.normalizedEconomicFcf
      : lookback === "5"
        ? row?.normalizedEconomicFcf5y ?? row?.normalized5y?.normalizedEconomicFcf
        : row?.normalizedEconomicFcf ?? row?.normalized?.normalizedEconomicFcf);
    const normalizedInterest = number(lookback === "3"
      ? row?.normalizedInterest3y ?? row?.normalized3y?.averageInterest
      : lookback === "5"
        ? row?.normalizedInterest5y ?? row?.normalized5y?.averageInterest
        : row?.normalizedInterest ?? row?.normalized?.averageInterest);
    const unlevered = finite(normalizedFcf) && normalizedFcf > 0
      ? normalizedFcf + Math.max(0, normalizedInterest || 0) * 0.79
      : null;

    return {
      lookback,
      normalizedFcf,
      normalizedEconomicFcf,
      priceToNfcf: finite(marketCap) && finite(normalizedFcf) && normalizedFcf > 0 ? marketCap / normalizedFcf : null,
      priceToEconomicNfcf: finite(marketCap) && finite(normalizedEconomicFcf) && normalizedEconomicFcf > 0 ? marketCap / normalizedEconomicFcf : null,
      evToUnleveredNfcf: finite(enterpriseValue) && finite(unlevered) && unlevered > 0 ? enterpriseValue / unlevered : null,
      fcfYield: finite(marketCap) && marketCap > 0 && finite(normalizedFcf) ? normalizedFcf / marketCap : null,
      netDebtToNfcf: finite(number(value(row, "netDebt", ["valuation", "netDebt"]))) && finite(normalizedFcf) && normalizedFcf > 0
        ? number(value(row, "netDebt", ["valuation", "netDebt"])) / normalizedFcf
        : null
    };
  }

  function evaluateCandidate(row, criteria = {}) {
    const pass = [];
    const fail = [];
    const unknown = [];
    const excluded = [];
    const selected = selectedMetrics(row, criteria);
    const get = (summaryKey, ...path) => number(value(row, summaryKey, path));
    const threshold = (input, fallback) => number(input) ?? fallback;
    const recordMax = (label, actual, maximum) => {
      if (!finite(actual)) unknown.push(`${label} is unavailable`);
      else if (actual <= maximum) pass.push(`${label} is within the limit`);
      else fail.push(`${label} exceeds the limit`);
    };

    const sic = get("sic", "company", "sic");
    const isFinancial = row?.isFinancial === true || (finite(sic) && sic >= 6000 && sic <= 6799);
    if (criteria.excludeFinancials !== false && isFinancial) excluded.push("Financial institutions require a different cash-flow model");

    const marketCap = get("marketCap", "valuation", "marketCap");
    const minMarketCap = threshold(criteria.minMarketCap, 0);
    const maxMarketCap = threshold(criteria.maxMarketCap, Infinity);
    if (!finite(marketCap)) unknown.push("Market capitalization is unavailable");
    else if (marketCap < minMarketCap || marketCap > maxMarketCap) excluded.push("Market capitalization is outside the selected range");
    else pass.push("Market capitalization is within range");

    const usableYears = get("usableYears", "normalized", "usableYears");
    const minYears = threshold(criteria.minYears, 5);
    if (!finite(usableYears) || usableYears < minYears) excluded.push(`Fewer than ${minYears} usable annual periods`);
    else pass.push(`${usableYears} usable annual periods`);

    const quoteCurrency = row?.quoteCurrency ?? row?.quote?.currency;
    const currencyValid = row?.currencyConversionValid !== false && (!quoteCurrency || quoteCurrency === "USD");
    if (!currencyValid) fail.push("Currency conversion is unavailable or the quote is not USD");

    const instrumentType = row?.quoteInstrumentType ?? row?.quote?.instrumentType;
    if (instrumentType && instrumentType !== "EQUITY") {
      excluded.push("Market quote is no longer an active equity listing");
    }
    if (Object.hasOwn(row || {}, "marketDataAsOf")) {
      const freshness = marketDataFreshness(row.marketDataAsOf);
      if (freshness === "missing") fail.push("Market price timestamp is unavailable");
      else if (freshness === "stale") fail.push(`Market price is stale (last quote ${marketDate(row.marketDataAsOf) || "unknown"})`);
      else pass.push("Market price is current");
    }

    if (!finite(selected.priceToNfcf) || selected.priceToNfcf <= 0) unknown.push("Normalized FCF valuation is unavailable");
    else recordMax("P/nFCF", selected.priceToNfcf, threshold(criteria.maxMultiple, 15));
    if (!finite(selected.normalizedEconomicFcf)) unknown.push("Economic normalized FCF is unavailable because SBC history is incomplete");

    const maxEv = threshold(criteria.maxEvMultiple, Infinity);
    if (Number.isFinite(maxEv)) recordMax("EV/unlevered nFCF", selected.evToUnleveredNfcf, maxEv);

    recordMax("Net debt/nFCF", selected.netDebtToNfcf, threshold(criteria.maxDebt, 4));
    const normalizedSbcToFcf = get("normalizedSbcToFcf", "quality", "normalizedSbcToFcf");
    const legacySbcToFcf = get("latestSbcToFcf", "quality", "latestSbcToFcf");
    recordMax("Recent 3-year normalized SBC/FCF", finite(normalizedSbcToFcf) ? normalizedSbcToFcf : legacySbcToFcf, threshold(criteria.maxSbc, 0.30));

    const dilution = get("shareChange", "quality", "shareChange");
    const maxDilution = threshold(criteria.maxDilution, 0.25);
    const dilutionYears = get("shareChangeYears", "quality", "shareChangeYears");
    const annualizedDilution = get("shareChangeAnnualized", "quality", "shareChangeAnnualized");
    if (!finite(dilution)) unknown.push("Historical dilution is unavailable");
    else if (dilution <= maxDilution) pass.push("Historical dilution is within the limit");
    else {
      const span = finite(dilutionYears) ? ` over ${Math.round(dilutionYears)} years` : "";
      const annualized = finite(annualizedDilution) ? `; ${(annualizedDilution * 100).toFixed(1)}% annualized` : "";
      fail.push(`Historical dilution exceeds the limit (${(dilution * 100).toFixed(1)}%${span}${annualized})`);
    }

    if (row?.dataReconciliation?.capexReliable === false) unknown.push("Capital expenditure classification is unreliable");

    const positiveRatio = get("positiveFcfRatio", "quality", "positiveFcfRatio");
    const minPositive = threshold(criteria.minPosFcf, 0.67);
    if (!finite(positiveRatio)) unknown.push("Positive-FCF history is unavailable");
    else if (positiveRatio >= minPositive) pass.push("Positive-FCF history meets the minimum");
    else fail.push("Positive-FCF history is below the minimum");

    const debt = get("debt", "valuation", "debt");
    const cash = get("cash", "valuation", "cash");
    const shares = get("shares", "valuation", "shares");
    if (!finite(debt)) unknown.push("Total debt is unavailable");
    if (!finite(cash)) unknown.push("Cash and liquid investments are unavailable");
    if (!finite(shares)) unknown.push("Current share count is unavailable");

    if (criteria.enforceSolvency !== false) {
      const shortDebt = get("shortDebt", "valuation", "shortDebt");
      const latestFcf = get("latestFcf", "normalized", "latestReportedFcf");
      if (!finite(shortDebt) || !finite(cash) || !finite(latestFcf)) unknown.push("Near-term solvency inputs are incomplete");
      else if (shortDebt > cash + Math.max(0, latestFcf)) fail.push("Near-term debt exceeds cash plus annual FCF");
      else pass.push("Near-term liquidity covers short-term debt");
    }

    const fcfYield = selected.fcfYield;
    if (!finite(marketCap) || marketCap < 10_000_000 || !finite(fcfYield) || fcfYield <= 0 || fcfYield > 0.50) {
      fail.push("Valuation sanity check failed");
    }

    const marginAgreement = row?.marginAgreement ?? row?.normalized?.marginAgreement;
    if (criteria.requireMarginAgreement === true && marginAgreement !== true) fail.push("Normalized margins do not agree");

    const requireComplete = criteria.requireCompleteData !== false;
    const status = excluded.length ? "Excluded" : fail.length || (requireComplete && unknown.length) ? "Review" : "Idea";
    const reasons = status === "Idea" ? [] : [
      ...excluded.map((reason) => `Excluded: ${reason}`),
      ...fail.map((reason) => `Failed: ${reason}`),
      ...(requireComplete ? unknown.map((reason) => `Missing: ${reason}`) : [])
    ];
    return { status, passes: pass, failures: fail, unknowns: unknown, exclusions: excluded, reasons, selected };
  }

  return { evaluateCandidate, selectedMetrics, lookbackKey, marketDataFreshness };
});
