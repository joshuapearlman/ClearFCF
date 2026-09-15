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
    const minYears = threshold(criteria.minYears, 6);
    if (!finite(usableYears) || usableYears < minYears) excluded.push(`Fewer than ${minYears} usable annual periods`);
    else pass.push(`${usableYears} usable annual periods`);

    const quoteCurrency = row?.quoteCurrency ?? row?.quote?.currency;
    const currencyValid = row?.currencyConversionValid !== false && (!quoteCurrency || quoteCurrency === "USD");
    if (!currencyValid) fail.push("Currency conversion is unavailable or the quote is not USD");

    if (!finite(selected.priceToNfcf) || selected.priceToNfcf <= 0) unknown.push("Normalized FCF valuation is unavailable");
    else recordMax("P/nFCF", selected.priceToNfcf, threshold(criteria.maxMultiple, 15));
    if (!finite(selected.normalizedEconomicFcf)) unknown.push("Economic normalized FCF is unavailable because SBC history is incomplete");

    const maxEv = threshold(criteria.maxEvMultiple, Infinity);
    if (Number.isFinite(maxEv)) recordMax("EV/unlevered nFCF", selected.evToUnleveredNfcf, maxEv);

    recordMax("Net debt/nFCF", selected.netDebtToNfcf, threshold(criteria.maxDebt, 4));
    recordMax("SBC/annual FCF", get("latestSbcToFcf", "quality", "latestSbcToFcf"), threshold(criteria.maxSbc, 0.30));
    recordMax("Historical dilution", get("shareChange", "quality", "shareChange"), threshold(criteria.maxDilution, 0.25));

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
    return { status, passes: pass, failures: fail, unknowns: unknown, exclusions: excluded, selected };
  }

  return { evaluateCandidate, selectedMetrics, lookbackKey };
});
