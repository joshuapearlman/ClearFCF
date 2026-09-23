"use strict";

const { fetchSecCompany, extractFinancials, fetchRecentForm4Purchases, fetchLatestAnnualSbcSeries } = require("./sec");
const { fetchYahooQuote, fetchYahooFinancials, fetchExchangeRate, fetchYahooPriceHistory } = require("./yahoo");
const { finite, round, median, standardDeviation } = require("./utils");
const { evaluateCandidate } = require("../public/screening");

function valueForYear(series, year) {
  return series?.values?.get(year)?.val ?? null;
}

function evidenceForYear(series, year) {
  const fact = series?.values?.get(year);
  if (!fact) return null;
  return {
    taxonomy: fact.taxonomy || series.taxonomy || null,
    tag: fact.tag || series.tag || null,
    label: fact.label || series.label || null,
    unit: fact.unit || series.unit || null,
    filed: fact.filed || null,
    form: fact.form || null,
    accession: fact.accn || null,
    periodEnd: fact.end || null,
    shareBasis: fact.shareBasis || null
  };
}

function annualRows(extracted) {
  const years = new Set();
  for (const series of Object.values(extracted.series)) {
    if (series?.values) {
      for (const year of series.values.keys()) years.add(year);
    }
  }
  const rows = [...years].sort((a, b) => b - a).slice(0, 10).map((year) => {
    const revenue = valueForYear(extracted.series.revenue, year);
    const grossProfit = valueForYear(extracted.series.grossProfit, year);
    const ebit = valueForYear(extracted.series.operatingIncome, year);
    const pretaxIncome = valueForYear(extracted.series.pretaxIncome, year);
    const incomeTaxExpenseRaw = valueForYear(extracted.series.incomeTaxExpense, year);
    const incomeTaxExpense = finite(incomeTaxExpenseRaw) ? Math.abs(incomeTaxExpenseRaw) : null;
    const netIncome = valueForYear(extracted.series.netIncome, year);
    const ocf = valueForYear(extracted.series.ocf, year);
    const capexTangibleRaw = valueForYear(extracted.series.capex, year);
    const capexIntangibleRaw = valueForYear(extracted.series.intangibleCapex, year);
    const capexTangible = finite(capexTangibleRaw) ? Math.abs(capexTangibleRaw) : null;
    const capexIntangible = finite(capexIntangibleRaw) ? Math.abs(capexIntangibleRaw) : null;
    const capex = finite(capexTangible) || finite(capexIntangible)
      ? (capexTangible || 0) + (capexIntangible || 0)
      : null;

    const dna = valueForYear(extracted.series.dna, year);
    const interest = valueForYear(extracted.series.interestExpense, year);
    const sbc = valueForYear(extracted.series.sbc, year);
    const shareFact = extracted.series.dilutedShares?.values?.get(year);
    const shares = shareFact?.val ?? null;
    const shareBasis = shareFact?.shareBasis || (finite(shares) ? "weighted-average diluted" : null);
    const buybackCashRaw = valueForYear(extracted.series.buybackCash, year);
    const buybackSharesRaw = valueForYear(extracted.series.buybackShares, year);
    const buybackCash = finite(buybackCashRaw) ? Math.abs(buybackCashRaw) : null;
    const buybackShares = finite(buybackSharesRaw) ? Math.abs(buybackSharesRaw) : null;
    const dividendsPaidRaw = valueForYear(extracted.series.dividendsPaid, year);
    const dividendsPaid = finite(dividendsPaidRaw) ? Math.abs(dividendsPaidRaw) : null;
    const currentAssets = valueForYear(extracted.series.currentAssets, year);
    const currentLiabilities = valueForYear(extracted.series.currentLiabilities, year);
    const accountsReceivable = valueForYear(extracted.series.accountsReceivable, year);
    const inventory = valueForYear(extracted.series.inventory, year);
    const prepaidExpenses = valueForYear(extracted.series.prepaidExpenses, year);
    const accountsPayable = valueForYear(extracted.series.accountsPayable, year);
    const accruedExpenses = valueForYear(extracted.series.accruedExpenses, year);
    const historicalCash = valueForYear(extracted.series.historicalCash, year);
    const historicalShortDebt = valueForYear(extracted.series.historicalShortDebt, year);
    const operatingCurrentAssets = [accountsReceivable, inventory, prepaidExpenses].some(finite)
      ? [accountsReceivable, inventory, prepaidExpenses].reduce((sum, value) => sum + (finite(value) ? value : 0), 0)
      : null;
    const operatingCurrentLiabilities = [accountsPayable, accruedExpenses].some(finite)
      ? [accountsPayable, accruedExpenses].reduce((sum, value) => sum + (finite(value) ? value : 0), 0)
      : null;
    const netWorkingCapital = finite(operatingCurrentAssets) && finite(operatingCurrentLiabilities)
      ? operatingCurrentAssets - operatingCurrentLiabilities
      : null;
    const effectiveTaxRate = finite(incomeTaxExpense) && finite(pretaxIncome) && pretaxIncome > 0
      ? incomeTaxExpense / pretaxIncome
      : null;

    const fcf = finite(ocf) && finite(capex) ? ocf - capex : null;
    const fcfEconomic = finite(fcf) && finite(sbc) ? fcf - sbc : null;

    return {
      year, revenue, grossProfit, ebit, pretaxIncome, incomeTaxExpense, effectiveTaxRate, netIncome,
      currentAssets, currentLiabilities, accountsReceivable, inventory, prepaidExpenses, accountsPayable, accruedExpenses,
      operatingCurrentAssets, operatingCurrentLiabilities, historicalCash, historicalShortDebt, netWorkingCapital,
      ocf, capex, capexTangible, capexIntangible, dna, interest, sbc, shares, shareBasis,
      fcf,
      fcfEconomic,
      buybackCash,
      buybackShares,
      dividendsPaid,
      dividendsPerShare: finite(dividendsPaid) && finite(shares) && shares > 0 ? dividendsPaid / shares : null,
      fcfMargin: finite(fcf) && finite(revenue) && revenue > 0 ? fcf / revenue : null,
      fcfEconomicMargin: finite(fcfEconomic) && finite(revenue) && revenue > 0 ? fcfEconomic / revenue : null,
      sbcToRevenue: finite(sbc) && finite(revenue) && revenue > 0 ? sbc / revenue : null,
      sbcToFcf: finite(sbc) && finite(fcf) && fcf > 0 ? sbc / fcf : null,
      capexToDna: finite(capex) && finite(dna) && dna > 0 ? capex / dna : null,
      evidence: Object.fromEntries(Object.entries(extracted.series).map(([key, series]) => [key, evidenceForYear(series, year)]))
    };
  });
  for (let index = 0; index < rows.length; index += 1) {
    const prior = rows[index + 1];
    rows[index].changeInNwc = finite(rows[index].netWorkingCapital) && finite(prior?.netWorkingCapital)
      ? rows[index].netWorkingCapital - prior.netWorkingCapital
      : null;
  }
  return rows;
}

function cloneSeries(series, fallbackTag = "Unavailable") {
  return {
    ...(series || {}),
    values: new Map(series?.values || []),
    tag: series?.tag || fallbackTag,
    label: series?.label || fallbackTag,
    unit: series?.unit || "USD"
  };
}

function mergeAnnualSeries(primary, fallback, options = {}) {
  const merged = cloneSeries(primary, fallback?.tag);
  for (const [year, fact] of fallback?.values || []) {
    if (options.override === true || !merged.values.has(year)) merged.values.set(year, fact);
  }
  if (!merged.taxonomy && fallback?.taxonomy) merged.taxonomy = fallback.taxonomy;
  if ((!merged.tag || merged.tag === "Unavailable") && fallback?.tag) merged.tag = fallback.tag;
  if ((!merged.label || merged.label === "Unavailable") && fallback?.label) merged.label = fallback.label;
  return merged;
}

function yahooOperatingCapexSeries(yahooFinancials) {
  const total = yahooFinancials?.series?.capex;
  const acquiredIntangibles = yahooFinancials?.series?.acquiredIntangibles;
  const result = cloneSeries(total, "annualCapitalExpenditure");
  result.values = new Map();
  result.label = "Capital expenditure excluding acquired intangibles";
  for (const [year, fact] of total?.values || []) {
    const intangible = acquiredIntangibles?.values?.get(year)?.val;
    const val = Math.max(0, Math.abs(fact.val) - (finite(intangible) ? Math.abs(intangible) : 0));
    result.values.set(year, { ...fact, val, label: result.label });
  }
  return result;
}

function reconciliationNeeds(extracted, includeDetail = false) {
  const rows = annualRows(extracted);
  const latest = rows.find((row) => finite(row.fcf));
  const capexSuspicious = Boolean(latest && finite(latest.capex) && finite(latest.dna) && latest.dna > 0 && latest.capex / latest.dna < 0.25);
  const recent = rows.filter((row) => finite(row.revenue) && finite(row.fcf)).slice(0, 3);
  const sbcMissing = includeDetail && (recent.length < 3 || recent.some((row) => !finite(row.sbc)));
  const shortDebtMissing = includeDetail && !finite(extracted?.latest?.shortDebt?.val);
  const nwcKeys = ["accountsReceivable", "inventory", "prepaidExpenses", "accountsPayable", "accruedExpenses"];
  const nwcMissing = includeDetail && nwcKeys.some((key) => !extracted?.series?.[key]?.values?.size);
  return { capexSuspicious, sbcMissing, shortDebtMissing, nwcMissing, needed: capexSuspicious || sbcMissing || shortDebtMissing || nwcMissing };
}

function reconcileAnnualFinancials(extracted, yahooFinancials, needs = reconciliationNeeds(extracted, true)) {
  const next = {
    ...extracted,
    series: Object.fromEntries(Object.entries(extracted.series || {}).map(([key, value]) => [key, cloneSeries(value, key)])),
    latest: { ...(extracted.latest || {}) }
  };
  const notes = [];
  let capexReconciled = false;
  let sbcReconciled = false;
  let shortDebtReconciled = false;
  let nwcReconciled = false;

  if (needs.capexSuspicious) {
    const secLatest = annualRows(next).find((row) => finite(row.capex) && finite(row.dna));
    const operatingCapex = yahooOperatingCapexSeries(yahooFinancials);
    const yahooLatest = [...operatingCapex.values.entries()].sort((a, b) => b[0] - a[0])[0]?.[1]?.val;
    if (secLatest && finite(yahooLatest) && yahooLatest > secLatest.capex * 2 && yahooLatest >= secLatest.dna * 0.25) {
      next.series.capex = mergeAnnualSeries(next.series.capex, operatingCapex, { override: true });
      const intangible = cloneSeries(next.series.intangibleCapex, "Unavailable");
      for (const year of operatingCapex.values.keys()) intangible.values.delete(year);
      next.series.intangibleCapex = intangible;
      capexReconciled = true;
      notes.push("SEC CapEx facts appeared to capture acquired intangibles rather than operating capital expenditure; Yahoo annual CapEx less acquired intangibles was used for overlapping years.");
    }
  }

  if (needs.sbcMissing && yahooFinancials?.series?.sbc?.values?.size) {
    const before = next.series.sbc?.values?.size || 0;
    next.series.sbc = mergeAnnualSeries(next.series.sbc, yahooFinancials.series.sbc);
    sbcReconciled = next.series.sbc.values.size > before;
    if (sbcReconciled) notes.push("Missing SEC SBC periods were filled from Yahoo annual stock-based compensation history.");
  }

  if (needs.shortDebtMissing && finite(yahooFinancials?.latest?.shortDebt?.val)) {
    next.latest.shortDebt = yahooFinancials.latest.shortDebt;
    shortDebtReconciled = true;
    notes.push("SEC current debt was unavailable; Yahoo current debt was used for the near-term solvency check.");
  }

  if (needs.nwcMissing) {
    for (const key of ["accountsReceivable", "inventory", "prepaidExpenses", "accountsPayable", "accruedExpenses"]) {
      const before = next.series[key]?.values?.size || 0;
      next.series[key] = mergeAnnualSeries(next.series[key], yahooFinancials?.series?.[key]);
      if ((next.series[key]?.values?.size || 0) > before) nwcReconciled = true;
    }
    if (nwcReconciled) notes.push("Missing operating working-capital components were filled from Yahoo annual balance-sheet history where available.");
  }

  return { extracted: next, notes, capexReconciled, sbcReconciled, shortDebtReconciled, nwcReconciled };
}

function normalize(rows, maxYears = null) {
  const allUsable = rows.filter((row) => finite(row.revenue) && row.revenue > 0 && finite(row.fcf));
  const usable = maxYears && maxYears > 0 ? allUsable.slice(0, maxYears) : allUsable;

  const latestRevenue = usable[0]?.revenue ?? null;
  if (!usable.length || !finite(latestRevenue)) {
    return {
      usableYears: 0, latestRevenue, latestReportedFcf: null, latestReportedEconomicFcf: null,
      totalRevenue: null, totalFcf: null, averageAnnualFcf: null, averageMargin: null,
      simpleAverageMargin: null, weightedMargin: null, blendedMargin: null, simpleVsWeightedGap: null,
      medianMargin: null, averageMedianGap: null, marginAgreement: false, outlierYears: [],
      normalizedFcf: null, normalizedSbc: null, normalizedSbcToFcf: null,
      normalizedEconomicFcf: null, sbcUsableYears: 0, averageInterest: null
    };
  }

  const totalRevenue = usable.reduce((sum, row) => sum + row.revenue, 0);
  const totalFcf = usable.reduce((sum, row) => sum + row.fcf, 0);
  const averageAnnualFcf = totalFcf / usable.length;
  const interestRows = usable.filter((row) => finite(row.interest));
  const averageInterest = interestRows.length
    ? interestRows.reduce((sum, row) => sum + Math.max(0, row.interest), 0) / interestRows.length
    : null;

  // 1. Simple average of annual margins
  const simpleAverageMargin = usable.reduce((sum, row) => sum + row.fcfMargin, 0) / usable.length;

  // 2. Aggregate volume-weighted margin: Total FCF / Total Revenue
  const weightedMargin = totalRevenue > 0 ? totalFcf / totalRevenue : simpleAverageMargin;

  // 3. Both used equally: 50/50 blended margin
  const blendedMargin = (simpleAverageMargin + weightedMargin) / 2;

  // 4. Comparison between simple average and aggregate volume-weighted average
  const simpleVsWeightedGap = finite(weightedMargin) && Math.abs(weightedMargin) > 1e-12
    ? Math.abs(simpleAverageMargin - weightedMargin) / Math.abs(weightedMargin)
    : 0;

  // 5. Median cross-check against simple average
  const medianMargin = median(usable.map((row) => row.fcfMargin));
  const averageMedianGap = finite(medianMargin) && Math.abs(medianMargin) > 1e-12
    ? Math.abs(simpleAverageMargin - medianMargin) / Math.abs(medianMargin)
    : Math.abs(simpleAverageMargin - (medianMargin || 0)) <= 1e-12 ? 0 : null;

  // Allow margin agreement if gap <= 25%, OR if margins are structurally expanding (recent 3y avg >= median)
  const recentUsable = usable.slice(0, Math.min(3, usable.length));
  const recentAvgMargin = recentUsable.reduce((sum, r) => sum + r.fcfMargin, 0) / recentUsable.length;
  const isExpanding = finite(recentAvgMargin) && finite(medianMargin) && recentAvgMargin >= medianMargin;
  const marginAgreement = (finite(averageMedianGap) && averageMedianGap <= 0.25) || isExpanding;

  // Outlier detection via MAD
  const absoluteDeviations = usable.map((row) => Math.abs(row.fcfMargin - medianMargin));
  const medianAbsoluteDeviation = median(absoluteDeviations);
  const outlierYears = usable.filter((row) => {
    const deviation = Math.abs(row.fcfMargin - medianMargin);
    if (medianAbsoluteDeviation > 1e-12) return 0.6745 * deviation / medianAbsoluteDeviation > 3.5;
    return deviation > 0.05;
  }).map((row) => ({ year: row.year, margin: row.fcfMargin }));

  // Normalized FCF (using the blended 50/50 margin)
  const normalizedFcf = blendedMargin * latestRevenue;

  // Normalize recurring SBC over the latest three annual periods. Requiring an
  // entire 10-year SBC series made otherwise complete filings fail, while using
  // only the latest annual FCF made cyclical companies look artificially bad.
  const recentSbcWindow = usable.slice(0, Math.min(3, usable.length));
  const sbcRows = recentSbcWindow.filter((row) => finite(row.sbc) && finite(row.sbcToRevenue));
  const sbcComplete = recentSbcWindow.length >= 3 && sbcRows.length === recentSbcWindow.length;
  const sbcRevenue = sbcComplete ? sbcRows.reduce((sum, row) => sum + row.revenue, 0) : null;
  const totalSbc = sbcComplete ? sbcRows.reduce((sum, row) => sum + Math.max(0, row.sbc), 0) : null;
  const simpleSbcMargin = sbcComplete ? sbcRows.reduce((sum, row) => sum + row.sbcToRevenue, 0) / sbcRows.length : null;
  const weightedSbcMargin = sbcComplete && sbcRevenue > 0 ? totalSbc / sbcRevenue : null;
  const blendedSbcMargin = sbcComplete ? (simpleSbcMargin + weightedSbcMargin) / 2 : null;
  const normalizedSbc = finite(blendedSbcMargin) ? blendedSbcMargin * latestRevenue : null;
  const normalizedSbcToFcf = finite(normalizedSbc) && normalizedFcf > 0 ? normalizedSbc / normalizedFcf : null;
  const normalizedEconomicFcf = finite(normalizedSbc) ? normalizedFcf - normalizedSbc : null;

  return {
    usableYears: usable.length,
    latestRevenue,
    latestReportedFcf: usable[0].fcf,
    latestReportedEconomicFcf: usable[0].fcfEconomic,
    totalRevenue,
    totalFcf,
    averageAnnualFcf,
    averageMargin: simpleAverageMargin, // retained for backward compatibility
    simpleAverageMargin,
    weightedMargin,
    blendedMargin,
    simpleVsWeightedGap,
    medianMargin,
    averageMedianGap,
    marginAgreement,
    medianAbsoluteDeviation,
    outlierYears,
    normalizedFcf,
    normalizedSbc,
    normalizedSbcToFcf,
    normalizedEconomicFcf,
    sbcUsableYears: sbcRows.length,
    averageInterest,
    includedYears: usable.map((row) => row.year)
  };
}

function selectValuationShares(rows, instantFact) {
  const annualRow = rows.find((row) => finite(row.shares) && row.shares > 0);
  const annual = annualRow?.shares ?? null;
  const annualDescription = annualRow?.shareBasis === "period-end outstanding"
    ? "annual period-end shares outstanding"
    : "annual diluted weighted-average shares";
  const instant = instantFact?.val ?? null;
  if (finite(annual) && finite(instant) && instant > 0) {
    const ratio = instant / annual;
    if (ratio >= 0.7 && ratio <= 1.3) {
      return { shares: instant, source: `SEC shares outstanding (${instantFact.end})`, annual, instant, inconsistent: false };
    }
    return { shares: annual, source: `Latest ${annualDescription} (${annualRow.year})`, annual, instant, inconsistent: true };
  }
  if (finite(annual)) return { shares: annual, source: `Latest ${annualDescription} (${annualRow.year})`, annual, instant: null, inconsistent: false };
  if (finite(instant) && instant > 0) return { shares: instant, source: `SEC shares outstanding (${instantFact.end})`, annual: null, instant, inconsistent: false };
  return { shares: null, source: "Unavailable", annual, instant, inconsistent: false };
}

function debtValue(latest) {
  const total = latest.totalDebt?.val;
  const short = latest.shortDebt?.val;
  const long = latest.longDebt?.val;
  const components = finite(short) || finite(long) ? (finite(short) ? short : 0) + (finite(long) ? long : 0) : null;
  if (finite(total) && finite(components)) return Math.max(total, components);
  if (finite(total)) return total;
  return finite(components) ? components : null;
}

function reconcileBalanceSheet(latest, quote, fxRate = 1) {
  const secDebtRaw = debtValue(latest);
  const secCashRaw = latest.cash?.val;
  const secDebt = finite(secDebtRaw) ? secDebtRaw * fxRate : null;
  const secCash = finite(secCashRaw) ? secCashRaw * fxRate : null;
  const yahooDebt = finite(quote?.totalDebt) ? quote.totalDebt : null;
  const yahooCash = finite(quote?.totalCash) ? quote.totalCash : null;
  let debt = secDebt;
  let cash = secCash;
  let debtSource = finite(secDebt) ? "SEC debt reconciliation" : "Unavailable";
  let cashSource = finite(secCash) ? "SEC cash and liquid investments" : "Unavailable";
  const notes = [];

  if (!finite(debt) && finite(yahooDebt)) {
    debt = yahooDebt;
    debtSource = "Yahoo Finance total debt fallback";
    notes.push("SEC debt was unavailable; Yahoo total debt was used.");
  } else if (finite(debt) && finite(yahooDebt) && yahooDebt > debt * 2 && yahooDebt - debt > 5_000_000_000) {
    debt = yahooDebt;
    debtSource = "Yahoo Finance total debt (material SEC discrepancy)";
    notes.push("Yahoo total debt materially exceeded the SEC-tagged amount; the higher Yahoo figure was used.");
  }

  if (!finite(cash) && finite(yahooCash)) {
    cash = yahooCash;
    cashSource = "Yahoo Finance total cash fallback";
    notes.push("SEC liquid cash was unavailable; Yahoo total cash was used.");
  } else if (finite(cash) && finite(yahooCash) && yahooCash > cash * 1.15) {
    cash = yahooCash;
    cashSource = "Yahoo Finance total cash (includes additional liquid investments)";
    notes.push("Yahoo total cash materially exceeded the SEC cash fact and was used as the broader liquid-cash measure.");
  }

  return { debt, cash, debtSource, cashSource, notes, reconciled: notes.length > 0 };
}

function computeQuality(rows, normalized, currentPrice = null) {
  const usable = rows.filter((row) => finite(row.fcf) && finite(row.revenue) && row.revenue > 0);
  const positiveYears = usable.filter((row) => row.fcf > 0).length;
  const margins = usable.map((row) => row.fcfMargin);
  const allShareRows = rows.filter((row) => finite(row.shares) && row.shares > 0);
  const newestShareBasis = allShareRows[0]?.shareBasis || null;
  const shareRows = newestShareBasis
    ? allShareRows.filter((row) => row.shareBasis === newestShareBasis)
    : allShareRows;
  const comparableShares = shareRows.length ? [shareRows[0]] : [];
  for (let index = 1; index < shareRows.length; index += 1) {
    const prior = comparableShares.at(-1).shares;
    const next = shareRows[index].shares;
    if (Math.abs(prior - next) / Math.min(prior, next) > 0.6) break;
    comparableShares.push(shareRows[index]);
  }
  const latestShares = comparableShares[0]?.shares;
  const oldestShares = comparableShares.length >= 2 ? comparableShares.at(-1)?.shares : null;
  const dilution = finite(latestShares) && finite(oldestShares) && oldestShares > 0 ? latestShares / oldestShares - 1 : null;
  const dilutionYears = Number.isInteger(comparableShares[0]?.year) && Number.isInteger(comparableShares.at(-1)?.year)
    ? Math.abs(comparableShares[0].year - comparableShares.at(-1).year) : null;
  const annualizedDilution = finite(dilution) && finite(dilutionYears) && dilutionYears > 0 && latestShares > 0 && oldestShares > 0
    ? (latestShares / oldestShares) ** (1 / dilutionYears) - 1 : null;
  const latestSbc = rows.find((row) => finite(row.sbc));

  // Cumulative CapEx vs Cumulative D&A over usable periods
  const totalCapex = usable.reduce((sum, r) => sum + (r.capex || 0), 0);
  const totalDna = usable.reduce((sum, r) => sum + (r.dna || 0), 0);
  const capexToDnaRatio = totalDna > 0 ? totalCapex / totalDna : null;

  // 1. Share Buyback Capital Allocation Audit (with SEC unit scale check)
  const pairedBuybackRows = rows.filter((row) => finite(row.buybackCash) && row.buybackCash > 0 && finite(row.buybackShares) && row.buybackShares > 0);
  const totalBuybackCash = pairedBuybackRows.reduce((sum, r) => sum + Math.abs(r.buybackCash), 0);
  let totalBuybackShares = pairedBuybackRows.reduce((sum, r) => sum + Math.abs(r.buybackShares), 0);
  let averageBuybackPrice = totalBuybackShares > 0 && totalBuybackCash > 0 ? totalBuybackCash / totalBuybackShares : null;

  // SEC Unit Scaling Sanity Check: If shares were reported in thousands while cash was in exact dollars
  if (finite(averageBuybackPrice) && finite(currentPrice) && currentPrice > 0) {
    if (averageBuybackPrice / currentPrice > 5.0 && (averageBuybackPrice / 1000) / currentPrice <= 3.0 && (averageBuybackPrice / 1000) / currentPrice >= 0.1) {
      totalBuybackShares = totalBuybackShares * 1000;
      averageBuybackPrice = totalBuybackCash / totalBuybackShares;
    }
  }

  let buybackAllocationRating = "No Buybacks";
  let buybackPriceVsCurrent = null;
  if (finite(averageBuybackPrice)) {
    if (finite(currentPrice) && currentPrice > 0) {
      buybackPriceVsCurrent = averageBuybackPrice / currentPrice;
      if (buybackPriceVsCurrent <= 0.85) {
        buybackAllocationRating = "Accretive";
      } else if (buybackPriceVsCurrent >= 1.25) {
        buybackAllocationRating = buybackPriceVsCurrent > 5 ? "Unreliable" : "Value Destructive";
      } else {
        buybackAllocationRating = "Neutral";
      }
    } else {
      buybackAllocationRating = "Active";
    }
  }

  // 2. FCF Trajectory & Multi-Year Trend Detection
  let fcfTrajectory = "Stable";
  let recent3yAvgMargin = null;
  let baselineMargin = null;
  let marginSlope = null;
  if (usable.length >= 3) {
    const recent3 = usable.slice(0, 3);
    recent3yAvgMargin = recent3.reduce((sum, r) => sum + r.fcfMargin, 0) / recent3.length;
    const baseline = usable.length >= 5 ? usable.slice(2, 5) : usable.slice(1);
    baselineMargin = baseline.length ? baseline.reduce((sum, r) => sum + r.fcfMargin, 0) / baseline.length : recent3yAvgMargin;
    marginSlope = recent3yAvgMargin - baselineMargin;

    const recentAvgFcf = recent3.reduce((sum, r) => sum + r.fcf, 0) / recent3.length;
    const baselineFcf = baseline.length ? baseline.reduce((sum, r) => sum + r.fcf, 0) / baseline.length : recentAvgFcf;
    const fcfChange = baselineFcf > 0 ? (recentAvgFcf - baselineFcf) / baselineFcf : 0;

    if (marginSlope >= 0.02 || fcfChange >= 0.20) {
      fcfTrajectory = "Expanding";
    } else if (marginSlope <= -0.03 || fcfChange <= -0.25) {
      fcfTrajectory = "Deteriorating";
    }
  }

  const reliability = normalized.usableYears < 6 ? "Insufficient" : positiveYears / usable.length >= 0.8 && standardDeviation(margins) <= 0.08 ? "High" : positiveYears / usable.length >= 0.67 ? "Medium" : "Low";

  return {
    reliability,
    positiveFcfYears: positiveYears,
    positiveFcfRatio: usable.length ? positiveYears / usable.length : null,
    marginVolatility: standardDeviation(margins),
    shareChange: dilution,
    shareChangeYears: dilutionYears,
    shareChangeAnnualized: annualizedDilution,
    shareChangeBasis: newestShareBasis,
    latestSbcToRevenue: latestSbc?.sbcToRevenue ?? null,
    latestSbcToFcf: latestSbc?.sbcToFcf ?? null,
    normalizedSbcToFcf: normalized.normalizedSbcToFcf ?? null,
    sbcCoverageYears: normalized.sbcUsableYears ?? 0,
    capexToDnaRatio,
    buybackAudit: {
      totalCashSpent: totalBuybackCash,
      totalSharesRepurchased: totalBuybackShares,
      averageBuybackPrice,
      buybackPriceVsCurrent,
      rating: buybackAllocationRating,
      coverageYears: pairedBuybackRows.length
    },
    fcfTrajectory,
    recent3yAvgMargin,
    baselineMargin,
    marginSlope
  };
}

function computeOwnerReturns(rows, normalized, marketCap, dividends = {}) {
  const dividendRows = rows.filter((row) => finite(row.dividendsPerShare) && row.dividendsPerShare > 0);
  const latest = rows[0] || {};
  const latestDividendCash = finite(latest.dividendsPaid) ? latest.dividendsPaid
    : finite(dividends.annualRate) && finite(latest.shares) ? dividends.annualRate * latest.shares : null;
  const payoutRatio = finite(latestDividendCash) && finite(normalized.normalizedFcf) && normalized.normalizedFcf > 0
    ? latestDividendCash / normalized.normalizedFcf : null;
  const fiveYearRows = dividendRows.slice(0, 5);
  const newest = fiveYearRows[0];
  const oldest = fiveYearRows.at(-1);
  const growthYears = newest && oldest ? newest.year - oldest.year : 0;
  const fiveYearGrowth = growthYears > 0 && oldest.dividendsPerShare > 0
    ? (newest.dividendsPerShare / oldest.dividendsPerShare) ** (1 / growthYears) - 1 : null;
  let yearsWithoutCut = dividendRows.length ? 1 : 0;
  for (let index = 0; index < dividendRows.length - 1; index += 1) {
    if (dividendRows[index].dividendsPerShare + 1e-9 < dividendRows[index + 1].dividendsPerShare * 0.98) break;
    yearsWithoutCut += 1;
  }
  const latestCut = dividendRows.length >= 2
    ? dividendRows[0].dividendsPerShare < dividendRows[1].dividendsPerShare * 0.98 : false;
  const coverage = !finite(dividends.currentYield) || dividends.currentYield <= 0 ? "No dividend"
    : !finite(payoutRatio) ? "Coverage unavailable"
      : payoutRatio <= 0.60 ? "Strong coverage"
        : payoutRatio <= 0.85 ? "Covered"
          : payoutRatio <= 1 ? "Stretched" : "Not covered by nFCF";

  const buybackCashYield = finite(latest.buybackCash) && finite(marketCap) && marketCap > 0 ? latest.buybackCash / marketCap : null;
  const sbcYield = finite(latest.sbc) && finite(marketCap) && marketCap > 0 ? latest.sbc / marketCap : null;
  const dividendCashYield = finite(latestDividendCash) && finite(marketCap) && marketCap > 0
    ? latestDividendCash / marketCap : dividends.currentYield;
  const shareholderYield = finite(dividendCashYield) && finite(buybackCashYield) && finite(sbcYield)
    ? dividendCashYield + buybackCashYield - sbcYield : null;
  const prior = rows.find((row, index) => index > 0 && finite(row.shares) && row.shares > 0);
  const netBuybackYield = finite(latest.shares) && finite(prior?.shares) && prior.shares > 0
    ? (prior.shares - latest.shares) / prior.shares : null;

  return {
    dividendSafety: {
      payoutRatio,
      fiveYearGrowth,
      yearsWithoutCut,
      latestCut,
      coverage,
      highYieldRisk: finite(dividends.currentYield) && dividends.currentYield >= 0.05 && finite(payoutRatio) && payoutRatio > 0.85,
      latestDividendCash,
      historyYears: dividendRows.length
    },
    shareholderYield: {
      dividendCashYield,
      buybackCashYield,
      sbcYield,
      netBuybackYield,
      total: shareholderYield
    }
  };
}

function computeValuationHistory(rows, priceHistory, valuation, quote) {
  const observations = [];
  for (const row of rows) {
    if (!finite(row.fcf) || row.fcf <= 0 || !finite(row.shares) || row.shares <= 0) continue;
    const prices = priceHistory.filter((item) => Number(item.date.slice(0, 4)) === row.year && finite(item.close));
    const price = prices.at(-1)?.close;
    if (!finite(price)) continue;
    observations.push({ year: row.year, price, priceToFcf: price * row.shares / row.fcf });
  }
  const currentReportedMultiple = finite(valuation.marketCap) && finite(rows[0]?.fcf) && rows[0].fcf > 0
    ? valuation.marketCap / rows[0].fcf : null;
  const multiples = observations.map((item) => item.priceToFcf).filter(finite);
  const percentile = finite(currentReportedMultiple) && multiples.length
    ? multiples.filter((value) => value <= currentReportedMultiple).length / multiples.length : null;
  const historicalMedian = median(multiples);
  const drawdownFromHigh = finite(quote?.fiftyTwoWeekHigh) && quote.fiftyTwoWeekHigh > 0 && finite(valuation.price)
    ? valuation.price / quote.fiftyTwoWeekHigh - 1 : null;
  return {
    observations,
    currentReportedMultiple,
    historicalMedian,
    multiplePercentile: percentile,
    context: !finite(percentile) ? "History unavailable" : percentile <= 0.25 ? "Cheap vs. history" : percentile >= 0.75 ? "Expensive vs. history" : "Near historical range",
    drawdownFromHigh,
    fiftyTwoWeekHigh: finite(quote?.fiftyTwoWeekHigh) ? quote.fiftyTwoWeekHigh : null,
    fiftyTwoWeekLow: finite(quote?.fiftyTwoWeekLow) ? quote.fiftyTwoWeekLow : null
  };
}

function latestFiling(submissions) {
  const recent = submissions?.filings?.recent || {};
  const forms = recent.form || [];
  for (let index = 0; index < forms.length; index += 1) {
    if (["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"].includes(forms[index])) {
      return { form: forms[index], filed: recent.filingDate?.[index] || null, accession: recent.accessionNumber?.[index] || null, primaryDocument: recent.primaryDocument?.[index] || null };
    }
  }
  return null;
}

function filingUrl(cik, filing) {
  if (!filing?.accession || !filing.primaryDocument) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll("-", "")}/${filing.primaryDocument}`;
}

async function analyzeTicker(rawTicker, options = {}) {
  const ticker = String(rawTicker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    const error = new Error("Enter a valid ticker such as AAPL or BRK.B.");
    error.statusCode = 400;
    throw error;
  }
  const [secAttempt, quoteAttempt] = await Promise.allSettled([
    fetchSecCompany(ticker),
    fetchYahooQuote(ticker)
  ]);
  const quoteResult = quoteAttempt.status === "fulfilled"
    ? quoteAttempt.value
    : { price: finite(Number(options.price)) ? Number(options.price) : null, error: quoteAttempt.reason?.message, source: "Unavailable" };
  let company;
  let submissions;
  let extracted;
  let financialSource = "SEC Company Facts";
  let secFallbackReason = null;
  if (secAttempt.status === "fulfilled") {
    ({ company, submissions } = secAttempt.value);
    extracted = extractFinancials(secAttempt.value.facts);
  } else {
    secFallbackReason = secAttempt.reason?.message || "SEC request failed";
    extracted = await fetchYahooFinancials(ticker);
    financialSource = "Yahoo Finance fundamentals fallback";
    company = { cik: null, title: quoteResult.companyName || ticker };
    submissions = {
      name: quoteResult.companyName || ticker,
      sic: null,
      sicDescription: quoteResult.industry || quoteResult.sector || "Industry unavailable",
      fiscalYearEnd: null,
      exchanges: quoteResult.exchange ? [quoteResult.exchange] : [],
      tickers: [ticker],
      filings: { recent: {} }
    };
  }
  const dataReconciliation = {
    notes: [],
    capexSuspicious: false,
    capexReconciled: false,
    capexReliable: true,
    sbcReconciled: false,
    shortDebtReconciled: false,
    nwcReconciled: false
  };
  if (financialSource === "SEC Company Facts") {
    const initialNeeds = reconciliationNeeds(extracted, options.includeDetail === true);
    dataReconciliation.capexSuspicious = initialNeeds.capexSuspicious;
    const supplementalAttempt = initialNeeds.sbcMissing
      ? fetchLatestAnnualSbcSeries(company, submissions).catch(() => null)
      : Promise.resolve(null);
    const yahooFinancialAttempt = initialNeeds.needed
      ? fetchYahooFinancials(ticker).catch(() => null)
      : Promise.resolve(null);
    const [supplementalSbc, yahooFinancials] = await Promise.all([supplementalAttempt, yahooFinancialAttempt]);

    if (supplementalSbc?.values?.size) {
      const before = extracted.series.sbc?.values?.size || 0;
      extracted = {
        ...extracted,
        series: { ...extracted.series, sbc: mergeAnnualSeries(extracted.series.sbc, supplementalSbc) }
      };
      if (extracted.series.sbc.values.size > before) {
        dataReconciliation.sbcReconciled = true;
        dataReconciliation.notes.push("Recent SBC history was recovered from the inline annual filing.");
      }
    }

    const remainingNeeds = reconciliationNeeds(extracted, options.includeDetail === true);
    if (yahooFinancials && remainingNeeds.needed) {
      const reconciled = reconcileAnnualFinancials(extracted, yahooFinancials, remainingNeeds);
      extracted = reconciled.extracted;
      dataReconciliation.notes.push(...reconciled.notes);
      dataReconciliation.capexReconciled = reconciled.capexReconciled;
      dataReconciliation.sbcReconciled ||= reconciled.sbcReconciled;
      dataReconciliation.shortDebtReconciled = reconciled.shortDebtReconciled;
      dataReconciliation.nwcReconciled = reconciled.nwcReconciled;
    }
    dataReconciliation.capexReliable = !dataReconciliation.capexSuspicious || dataReconciliation.capexReconciled;
  }
  let rows = annualRows(extracted);
  let normalized = normalize(rows); // Full history (up to 10Y)
  let normalized5y = normalize(rows, 5); // 5-Year Lookback
  let normalized3y = normalize(rows, 3); // 3-Year Lookback
  const sic = Number(submissions.sic);
  const isFinancial = (finite(sic) && sic >= 6000 && sic <= 6799) || /financial|bank|insurance/i.test(`${quoteResult.sector || ""} ${quoteResult.industry || ""}`);
  const hasUsdQuote = !quoteResult.currency || quoteResult.currency === "USD";
  const financialCurrency = extracted.financialCurrency || "USD";
  const quoteCurrency = quoteResult.currency || "USD";
  let fxRate = 1.0;
  let currencyConversionValid = hasUsdQuote;
  if (financialCurrency !== "USD" && quoteCurrency === "USD") {
    try {
      fxRate = await fetchExchangeRate(financialCurrency, "USD");
      currencyConversionValid = finite(fxRate) && fxRate > 0 && fxRate !== 1;
    } catch {
      currencyConversionValid = false;
    }
  }

  // Convert financial statement figures if filing currency differs from stock quote currency
  if (fxRate !== 1.0) {
    rows = rows.map((r) => ({
      ...r,
      revenue: finite(r.revenue) ? r.revenue * fxRate : null,
      grossProfit: finite(r.grossProfit) ? r.grossProfit * fxRate : null,
      ebit: finite(r.ebit) ? r.ebit * fxRate : null,
      pretaxIncome: finite(r.pretaxIncome) ? r.pretaxIncome * fxRate : null,
      incomeTaxExpense: finite(r.incomeTaxExpense) ? r.incomeTaxExpense * fxRate : null,
      netIncome: finite(r.netIncome) ? r.netIncome * fxRate : null,
      currentAssets: finite(r.currentAssets) ? r.currentAssets * fxRate : null,
      currentLiabilities: finite(r.currentLiabilities) ? r.currentLiabilities * fxRate : null,
      accountsReceivable: finite(r.accountsReceivable) ? r.accountsReceivable * fxRate : null,
      inventory: finite(r.inventory) ? r.inventory * fxRate : null,
      prepaidExpenses: finite(r.prepaidExpenses) ? r.prepaidExpenses * fxRate : null,
      accountsPayable: finite(r.accountsPayable) ? r.accountsPayable * fxRate : null,
      accruedExpenses: finite(r.accruedExpenses) ? r.accruedExpenses * fxRate : null,
      operatingCurrentAssets: finite(r.operatingCurrentAssets) ? r.operatingCurrentAssets * fxRate : null,
      operatingCurrentLiabilities: finite(r.operatingCurrentLiabilities) ? r.operatingCurrentLiabilities * fxRate : null,
      historicalCash: finite(r.historicalCash) ? r.historicalCash * fxRate : null,
      historicalShortDebt: finite(r.historicalShortDebt) ? r.historicalShortDebt * fxRate : null,
      netWorkingCapital: finite(r.netWorkingCapital) ? r.netWorkingCapital * fxRate : null,
      changeInNwc: finite(r.changeInNwc) ? r.changeInNwc * fxRate : null,
      ocf: finite(r.ocf) ? r.ocf * fxRate : null,
      capex: finite(r.capex) ? r.capex * fxRate : null,
      capexTangible: finite(r.capexTangible) ? r.capexTangible * fxRate : null,
      capexIntangible: finite(r.capexIntangible) ? r.capexIntangible * fxRate : null,
      fcf: finite(r.fcf) ? r.fcf * fxRate : null,
      fcfEconomic: finite(r.fcfEconomic) ? r.fcfEconomic * fxRate : null,
      dna: finite(r.dna) ? r.dna * fxRate : null,
      interest: finite(r.interest) ? r.interest * fxRate : null,
      sbc: finite(r.sbc) ? r.sbc * fxRate : null,
      buybackCash: finite(r.buybackCash) ? r.buybackCash * fxRate : null,
      dividendsPaid: finite(r.dividendsPaid) ? r.dividendsPaid * fxRate : null,
      dividendsPerShare: finite(r.dividendsPerShare) ? r.dividendsPerShare * fxRate : null
    }));
    normalized = normalize(rows);
    normalized5y = normalize(rows, 5);
    normalized3y = normalize(rows, 3);
  }

  const shareSelection = selectValuationShares(rows, extracted.latest.sharesOutstanding);
  const shares = shareSelection.shares;
  const price = finite(Number(options.price)) ? Number(options.price) : quoteResult.price;
  const quality = computeQuality(rows, normalized, price);
  const suppliedMarketCap = finite(Number(options.marketCap)) && Number(options.marketCap) > 0 ? Number(options.marketCap) : null;
  const yahooMarketCap = finite(Number(quoteResult?.marketCap)) && Number(quoteResult.marketCap) > 0 ? Number(quoteResult.marketCap) : null;
  const liveShares = finite(Number(quoteResult?.shares)) && Number(quoteResult.shares) > 0 ? Number(quoteResult.shares) : null;

  // Primary: Take Market Cap directly from Yahoo Finance as instructed
  let marketCap = suppliedMarketCap ?? yahooMarketCap;
  let effectiveShares = liveShares;
  let marketCapSource = "";

  if (finite(marketCap) && marketCap > 0) {
    marketCapSource = suppliedMarketCap ? "Yahoo screener market cap" : "Yahoo Finance live market cap";
    if (!effectiveShares && finite(price) && price > 0) effectiveShares = marketCap / price;
  } else if (finite(effectiveShares) && finite(price) && price > 0) {
    marketCap = price * effectiveShares;
    marketCapSource = "Yahoo Finance live shares × price";
  } else {
    // Graceful SEC fallback if Yahoo marketCap is unavailable
    effectiveShares = shareSelection.shares;
    marketCap = (finite(price) && finite(effectiveShares)) ? price * effectiveShares : null;
    marketCapSource = finite(marketCap) ? `${shareSelection.source} × current price` : "Unavailable";
  }

  const balanceSheet = reconcileBalanceSheet(extracted.latest, quoteResult, fxRate);
  const debt = balanceSheet.debt;
  const cash = balanceSheet.cash;
  const secPreferredStock = finite(extracted.latest.preferredStock?.val) ? extracted.latest.preferredStock.val * fxRate : null;
  const secMinorityInterest = finite(extracted.latest.minorityInterest?.val) ? extracted.latest.minorityInterest.val * fxRate : null;
  const preferredStock = finite(quoteResult?.preferredStock) ? quoteResult.preferredStock : secPreferredStock;
  const minorityInterest = finite(quoteResult?.minorityInterest) ? quoteResult.minorityInterest : secMinorityInterest;
  const preferredStockSource = finite(quoteResult?.preferredStock) ? "Yahoo Finance quarterly balance sheet"
    : finite(secPreferredStock) ? "SEC Company Facts" : "Unavailable — review required";
  const minorityInterestSource = finite(quoteResult?.minorityInterest) ? "Yahoo Finance quarterly balance sheet"
    : finite(secMinorityInterest) ? "SEC Company Facts" : "Unavailable — review required";
  const rawShortDebt = extracted.latest.shortDebt?.val;
  const shortDebt = finite(rawShortDebt) ? rawShortDebt * fxRate : null;
  const netDebt = finite(debt) && finite(cash) ? debt - cash : null;
  const enterpriseValue = finite(marketCap) && finite(netDebt) ? marketCap + netDebt : null;
  const explicitNonOperatingAssets = finite(quoteResult?.otherNonOperatingAssets) ? quoteResult.otherNonOperatingAssets : null;
  const impliedNonOperatingAssets = finite(quoteResult?.enterpriseValue) && finite(marketCap) && finite(debt) && finite(cash)
    ? Math.max(0, marketCap + debt + (finite(preferredStock) ? preferredStock : 0) + (finite(minorityInterest) ? minorityInterest : 0) - cash - quoteResult.enterpriseValue)
    : null;
  const otherNonOperatingAssets = explicitNonOperatingAssets ?? impliedNonOperatingAssets;
  const otherNonOperatingAssetsSource = finite(explicitNonOperatingAssets) ? "Yahoo Finance long-term investments"
    : finite(impliedNonOperatingAssets) ? "Implied from Yahoo Finance enterprise value" : "Unavailable — review required";

  // Normalize interest over the same lookback as FCF before the after-tax add-back.
  const taxRate = 0.21;
  function lookbackValuation(norm) {
    const nfcf = norm.normalizedFcf;
    const economicNfcf = norm.normalizedEconomicFcf;
    const unleveredNfcf = finite(nfcf) && nfcf > 0
      ? nfcf + Math.max(0, norm.averageInterest || 0) * (1 - taxRate)
      : null;
    return {
      normalizedFcf: nfcf,
      normalizedEconomicFcf: economicNfcf,
      normalizedInterest: norm.averageInterest,
      unleveredNfcf,
      priceToNfcf: finite(marketCap) && finite(nfcf) && nfcf > 0 ? marketCap / nfcf : null,
      priceToEconomicNfcf: finite(marketCap) && finite(economicNfcf) && economicNfcf > 0 ? marketCap / economicNfcf : null,
      evToUnleveredNfcf: finite(enterpriseValue) && finite(unleveredNfcf) && unleveredNfcf > 0 ? enterpriseValue / unleveredNfcf : null,
      fcfYield: finite(marketCap) && marketCap > 0 && finite(nfcf) ? nfcf / marketCap : null,
      economicFcfYield: finite(marketCap) && marketCap > 0 && finite(economicNfcf) ? economicNfcf / marketCap : null,
      netDebtToNfcf: finite(netDebt) && finite(nfcf) && nfcf > 0 ? netDebt / nfcf : null
    };
  }
  const lookbacks = { all: lookbackValuation(normalized), 5: lookbackValuation(normalized5y), 3: lookbackValuation(normalized3y) };
  const fullValuation = lookbacks.all;

  const valuation = {
    price, shares: effectiveShares, shareSource: yahooMarketCap ? "Yahoo Finance market cap ÷ price" : shareSelection.source, marketCap, marketCapSource,
    debt, debtSource: balanceSheet.debtSource, shortDebt, cash, cashSource: balanceSheet.cashSource, netDebt, enterpriseValue,
    preferredStock, preferredStockSource, minorityInterest, minorityInterestSource,
    otherNonOperatingAssets, otherNonOperatingAssetsSource,
    ...fullValuation,
    lookbacks,
    evToNfcf: finite(enterpriseValue) && finite(normalized.normalizedFcf) && normalized.normalizedFcf > 0 ? enterpriseValue / normalized.normalizedFcf : null,
    averageFcfYield: finite(marketCap) && marketCap > 0 && finite(normalized.averageAnnualFcf) ? normalized.averageAnnualFcf / marketCap : null,
    latestFcfYield: finite(marketCap) && marketCap > 0 && finite(normalized.latestReportedFcf) ? normalized.latestReportedFcf / marketCap : null,
    shortDebtToCash: finite(cash) && cash > 0 && finite(shortDebt) && shortDebt > 0 ? shortDebt / cash : null
  };

  let secInsiderPurchases = [];
  let priceHistory = [];
  if (options.includeDetail === true) {
    const detailAttempts = await Promise.allSettled([
      secAttempt.status === "fulfilled" ? fetchRecentForm4Purchases(company, submissions, 6) : Promise.resolve([]),
      fetchYahooPriceHistory(ticker)
    ]);
    if (detailAttempts[0].status === "fulfilled") secInsiderPurchases = detailAttempts[0].value;
    if (detailAttempts[1].status === "fulfilled") priceHistory = detailAttempts[1].value;
  }

  const dividends = {
    currentYield: finite(quoteResult?.dividends?.currentYield) ? quoteResult.dividends.currentYield : null,
    annualRate: finite(quoteResult?.dividends?.annualRate) ? quoteResult.dividends.annualRate : null,
    fiveYearAverageYield: finite(quoteResult?.dividends?.fiveYearAverageYield) ? quoteResult.dividends.fiveYearAverageYield : null,
    exDividendDate: quoteResult?.dividends?.exDividendDate || null,
    source: quoteResult?.dividends?.source || "Unavailable"
  };
  const quotedInsiders = quoteResult?.insiders || {};
  const authoritativePurchases = secInsiderPurchases.length ? secInsiderPurchases : (quotedInsiders.purchases || []);
  const insiderDataAvailable = Boolean(quotedInsiders.source) || finite(quotedInsiders.saleCount) || finite(quotedInsiders.netShares);
  const insiderPurchaseCount = secInsiderPurchases.length || (finite(quotedInsiders.purchaseCount) ? quotedInsiders.purchaseCount : 0);
  const hasInsiderBuying = insiderPurchaseCount > 0;
  const totalPurchaseShares = authoritativePurchases.reduce((sum, item) => sum + (finite(item.shares) ? item.shares : 0), 0);
  const totalPurchaseValue = authoritativePurchases.reduce((sum, item) => sum + (finite(item.value) ? item.value : 0), 0);
  const averagePurchasePrice = totalPurchaseShares > 0 && totalPurchaseValue > 0
    ? totalPurchaseValue / totalPurchaseShares : quotedInsiders.averagePurchasePrice;
  const buyers = [...new Set(authoritativePurchases.map((item) => item.name).filter(Boolean))];
  const clusterBuying = buyers.length >= 2;
  const purchasePriceComparable = finite(averagePurchasePrice) && finite(price) && price > 0;
  const tradingNearInsiderBuys = purchasePriceComparable ? price <= averagePurchasePrice * 1.10 : null;
  const inexpensiveOnFcf = finite(valuation.priceToNfcf) && valuation.priceToNfcf > 0 && valuation.priceToNfcf <= 15;
  const insiders = {
    period: quotedInsiders.period || "12 months",
    purchaseCount: insiderPurchaseCount,
    saleCount: finite(quotedInsiders.saleCount) ? quotedInsiders.saleCount : null,
    netShares: finite(quotedInsiders.netShares) ? quotedInsiders.netShares : null,
    averagePurchasePrice: finite(averagePurchasePrice) ? averagePurchasePrice : null,
    purchases: authoritativePurchases,
    buyers,
    clusterBuying,
    largestPurchaseValue: authoritativePurchases.reduce((max, item) => Math.max(max, finite(item.value) ? item.value : 0), 0) || null,
    latestPurchaseDate: authoritativePurchases.map((item) => item.date).filter(Boolean).sort().at(-1) || null,
    hasRecentBuying: hasInsiderBuying,
    tradingNearInsiderBuys,
    valueAligned: hasInsiderBuying && inexpensiveOnFcf && tradingNearInsiderBuys !== false,
    signal: !insiderDataAvailable && !secInsiderPurchases.length ? "Unavailable"
      : !hasInsiderBuying ? "No recent buying found"
      : clusterBuying && inexpensiveOnFcf && tradingNearInsiderBuys !== false ? "Cluster buying + inexpensive FCF"
        : inexpensiveOnFcf && tradingNearInsiderBuys !== false ? "Buying + inexpensive FCF"
        : "Recent insider buying",
    source: secInsiderPurchases.length ? "SEC Form 4" : quotedInsiders.source || "Unavailable",
    caveat: "A purchase can align with a low valuation, but the filing does not disclose that cheapness was the insider's motive."
  };
  const ownerReturns = computeOwnerReturns(rows, normalized, marketCap, dividends);
  const valuationHistory = computeValuationHistory(rows, priceHistory, valuation, quoteResult);

  const warnings = [];
  if (financialSource !== "SEC Company Facts") warnings.push(`SEC filing data was unavailable (${secFallbackReason}); analysis uses Yahoo annual fundamentals and should be verified against the original filing.`);
  if (isFinancial) warnings.push("Banking/insurance-style company: conventional FCF analysis is unsuitable.");
  if (!hasUsdQuote) warnings.push(`Price is quoted in ${quoteResult.currency}; version one only values USD-quoted securities.`);
  const sourceMinimumYears = financialSource === "SEC Company Facts" ? 6 : 5;
  if (normalized.usableYears < sourceMinimumYears) warnings.push(`Only ${normalized.usableYears} usable annual periods; ${sourceMinimumYears} are required for this data source.`);
  if (!finite(price)) warnings.push("Current price is unavailable.");
  if (!finite(effectiveShares)) warnings.push("Current share count is unavailable.");
  if (shareSelection.inconsistent && !suppliedMarketCap) warnings.push(`SEC instant shares (${round(shareSelection.instant)}) differ materially from the latest annual share figure (${round(shareSelection.annual)}); valuation uses the annual figure.`);
  if (finite(valuation.fcfYield) && valuation.fcfYield > 0.50) warnings.push("Normalized FCF yield exceeds 50%; verify market capitalization and cash-flow facts before relying on valuation.");
  if (finite(valuation.fcfYield) && valuation.fcfYield > 0.25) warnings.push("Elevated FCF yield (>25%): deep value opportunity or potential distress; inspect balance sheet and business durability.");
  if (ownerReturns.dividendSafety.highYieldRisk) warnings.push("High dividend yield is paired with a stretched normalized-FCF payout ratio; verify dividend sustainability.");
  if (ownerReturns.dividendSafety.latestCut) warnings.push("The latest annual dividend per share is lower than the prior annual period.");
  if (!finite(cash) || !finite(debt)) warnings.push("Cash or debt data is incomplete; the company cannot qualify automatically.");
  warnings.push(...balanceSheet.notes);
  warnings.push(...dataReconciliation.notes);
  if (!dataReconciliation.capexReliable) warnings.push("The available CapEx fact appears to represent a narrow acquisition category rather than total operating capital expenditure; FCF cannot qualify automatically.");
  
  if (fxRate !== 1.0) {
    warnings.push(`Financial statements reported in ${financialCurrency} converted to ${quoteCurrency} at exchange rate ~${round(fxRate, 4)}.`);
  } else if (!currencyConversionValid) {
    warnings.push(`Could not safely convert ${financialCurrency} financial statements into ${quoteCurrency}; valuation cannot qualify automatically.`);
  }

  // Solvency check: Near-term debt vs. liquidity
  const cashVal = cash || 0;
  const annualCashGeneration = Math.max(0, normalized.latestReportedFcf || 0);
  const immediateDebtRisk = finite(shortDebt) && shortDebt > 0 && shortDebt > (cashVal + annualCashGeneration);
  if (immediateDebtRisk) {
    warnings.push(`High near-term debt maturity: Short-term debt ($${compactStr(shortDebt)}) exceeds cash ($${compactStr(cashVal)}) plus annual FCF ($${compactStr(annualCashGeneration)}).`);
  }

  // CapEx vs. D&A (Informational warning only - does NOT disqualify asset-light software/services)
  if (quality.capexToDnaRatio && quality.capexToDnaRatio < 0.70) {
    warnings.push(`Low CapEx relative to D&A (${round(quality.capexToDnaRatio * 100, 0)}%): evaluate whether the business is asset-light (normal) or deferring capital maintenance.`);
  }

  // Trajectory warning
  if (quality.fcfTrajectory === "Deteriorating") {
    warnings.push(`Deteriorating FCF trend: Recent 3-year average margin (${round(quality.recent3yAvgMargin * 100, 1)}%) has contracted compared to earlier baseline (${round(quality.baselineMargin * 100, 1)}%).`);
  }
  // Buyback capital allocation warning
  if (quality.buybackAudit?.rating === "Value Destructive") {
    warnings.push(`Historical buybacks appear destructive: Average repurchase price ($${round(quality.buybackAudit.averageBuybackPrice, 2)}) is significantly above current market price ($${round(price, 2)}).`);
  } else if (quality.buybackAudit?.rating === "Unreliable") {
    warnings.push("Buyback cash and repurchased-share disclosures do not produce a plausible average purchase price; the buyback rating is unavailable.");
  }

  // SBC Burden check
  if (quality.normalizedSbcToFcf && quality.normalizedSbcToFcf > 0.25) {
    warnings.push(`Heavy recurring SBC burden: normalized stock-based compensation absorbs ${round(quality.normalizedSbcToFcf * 100, 0)}% of normalized FCF.`);
  }

  // Simple vs Volume-weighted margin comparison
  if (normalized.simpleVsWeightedGap && normalized.simpleVsWeightedGap > 0.25) {
    warnings.push(`Margin divergence: Simple average margin (${round(normalized.simpleAverageMargin * 100, 1)}%) differs by ${round(normalized.simpleVsWeightedGap * 100, 1)}% from volume-weighted margin (${round(normalized.weightedMargin * 100, 1)}%).`);
  }

  if (finite(quality.shareChange) && quality.shareChange > 0.25) {
    const annualized = finite(quality.shareChangeAnnualized) ? `, approximately ${round(quality.shareChangeAnnualized * 100, 1)}% annualized` : "";
    const span = finite(quality.shareChangeYears) ? ` over ${quality.shareChangeYears} years` : " over the available period";
    warnings.push(`Share count increased by ${round(quality.shareChange * 100, 1)}%${span}${annualized} (exceeds 25% cumulative threshold).`);
  }
  if (quality.reliability === "Low") warnings.push("Free cash flow history is inconsistent (<67% positive years).");
  if (!normalized.marginAgreement) warnings.push(`Average and median annual FCF margins differ by more than 25%${finite(normalized.averageMedianGap) ? ` (${round(normalized.averageMedianGap * 100, 1)}%)` : ""}; this stock cannot qualify automatically.`);
  if (normalized.outlierYears.length) warnings.push(`Extreme annual FCF margin detected in: ${normalized.outlierYears.map((item) => item.year).join(", ")}.`);

  // Valuation sanity: market cap >= $10M and FCF yield between 0% and 50%
  const valuationSane = finite(marketCap) && marketCap >= 10_000_000 && finite(valuation.fcfYield) && valuation.fcfYield > 0 && valuation.fcfYield <= 0.50;
  if (!valuationSane) warnings.push("Valuation failed sanity thresholds (market cap >= $10M and FCF yield between 0% and 50%) and cannot qualify automatically.");

  const filing = latestFiling(submissions);
  const solvencyRequired = options.criteria?.enforceSolvency !== false;
  const criticalMissing = [debt, cash, effectiveShares, quality.normalizedSbcToFcf, normalized.normalizedEconomicFcf].some((item) => !finite(item))
    || (solvencyRequired && !finite(shortDebt))
    || !dataReconciliation.capexReliable
    || !currencyConversionValid;
  const evidenceConfidence = {
    level: criticalMissing ? "Unsafe" : financialSource !== "SEC Company Facts" || normalized.usableYears < 6 ? "Partial" : balanceSheet.reconciled ? "Reconciled" : "Complete",
    criticalMissing,
    balanceSheetReconciled: balanceSheet.reconciled,
    currencyConversionValid
  };
  const report = {
    ticker, companyName: submissions.name || company.title, cik: company.cik,
    company: { sic: submissions.sic || null, sicDescription: submissions.sicDescription || null, fiscalYearEnd: submissions.fiscalYearEnd || null, exchanges: submissions.exchanges || [], tickers: submissions.tickers || [] },
    quote: quoteResult,
    quoteCurrency,
    financialCurrency,
    currencyConversionValid,
    isFinancial,
    rows,
    normalized,
    normalized5y,
    normalized3y,
    quality,
    valuation,
    dividends,
    dividendSafety: ownerReturns.dividendSafety,
    shareholderYield: ownerReturns.shareholderYield,
    insiders,
    valuationHistory,
    dataReconciliation,
    evidenceConfidence,
    warnings,
    filing: filing ? { ...filing, url: filingUrl(company.cik, filing) } : null,
    methodology: {
      standardFcf: "Operating cash flow - capital expenditure (tangible PP&E + routine intangibles)",
      economicFcf: "Standard FCF - stock-based compensation",
      normalizedFcf: "50/50 blend of simple average margin and aggregate volume-weighted margin × latest revenue",
      unleveredFcf: "Normalized FCF + after-tax net interest expense for enterprise valuation"
    },
    sources: {
      financials: dataReconciliation.notes.length ? `${financialSource} with targeted reconciliation` : financialSource,
      price: quoteResult.source,
      shares: shareSelection.source,
      marketCap: marketCapSource,
      debt: balanceSheet.debtSource,
      cash: balanceSheet.cashSource,
      preferredStock: preferredStockSource,
      minorityInterest: minorityInterestSource,
      otherNonOperatingAssets: otherNonOperatingAssetsSource,
      dividends: dividends.source,
      insiders: insiders.source,
      financialTags: Object.fromEntries(Object.entries(extracted.series).map(([key, value]) => [key, value.tag]))
    },
    analyzedAt: new Date().toISOString()
  };
  const evaluation = evaluateCandidate(report, options.criteria || {});
  report.evaluation = evaluation;
  report.status = evaluation.status;
  report.passesDefaultIdeaFilter = evaluation.status === "Idea";
  report.primaryReason = evaluation.exclusions[0] || evaluation.failures[0] || evaluation.unknowns[0] || "All active qualification checks passed";
  report.nonQualificationReasons = evaluation.reasons || [];
  report.nonQualificationReason = report.nonQualificationReasons.join("; ");
  report.decisionSummary = decisionSummary(report);
  return report;
}

function compactStr(val) {
  if (Math.abs(val) >= 1e9) return (val / 1e9).toFixed(1) + "B";
  if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(1) + "M";
  return Math.round(val).toLocaleString();
}

function decisionSummary(report) {
  const parts = [];
  if (finite(report.valuation?.priceToNfcf)) parts.push(`${round(report.valuation.priceToNfcf, 1)}x normalized FCF`);
  if (finite(report.valuation?.netDebtToNfcf) && report.valuation.netDebtToNfcf < 0) parts.push("net cash");
  if (finite(report.dividends?.currentYield) && report.dividends.currentYield > 0) parts.push(`${round(report.dividends.currentYield * 100, 1)}% dividend yield`);
  if (finite(report.quality?.positiveFcfRatio)) parts.push(`positive FCF in ${round(report.quality.positiveFcfRatio * 100, 0)}% of usable years`);
  if (report.insiders?.clusterBuying) parts.push("recent cluster insider buying");
  else if (report.insiders?.hasRecentBuying) parts.push("recent insider buying");
  const summary = `${report.status}: ${parts.slice(0, 4).join(", ") || report.primaryReason}.`;
  return report.status === "Idea" || !report.nonQualificationReason
    ? summary
    : `${summary} Why not Idea: ${report.nonQualificationReason}.`;
}

function summary(report) {
  return {
    ticker: report.ticker, companyName: report.companyName, status: report.status,
    sic: Number(report.company?.sic) || null,
    isFinancial: report.isFinancial,
    quoteCurrency: report.quoteCurrency,
    currencyConversionValid: report.currencyConversionValid,
    price: round(report.valuation.price), marketCap: round(report.valuation.marketCap),
    priceToNfcf: round(report.valuation.priceToNfcf),
    priceToEconomicNfcf: round(report.valuation.priceToEconomicNfcf),
    evToUnleveredNfcf: round(report.valuation.evToUnleveredNfcf),
    evToNfcf: round(report.valuation.evToNfcf), // legacy
    fcfYield: round(report.valuation.fcfYield, 4),
    economicFcfYield: round(report.valuation.economicFcfYield, 4),
    averageFcfYield: round(report.valuation.averageFcfYield, 4),
    latestFcfYield: round(report.valuation.latestFcfYield, 4),
    dividendYield: round(report.dividends?.currentYield, 4),
    fiveYearDividendYield: round(report.dividends?.fiveYearAverageYield, 4),
    dividendRate: round(report.dividends?.annualRate, 4),
    exDividendDate: report.dividends?.exDividendDate || null,
    insiderBuying: report.insiders?.hasRecentBuying === true,
    insiderPurchaseCount: report.insiders?.purchaseCount ?? 0,
    insiderNetShares: round(report.insiders?.netShares),
    insiderAveragePurchasePrice: round(report.insiders?.averagePurchasePrice, 2),
    insiderValueAligned: report.insiders?.valueAligned === true,
    insiderSignal: report.insiders?.signal || "Unavailable",
    insiderClusterBuying: report.insiders?.clusterBuying === true,
    latestInsiderPurchaseDate: report.insiders?.latestPurchaseDate || null,
    dividendPayoutRatio: round(report.dividendSafety?.payoutRatio, 4),
    dividendGrowth5y: round(report.dividendSafety?.fiveYearGrowth, 4),
    dividendYearsWithoutCut: report.dividendSafety?.yearsWithoutCut ?? 0,
    dividendCoverage: report.dividendSafety?.coverage || "Unavailable",
    shareholderYield: round(report.shareholderYield?.total, 4),
    buybackCashYield: round(report.shareholderYield?.buybackCashYield, 4),
    sbcYield: round(report.shareholderYield?.sbcYield, 4),
    netBuybackYield: round(report.shareholderYield?.netBuybackYield, 4),
    valuationHistoryContext: report.valuationHistory?.context || "History unavailable",
    valuationMultiplePercentile: round(report.valuationHistory?.multiplePercentile, 4),
    drawdownFromHigh: round(report.valuationHistory?.drawdownFromHigh, 4),
    marketDataAsOf: report.quote?.marketTime || null,
    financialPeriodEnd: report.rows?.[0]?.evidence?.revenue?.periodEnd || String(report.rows?.[0]?.year || ""),
    primaryReason: report.primaryReason,
    nonQualificationReason: report.nonQualificationReason,
    nonQualificationReasons: report.nonQualificationReasons,
    decisionSummary: report.decisionSummary,
    latestRevenue: round(report.normalized.latestRevenue),
    latestFcf: round(report.normalized.latestReportedFcf),
    averageAnnualFcf: round(report.normalized.averageAnnualFcf),
    normalizedFcf: round(report.normalized.normalizedFcf),
    normalizedFcf5y: round(report.normalized5y?.normalizedFcf),
    normalizedFcf3y: round(report.normalized3y?.normalizedFcf),
    normalizedEconomicFcf5y: round(report.normalized5y?.normalizedEconomicFcf),
    normalizedEconomicFcf3y: round(report.normalized3y?.normalizedEconomicFcf),
    normalizedInterest: round(report.normalized?.averageInterest),
    normalizedInterest5y: round(report.normalized5y?.averageInterest),
    normalizedInterest3y: round(report.normalized3y?.averageInterest),
    blendedMargin5y: round(report.normalized5y?.blendedMargin, 4),
    priceToNfcf5y: round(report.valuation.price && report.normalized5y?.normalizedFcf > 0 ? report.valuation.marketCap / report.normalized5y.normalizedFcf : null),
    normalizedEconomicFcf: round(report.normalized.normalizedEconomicFcf),
    usableYears: report.normalized.usableYears,
    simpleAverageMargin: round(report.normalized.simpleAverageMargin, 4),
    weightedMargin: round(report.normalized.weightedMargin, 4),
    blendedMargin: round(report.normalized.blendedMargin, 4),
    simpleVsWeightedGap: round(report.normalized.simpleVsWeightedGap, 4),
    averageFcfMargin: round(report.normalized.averageMargin, 4), // legacy
    medianFcfMargin: round(report.normalized.medianMargin, 4),
    averageMedianGap: round(report.normalized.averageMedianGap, 4),
    marginAgreement: report.normalized.marginAgreement,
    reliability: report.quality.reliability,
    positiveFcfRatio: round(report.quality.positiveFcfRatio, 4),
    capexToDnaRatio: round(report.quality.capexToDnaRatio, 2),
    fcfTrajectory: report.quality.fcfTrajectory,
    marginSlope: round(report.quality.marginSlope, 4),
    buybackPrice: round(report.quality.buybackAudit?.averageBuybackPrice, 2),
    buybackRating: report.quality.buybackAudit?.rating || "N/A",
    netDebtToNfcf: round(report.valuation.netDebtToNfcf),
    netDebt: round(report.valuation.netDebt),
    enterpriseValue: round(report.valuation.enterpriseValue),
    debt: round(report.valuation.debt),
    shortDebt: round(report.valuation.shortDebt),
    cash: round(report.valuation.cash),
    shares: round(report.valuation.shares),
    shareChange: round(report.quality.shareChange, 4),
    shareChangeYears: report.quality.shareChangeYears,
    shareChangeAnnualized: round(report.quality.shareChangeAnnualized, 4),
    shareChangeBasis: report.quality.shareChangeBasis,
    latestSbcToRevenue: round(report.quality.latestSbcToRevenue, 4),
    latestSbcToFcf: round(report.quality.latestSbcToFcf, 4),
    normalizedSbcToFcf: round(report.quality.normalizedSbcToFcf, 4),
    sbcCoverageYears: report.quality.sbcCoverageYears,
    dataReconciliation: report.dataReconciliation,
    warnings: report.warnings,
    evidenceConfidence: report.evidenceConfidence,
    evaluation: report.evaluation,
    passesDefaultIdeaFilter: report.passesDefaultIdeaFilter,
    analyzedAt: report.analyzedAt
  };
}

async function analyzeBatch(tickers, options = {}) {
  const reports = {};
  const failures = [];
  let index = 0;
  const requestedWorkers = Number(options.workers);
  const requestedPacing = Number(options.pacingMs);
  const workers = Number.isFinite(requestedWorkers) ? Math.min(8, Math.max(1, Math.round(requestedWorkers))) : 1;
  const pacingMs = Number.isFinite(requestedPacing) ? Math.min(5000, Math.max(0, Math.round(requestedPacing))) : 250;
  async function worker() {
    while (index < tickers.length) {
      const ticker = tickers[index++];
      try {
        reports[ticker] = await analyzeTicker(ticker, { ...options, ...(options.quotes?.[ticker] || {}) });
      } catch (error) {
        failures.push({ ticker, error: error.message || "Analysis failed." });
      }
      // Pace ticker analyses to reduce the risk of Yahoo/SEC rate limiting.
      if (pacingMs > 0) await new Promise((r) => setTimeout(r, pacingMs));
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  const results = Object.values(reports).map(summary).sort((a, b) => Number(b.passesDefaultIdeaFilter) - Number(a.passesDefaultIdeaFilter) || (a.priceToNfcf ?? 999) - (b.priceToNfcf ?? 999));
  return { results, reports, failures };
}

module.exports = {
  annualRows,
  normalize,
  computeQuality,
  computeOwnerReturns,
  computeValuationHistory,
  selectValuationShares,
  reconciliationNeeds,
  reconcileAnnualFinancials,
  mergeAnnualSeries,
  debtValue,
  reconcileBalanceSheet,
  analyzeTicker,
  analyzeBatch,
  summary
};
