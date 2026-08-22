import { logger } from "./logger";
import { yahooFinance } from "./yahoo";
import { getTVStockInfo } from "./tvFundamentals";

// OpenAlice-style stock detail: quote stats from the Yahoo chart endpoint
// (works from datacenter IPs where quoteSummary is blocked), fundamentals from
// the TradingView scanner, financial statements straight from SEC EDGAR XBRL,
// and corporate profile data parsed from Wikipedia's infobox.

export interface StockProfile {
  sector: string | null;
  industry: string | null;
  ceo: string | null;
  employees: number | null;
  hq: string | null;
  website: string | null;
  description: string | null;
}

export interface StockMetrics {
  pe: number | null;
  peg: number | null;
  ps: number | null;
  pb: number | null;
  evEbitda: number | null;
  evSales: number | null;
  /** percent */
  divYield: number | null;
  /** percent */
  roe: number | null;
  /** percent */
  roa: number | null;
  /** percent */
  grossMargin: number | null;
  /** percent */
  opMargin: number | null;
  /** percent */
  netMargin: number | null;
  /** percent */
  debtEquity: number | null;
  currentRatio: number | null;
  enterpriseValue: number | null;
}

export interface FinRow {
  label: string;
  values: Array<number | null>;
}

export interface FinancialStatements {
  /** Fiscal years, newest first ("FY2025", ...) */
  years: string[];
  income: FinRow[];
  balance: FinRow[];
  cashflow: FinRow[];
}

export interface StockDetail {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  instrumentType: string | null;
  price: number | null;
  changeAbs: number | null;
  changePct: number | null;
  open: number | null;
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  ma50: number | null;
  ma200: number | null;
  profile: StockProfile;
  metrics: StockMetrics;
  statements: FinancialStatements;
  updatedAt: string;
}

export interface HistoryBar {
  t: string;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number;
  v: number | null;
}

export interface HistoryData {
  symbol: string;
  range: string;
  interval: string;
  bars: HistoryBar[];
  currency: string | null;
  exchange: string | null;
  instrumentType: string | null;
}

// ── Quote stats (Yahoo chart meta + daily bars) ──────────────────────────────

interface QuoteStats {
  name: string | null;
  exchange: string | null;
  currency: string | null;
  instrumentType: string | null;
  price: number | null;
  changeAbs: number | null;
  changePct: number | null;
  open: number | null;
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  ma50: number | null;
  ma200: number | null;
}

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

export async function fetchQuoteStats(symbol: string): Promise<QuoteStats> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 5);

  const result = await yahooFinance.chart(symbol, { period1: since, interval: "1d" });
  const meta = result.meta ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

  const closes: number[] = [];
  let lastOpen: number | null = null;
  for (const q of result.quotes ?? []) {
    if (q.close == null) continue;
    closes.push(q.close as number);
    if (q.open != null) lastOpen = q.open as number;
  }

  const price = num(meta.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
  const prevClose =
    num(meta.previousClose) ??
    (closes.length >= 2 ? closes[closes.length - 2] : null);
  const changeAbs = price != null && prevClose != null ? price - prevClose : null;

  return {
    name: (meta.longName as string) || (meta.shortName as string) || null,
    exchange: (meta.exchangeName as string) || null,
    currency: (meta.currency as string) || null,
    instrumentType: (meta.instrumentType as string) || null,
    price,
    changeAbs,
    changePct: changeAbs != null && prevClose ? (changeAbs / prevClose) * 100 : null,
    open: lastOpen,
    prevClose,
    dayHigh: num(meta.regularMarketDayHigh),
    dayLow: num(meta.regularMarketDayLow),
    volume: num(meta.regularMarketVolume),
    fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
    ma50: sma(closes, 50),
    ma200: sma(closes, 200),
  };
}

// ── SEC EDGAR XBRL financial statements ──────────────────────────────────────

const SEC_HEADERS = {
  "User-Agent": "Asset-Manager personal-investment-dashboard admin@asset-manager.local",
  Accept: "application/json",
};

export type SecConcepts = Record<string, { units?: Record<string, SecEntry[]> }>;
export type SecFacts = { entityName?: string; facts?: { "us-gaap"?: SecConcepts } };
export type SecEntry = { start?: string; end: string; val: number; form?: string; filed?: string };

let tickerMapCache: { t: number; m: Map<string, { cik: number; title: string }> } | null = null;

export async function secTickerMap(): Promise<Map<string, { cik: number; title: string }>> {
  if (tickerMapCache && Date.now() - tickerMapCache.t < 7 * 24 * 3600_000) {
    return tickerMapCache.m;
  }
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: SEC_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`SEC ticker map ${res.status}`);
  const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const m = new Map<string, { cik: number; title: string }>();
  for (const v of Object.values(raw)) m.set(v.ticker.toUpperCase(), { cik: v.cik_str, title: v.title });
  tickerMapCache = { t: Date.now(), m };
  return m;
}

const factsCache = new Map<string, { t: number; facts: SecFacts }>();

export async function secCompanyFacts(cik: number): Promise<SecFacts> {
  const key = String(cik);
  const hit = factsCache.get(key);
  if (hit && Date.now() - hit.t < 24 * 3600_000) return hit.facts;

  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, {
    headers: SEC_HEADERS,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`SEC companyfacts ${res.status}`);
  const facts = (await res.json()) as SecFacts;

  // Cap memory: drop the oldest entry beyond 40 cached companies.
  if (factsCache.size >= 40) {
    const oldest = [...factsCache.entries()].sort((a, b) => a[1].t - b[1].t)[0];
    if (oldest) factsCache.delete(oldest[0]);
  }
  factsCache.set(key, { t: Date.now(), facts });
  return facts;
}

/** Latest annual (10-K) value per fiscal year. Handles both duration
 *  concepts (income/cash flow, with start+end) and instant concepts
 *  (balance sheet, end only). Falls back to the first non-USD unit key
 *  for per-share concepts like EPS ("USD/shares"). */
function annualByYear(concepts: SecConcepts, tags: string[]): Map<number, number> {
  const out = new Map<number, { val: number; end: string; filed: string }>();
  for (const tag of tags) {
    const conceptUnits = concepts[tag]?.units;
    if (!conceptUnits) continue;
    const units = conceptUnits.USD ?? Object.values(conceptUnits)[0];
    if (!units) continue;
    for (const u of units) {
      if (!u.end || typeof u.val !== "number") continue;
      if (!u.form?.startsWith("10-K")) continue;
      if (u.start) {
        const days = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
        if (days < 300 || days > 400) continue;
      }
      // Prefer the latest end date; on equal end dates prefer the latest
      // filing (later 10-Ks restate prior-year comparatives, e.g. after a
      // stock split).
      const y = Number(u.end.slice(0, 4));
      const filed = u.filed ?? "";
      const prev = out.get(y);
      if (
        !prev ||
        u.end > prev.end ||
        (u.end === prev.end && filed > (prev.filed ?? ""))
      )
        out.set(y, { val: u.val, end: u.end, filed });
    }
  }
  return new Map([...out].map(([y, e]) => [y, e.val]));
}

function buildStatements(facts: SecFacts): FinancialStatements {
  const g = facts.facts?.["us-gaap"] ?? {};
  const empty = new Map<number, number>();
  const rev = annualByYear(g, [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
  ]);
  const cost = annualByYear(g, ["CostOfRevenue", "CostOfGoodsAndServicesSold"]);
  const grossProfit = annualByYear(g, ["GrossProfit"]);
  const rd = annualByYear(g, ["ResearchAndDevelopmentExpense"]);
  const sga = annualByYear(g, [
    "SellingGeneralAndAdministrativeExpense",
    "SellingGeneralAndAdministrationExpense",
  ]);
  const opInc = annualByYear(g, ["OperatingIncomeLoss"]);
  const da = annualByYear(g, [
    "DepreciationDepletionAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "Depreciation",
  ]);
  const tax = annualByYear(g, ["IncomeTaxExpenseBenefit"]);
  const ni = annualByYear(g, ["NetIncomeLoss", "ProfitLoss"]);
  const epsBasic = annualByYear(g, ["EarningsPerShareBasic"]);
  const epsDiluted = annualByYear(g, ["EarningsPerShareDiluted"]);

  const assets = annualByYear(g, ["Assets"]);
  const currentAssets = annualByYear(g, ["AssetsCurrent"]);
  const liabilities = annualByYear(g, ["Liabilities"]);
  const currentLiabilities = annualByYear(g, ["LiabilitiesCurrent"]);
  const equity = annualByYear(g, ["StockholdersEquity"]);
  const cash = annualByYear(g, ["CashAndCashEquivalentsAtCarryingValue"]);
  const ltDebt = annualByYear(g, ["LongTermDebtNoncurrent", "LongTermDebt"]);

  const ocf = annualByYear(g, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);
  const capex = annualByYear(g, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ]);
  const dividendsPaid = annualByYear(g, ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"]);

  // Fiscal-year axis anchored on revenue (every filer reports it).
  const years = [...rev.keys()].sort((a, b) => b - a).slice(0, 5);
  const row = (
    label: string,
    m: Map<number, number>,
    derive?: (y: number) => number | null
  ): FinRow => ({
    label,
    values: years.map((y) => m.get(y) ?? derive?.(y) ?? null),
  });

  const income: FinRow[] = [
    row("Revenue", rev),
    row("Cost of Revenue", cost),
    row("Gross Profit", grossProfit, (y) => {
      const r = rev.get(y);
      const c = cost.get(y);
      return r != null && c != null ? r - c : null;
    }),
    row("R&D", rd),
    row("SG&A", sga),
    row("Operating Income", opInc),
    row("EBITDA", empty, (y) => {
      const o = opInc.get(y);
      const d = da.get(y);
      return o != null && d != null ? o + d : null;
    }),
    row("EBIT", opInc),
    row("Income Tax", tax),
    row("Net Income", ni),
    row("EPS (basic)", epsBasic),
    row("EPS (diluted)", epsDiluted),
  ];

  const balance: FinRow[] = [
    row("Total Assets", assets),
    row("Current Assets", currentAssets),
    row("Total Liabilities", liabilities),
    row("Current Liabilities", currentLiabilities),
    row("Long-Term Debt", ltDebt),
    row("Cash & Equivalents", cash),
    row("Shareholders' Equity", equity),
  ];

  const cashflow: FinRow[] = [
    row("Operating Cash Flow", ocf),
    row("CapEx", capex),
    row("Free Cash Flow", empty, (y) => {
      const o = ocf.get(y);
      const c = capex.get(y);
      return o != null && c != null ? o - c : null;
    }),
    row("Dividends Paid", dividendsPaid),
  ];

  return { years: years.map((y) => `FY${y}`), income, balance, cashflow };
}

// ── Wikipedia profile (CEO, employees, HQ, website, description) ─────────────

const WIKI_HEADERS = { "User-Agent": "Asset-Manager/1.0 (personal investment dashboard)" };

function cleanWiki(s: string): string {
  return s
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/\{\{(?:URL|url)\|([^|}]+)/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function infoboxField(wikitext: string, names: string[]): string | null {
  for (const n of names) {
    // Stop at the next "| field =" line (allowing whitespace around the pipe).
    const m = wikitext.match(new RegExp(`\\|\\s*${n}\\s*=([\\s\\S]*?)(?=\\n[ \\t]*\\|[ \\t]*[a-zA-Z_0-9]+[ \\t]*=|\\n[ \\t]*\\}\\})`));
    if (m && m[1].trim()) return m[1];
  }
  return null;
}

interface WikiProfile {
  ceo: string | null;
  employees: number | null;
  hq: string | null;
  website: string | null;
  description: string | null;
}

const wikiCache = new Map<string, { t: number; v: WikiProfile }>();

async function fetchWikiProfile(companyName: string): Promise<WikiProfile> {
  const empty: WikiProfile = { ceo: null, employees: null, hq: null, website: null, description: null };
  const key = companyName.trim().toLowerCase();
  if (!key) return empty;
  const hit = wikiCache.get(key);
  if (hit && Date.now() - hit.t < 7 * 24 * 3600_000) return hit.v;

  try {
    // Resolve the article title from the company name.
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(companyName)}&limit=1&format=json`,
      { headers: WIKI_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (!searchRes.ok) throw new Error(`wiki search ${searchRes.status}`);
    const searchJson = (await searchRes.json()) as [string, string[]];
    const title = searchJson[1]?.[0];
    if (!title) throw new Error("no wikipedia article");

    const [parseRes, summaryRes] = await Promise.all([
      fetch(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&section=0`,
        { headers: WIKI_HEADERS, signal: AbortSignal.timeout(8000) }
      ),
      fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: WIKI_HEADERS, signal: AbortSignal.timeout(8000) }
      ),
    ]);

    let profile: WikiProfile = { ...empty };
    if (parseRes.ok) {
      const parseJson = (await parseRes.json()) as { parse?: { wikitext?: { "*": string } } };
      const w = parseJson.parse?.wikitext?.["*"] ?? "";
      const employeesRaw = infoboxField(w, ["num_employees", "employees"]);
      const employeesNum = employeesRaw?.match(/([\d,]{3,})/)?.[1];
      const hqCity = infoboxField(w, ["hq_location_city", "location_city"]);
      const hqCountry = infoboxField(w, ["hq_location_country", "location_country"]);
      const websiteRaw = infoboxField(w, ["website"]);
      const websiteUrl = websiteRaw?.match(/\{\{(?:URL|url)\|([^|}]+)/)?.[1]?.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const keyPeople = infoboxField(w, ["key_people"]) ?? "";
      const ceoLine =
        keyPeople.split("\n").find((l) => /\bCEO\b|chief executive officer/i.test(l)) ?? "";
      const ceoMatch = ceoLine.match(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/);

      profile = {
        ceo: ceoMatch?.[1]?.trim() ?? null,
        employees: employeesNum ? Number(employeesNum.replace(/,/g, "")) : null,
        hq: [hqCity, hqCountry]
          .map((x) => (x ? cleanWiki(x) : ""))
          .filter(Boolean)
          .join(", ") || null,
        website: websiteUrl ?? null,
        description: null,
      };
    }
    if (summaryRes.ok) {
      const summaryJson = (await summaryRes.json()) as { extract?: string };
      profile.description = summaryJson.extract ?? null;
    }

    wikiCache.set(key, { t: Date.now(), v: profile });
    return profile;
  } catch (err) {
    logger.warn({ companyName, err }, "Wikipedia profile unavailable");
    wikiCache.set(key, { t: Date.now(), v: empty });
    return empty;
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const detailTTL = 15 * 60 * 1000;
const detailCache = new Map<string, { t: number; v: StockDetail | null }>();

export async function getStockDetail(symbolRaw: string): Promise<StockDetail | null> {
  const symbol = symbolRaw.toUpperCase().trim();
  if (!symbol) return null;
  const hit = detailCache.get(symbol);
  if (hit && Date.now() - hit.t < detailTTL) return hit.v;

  try {
    const quote = await fetchQuoteStats(symbol); // throws for unknown tickers

    const [tvRes, secRes, wikiRes] = await Promise.allSettled([
      getTVStockInfo(symbol),
      (async () => {
        const map = await secTickerMap();
        const entry = map.get(symbol);
        if (!entry) return null;
        const facts = await secCompanyFacts(entry.cik);
        return buildStatements(facts);
      })(),
      fetchWikiProfile(quote.name ?? symbol),
    ]);

    const tv = tvRes.status === "fulfilled" ? tvRes.value : null;
    const statements = secRes.status === "fulfilled" ? secRes.value : null;
    const wiki = wikiRes.status === "fulfilled" ? wikiRes.value : null;

    // Key metrics: TradingView TTM/fresh-quarter items, ratios computed from
    // the latest filed fiscal year when TradingView doesn't carry them.
    const i = statements?.income ?? [];
    const b = statements?.balance ?? [];
    const last = (rows: FinRow[], label: string): number | null =>
      rows.find((r) => r.label === label)?.values[0] ?? null;
    const revenue = last(i, "Revenue");
    const netIncome = last(i, "Net Income");
    const grossProfit = last(i, "Gross Profit");
    const operatingIncome = last(i, "Operating Income");
    const ebitda = last(i, "EBITDA");
    const totalAssets = last(b, "Total Assets");
    const equityV = last(b, "Shareholders' Equity");
    const ltDebtV = last(b, "Long-Term Debt");

    const ratio = (a: number | null, bb: number | null): number | null =>
      a != null && bb != null && bb !== 0 ? a / bb : null;
    const pct = (a: number | null, bb: number | null): number | null => {
      const r = ratio(a, bb);
      return r == null ? null : r * 100;
    };

    const metrics: StockMetrics = {
      pe: tv?.pe ?? null,
      peg: null, // forward estimates aren't available from our sources
      ps: ratio(tv?.marketCap ?? null, revenue),
      pb: tv?.pb ?? null,
      evEbitda: ratio(tv?.enterpriseValue ?? null, ebitda),
      evSales: ratio(tv?.enterpriseValue ?? null, revenue),
      divYield: tv?.dividendYield ?? null,
      roe: tv?.roe ?? pct(netIncome, equityV),
      roa: pct(netIncome, totalAssets),
      grossMargin: pct(grossProfit, revenue),
      opMargin: pct(operatingIncome, revenue),
      netMargin: pct(netIncome, revenue),
      debtEquity: pct(ltDebtV, equityV),
      currentRatio: tv?.currentRatio ?? null,
      enterpriseValue: tv?.enterpriseValue ?? null,
    };

    const profile: StockProfile = {
      sector: tv?.sector ?? null,
      industry: tv?.industry ?? null,
      ceo: wiki?.ceo ?? null,
      employees: wiki?.employees ?? null,
      hq: wiki?.hq ?? null,
      website: wiki?.website ?? null,
      description: wiki?.description ?? null,
    };

    const detail: StockDetail = {
      symbol,
      name: quote.name,
      exchange: quote.exchange,
      currency: quote.currency,
      instrumentType: quote.instrumentType,
      price: quote.price,
      changeAbs: quote.changeAbs,
      changePct: quote.changePct,
      open: quote.open,
      prevClose: quote.prevClose,
      dayHigh: quote.dayHigh,
      dayLow: quote.dayLow,
      volume: quote.volume,
      marketCap: tv?.marketCap ?? null,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      ma50: quote.ma50,
      ma200: quote.ma200,
      profile,
      metrics,
      statements: statements ?? { years: [], income: [], balance: [], cashflow: [] },
      updatedAt: new Date().toISOString(),
    };

    detailCache.set(symbol, { t: Date.now(), v: detail });
    return detail;
  } catch (err) {
    logger.warn({ symbol, err }, "stock detail unavailable");
    detailCache.set(symbol, { t: Date.now(), v: null });
    return null;
  }
}

// ── Interactive chart history ────────────────────────────────────────────────

export type HistoryRange = "1D" | "5D" | "1M" | "3M" | "1Y" | "5Y" | "ALL";

const RANGE_CFG: Record<HistoryRange, { def: string; allowed: string[] }> = {
  "1D": { def: "5m", allowed: ["1m", "2m", "5m", "15m", "30m"] },
  "5D": { def: "30m", allowed: ["5m", "15m", "30m", "1h"] },
  "1M": { def: "1h", allowed: ["30m", "1h", "1d"] },
  "3M": { def: "1d", allowed: ["1h", "1d"] },
  "1Y": { def: "1d", allowed: ["1d", "1wk"] },
  "5Y": { def: "1wk", allowed: ["1d", "1wk", "1mo"] },
  ALL: { def: "1mo", allowed: ["1mo", "3mo"] },
};

const historyTTL = 60 * 1000;
const historyCache = new Map<string, { t: number; v: HistoryData | null }>();

// yahoo-finance2 validates ChartOptions against period1/period2 (range alone
// fails schema validation), so translate our range labels into dates.
const RANGE_DAYS: Record<HistoryRange, number> = {
  "1D": 1,
  "5D": 5,
  "1M": 31,
  "3M": 92,
  "1Y": 365,
  "5Y": 365 * 5,
  ALL: 60 * 365,
};

export async function getStockHistory(
  symbolRaw: string,
  rangeRaw: string,
  intervalRaw?: string
): Promise<HistoryData | null> {
  const symbol = symbolRaw.toUpperCase().trim();
  const range = (Object.keys(RANGE_CFG) as HistoryRange[]).includes(rangeRaw.toUpperCase() as HistoryRange)
    ? (rangeRaw.toUpperCase() as HistoryRange)
    : "1Y";
  const cfg = RANGE_CFG[range];
  const interval = intervalRaw && cfg.allowed.includes(intervalRaw) ? intervalRaw : cfg.def;
  const key = `${symbol}|${range}|${interval}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.t < historyTTL) return hit.v;

  try {
    const period1 = new Date(Date.now() - RANGE_DAYS[range] * 86400_000);
    const result = await yahooFinance.chart(symbol, { period1, period2: new Date(), interval });
    const meta = result.meta ?? {};
    const bars: HistoryBar[] = [];
    for (const q of result.quotes ?? []) {
      if (q.close == null) continue;
      bars.push({
        t: new Date(q.date).toISOString(),
        o: (q.open as number) ?? null,
        h: (q.high as number) ?? null,
        l: (q.low as number) ?? null,
        c: q.close as number,
        v: (q.volume as number) ?? null,
      });
    }
    const data: HistoryData = {
      symbol,
      range,
      interval,
      bars,
      currency: (meta.currency as string) || null,
      exchange: (meta.exchangeName as string) || null,
      instrumentType: (meta.instrumentType as string) || null,
    };
    historyCache.set(key, { t: Date.now(), v: data });
    return data;
  } catch (err) {
    logger.warn({ symbol, range, interval, err }, "stock history unavailable");
    historyCache.set(key, { t: Date.now(), v: null });
    return null;
  }
}
