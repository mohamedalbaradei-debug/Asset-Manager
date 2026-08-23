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
// Wrong prefixes simply drop out of the scanner response — safe to extend.
const UNIVERSE: Array<{ tv: string; ticker: string; category: string }> = [
  // US broad equity
  { tv: "AMEX:SPY", ticker: "SPY", category: "US Broad Equity" },
  { tv: "AMEX:VOO", ticker: "VOO", category: "US Broad Equity" },
  { tv: "NASDAQ:QQQ", ticker: "QQQ", category: "US Broad Equity" },
  { tv: "NASDAQ:QQQM", ticker: "QQQM", category: "US Broad Equity" },
  { tv: "AMEX:VTI", ticker: "VTI", category: "US Broad Equity" },
  { tv: "AMEX:DIA", ticker: "DIA", category: "US Broad Equity" },
  { tv: "AMEX:IWM", ticker: "IWM", category: "US Broad Equity" },
  { tv: "AMEX:SCHD", ticker: "SCHD", category: "US Broad Equity" },
  { tv: "AMEX:VIG", ticker: "VIG", category: "US Broad Equity" },
  { tv: "AMEX:IVE", ticker: "IVE", category: "US Broad Equity" },
  { tv: "AMEX:IVW", ticker: "IVW", category: "US Broad Equity" },
  { tv: "AMEX:MDY", ticker: "MDY", category: "US Broad Equity" },
  { tv: "NASDAQ:ONEQ", ticker: "ONEQ", category: "US Broad Equity" },
  { tv: "AMEX:RSP", ticker: "RSP", category: "US Broad Equity" },
  { tv: "AMEX:QUAL", ticker: "QUAL", category: "US Broad Equity" },
  { tv: "AMEX:MTUM", ticker: "MTUM", category: "US Broad Equity" },
  { tv: "AMEX:VLUE", ticker: "VLUE", category: "US Broad Equity" },
  { tv: "AMEX:USMV", ticker: "USMV", category: "US Broad Equity" },
  // International equity
  { tv: "NASDAQ:VXUS", ticker: "VXUS", category: "International Equity" },
  { tv: "AMEX:VEA", ticker: "VEA", category: "International Equity" },
  { tv: "AMEX:EEM", ticker: "EEM", category: "International Equity" },
  { tv: "AMEX:VWO", ticker: "VWO", category: "International Equity" },
  { tv: "AMEX:EFA", ticker: "EFA", category: "International Equity" },
  { tv: "AMEX:IEF", ticker: "IEF", category: "International Equity" },
  { tv: "AMEX:EWJ", ticker: "EWJ", category: "International Equity" },
  { tv: "AMEX:INDA", ticker: "INDA", category: "International Equity" },
  { tv: "AMEX:MCHI", ticker: "MCHI", category: "International Equity" },
  { tv: "AMEX:EWZ", ticker: "EWZ", category: "International Equity" },
  { tv: "AMEX:EWW", ticker: "EWW", category: "International Equity" },
  { tv: "AMEX:EPHE", ticker: "EPHE", category: "International Equity" },
  { tv: "AMEX:TUR", ticker: "TUR", category: "International Equity" },
  { tv: "AMEX:EWH", ticker: "EWH", category: "International Equity" },
  { tv: "AMEX:EWY", ticker: "EWY", category: "International Equity" },
  { tv: "AMEX:EWT", ticker: "EWT", category: "International Equity" },
  { tv: "AMEX:EWG", ticker: "EWG", category: "International Equity" },
  { tv: "AMEX:EWU", ticker: "EWU", category: "International Equity" },
  { tv: "AMEX:FXI", ticker: "FXI", category: "International Equity" },
  { tv: "AMEX:KWEB", ticker: "KWEB", category: "International Equity" },
  { tv: "AMEX:RSX", ticker: "RSX", category: "International Equity" },
  // Sectors
  { tv: "AMEX:XLK", ticker: "XLK", category: "Sectors" },
  { tv: "AMEX:XLF", ticker: "XLF", category: "Sectors" },
  { tv: "AMEX:XLE", ticker: "XLE", category: "Sectors" },
  { tv: "AMEX:XLV", ticker: "XLV", category: "Sectors" },
  { tv: "AMEX:XLI", ticker: "XLI", category: "Sectors" },
  { tv: "AMEX:XLY", ticker: "XLY", category: "Sectors" },
  { tv: "AMEX:XLP", ticker: "XLP", category: "Sectors" },
  { tv: "AMEX:XLU", ticker: "XLU", category: "Sectors" },
  { tv: "AMEX:XLB", ticker: "XLB", category: "Sectors" },
  { tv: "AMEX:XLRE", ticker: "XLRE", category: "Sectors" },
  { tv: "AMEX:XLC", ticker: "XLC", category: "Sectors" },
  { tv: "AMEX:VNQ", ticker: "VNQ", category: "Sectors" },
  { tv: "AMEX:IYR", ticker: "IYR", category: "Sectors" },
  { tv: "AMEX:ITB", ticker: "ITB", category: "Sectors" },
  { tv: "AMEX:IYT", ticker: "IYT", category: "Sectors" },
  { tv: "AMEX:IYE", ticker: "IYE", category: "Sectors" },
  { tv: "AMEX:OIH", ticker: "OIH", category: "Sectors" },
  { tv: "AMEX:XOP", ticker: "XOP", category: "Sectors" },
  { tv: "AMEX:KBE", ticker: "KBE", category: "Sectors" },
  { tv: "AMEX:KRE", ticker: "KRE", category: "Sectors" },
  { tv: "AMEX:IAI", ticker: "IAI", category: "Sectors" },
  // Themes & innovation
  { tv: "NASDAQ:SMH", ticker: "SMH", category: "Themes" },
  { tv: "AMEX:SOXX", ticker: "SOXX", category: "Themes" },
  { tv: "AMEX:SOXL", ticker: "SOXL", category: "Themes" },
  { tv: "AMEX:ARKK", ticker: "ARKK", category: "Themes" },
  { tv: "AMEX:ARKW", ticker: "ARKW", category: "Themes" },
  { tv: "AMEX:ARKQ", ticker: "ARKQ", category: "Themes" },
  { tv: "AMEX:ARKF", ticker: "ARKF", category: "Themes" },
  { tv: "AMEX:ARKG", ticker: "ARKG", category: "Themes" },
  { tv: "AMEX:XBI", ticker: "XBI", category: "Themes" },
  { tv: "AMEX:IBB", ticker: "IBB", category: "Themes" },
  { tv: "AMEX:IHI", ticker: "IHI", category: "Themes" },
  { tv: "AMEX:ITA", ticker: "ITA", category: "Themes" },
  { tv: "AMEX:PPA", ticker: "PPA", category: "Themes" },
  { tv: "AMEX:ICLN", ticker: "ICLN", category: "Themes" },
  { tv: "AMEX:TAN", ticker: "TAN", category: "Themes" },
  { tv: "AMEX:PBW", ticker: "PBW", category: "Themes" },
  { tv: "AMEX:URTH", ticker: "URTH", category: "Themes" },
  { tv: "NASDAQ:ROBO", ticker: "ROBO", category: "Themes" },
  { tv: "NASDAQ:CLOU", ticker: "CLOU", category: "Themes" },
  { tv: "AMEX:IPAY", ticker: "IPAY", category: "Themes" },
  { tv: "AMEX:FDN", ticker: "FDN", category: "Themes" },
  { tv: "AMEX:IGV", ticker: "IGV", category: "Themes" },
  { tv: "AMEX:WEBX", ticker: "WEBX", category: "Themes" },
  // Crypto & blockchain
  { tv: "AMEX:BITO", ticker: "BITO", category: "Crypto" },
  { tv: "AMEX:IBIT", ticker: "IBIT", category: "Crypto" },
  { tv: "AMEX:FBTC", ticker: "FBTC", category: "Crypto" },
  { tv: "AMEX:GBTC", ticker: "GBTC", category: "Crypto" },
  { tv: "AMEX:ETHE", ticker: "ETHE", category: "Crypto" },
  { tv: "AMEX:BLOK", ticker: "BLOK", category: "Crypto" },
  // Bonds & fixed income
  { tv: "NASDAQ:BND", ticker: "BND", category: "Bonds" },
  { tv: "AMEX:AGG", ticker: "AGG", category: "Bonds" },
  { tv: "NASDAQ:TLT", ticker: "TLT", category: "Bonds" },
  { tv: "AMEX:SHY", ticker: "SHY", category: "Bonds" },
  { tv: "AMEX:IEI", ticker: "IEI", category: "Bonds" },
  { tv: "AMEX:LQD", ticker: "LQD", category: "Bonds" },
  { tv: "AMEX:HYG", ticker: "HYG", category: "Bonds" },
  { tv: "AMEX:JNK", ticker: "JNK", category: "Bonds" },
  { tv: "AMEX:EMB", ticker: "EMB", category: "Bonds" },
  { tv: "AMEX:TIP", ticker: "TIP", category: "Bonds" },
  { tv: "AMEX:MUB", ticker: "MUB", category: "Bonds" },
  { tv: "NASDAQ:BIL", ticker: "BIL", category: "Bonds" },
  { tv: "AMEX:SCHO", ticker: "SCHO", category: "Bonds" },
  { tv: "AMEX:VGIT", ticker: "VGIT", category: "Bonds" },
  { tv: "AMEX:VCIT", ticker: "VCIT", category: "Bonds" },
  { tv: "AMEX:GOVT", ticker: "GOVT", category: "Bonds" },
  // Commodities & resources
  { tv: "AMEX:GLD", ticker: "GLD", category: "Commodities" },
  { tv: "AMEX:SLV", ticker: "SLV", category: "Commodities" },
  { tv: "AMEX:IAU", ticker: "IAU", category: "Commodities" },
  { tv: "AMEX:GLDM", ticker: "GLDM", category: "Commodities" },
  { tv: "AMEX:GDX", ticker: "GDX", category: "Commodities" },
  { tv: "AMEX:GDXJ", ticker: "GDXJ", category: "Commodities" },
  { tv: "AMEX:USO", ticker: "USO", category: "Commodities" },
  { tv: "AMEX:UCO", ticker: "UCO", category: "Commodities" },
  { tv: "AMEX:UNG", ticker: "UNG", category: "Commodities" },
  { tv: "AMEX:DBC", ticker: "DBC", category: "Commodities" },
  { tv: "AMEX:PDBC", ticker: "PDBC", category: "Commodities" },
  { tv: "AMEX:COMT", ticker: "COMT", category: "Commodities" },
  { tv: "AMEX:COPX", ticker: "COPX", category: "Commodities" },
  { tv: "AMEX:URA", ticker: "URA", category: "Commodities" },
  { tv: "AMEX:DBA", ticker: "DBA", category: "Commodities" },
  { tv: "AMEX:WEAT", ticker: "WEAT", category: "Commodities" },
  { tv: "AMEX:CANE", ticker: "CANE", category: "Commodities" },
  { tv: "AMEX:JO", ticker: "JO", category: "Commodities" },
  { tv: "AMEX:NIB", ticker: "NIB", category: "Commodities" },
  { tv: "AMEX:PALL", ticker: "PALL", category: "Commodities" },
  { tv: "AMEX:PLTM", ticker: "PLTM", category: "Commodities" },
  // Currency
  { tv: "AMEX:UUP", ticker: "UUP", category: "Currency" },
  { tv: "AMEX:UDN", ticker: "UDN", category: "Currency" },
  { tv: "AMEX:FXE", ticker: "FXE", category: "Currency" },
  { tv: "AMEX:FXY", ticker: "FXY", category: "Currency" },
  { tv: "AMEX:FXB", ticker: "FXB", category: "Currency" },
  { tv: "AMEX:FXF", ticker: "FXF", category: "Currency" },
  { tv: "AMEX:CEW", ticker: "CEW", category: "Currency" },
  // Volatility & leveraged (the "viral" ones)
  { tv: "AMEX:UVXY", ticker: "UVXY", category: "Volatility & Leveraged" },
  { tv: "AMEX:VIXY", ticker: "VIXY", category: "Volatility & Leveraged" },
  { tv: "AMEX:TQQQ", ticker: "TQQQ", category: "Volatility & Leveraged" },
  { tv: "AMEX:SQQQ", ticker: "SQQQ", category: "Volatility & Leveraged" },
  { tv: "AMEX:UPRO", ticker: "UPRO", category: "Volatility & Leveraged" },
  { tv: "AMEX:SPXS", ticker: "SPXS", category: "Volatility & Leveraged" },
  { tv: "AMEX:SPXL", ticker: "SPXL", category: "Volatility & Leveraged" },
  { tv: "AMEX:LABU", ticker: "LABU", category: "Volatility & Leveraged" },
  { tv: "AMEX:LABD", ticker: "LABD", category: "Volatility & Leveraged" },
  { tv: "AMEX:NUGT", ticker: "NUGT", category: "Volatility & Leveraged" },
  { tv: "AMEX:GUSH", ticker: "GUSH", category: "Volatility & Leveraged" },
  { tv: "AMEX:DRIP", ticker: "DRIP", category: "Volatility & Leveraged" },
  { tv: "AMEX:USD", ticker: "USD", category: "Volatility & Leveraged" },
];

const CATEGORY_ORDER = [
  "US Broad Equity",
  "International Equity",
  "Sectors",
  "Themes",
  "Crypto",
  "Bonds",
  "Commodities",
  "Currency",
  "Volatility & Leveraged",
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

export type EtfSortKey =
  | "changePct"
  | "perfWeek"
  | "perfMonth1"
  | "perfMonth3"
  | "perfMonth6"
  | "perfYtd"
  | "perfYear"
  | "perf3Year"
  | "volume"
  | "expenseRatioPct";

/** Flat, filtered + ranked view over the same cached tracker data. */
export async function getEtfScan(opts: {
  sort?: string;
  dir?: string;
  category?: string;
  q?: string;
}): Promise<{ items: EtfQuote[]; updatedAt: string }> {
  const { groups, updatedAt } = await getEtfTracker();
  let items: EtfQuote[] = groups.flatMap((g) => g.etfs);
  if (opts.category && opts.category !== "all") {
    items = items.filter((e) => e.category === opts.category);
  }
  const q = (opts.q ?? "").trim().toUpperCase();
  if (q) {
    items = items.filter(
      (e) => e.ticker.includes(q) || (e.name ?? "").toUpperCase().includes(q),
    );
  }
  const sortKeys: EtfSortKey[] = [
    "changePct",
    "perfWeek",
    "perfMonth1",
    "perfMonth3",
    "perfMonth6",
    "perfYtd",
    "perfYear",
    "perf3Year",
    "volume",
    "expenseRatioPct",
  ];
  const sortKey = sortKeys.includes(opts.sort as EtfSortKey)
    ? (opts.sort as EtfSortKey)
    : "perfMonth3";
  const desc = opts.dir !== "asc";
  items = [...items].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    return desc ? bv - av : av - bv;
  });
  return { items, updatedAt };
}
