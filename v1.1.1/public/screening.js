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

  function easternParts(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function marketDate(timestamp) {
    const fields = easternParts(timestamp);
    return fields ? `${fields.year}-${fields.month}-${fields.day}` : null;
  }

  function dateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function nthWeekday(year, month, weekday, nth) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return dateKey(year, month, 1 + (weekday - first + 7) % 7 + (nth - 1) * 7);
  }

  function lastWeekday(year, month, weekday) {
    const last = new Date(Date.UTC(year, month, 0));
    return dateKey(year, month, last.getUTCDate() - (last.getUTCDay() - weekday + 7) % 7);
  }

  function observedHoliday(year, month, day, saturdayObserved = true) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay();
    if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
    if (weekday === 6 && saturdayObserved) date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k + 7) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  // Recurring NYSE/Nasdaq cash-equity holidays. Exchange notices remain authoritative
  // for exceptional closures and early closes: https://www.nyse.com/trade/hours-calendars
  const EXTRA_CLOSED = new Set();
  const EXTRA_EARLY_CLOSES = new Map();
  const holidaysByYear = new Map();
  function marketHolidays(year) {
    if (holidaysByYear.has(year)) return holidaysByYear.get(year);
    const goodFriday = easterSunday(year);
    goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
    const holidays = new Set([
      observedHoliday(year, 1, 1, false),
      nthWeekday(year, 1, 1, 3),
      nthWeekday(year, 2, 1, 3),
      goodFriday.toISOString().slice(0, 10),
      lastWeekday(year, 5, 1),
      observedHoliday(year, 6, 19),
      observedHoliday(year, 7, 4),
      nthWeekday(year, 9, 1, 1),
      nthWeekday(year, 11, 4, 4),
      observedHoliday(year, 12, 25)
    ]);
    holidaysByYear.set(year, holidays);
    return holidays;
  }

  function isMarketSession(day, extraClosed = EXTRA_CLOSED) {
    const date = new Date(`${day}T12:00:00Z`);
    if (!Number.isFinite(date.getTime())) return false;
    const weekday = date.getUTCDay();
    return weekday !== 0 && weekday !== 6 && !marketHolidays(date.getUTCFullYear()).has(day) && !extraClosed.has(day);
  }

  function marketCloseMinutes(day, earlyCloses = EXTRA_EARLY_CLOSES) {
    if (earlyCloses.has(day)) return earlyCloses.get(day);
    const year = Number(day.slice(0, 4));
    const thanksgiving = nthWeekday(year, 11, 4, 4);
    const afterThanksgiving = new Date(`${thanksgiving}T12:00:00Z`);
    afterThanksgiving.setUTCDate(afterThanksgiving.getUTCDate() + 1);
    if (day === afterThanksgiving.toISOString().slice(0, 10)) return 13 * 60;
    if (day === dateKey(year, 12, 24) && isMarketSession(day)) return 13 * 60;
    return 16 * 60;
  }

  function latestExpectedSession(now, calendar = {}) {
    const parts = easternParts(now);
    if (!parts) return null;
    let day = `${parts.year}-${parts.month}-${parts.day}`;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    const extraClosed = calendar.closedDates || EXTRA_CLOSED;
    if (isMarketSession(day, extraClosed) && minutes >= marketCloseMinutes(day, calendar.earlyCloses) + 30) return day;
    let cursor = new Date(`${day}T12:00:00Z`);
    for (let n = 0; n < 14; n += 1) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      day = cursor.toISOString().slice(0, 10);
      if (isMarketSession(day, extraClosed)) return day;
    }
    return null;
  }

  function marketDataFreshness(asOf, now = Date.now(), calendar = {}) {
    if (!asOf) return "missing";
    const quoteTime = Date.parse(asOf);
    const currentTime = new Date(now).getTime();
    if (!Number.isFinite(quoteTime) || !Number.isFinite(currentTime)) return "missing";
    if (quoteTime > currentTime + 5 * 60 * 1000) return "stale";
    const quoteDate = marketDate(quoteTime);
    const currentDate = marketDate(currentTime);
    if (!quoteDate || !currentDate || quoteDate > currentDate) return "stale";
    const expected = latestExpectedSession(currentTime, calendar);
    if (!expected || quoteDate < expected) return "stale";
    const current = easternParts(currentTime);
    const quote = easternParts(quoteTime);
    const currentMinutes = Number(current.hour) * 60 + Number(current.minute);
    const quoteMinutes = Number(quote.hour) * 60 + Number(quote.minute);
    const close = marketCloseMinutes(currentDate, calendar.earlyCloses);
    const activeSession = isMarketSession(currentDate, calendar.closedDates || EXTRA_CLOSED)
      && currentMinutes >= 9 * 60 + 50 && currentMinutes < close + 30;
    if (activeSession && currentTime - quoteTime > 20 * 60 * 1000) return "delayed";
    const expectedClose = marketCloseMinutes(expected, calendar.earlyCloses);
    if (quoteDate === expected && currentDate !== expected && quoteMinutes < expectedClose - 20) return "delayed";
    if (quoteDate === currentDate && currentMinutes >= close + 30 && quoteMinutes < close - 20) return "delayed";
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
    const quotedPrice = get("price", "valuation", "price");
    if (!finite(quotedPrice)) fail.push("Market price is unavailable");
    if (Object.hasOwn(row || {}, "marketDataAsOf")) {
      const freshness = marketDataFreshness(row.marketDataAsOf);
      if (freshness === "missing") fail.push("Market price timestamp is unavailable");
      else if (freshness === "stale") fail.push(`Market price is stale (last quote ${marketDate(row.marketDataAsOf) || "unknown"})`);
      else if (freshness === "delayed") fail.push(`Market price is delayed (last quote ${row.marketDataAsOf})`);
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
    if (criteria.requireMarginAgreement !== false && marginAgreement !== true) fail.push("Normalized margins do not agree");

    const requireComplete = criteria.requireCompleteData !== false;
    const status = excluded.length ? "Excluded" : fail.length || (requireComplete && unknown.length) ? "Review" : "Idea";
    const reasons = status === "Idea" ? [] : [
      ...excluded.map((reason) => `Excluded: ${reason}`),
      ...fail.map((reason) => `Failed: ${reason}`),
      ...(requireComplete ? unknown.map((reason) => `Missing: ${reason}`) : [])
    ];
    return { status, passes: pass, failures: fail, unknowns: unknown, exclusions: excluded, reasons, selected };
  }

  return { evaluateCandidate, selectedMetrics, lookbackKey, marketDataFreshness, isMarketSession, latestExpectedSession };
});
