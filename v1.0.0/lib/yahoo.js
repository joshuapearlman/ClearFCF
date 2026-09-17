"use strict";

const { fetchJson, clamp, finite } = require("./utils");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*"
};

const SOURCES = [
  "undervalued_large_caps", "undervalued_growth_stocks", "day_losers",
  "most_actives", "aggressive_small_caps", "small_cap_gainers"
];

let cachedCookie = null;
let cachedCrumb = null;
let authExpires = 0;

async function getYahooAuth(forceRefresh = false) {
  if (!forceRefresh && cachedCookie && cachedCrumb && Date.now() < authExpires) {
    return { cookie: cachedCookie, crumb: cachedCrumb };
  }
  try {
    const res = await fetch("https://fc.yahoo.com", { headers: HEADERS });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      cachedCookie = setCookie.split(";")[0];
      const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: { ...HEADERS, cookie: cachedCookie }
      });
      if (crumbRes.ok) {
        cachedCrumb = (await crumbRes.text()).trim();
        authExpires = Date.now() + 1800 * 1000; // 30 min cache
        return { cookie: cachedCookie, crumb: cachedCrumb };
      }
    }
  } catch (e) {}
  return null;
}

async function fetchYahooQuote(ticker) {
  const symbol = encodeURIComponent(ticker);

  // 1. Primary: quoteSummary with price, defaultKeyStatistics, and financialData (Live Balance Sheet Snapshot with retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const auth = await getYahooAuth(attempt > 0);
      const authHeaders = auth?.cookie ? { ...HEADERS, cookie: auth.cookie } : HEADERS;
      const crumbStr = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
      const summaryUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price,defaultKeyStatistics,financialData,assetProfile,summaryDetail,insiderTransactions,netSharePurchaseActivity${crumbStr}`;
      const summaryData = await fetchJson(summaryUrl, { headers: authHeaders }, 8000);
      const result = summaryData?.quoteSummary?.result?.[0];
      const pMod = result?.price;
      const sMod = result?.defaultKeyStatistics;
      const fMod = result?.financialData;
      const profile = result?.assetProfile;
      const detail = result?.summaryDetail;

      const priceVal = pMod?.regularMarketPrice?.raw ?? pMod?.regularMarketPrice;
      const mcVal = pMod?.marketCap?.raw ?? pMod?.marketCap;
      const sharesVal = sMod?.sharesOutstanding?.raw ?? sMod?.sharesOutstanding;
      const totalDebtVal = fMod?.totalDebt?.raw ?? (finite(fMod?.totalDebt) ? fMod?.totalDebt : null);
      const totalCashVal = fMod?.totalCash?.raw ?? (finite(fMod?.totalCash) ? fMod?.totalCash : null);
      const currentRatioVal = fMod?.currentRatio?.raw ?? (finite(fMod?.currentRatio) ? fMod?.currentRatio : null);
      const quickRatioVal = fMod?.quickRatio?.raw ?? (finite(fMod?.quickRatio) ? fMod?.quickRatio : null);
      const bookValueVal = sMod?.bookValue?.raw ?? (finite(sMod?.bookValue) ? sMod?.bookValue : null);
      const evVal = sMod?.enterpriseValue?.raw ?? (finite(sMod?.enterpriseValue) ? sMod?.enterpriseValue : null);

      const raw = (field) => field?.raw ?? (finite(field) ? field : null);
      const currentYield = raw(detail?.dividendYield) ?? raw(detail?.trailingAnnualDividendYield);
      const dividendRate = raw(detail?.dividendRate) ?? raw(detail?.trailingAnnualDividendRate);
      const fiveYearYieldPercent = raw(sMod?.fiveYearAvgDividendYield);
      const transactions = Array.isArray(result?.insiderTransactions?.transactions)
        ? result.insiderTransactions.transactions
        : [];
      const oneYearAgo = Math.floor(Date.now() / 1000) - (366 * 86400);
      const directPurchases = transactions.filter((transaction) => {
        const text = String(transaction?.transactionText || transaction?.text || "");
        const date = raw(transaction?.startDate);
        return /\bpurchase\b/i.test(text) && !/option|award|grant/i.test(text) && (!finite(date) || date >= oneYearAgo);
      }).map((transaction) => {
        const shares = raw(transaction.shares);
        const value = raw(transaction.value);
        return {
          name: transaction.filerName || null,
          relation: transaction.filerRelation || transaction.filerTitle || null,
          date: finite(raw(transaction.startDate)) ? new Date(raw(transaction.startDate) * 1000).toISOString().slice(0, 10) : null,
          shares: finite(shares) ? shares : null,
          value: finite(value) ? value : null,
          price: finite(value) && finite(shares) && shares > 0 ? value / shares : null,
          description: String(transaction.transactionText || transaction.text || "Purchase")
        };
      });
      const netActivity = result?.netSharePurchaseActivity || {};
      const buyCount = raw(netActivity.buyInfoCount);
      const sellCount = raw(netActivity.sellInfoCount);
      const netShares = raw(netActivity.netInfoShares) ?? raw(netActivity.netSharesPurchased);
      const purchaseShares = directPurchases.reduce((sum, item) => sum + (item.shares || 0), 0);
      const purchaseValue = directPurchases.reduce((sum, item) => sum + (item.value || 0), 0);

      if (finite(priceVal)) {
        return {
          price: priceVal,
          marketCap: finite(mcVal) ? mcVal : null,
          shares: finite(sharesVal) ? sharesVal : null,
          totalDebt: finite(totalDebtVal) ? totalDebtVal : null,
          totalCash: finite(totalCashVal) ? totalCashVal : null,
          currentRatio: finite(currentRatioVal) ? currentRatioVal : null,
          quickRatio: finite(quickRatioVal) ? quickRatioVal : null,
          bookValue: finite(bookValueVal) ? bookValueVal : null,
          enterpriseValue: finite(evVal) ? evVal : null,
          currency: pMod?.currency || null,
          exchange: pMod?.exchangeName || null,
          instrumentType: pMod?.quoteType || null,
          companyName: pMod?.longName || pMod?.shortName || ticker,
          sector: profile?.sector || null,
          industry: profile?.industry || null,
          dividends: {
            currentYield: finite(currentYield) ? currentYield : null,
            annualRate: finite(dividendRate) ? dividendRate : null,
            fiveYearAverageYield: finite(fiveYearYieldPercent) ? fiveYearYieldPercent / 100 : null,
            exDividendDate: finite(raw(detail?.exDividendDate)) ? new Date(raw(detail.exDividendDate) * 1000).toISOString().slice(0, 10) : null,
            source: "Yahoo Finance summary"
          },
          fiftyTwoWeekHigh: finite(raw(detail?.fiftyTwoWeekHigh)) ? raw(detail.fiftyTwoWeekHigh) : null,
          fiftyTwoWeekLow: finite(raw(detail?.fiftyTwoWeekLow)) ? raw(detail.fiftyTwoWeekLow) : null,
          insiders: {
            period: netActivity.period || "12 months",
            purchaseCount: directPurchases.length,
            reportedBuyCount: finite(buyCount) ? buyCount : null,
            saleCount: finite(sellCount) ? sellCount : null,
            netShares: finite(netShares) ? netShares : null,
            averagePurchasePrice: purchaseShares > 0 && purchaseValue > 0 ? purchaseValue / purchaseShares : null,
            purchases: directPurchases.slice(0, 5),
            source: "Yahoo Finance insider transactions"
          },
          marketTime: pMod?.regularMarketTime ? new Date(pMod.regularMarketTime * 1000).toISOString() : null,
          source: "Yahoo Finance live balance sheet & quote"
        };
      }
    } catch (e) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }

  // 2. Secondary fallback: v6 / v7 quote endpoints
  const quoteUrls = [
    `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${symbol}`,
    `https://query1.finance.yahoo.com/v6/finance/quote?symbols=${symbol}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`
  ];

  for (const url of quoteUrls) {
    try {
      const qData = await fetchJson(url, { headers: HEADERS });
      const q = qData?.quoteResponse?.result?.[0];
      if (q && finite(q.regularMarketPrice)) {
        const fallbackYield = finite(q.trailingAnnualDividendYield) ? q.trailingAnnualDividendYield
          : finite(q.dividendYield) ? q.dividendYield / 100 : null;
        return {
          price: q.regularMarketPrice,
          marketCap: finite(q.marketCap) ? q.marketCap : null,
          shares: finite(q.sharesOutstanding) ? q.sharesOutstanding : null,
          totalDebt: null,
          totalCash: null,
          currentRatio: null,
          quickRatio: null,
          bookValue: null,
          enterpriseValue: null,
          currency: q.currency || null,
          exchange: q.fullExchangeName || q.exchange || null,
          instrumentType: q.quoteType || null,
          companyName: q.longName || q.shortName || ticker,
          sector: q.sector || null,
          industry: q.industry || null,
          dividends: {
            currentYield: fallbackYield,
            annualRate: finite(q.dividendRate) ? q.dividendRate
              : finite(q.trailingAnnualDividendRate) ? q.trailingAnnualDividendRate : null,
            fiveYearAverageYield: finite(q.fiveYearAvgDividendYield) ? q.fiveYearAvgDividendYield / 100 : null,
            exDividendDate: finite(q.exDividendDate) ? new Date(q.exDividendDate * 1000).toISOString().slice(0, 10) : null,
            source: "Yahoo Finance quote"
          },
          fiftyTwoWeekHigh: finite(q.fiftyTwoWeekHigh) ? q.fiftyTwoWeekHigh : null,
          fiftyTwoWeekLow: finite(q.fiftyTwoWeekLow) ? q.fiftyTwoWeekLow : null,
          marketTime: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null,
          source: "Yahoo Finance quote"
        };
      }
    } catch (e) {}
  }

  // 3. Fallback to chart endpoint for price
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`, { headers: HEADERS });
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const lastClose = [...closes].reverse().find(finite);
  const price = finite(meta.regularMarketPrice) ? meta.regularMarketPrice : lastClose;
  return {
    price: finite(price) ? price : null,
    marketCap: finite(meta.marketCap) ? meta.marketCap : null,
    totalDebt: null,
    totalCash: null,
    currentRatio: null,
    quickRatio: null,
    bookValue: null,
    enterpriseValue: null,
    currency: meta.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    instrumentType: meta.instrumentType || null,
    companyName: meta.longName || meta.shortName || ticker,
    sector: null,
    industry: null,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    source: "Yahoo Finance chart"
  };
}

const FUNDAMENTAL_TYPES = [
  "annualTotalRevenue",
  "annualOperatingCashFlow",
  "annualCapitalExpenditure",
  "annualPurchaseOfIntangibles",
  "annualStockBasedCompensation",
  "annualDilutedAverageShares",
  "annualDepreciationAndAmortization",
  "annualInterestExpense",
  "annualRepurchaseOfCapitalStock",
  "annualCashDividendsPaid",
  "quarterlyCashCashEquivalentsAndShortTermInvestments",
  "quarterlyCashAndCashEquivalents",
  "quarterlyTotalDebt",
  "quarterlyCurrentDebt"
];

async function fetchFundamentalWindow(ticker, period1, period2) {
  const symbol = encodeURIComponent(ticker);
  const types = FUNDAMENTAL_TYPES.join(",");
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${symbol}?symbol=${symbol}&type=${types}&period1=${period1}&period2=${period2}`;
  const data = await fetchJson(url, { headers: HEADERS }, 12000);
  return data?.timeseries?.result || [];
}

function yahooFact(item, tag) {
  const value = item?.reportedValue?.raw;
  if (!finite(value) || !item?.asOfDate) return null;
  return {
    val: value,
    end: item.asOfDate,
    filed: item.asOfDate,
    form: "Yahoo",
    taxonomy: "yahoo-finance",
    tag,
    label: tag.replace(/^(annual|quarterly)/, ""),
    unit: tag.includes("Shares") ? "shares" : item.currencyCode || "USD"
  };
}

function yahooSeries(byType, tag) {
  const values = new Map();
  for (const item of byType.get(tag) || []) {
    const fact = yahooFact(item, tag);
    if (fact) values.set(Number(fact.end.slice(0, 4)), fact);
  }
  const first = values.values().next().value;
  return { values, taxonomy: "yahoo-finance", tag, label: first?.label || tag, unit: first?.unit || "USD" };
}

function latestYahooFact(byType, tags) {
  return tags.flatMap((tag) => (byType.get(tag) || []).map((item) => yahooFact(item, tag)).filter(Boolean))
    .sort((a, b) => String(b.end).localeCompare(String(a.end)))[0] || null;
}

async function fetchYahooFinancials(ticker) {
  const nowSeconds = Math.floor(Date.now() / 1000) + 86400;
  const initial = await fetchFundamentalWindow(ticker, 946684800, nowSeconds);
  const annualDates = initial.flatMap((series) => {
    const tag = series?.meta?.type?.[0];
    return tag === "annualTotalRevenue" ? (series[tag] || []).map((item) => item.asOfDate).filter(Boolean) : [];
  });
  if (!annualDates.length) {
    const error = new Error(`${ticker} has no Yahoo annual financial history.`);
    error.statusCode = 404;
    throw error;
  }
  const earliestYear = Math.min(...annualDates.map((date) => Number(date.slice(0, 4))));
  const cutoff = (year) => Math.floor(Date.parse(`${year}-01-01T00:00:00Z`) / 1000);
  const older = await Promise.all([
    fetchFundamentalWindow(ticker, 946684800, cutoff(earliestYear)),
    fetchFundamentalWindow(ticker, 946684800, cutoff(earliestYear - 1))
  ]);
  const byType = new Map();
  for (const series of [...initial, ...older.flat()]) {
    const tag = series?.meta?.type?.[0];
    if (!tag) continue;
    const existing = byType.get(tag) || [];
    const seen = new Set(existing.map((item) => item.asOfDate));
    for (const item of series[tag] || []) {
      if (item?.asOfDate && !seen.has(item.asOfDate)) {
        existing.push(item);
        seen.add(item.asOfDate);
      }
    }
    byType.set(tag, existing);
  }

  const empty = (tag) => ({ values: new Map(), taxonomy: "yahoo-finance", tag, label: tag, unit: "USD" });
  const series = {
    revenue: yahooSeries(byType, "annualTotalRevenue"),
    ocf: yahooSeries(byType, "annualOperatingCashFlow"),
    capex: yahooSeries(byType, "annualCapitalExpenditure"),
    acquiredIntangibles: yahooSeries(byType, "annualPurchaseOfIntangibles"),
    intangibleCapex: empty("Unavailable"),
    dna: yahooSeries(byType, "annualDepreciationAndAmortization"),
    interestExpense: yahooSeries(byType, "annualInterestExpense"),
    sbc: yahooSeries(byType, "annualStockBasedCompensation"),
    dilutedShares: yahooSeries(byType, "annualDilutedAverageShares"),
    buybackCash: yahooSeries(byType, "annualRepurchaseOfCapitalStock"),
    buybackShares: empty("Unavailable"),
    dividendsPaid: yahooSeries(byType, "annualCashDividendsPaid")
  };
  const cash = latestYahooFact(byType, ["quarterlyCashCashEquivalentsAndShortTermInvestments", "quarterlyCashAndCashEquivalents"]);
  const totalDebt = latestYahooFact(byType, ["quarterlyTotalDebt"]);
  const shortDebt = latestYahooFact(byType, ["quarterlyCurrentDebt"]);
  const currencies = [...series.revenue.values.values()].map((fact) => fact.unit).filter(Boolean);
  return {
    series,
    latest: { cash, totalDebt, shortDebt, longDebt: null, sharesOutstanding: null },
    financialCurrency: currencies[0] || "USD"
  };
}

async function fetchSource(source, count) {
  const url = `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${encodeURIComponent(source)}&count=${count}`;
  const data = await fetchJson(url, { headers: HEADERS });
  const result = data?.finance?.result?.[0];
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  return {
    id: source,
    title: result?.title || source.replaceAll("_", " "),
    symbols: quotes.filter((quote) =>
      quote.quoteType === "EQUITY" && finite(quote.regularMarketPrice) && finite(quote.marketCap) && quote.marketCap > 50_000_000
    ).map((quote) => ({
      ticker: String(quote.symbol || "").toUpperCase(),
      name: quote.shortName || quote.longName || quote.symbol,
      price: quote.regularMarketPrice,
      marketCap: quote.marketCap,
      exchange: quote.fullExchangeName || quote.exchange || null,
      source
    })).filter((quote) => /^[A-Z0-9.-]{1,12}$/.test(quote.ticker))
  };
}

async function fetchYahooUniverse(options = {}) {
  const count = clamp(Number(options.perSource) || 100, 25, 250);
  const requested = Array.isArray(options.sources) ? options.sources.filter((value) => SOURCES.includes(value)) : SOURCES;
  const settled = await Promise.allSettled(requested.map((source) => fetchSource(source, count)));
  const sources = [];
  const failures = [];
  const byTicker = new Map();
  const successfulLists = [];

  for (const result of settled) {
    if (result.status === "rejected") {
      failures.push(result.reason?.message || "Yahoo list failed.");
      continue;
    }
    sources.push({ id: result.value.id, title: result.value.title, count: result.value.symbols.length });
    successfulLists.push(result.value.symbols);
    for (const quote of result.value.symbols) {
      const existing = byTicker.get(quote.ticker);
      if (existing) existing.sources.push(quote.source);
      else byTicker.set(quote.ticker, { ...quote, sources: [quote.source] });
    }
  }

  const orderedTickers = [];
  const seen = new Set();
  const longest = Math.max(0, ...successfulLists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of successfulLists) {
      const ticker = list[index]?.ticker;
      if (ticker && !seen.has(ticker)) { seen.add(ticker); orderedTickers.push(ticker); }
    }
  }

  const symbols = orderedTickers.map((ticker) => byTicker.get(ticker));
  return { symbols, sources, failures, fetchedAt: new Date().toISOString() };
}

async function fetchExchangeRate(from, to) {
  if (!from || !to || from === to) return 1.0;
  const f = String(from).toUpperCase();
  const t = String(to).toUpperCase();
  if (f === "USD" && t === "USD") return 1.0;

  const direct = await fetchYahooQuote(`${f}${t}=X`).catch(() => null);
  if (finite(direct?.price) && direct.price > 0) return direct.price;
  const inverse = await fetchYahooQuote(`${t}${f}=X`).catch(() => null);
  if (finite(inverse?.price) && inverse.price > 0) return 1 / inverse.price;
  const error = new Error(`Live ${f}/${t} exchange rate is unavailable.`);
  error.statusCode = 502;
  throw error;
}

async function fetchYahooPriceHistory(ticker) {
  const symbol = encodeURIComponent(ticker);
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5y&interval=1mo&events=div`, { headers: HEADERS }, 12000);
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.adjclose?.[0]?.adjclose || result?.indicators?.quote?.[0]?.close || [];
  return timestamps.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    close: finite(closes[index]) ? closes[index] : null
  })).filter((item) => finite(item.close));
}

module.exports = { SOURCES, fetchYahooQuote, fetchYahooFinancials, fetchYahooUniverse, fetchExchangeRate, fetchYahooPriceHistory };
