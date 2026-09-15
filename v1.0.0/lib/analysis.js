"use strict";

const { fetchSecCompany, extractFinancials } = require("./sec");
const { fetchYahooQuote, fetchYahooFinancials, fetchExchangeRate } = require("./yahoo");
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
    periodEnd: fact.end || null
  };
}

function annualRows(extracted) {
  const years = new Set();
  for (const series of Object.values(extracted.series)) {
    if (series?.values) {
      for (const year of series.values.keys()) years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a).slice(0, 10).map((year) => {
    const revenue = valueForYear(extracted.series.revenue, year);
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
    const shares = valueForYear(extracted.series.dilutedShares, year);
    const buybackCashRaw = valueForYear(extracted.series.buybackCash, year);
    const buybackSharesRaw = valueForYear(extracted.series.buybackShares, year);
    const buybackCash = finite(buybackCashRaw) ? Math.abs(buybackCashRaw) : null;
    const buybackShares = finite(buybackSharesRaw) ? Math.abs(buybackSharesRaw) : null;

    const fcf = finite(ocf) && finite(capex) ? ocf - capex : null;
    const fcfEconomic = finite(fcf) && finite(sbc) ? fcf - sbc : null;

    return {
      year, revenue, ocf, capex, capexTangible, capexIntangible, dna, interest, sbc, shares,
      fcf,
      fcfEconomic,
      buybackCash,
      buybackShares,
      fcfMargin: finite(fcf) && finite(revenue) && revenue > 0 ? fcf / revenue : null,
      fcfEconomicMargin: finite(fcfEconomic) && finite(revenue) && revenue > 0 ? fcfEconomic / revenue : null,
      sbcToRevenue: finite(sbc) && finite(revenue) && revenue > 0 ? sbc / revenue : null,
      sbcToFcf: finite(sbc) && finite(fcf) && fcf > 0 ? sbc / fcf : null,
      capexToDna: finite(capex) && finite(dna) && dna > 0 ? capex / dna : null,
      evidence: Object.fromEntries(Object.entries(extracted.series).map(([key, series]) => [key, evidenceForYear(series, year)]))
    };
  });
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
      normalizedFcf: null, normalizedEconomicFcf: null, averageInterest: null
    };
  }

  const totalRevenue = usable.reduce((sum, row) => sum + row.revenue, 0);
  const totalFcf = usable.reduce((sum, row) => sum + row.fcf, 0);
  const economicComplete = usable.every((row) => finite(row.fcfEconomic) && finite(row.fcfEconomicMargin));
  const totalEconomicFcf = economicComplete ? usable.reduce((sum, row) => sum + row.fcfEconomic, 0) : null;
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

  // Economic FCF (post-SBC) using blended margins
  const simpleEconomicMargin = economicComplete
    ? usable.reduce((sum, row) => sum + row.fcfEconomicMargin, 0) / usable.length
    : null;
  const weightedEconomicMargin = economicComplete && totalRevenue > 0 ? totalEconomicFcf / totalRevenue : null;
  const blendedEconomicMargin = economicComplete ? (simpleEconomicMargin + weightedEconomicMargin) / 2 : null;
  const normalizedEconomicFcf = finite(blendedEconomicMargin) ? blendedEconomicMargin * latestRevenue : null;

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
    normalizedEconomicFcf,
    averageInterest,
    includedYears: usable.map((row) => row.year)
  };
}

function selectValuationShares(rows, instantFact) {
  const annualRow = rows.find((row) => finite(row.shares) && row.shares > 0);
  const annual = annualRow?.shares ?? null;
  const instant = instantFact?.val ?? null;
  if (finite(annual) && finite(instant) && instant > 0) {
    const ratio = instant / annual;
    if (ratio >= 0.7 && ratio <= 1.3) {
      return { shares: instant, source: `SEC shares outstanding (${instantFact.end})`, annual, instant, inconsistent: false };
    }
    return { shares: annual, source: `Latest annual diluted weighted-average shares (${annualRow.year})`, annual, instant, inconsistent: true };
  }
  if (finite(annual)) return { shares: annual, source: `Latest annual diluted weighted-average shares (${annualRow.year})`, annual, instant: null, inconsistent: false };
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
  const shareRows = rows.filter((row) => finite(row.shares) && row.shares > 0);
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
  const latestSbc = rows.find((row) => finite(row.sbc));

  // Cumulative CapEx vs Cumulative D&A over usable periods
  const totalCapex = usable.reduce((sum, r) => sum + (r.capex || 0), 0);
  const totalDna = usable.reduce((sum, r) => sum + (r.dna || 0), 0);
  const capexToDnaRatio = totalDna > 0 ? totalCapex / totalDna : null;

  // 1. Share Buyback Capital Allocation Audit (with SEC unit scale check)
  const totalBuybackCash = rows.reduce((sum, r) => sum + (finite(r.buybackCash) ? Math.abs(r.buybackCash) : 0), 0);
  let totalBuybackShares = rows.reduce((sum, r) => sum + (finite(r.buybackShares) ? Math.abs(r.buybackShares) : 0), 0);
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
        buybackAllocationRating = "Value Destructive";
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
    latestSbcToRevenue: latestSbc?.sbcToRevenue ?? null,
    latestSbcToFcf: latestSbc?.sbcToFcf ?? null,
    capexToDnaRatio,
    buybackAudit: {
      totalCashSpent: totalBuybackCash,
      totalSharesRepurchased: totalBuybackShares,
      averageBuybackPrice,
      buybackPriceVsCurrent,
      rating: buybackAllocationRating
    },
    fcfTrajectory,
    recent3yAvgMargin,
    baselineMargin,
    marginSlope
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
      ocf: finite(r.ocf) ? r.ocf * fxRate : null,
      capex: finite(r.capex) ? r.capex * fxRate : null,
      capexTangible: finite(r.capexTangible) ? r.capexTangible * fxRate : null,
      capexIntangible: finite(r.capexIntangible) ? r.capexIntangible * fxRate : null,
      fcf: finite(r.fcf) ? r.fcf * fxRate : null,
      fcfEconomic: finite(r.fcfEconomic) ? r.fcfEconomic * fxRate : null,
      dna: finite(r.dna) ? r.dna * fxRate : null,
      interest: finite(r.interest) ? r.interest * fxRate : null,
      sbc: finite(r.sbc) ? r.sbc * fxRate : null,
      buybackCash: finite(r.buybackCash) ? r.buybackCash * fxRate : null
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
  const rawShortDebt = extracted.latest.shortDebt?.val;
  const shortDebt = finite(rawShortDebt) ? rawShortDebt * fxRate : null;
  const netDebt = finite(debt) && finite(cash) ? debt - cash : null;
  const enterpriseValue = finite(marketCap) && finite(netDebt) ? marketCap + netDebt : null;

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
    ...fullValuation,
    lookbacks,
    evToNfcf: finite(enterpriseValue) && finite(normalized.normalizedFcf) && normalized.normalizedFcf > 0 ? enterpriseValue / normalized.normalizedFcf : null,
    averageFcfYield: finite(marketCap) && marketCap > 0 && finite(normalized.averageAnnualFcf) ? normalized.averageAnnualFcf / marketCap : null,
    latestFcfYield: finite(marketCap) && marketCap > 0 && finite(normalized.latestReportedFcf) ? normalized.latestReportedFcf / marketCap : null,
    shortDebtToCash: finite(cash) && cash > 0 && finite(shortDebt) && shortDebt > 0 ? shortDebt / cash : null
  };

  const warnings = [];
  if (financialSource !== "SEC Company Facts") warnings.push(`SEC filing data was unavailable (${secFallbackReason}); analysis uses Yahoo annual fundamentals and should be verified against the original filing.`);
  if (isFinancial) warnings.push("Banking/insurance-style company: conventional FCF analysis is unsuitable.");
  if (!hasUsdQuote) warnings.push(`Price is quoted in ${quoteResult.currency}; version one only values USD-quoted securities.`);
  const sourceMinimumYears = financialSource === "SEC Company Facts" ? 6 : 5;
  if (normalized.usableYears < sourceMinimumYears) warnings.push(`Only ${normalized.usableYears} usable annual periods; ${sourceMinimumYears} are required for this data source.`);
  if (!finite(price)) warnings.push("Current price is unavailable.");
  if (!finite(effectiveShares)) warnings.push("Current share count is unavailable.");
  if (shareSelection.inconsistent && !suppliedMarketCap) warnings.push(`SEC instant shares (${round(shareSelection.instant)}) differ materially from annual diluted shares (${round(shareSelection.annual)}); valuation uses the annual diluted figure.`);
  if (finite(valuation.fcfYield) && valuation.fcfYield > 0.50) warnings.push("Normalized FCF yield exceeds 50%; verify market capitalization and cash-flow facts before relying on valuation.");
  if (finite(valuation.fcfYield) && valuation.fcfYield > 0.25) warnings.push("Elevated FCF yield (>25%): deep value opportunity or potential distress; inspect balance sheet and business durability.");
  if (!finite(cash) || !finite(debt)) warnings.push("Cash or debt data is incomplete; the company cannot qualify automatically.");
  warnings.push(...balanceSheet.notes);
  
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
  }

  // SBC Burden check
  if (quality.latestSbcToFcf && quality.latestSbcToFcf > 0.25) {
    warnings.push(`Heavy SBC burden: Stock-based compensation absorbs ${round(quality.latestSbcToFcf * 100, 0)}% of reported annual FCF.`);
  }

  // Simple vs Volume-weighted margin comparison
  if (normalized.simpleVsWeightedGap && normalized.simpleVsWeightedGap > 0.25) {
    warnings.push(`Margin divergence: Simple average margin (${round(normalized.simpleAverageMargin * 100, 1)}%) differs by ${round(normalized.simpleVsWeightedGap * 100, 1)}% from volume-weighted margin (${round(normalized.weightedMargin * 100, 1)}%).`);
  }

  if (finite(quality.shareChange) && quality.shareChange > 0.25) warnings.push(`Share count increased by ${round(quality.shareChange * 100, 1)}% over the available period (exceeds 25% threshold).`);
  if (quality.reliability === "Low") warnings.push("Free cash flow history is inconsistent (<67% positive years).");
  if (!normalized.marginAgreement) warnings.push(`Average and median annual FCF margins differ by more than 25%${finite(normalized.averageMedianGap) ? ` (${round(normalized.averageMedianGap * 100, 1)}%)` : ""}; this stock cannot qualify automatically.`);
  if (normalized.outlierYears.length) warnings.push(`Extreme annual FCF margin detected in: ${normalized.outlierYears.map((item) => item.year).join(", ")}.`);

  // Valuation sanity: market cap >= $10M and FCF yield between 0% and 50%
  const valuationSane = finite(marketCap) && marketCap >= 10_000_000 && finite(valuation.fcfYield) && valuation.fcfYield > 0 && valuation.fcfYield <= 0.50;
  if (!valuationSane) warnings.push("Valuation failed sanity thresholds (market cap >= $10M and FCF yield between 0% and 50%) and cannot qualify automatically.");

  const filing = latestFiling(submissions);
  const criticalMissing = [debt, cash, effectiveShares, quality.latestSbcToFcf, normalized.normalizedEconomicFcf].some((item) => !finite(item)) || !currencyConversionValid;
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
      financials: financialSource,
      price: quoteResult.source,
      shares: shareSelection.source,
      marketCap: marketCapSource,
      debt: balanceSheet.debtSource,
      cash: balanceSheet.cashSource,
      financialTags: Object.fromEntries(Object.entries(extracted.series).map(([key, value]) => [key, value.tag]))
    },
    analyzedAt: new Date().toISOString()
  };
  const evaluation = evaluateCandidate(report, options.criteria || {});
  report.evaluation = evaluation;
  report.status = evaluation.status;
  report.passesDefaultIdeaFilter = evaluation.status === "Idea";
  return report;
}

function compactStr(val) {
  if (Math.abs(val) >= 1e9) return (val / 1e9).toFixed(1) + "B";
  if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(1) + "M";
  return Math.round(val).toLocaleString();
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
    latestSbcToRevenue: round(report.quality.latestSbcToRevenue, 4),
    latestSbcToFcf: round(report.quality.latestSbcToFcf, 4),
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
  // Use 1 worker to ensure serialized, rate-safe requests to Yahoo and SEC
  const workers = 1;
  async function worker() {
    while (index < tickers.length) {
      const ticker = tickers[index++];
      try {
        reports[ticker] = await analyzeTicker(ticker, { ...options, ...(options.quotes?.[ticker] || {}) });
      } catch (error) {
        failures.push({ ticker, error: error.message || "Analysis failed." });
      }
      // Option A: 350ms pacing delay between ticker analyses to prevent rate limiting
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  const results = Object.values(reports).map(summary).sort((a, b) => Number(b.passesDefaultIdeaFilter) - Number(a.passesDefaultIdeaFilter) || (a.priceToNfcf ?? 999) - (b.priceToNfcf ?? 999));
  return { results, reports, failures };
}

module.exports = { annualRows, normalize, computeQuality, selectValuationShares, debtValue, reconcileBalanceSheet, analyzeTicker, analyzeBatch, summary };
