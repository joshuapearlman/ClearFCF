"use strict";

const { fetchJson, finite } = require("./utils");

const SEC_AGENT = process.env.SEC_USER_AGENT || "ClearFCFScreener/1.0 contact@example.com";
const SEC_HEADERS = { "User-Agent": SEC_AGENT, Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
const cache = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;

const TAGS = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
    "SalesRevenueGoodsNet", "SalesRevenueServicesNet", "Revenue"
  ],
  ocf: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets"
  ],
  intangibleCapex: [
    "PaymentsToAcquireIntangibleAssets",
    "PaymentsToDevelopSoftware",
    "PaymentsToAcquireSoftware"
  ],
  dna: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "Depreciation",
    "AmortizationOfIntangibleAssets"
  ],
  interestExpense: [
    "InterestExpense",
    "InterestPaidNet",
    "InterestAndDebtExpense",
    "InterestExpenseDebt"
  ],
  sbc: ["ShareBasedCompensation"],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted"],
  sharesOutstanding: ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashCashEquivalentsAndShortTermInvestments"],
  totalDebt: ["LongTermDebtAndFinanceLeaseObligations", "DebtAndFinanceLeaseObligations", "LongTermDebtAndCapitalLeaseObligations"],
  shortDebt: ["ShortTermBorrowings", "ShortTermDebt", "DebtCurrent", "LongTermDebtCurrent"],
  longDebt: ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent"]
};

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.value;
  const value = await loader();
  cache.set(key, { time: Date.now(), value });
  return value;
}

async function tickerMap() {
  return cached("ticker-map", async () => {
    const data = await fetchJson("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
    return new Map(Object.values(data).map((item) => [String(item.ticker).toUpperCase(), item]));
  });
}

async function lookupTicker(ticker) {
  const map = await tickerMap();
  const item = map.get(ticker.toUpperCase());
  if (!item) {
    const error = new Error(`${ticker} was not found in the SEC ticker directory.`);
    error.statusCode = 404;
    throw error;
  }
  return { CIK: String(item.cik_str).padStart(10, "0"), ticker: item.ticker, title: item.title, cik: String(item.cik_str).padStart(10, "0") };
}

async function fetchSecCompany(ticker) {
  const company = await lookupTicker(ticker);
  const [facts, submissions] = await Promise.all([
    cached(`facts-${company.cik}`, () => fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`, { headers: SEC_HEADERS })),
    cached(`submissions-${company.cik}`, () => fetchJson(`https://data.sec.gov/submissions/CIK${company.cik}.json`, { headers: SEC_HEADERS }))
  ]);
  return { company, facts, submissions };
}

function allConcepts(facts, tag) {
  const matches = [];
  for (const taxonomy of ["us-gaap", "ifrs-full", "dei"]) {
    const concept = facts?.facts?.[taxonomy]?.[tag];
    if (concept) matches.push({ taxonomy, tag, concept });
  }
  return matches;
}

function factUnits(concept, preferred) {
  const units = concept?.units || {};
  for (const unit of preferred) if (Array.isArray(units[unit])) return units[unit];
  return Object.values(units).find(Array.isArray) || [];
}

function annualFacts(concept) {
  return factUnits(concept, ["USD", "shares"]).filter((fact) => {
    if (!["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"].includes(fact.form)) return false;
    if (!finite(fact.val) || !fact.end) return false;
    if (fact.start) {
      const days = (Date.parse(fact.end) - Date.parse(fact.start)) / 86400000;
      return days >= 300 && days <= 430;
    }
    return fact.fp === "FY";
  });
}

function instantFacts(concept) {
  return factUnits(concept, ["USD", "shares"]).filter((fact) =>
    finite(fact.val) && fact.end && ["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-Q"].includes(fact.form)
  );
}

function dedupeByYear(facts) {
  const years = new Map();
  for (const fact of facts) {
    const year = Number(String(fact.end).slice(0, 4));
    const current = years.get(year);
    if (!current || String(fact.filed || "") > String(current.filed || "")) years.set(year, fact);
  }
  return years;
}

function bestAnnualSeries(facts, tags) {
  let best = { values: new Map(), taxonomy: null, tag: null, label: null };
  for (const tag of tags) {
    for (const { taxonomy, concept } of allConcepts(facts, tag)) {
      const values = dedupeByYear(annualFacts(concept));
      if (values.size > best.values.size) best = { values, taxonomy, tag, label: concept.label || tag };
    }
  }
  return best;
}

function latestInstant(facts, tags) {
  for (const tag of tags) {
    const candidates = allConcepts(facts, tag).flatMap(({ concept, taxonomy }) =>
      instantFacts(concept).map((fact) => ({ ...fact, taxonomy, tag, label: concept.label || tag }))
    ).sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.filed).localeCompare(String(a.filed)));
    if (candidates.length) return candidates[0];
  }
  return null;
}

function extractFinancials(facts) {
  const series = {};
  for (const key of ["revenue", "ocf", "capex", "intangibleCapex", "dna", "interestExpense", "sbc", "dilutedShares"]) {
    series[key] = bestAnnualSeries(facts, TAGS[key]);
  }
  const cash = latestInstant(facts, TAGS.cash);
  const totalDebt = latestInstant(facts, TAGS.totalDebt);
  const shortDebt = latestInstant(facts, TAGS.shortDebt);
  const longDebt = latestInstant(facts, TAGS.longDebt);
  const sharesOutstanding = latestInstant(facts, TAGS.sharesOutstanding);
  return { series, latest: { cash, totalDebt, shortDebt, longDebt, sharesOutstanding } };
}

async function fetchSecUniverse() {
  const map = await tickerMap();
  const valid = [];
  const seen = new Set();
  for (const item of map.values()) {
    const ticker = String(item.ticker).toUpperCase().trim();
    if (!/^[A-Z]{1,5}$/.test(ticker)) continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    valid.push({
      ticker,
      name: item.title,
      cik: String(item.cik_str).padStart(10, "0"),
      source: "SEC Master Directory"
    });
  }
  return valid;
}

module.exports = { fetchSecCompany, extractFinancials, fetchSecUniverse, TAGS };
