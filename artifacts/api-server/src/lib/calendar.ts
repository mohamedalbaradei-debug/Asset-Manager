import { yahooFinance } from "./yahoo";
import { logger } from "./logger";

/**
 * Calendar: earnings + dividends for watched tickers, IPO placeholder.
 * Uses free Yahoo data; IPOs require a free FMP key (documented in the UI).
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

async function earningsFor(ticker: string): Promise<EarningsRow | null> {
  try {
    const q = await yahooFinance.quoteSummary(ticker, { modules: ["earnings"] });
    const earnings = q.earnings as
      | {
          earningsDate?: Array<{ fmt?: string }>;
          earningsChart?: {
            quarterly?: Array<{ date?: string; actual?: { raw?: number }; estimate?: { raw?: number } }>;
          };
        }
      | undefined;
    if (!earnings) return null;

    const dates = earnings.earningsDate ?? [];
    const quarterly = earnings.earningsChart?.quarterly ?? [];
    const last = quarterly[quarterly.length - 1];

    const now = Date.now();
    let date: string | null = null;
    let label: EarningsRow["label"] = "unknown";

    const upcoming = dates.find((d) => {
      const t = d.fmt ? Date.parse(d.fmt) : NaN;
      return !isNaN(t) && t > now;
    });
    if (upcoming?.fmt) {
      date = upcoming.fmt;
      label = "upcoming";
    } else {
      const recent = dates[dates.length - 1];
      if (recent?.fmt) {
        date = recent.fmt;
        label = "recent";
      }
    }

    return {
      ticker,
      date,
      epsEstimate: last?.estimate?.raw ?? null,
      epsActual: last?.actual?.raw ?? null,
      label,
    };
  } catch (err) {
    logger.warn({ err, ticker }, "Earnings fetch failed");
    return null;
  }
}

async function dividendsFor(ticker: string): Promise<DividendRow | null> {
  try {
    const q = await yahooFinance.quoteSummary(ticker, {
      modules: ["defaultKeyStatistics", "summaryDetail"],
    });
    const ks = q.defaultKeyStatistics as
      | { dividendRate?: { raw?: number }; dividendYield?: { raw?: number } }
      | undefined;
    const sd = q.summaryDetail as
      | { exDividendDate?: { raw?: number; fmt?: string }; dividendDate?: { raw?: number; fmt?: string }; dividendRate?: { raw?: number } }
      | undefined;

    const amount = (sd?.dividendRate?.raw ?? ks?.dividendRate?.raw ?? null) as number | null;
    const exDate = sd?.exDividendDate?.fmt ?? null;
    const payDate = sd?.dividendDate?.fmt ?? null;
    if (amount == null && !exDate && !payDate) return null;

    return { ticker, amount, exDate, payDate, frequency: null };
  } catch (err) {
    logger.warn({ err, ticker }, "Dividend fetch failed");
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