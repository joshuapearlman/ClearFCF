"use strict";

const { fetchJson, finite } = require("./utils");

const SEC_CONTACT_EMAIL = process.env.SEC_CONTACT_EMAIL || "joshuapearlman45@gmail.com";
const SEC_AGENT = process.env.SEC_USER_AGENT || `ClearFCF/1.0 ${SEC_CONTACT_EMAIL}`;
const SEC_HEADERS = { "User-Agent": SEC_AGENT, Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
const cache = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;
const SEC_MIN_INTERVAL_MS = 200;
let secRequestQueue = Promise.resolve();
let nextSecRequestAt = 0;

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
  sbc: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted"],
  periodEndShares: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"],
  sharesOutstanding: ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
  cash: ["CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  totalDebt: [
    "LongTermDebtAndFinanceLeaseObligations", "DebtAndFinanceLeaseObligations", "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebt", "SeniorNotes", "NotesPayable", "CommercialPaper", "LinesOfCredit"
  ],
  shortDebt: [
    "ShortTermBorrowings", "ShortTermDebt", "DebtCurrent", "LongTermDebtCurrent", "NotesPayableCurrent", "CommercialPaper"
  ],
  longDebt: [
    "LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent", "SeniorNotesNoncurrent"
  ],
  buybackCash: [
    "PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity", "PaymentsForRepurchaseOfStock"
  ],
  buybackShares: [
    "StockRepurchasedAndRetiredDuringPeriodShares", "TreasuryStockSharesAcquired", "StockRepurchasedDuringPeriodShares"
  ],
  dividendsPaid: [
    "PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends",
    "DividendsCommonStockCash", "PaymentsOfDividendsMinorityInterest"
  ]
};

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.value;
  const value = await loader();
  cache.set(key, { time: Date.now(), value });
  return value;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queueSecRequest(loader) {
  const request = secRequestQueue.then(async () => {
    const delay = Math.max(0, nextSecRequestAt - Date.now());
    if (delay) await wait(delay);
    nextSecRequestAt = Date.now() + SEC_MIN_INTERVAL_MS;
    return loader();
  });
  secRequestQueue = request.catch(() => undefined);
  return request;
}

async function fetchSecJson(url) {
  return queueSecRequest(() => fetchJson(url, { headers: SEC_HEADERS }));
}

async function fetchSecText(url) {
  return queueSecRequest(async () => {
    const response = await fetch(url, { headers: { ...SEC_HEADERS, Accept: "application/xml,text/xml,text/html,*/*" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`SEC filing request failed (${response.status}).`);
    return response.text();
  });
}

async function tickerMap() {
  return cached("ticker-map", async () => {
    const data = await fetchSecJson("https://www.sec.gov/files/company_tickers.json");
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
  // Do NOT cache raw multi-megabyte facts in memory across serverless requests.
  // Letting them fall out of scope allows V8 to garbage-collect them immediately.
  const [facts, submissions] = await Promise.all([
    fetchSecJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`),
    fetchSecJson(`https://data.sec.gov/submissions/CIK${company.cik}.json`)
  ]);
  return { company, facts, submissions };
}

function xmlValue(block, tag) {
  const match = String(block || "").match(new RegExp(`<${tag}[^>]*>\\s*(?:<value[^>]*>)?([^<]+)(?:</value>)?\\s*</${tag}>`, "i"));
  return match ? match[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;
}

async function fetchRecentForm4Purchases(company, submissions, limit = 5) {
  if (!company?.cik) return [];
  const cutoff = Date.now() - (366 * 86400000);
  const recent = submissions?.filings?.recent || {};
  const forms = recent.form || [];
  const filings = [];
  for (let index = 0; index < forms.length && filings.length < limit; index += 1) {
    if (!/^4(?:\/A)?$/.test(forms[index])) continue;
    const accession = recent.accessionNumber?.[index];
    const primaryDocument = recent.primaryDocument?.[index];
    const filed = recent.filingDate?.[index] || null;
    if (filed && Date.parse(filed) < cutoff) continue;
    if (!accession || !primaryDocument) continue;
    filings.push({
      filed,
      accession,
      primaryDocument,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${accession.replaceAll("-", "")}/${primaryDocument}`
    });
  }

  const settled = await Promise.allSettled(filings.map(async (filing) => ({ ...filing, xml: await fetchSecText(filing.url) })));
  const purchases = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { xml, ...filing } = result.value;
    const ownerBlock = xml.match(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/i)?.[1] || "";
    const ownerName = xmlValue(ownerBlock, "rptOwnerName");
    const relationship = xmlValue(ownerBlock, "officerTitle")
      || (xmlValue(ownerBlock, "isDirector") === "1" ? "Director" : xmlValue(ownerBlock, "isOfficer") === "1" ? "Officer" : null);
    const blocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) || [];
    for (const block of blocks) {
      if (xmlValue(block, "transactionCode") !== "P" || xmlValue(block, "transactionAcquiredDisposedCode") !== "A") continue;
      const shares = Number(xmlValue(block, "transactionShares"));
      const price = Number(xmlValue(block, "transactionPricePerShare"));
      purchases.push({
        name: ownerName,
        relation: relationship,
        date: xmlValue(block, "transactionDate") || filing.filed,
        shares: finite(shares) ? shares : null,
        price: finite(price) ? price : null,
        value: finite(shares) && finite(price) ? shares * price : null,
        sharesAfter: Number(xmlValue(block, "sharesOwnedFollowingTransaction")) || null,
        security: xmlValue(block, "securityTitle") || "Common stock",
        filingUrl: filing.url,
        source: "SEC Form 4"
      });
    }
  }
  return purchases.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function allConcepts(facts, tag) {
  const matches = [];
  for (const taxonomy of ["us-gaap", "ifrs-full", "dei"]) {
    const concept = facts?.facts?.[taxonomy]?.[tag];
    if (concept) matches.push({ taxonomy, tag, concept });
  }
  return matches;
}

function factUnitsWithKey(concept, preferred) {
  const units = concept?.units || {};
  for (const unit of preferred) {
    if (Array.isArray(units[unit])) return { unit, facts: units[unit] };
  }
  for (const [unit, list] of Object.entries(units)) {
    if (Array.isArray(list)) return { unit, facts: list };
  }
  return { unit: "USD", facts: [] };
}

function factUnits(concept, preferred) {
  return factUnitsWithKey(concept, preferred).facts;
}

function annualFacts(concept) {
  const { unit, facts } = factUnitsWithKey(concept, ["USD", "shares"]);
  return facts.filter((fact) => {
    if (!["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"].includes(fact.form)) return false;
    if (!finite(fact.val) || !fact.end) return false;
    if (fact.start) {
      const days = (Date.parse(fact.end) - Date.parse(fact.start)) / 86400000;
      return days >= 300 && days <= 430;
    }
    return fact.fp === "FY";
  }).map((f) => ({ ...f, unit }));
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
  const mergedValues = new Map();
  let bestTag = null;
  let bestLabel = null;
  let bestTaxonomy = null;
  let bestUnit = "USD";

  for (const tag of tags) {
    for (const { taxonomy, concept } of allConcepts(facts, tag)) {
      const yearMap = dedupeByYear(annualFacts(concept));
      for (const [year, fact] of yearMap.entries()) {
        if (!mergedValues.has(year)) {
          mergedValues.set(year, {
            ...fact,
            taxonomy,
            tag,
            label: concept.label || tag
          });
          if (!bestTag) {
            bestTag = tag;
            bestLabel = concept.label || tag;
            bestTaxonomy = taxonomy;
            if (fact.unit) bestUnit = fact.unit;
          }
        }
      }
    }
  }
  return { values: mergedValues, taxonomy: bestTaxonomy, tag: bestTag, label: bestLabel, unit: bestUnit };
}

function bestHistoricalShareSeries(facts) {
  const preferred = bestAnnualSeries(facts, TAGS.dilutedShares);
  for (const fact of preferred.values.values()) fact.shareBasis = "weighted-average diluted";

  const fallbackValues = new Map();
  for (const tag of TAGS.periodEndShares) {
    for (const { taxonomy, concept } of allConcepts(facts, tag)) {
      const candidates = factUnits(concept, ["shares"]).filter((fact) =>
        finite(fact.val) && fact.val > 0 && fact.end
        && ["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"].includes(fact.form)
      );
      for (const fact of candidates) {
        const endYear = Number(String(fact.end).slice(0, 4));
        const fiscalYear = Number(fact.fy);
        const year = tag === "EntityCommonStockSharesOutstanding" && Number.isInteger(fiscalYear)
          ? fiscalYear
          : endYear;
        if (!Number.isInteger(year)) continue;
        const current = fallbackValues.get(year);
        if (!current || String(fact.filed || "") > String(current.filed || "")) {
          fallbackValues.set(year, {
            ...fact,
            taxonomy,
            tag,
            label: `${concept.label || tag} (period-end fallback)`,
            unit: "shares",
            shareBasis: "period-end outstanding"
          });
        }
      }
    }
  }

  for (const [year, fact] of fallbackValues) {
    if (!preferred.values.has(year)) preferred.values.set(year, fact);
  }
  if (!preferred.tag && fallbackValues.size) {
    const first = fallbackValues.values().next().value;
    preferred.tag = first.tag;
    preferred.label = first.label;
    preferred.taxonomy = first.taxonomy;
    preferred.unit = "shares";
  }
  return preferred;
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
  for (const key of ["revenue", "ocf", "capex", "intangibleCapex", "dna", "interestExpense", "sbc", "buybackCash", "buybackShares", "dividendsPaid"]) {
    series[key] = bestAnnualSeries(facts, TAGS[key]);
  }
  series.dilutedShares = bestHistoricalShareSeries(facts);
  const cash = latestInstant(facts, TAGS.cash);
  const totalDebt = latestInstant(facts, TAGS.totalDebt);
  const shortDebt = latestInstant(facts, TAGS.shortDebt);
  const longDebt = latestInstant(facts, TAGS.longDebt);
  const sharesOutstanding = latestInstant(facts, TAGS.sharesOutstanding);
  const revUnit = series.revenue?.unit;
  const ocfUnit = series.ocf?.unit;
  const financialCurrency = (revUnit && revUnit !== "shares") ? revUnit : (ocfUnit && ocfUnit !== "shares") ? ocfUnit : "USD";
  return { series, latest: { cash, totalDebt, shortDebt, longDebt, sharesOutstanding }, financialCurrency };
}

function htmlAttribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
}

function inlineContextYears(html) {
  const contexts = new Map();
  const pattern = /<(?:xbrli:)?context\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const block = match[2];
    const start = block.match(/<(?:xbrli:)?startDate[^>]*>([^<]+)</i)?.[1]?.trim();
    const end = block.match(/<(?:xbrli:)?endDate[^>]*>([^<]+)</i)?.[1]?.trim();
    if (!start || !end) continue;
    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (days >= 300 && days <= 430) contexts.set(match[1], { year: Number(end.slice(0, 4)), start, end });
  }
  return contexts;
}

function parseInlineAnnualSbc(html, filing = {}) {
  const contexts = inlineContextYears(html);
  const values = new Map();
  const accepted = new Set(TAGS.sbc.map((tag) => tag.toLowerCase()));
  const pattern = /<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const attributes = match[1];
    const qualifiedName = htmlAttribute(attributes, "name") || "";
    const tag = qualifiedName.split(":").at(-1);
    if (!accepted.has(String(tag).toLowerCase())) continue;
    const context = contexts.get(htmlAttribute(attributes, "contextRef"));
    if (!context || !Number.isInteger(context.year)) continue;
    const raw = match[2].replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/,/g, "").trim();
    const numeric = Number(raw.replace(/[()]/g, ""));
    if (!finite(numeric)) continue;
    const scale = Number(htmlAttribute(attributes, "scale") || 0);
    const sign = htmlAttribute(attributes, "sign") === "-" || /^\(.*\)$/.test(raw) ? -1 : 1;
    const val = Math.abs(numeric * (10 ** scale) * sign);
    const existing = values.get(context.year);
    if (!existing || tag === "AllocatedShareBasedCompensationExpense") {
      values.set(context.year, {
        val,
        start: context.start,
        end: context.end,
        filed: filing.filed || null,
        form: filing.form || "10-K",
        accn: filing.accession || null,
        taxonomy: qualifiedName.split(":")[0] || "us-gaap",
        tag,
        label: "Share-based compensation disclosed in the annual filing",
        unit: "USD"
      });
    }
  }
  const first = values.values().next().value;
  return {
    values,
    taxonomy: first?.taxonomy || "us-gaap",
    tag: first?.tag || "ShareBasedCompensation",
    label: first?.label || "Share-based compensation disclosed in the annual filing",
    unit: "USD"
  };
}

async function fetchLatestAnnualSbcSeries(company, submissions) {
  if (!company?.cik) return null;
  const recent = submissions?.filings?.recent || {};
  const forms = recent.form || [];
  for (let index = 0; index < forms.length; index += 1) {
    if (!/^10-K(?:\/A)?$/.test(forms[index])) continue;
    const accession = recent.accessionNumber?.[index];
    const primaryDocument = recent.primaryDocument?.[index];
    if (!accession || !primaryDocument) continue;
    const filing = { form: forms[index], filed: recent.filingDate?.[index] || null, accession };
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${accession.replaceAll("-", "")}/${primaryDocument}`;
    const series = parseInlineAnnualSbc(await fetchSecText(url), filing);
    if (series.values.size) return series;
  }
  return null;
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

module.exports = {
  fetchSecCompany,
  extractFinancials,
  fetchSecUniverse,
  fetchRecentForm4Purchases,
  fetchLatestAnnualSbcSeries,
  parseInlineAnnualSbc,
  TAGS
};
