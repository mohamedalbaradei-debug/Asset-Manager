import { yahooFinance } from "./yahoo";
import { logger } from "./logger";
import { getTVStockInfo } from "./tvFundamentals";
import { secTickerMap, secCompanyFacts, fetchQuoteStats, type SecConcepts, type SecEntry } from "./stockDetail";

/**
 * Calendar: earnings + dividends for watched tickers, IPO placeholder.
 *
 * Datacenter-IP strategy (Yahoo blocks quoteSummary on Render):
 * - earnings dates come from SEC EDGAR 8-K filings (item 2.02 = results of
 *   operations); the next release is projected one reporting cycle ahead and
 *   labelled "upcoming" (estimated);
 * - EPS estimates come from the TradingView scanner (works everywhere);
 * - dividend yield comes from TradingView; the annual amount is derived
 *   from it via the live chart-meta price;
 * - yahooFinance.quoteSummary remains as a local-dev enrichment that fails
 *   silently when Yahoo blocks it.
 */

export interface EarningsRow {
  ticker: string;
  date: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  label: "upcoming" | "recent" | "unknown";
}

export interface DividendRow {
  ticker: string;
  amount: number | null;
  exDate: string | null;
  payDate: string | null;
  frequency: string | null;
}

export interface CalendarData {
  earnings: EarningsRow[];
  dividends: DividendRow[];
  ipos: Array<{ company: string; date: string | null; exchange: string | null; status: string }>;
  ipoNote: string;
  updatedAt: string;
}

/** Latest quarterly (≈90-day duration) EPS values by period end. */
function quarterlyEps(concepts: SecConcepts): Map<string, number> {
  const out = new Map<string, { val: number; basic: boolean }>();
  const tags = ["EarningsPerShareBasic", "EarningsPerShareDiluted"];
  tags.forEach((tag, i) => {
    const units: SecEntry[] | undefined = concepts[tag]?.units?.USD ?? Object.values(concepts[tag]?.units ?? {})[0];
    if (!units) return;
    for (const u of units) {
      if (!u.start || !u.end || typeof u.val !== "number") continue;
      if (!u.form?.startsWith("10-Q") && !u.form?.startsWith("10-K")) continue;
      const days = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
      if (days < 80 || days > 100) continue;
      const prev = out.get(u.end);
      // Basic wins over diluted for the same period end.
      if (!prev || (!prev.basic && i === 0)) out.set(u.end, { val: u.val, basic: i === 0 });
    }
  });
  return new Map([...out].map(([k, v]) => [k, v.val]));
}

interface SecSubmissionsShape {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      items?: string[];
    };
  };
}

const submissionsCache = new Map<number, { t: number; v: { date: string | null; prior: string | null } }>();

/** Two most recent earnings-release dates from 8-K item 2.02 filings. */
async function lastEarningsReleases8k(cik: number): Promise<{ date: string | null; prior: string | null }> {
  const hit = submissionsCache.get(cik);
  if (hit && Date.now() - hit.t < 6 * 3600_000) return hit.v;

  let out = { date: null as string | null, prior: null as string | null };
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
      headers: {
        "User-Agent": "Asset-Manager personal-investment-dashboard admin@asset-manager.local",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`submissions ${res.status}`);
    const d = (await res.json()) as SecSubmissionsShape;
    const r = d.filings?.recent;
    if (r?.form) {
      const hits: string[] = [];
      for (let i = 0; i < r.form.length && hits.length < 2; i++) {
        if (r.form[i] !== "8-K") continue;
        if (!(r.items?.[i] ?? "").includes("2.02")) continue;
        const dt = r.filingDate?.[i];
        if (dt) hits.push(dt);
      }
      out = { date: hits[0] ?? null, prior: hits[1] ?? null };
    }
  } catch (err) {
    logger.warn({ err, cik }, "SEC submissions unavailable");
  }
  submissionsCache.set(cik, { t: Date.now(), v: out });
  return out;
}

async function earningsFor(ticker: string): Promise<EarningsRow | null> {
  let date: string | null = null;
  let epsActual: number | null = null;
  const now = Date.now();
  let label: EarningsRow["label"] = "unknown";

  try {
    const map = await secTickerMap();
    const entry = map.get(ticker);
    if (entry) {
      const [{ date: last8k, prior }, facts] = await Promise.all([
        lastEarningsReleases8k(entry.cik),
        secCompanyFacts(entry.cik),
      ]);
      if (last8k) {
        // Project the next release one cycle ahead, anchored on the observed
        // gap between the two most recent releases when available (~91 days).
        const t = Date.parse(last8k);
        const gapDays = prior ? Math.min(180, Math.max(60, Math.round((t - Date.parse(prior)) / 86400000))) : 91;
        const next = new Date(t + gapDays * 86400_000);
        if (next.getTime() > now) {
          date = next.toISOString().split("T")[0];
          label = "upcoming"; // estimated schedule derived from filings cadence
        } else {
          date = last8k;
          label = "recent";
        }
      }
      const qeps = quarterlyEps(facts.facts?.["us-gaap"] ?? {});
      if (qeps.size > 0) {
        const latestEnd = [...qeps.keys()].sort().pop()!;
        epsActual = qeps.get(latestEnd) ?? null;
      }
    }
  } catch (err) {
    logger.warn({ err, ticker }, "EDGAR earnings enrichment failed");
  }

  // Local-only enrichment: Yahoo supplies exact upcoming dates when reachable.
  try {
    const q = await yahooFinance.quoteSummary(ticker, { modules: ["earnings"] });
    const earnings = q.earnings as { earningsDate?: Array<{ fmt?: string }> } | undefined;
    const upcoming = (earnings?.earningsDate ?? []).find((x) => {
      const t = x.fmt ? Date.parse(x.fmt) : NaN;
      return !isNaN(t) && t > now;
    });
    if (upcoming?.fmt) {
      date = upcoming.fmt;
      label = "upcoming";
    }
  } catch {
    /* expected on datacenter IPs — ignore silently */
  }

  // Consensus estimate from TradingView (works everywhere).
  let epsEstimate: number | null = null;
  try {
    const tv = await getTVStockInfo(ticker.replace(/\.(TO|L|DE|PA)$/i, ""));
    epsEstimate = tv?.epsForecast ?? null;
  } catch {
    /* ignore */
  }

  if (date == null && epsActual == null && epsEstimate == null) return null;

  return { ticker, date, epsEstimate, epsActual, label };
}

async function dividendsFor(ticker: string): Promise<DividendRow | null> {
  // TradingView yield works on datacenter IPs; amount is derived from it.
  let yieldPct: number | null = null;
  let price: number | null = null;
  try {
    const tv = await getTVStockInfo(ticker.replace(/\.(TO|L|DE|PA)$/i, ""));
    yieldPct = tv?.dividendYield ?? null;
  } catch {
    /* ignore */
  }
  try {
    const stats = await fetchQuoteStats(ticker);
    price = stats.price;
  } catch {
    /* ignore */
  }
  if (yieldPct != null && yieldPct > 0) {
    const amount = price != null ? (yieldPct / 100) * price : null;
    return { ticker, amount, exDate: null, payDate: null, frequency: null };
  }
  // Local-only fallback for exact ex/pay dates when Yahoo is reachable.
  try {
    const q = await yahooFinance.quoteSummary(ticker, {
      modules: ["defaultKeyStatistics", "summaryDetail"],
    });
    const sd = q.summaryDetail as
      | { exDividendDate?: { fmt?: string }; dividendDate?: { fmt?: string }; dividendRate?: { raw?: number } }
      | undefined;
    const amount = sd?.dividendRate?.raw ?? null;
    const exDate = sd?.exDividendDate?.fmt ?? null;
    if (amount == null && !exDate) return null;
    return { ticker, amount, exDate, payDate: sd?.dividendDate?.fmt ?? null, frequency: null };
  } catch {
    return null;
  }
}

export async function getCalendar(tickers: string[]): Promise<CalendarData> {
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase().trim()))].slice(0, 12);

  const [earningsRes, dividendRes] = await Promise.all([
    Promise.allSettled(uniq.map(earningsFor)),
    Promise.allSettled(uniq.map(dividendsFor)),
  ]);

  const earnings: EarningsRow[] = [];
  earningsRes.forEach((r) => {
    if (r.status === "fulfilled" && r.value) earnings.push(r.value);
  });
  const dividends: DividendRow[] = [];
  dividendRes.forEach((r) => {
    if (r.status === "fulfilled" && r.value) dividends.push(r.value);
  });

  return {
    earnings: earnings.sort((a, b) => {
      if (a.label === b.label) return (a.date ?? "").localeCompare(b.date ?? "");
      return a.label === "upcoming" ? -1 : 1;
    }),
    dividends,
    ipos: [],
    ipoNote:
      "IPO calendar needs a free Financial Modeling Prep API key. Get one at financialmodelingprep.com " +
      "and store it as FMP_API_KEY in Replit Secrets (or a local .env).",
    updatedAt: new Date().toISOString(),
  };
}
