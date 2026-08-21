import { logger } from "./logger";

/**
 * ETF performance tracker.
 *
 * One TradingView scanner batch returns price, daily change, trailing
 * performance windows (W/1M/3M/6M/YTD/1Y/all), expense ratios and volume for
 * a curated universe of liquid US-listed ETFs. Performance values arrive as
 * percent already (e.g. 12.22 = +12.22%).
 */

export interface EtfQuote {
  ticker: string;
  name: string | null;
  category: string;
  price: number | null;
  changePct: number | null;
  perfWeek: number | null;
  perfMonth1: number | null;
  perfMonth3: number | null;
  perfMonth6: number | null;
  perfYtd: number | null;
  perfYear: number | null;
  perf3Year: number | null;
  expenseRatioPct: number | null;
  volume: number | null;
}

export interface EtfCategoryGroup {
  category: string;
  etfs: EtfQuote[];
}

// Verified TradingView exchange prefixes (several ETFs trade OTC/NASDAQ).
const UNIVERSE: Array<{ tv: string; ticker: string; category: string }> = [
  // US broad equity
  { tv: "AMEX:SPY", ticker: "SPY", category: "US Broad Equity" },
  { tv: "AMEX:VOO", ticker: "VOO", category: "US Broad Equity" },
  { tv: "NASDAQ:QQQ", ticker: "QQQ", category: "US Broad Equity" },
  { tv: "AMEX:VTI", ticker: "VTI", category: "US Broad Equity" },
  { tv: "AMEX:DIA", ticker: "DIA", category: "US Broad Equity" },
  { tv: "AMEX:IWM", ticker: "IWM", category: "US Broad Equity" },
  { tv: "AMEX:SCHD", ticker: "SCHD", category: "US Broad Equity" },
  // International equity
  { tv: "NASDAQ:VXUS", ticker: "VXUS", category: "International Equity" },
  { tv: "AMEX:EEM", ticker: "EEM", category: "International Equity" },
  { tv: "AMEX:VWO", ticker: "VWO", category: "International Equity" },
  // Sectors & themes
  { tv: "AMEX:XLK", ticker: "XLK", category: "Sectors" },
  { tv: "AMEX:XLF", ticker: "XLF", category: "Sectors" },
  { tv: "AMEX:XLE", ticker: "XLE", category: "Sectors" },
  { tv: "AMEX:XLV", ticker: "XLV", category: "Sectors" },
  { tv: "AMEX:VNQ", ticker: "VNQ", category: "Sectors" },
  // Bonds
  { tv: "NASDAQ:BND", ticker: "BND", category: "Bonds" },
  { tv: "AMEX:AGG", ticker: "AGG", category: "Bonds" },
  { tv: "NASDAQ:TLT", ticker: "TLT", category: "Bonds" },
  // Commodities
  { tv: "AMEX:GLD", ticker: "GLD", category: "Commodities" },
  { tv: "AMEX:SLV", ticker: "SLV", category: "Commodities" },
  { tv: "AMEX:IAU", ticker: "IAU", category: "Commodities" },
];

const CATEGORY_ORDER = [
  "US Broad Equity",
  "International Equity",
  "Sectors",
  "Bonds",
  "Commodities",
];

const COLUMNS = [
  "name",
  "description",
  "close",
  "change_abs",
  "Perf.W",
  "Perf.1M",
  "Perf.3M",
  "Perf.6M",
  "Perf.YTD",
  "Perf.Y",
  "Perf.3Y",
  "expense_ratio",
  "volume",
];

const TTL = 30 * 60 * 1000; // performance windows move slowly intraday
let cache: { t: number; groups: EtfCategoryGroup[] } | null = null;

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export async function getEtfTracker(): Promise<{ groups: EtfCategoryGroup[]; updatedAt: string }> {
  if (cache && Date.now() - cache.t < TTL) {
    return { groups: cache.groups, updatedAt: new Date(cache.t).toISOString() };
  }

  const byTv = new Map<string, EtfQuote>();
  try {
    const res = await fetch("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.tradingview.com",
      },
      body: JSON.stringify({
        symbols: { tickers: UNIVERSE.map((u) => u.tv), query: { types: [] } },
        columns: COLUMNS,
      }),
    });
    if (!res.ok) throw new Error(`TV scan ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{ s: string; d: Array<string | number | null> }>;
    };
    for (const row of json.data ?? []) {
      const [name, description, close, chgAbs, w, m1, m3, m6, ytd, y, y3, ter, vol] = row.d as [
        string,
        string | null,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number | null,
        number | null,
      ];
      const prevClose = num(close) != null && num(chgAbs) != null ? (close as number) - (chgAbs as number) : null;
      byTv.set(row.s, {
        ticker: name,
        name: typeof description === "string" ? description : null,
        category: "",
        price: num(close),
        changePct:
          prevClose && prevClose > 0 && num(chgAbs) != null
            ? Math.round(((chgAbs as number) / prevClose) * 10000) / 100
            : null,
        perfWeek: num(w),
        perfMonth1: num(m1),
        perfMonth3: num(m3),
        perfMonth6: num(m6),
        perfYtd: num(ytd),
        perfYear: num(y),
        perf3Year: num(y3),
        expenseRatioPct: num(ter),
        volume: num(vol),
      });
    }
  } catch (err) {
    logger.warn({ err }, "ETF tracker fetch failed");
    if (cache) return { groups: cache.groups, updatedAt: new Date(cache.t).toISOString() };
    return { groups: [], updatedAt: new Date().toISOString() };
  }

  const groups: EtfCategoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const etfs: EtfQuote[] = [];
    for (const u of UNIVERSE) {
      if (u.category !== category) continue;
      const q = byTv.get(u.tv);
      if (q) etfs.push({ ...q, ticker: u.ticker, category });
    }
    if (etfs.length > 0) groups.push({ category, etfs });
  }

  if (groups.length > 0) cache = { t: Date.now(), groups };
  return { groups, updatedAt: new Date().toISOString() };
}
