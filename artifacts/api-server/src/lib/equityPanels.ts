import { yahooFinance } from "./yahoo";
import { logger } from "./logger";

/**
 * Equity market panels: movers, sector rotation, SPY-QQQ rotation.
 * All free Yahoo Finance data.
 */

// ── Market movers ────────────────────────────────────────────────────────────

export interface Mover {
  symbol: string;
  name: string | null;
  price: number;
  changePct: number;
  change: number;
  volume: number | null;
  marketCap: number | null;
}

export interface MoversData {
  gainers: Mover[];
  losers: Mover[];
  mostActive: Mover[];
  updatedAt: string;
}

const SCREENER_IDS = ["day_gainers", "day_losers", "most_actives"] as const;

async function fetchScreener(
  id: (typeof SCREENER_IDS)[number]
): Promise<Mover[]> {
  try {
    const res = await yahooFinance.screener({ scrIds: id, count: 10 });
    const quotes = (res.quotes ?? []) as Array<{
      symbol?: string;
      longName?: string;
      shortName?: string;
      regularMarketPrice?: number;
      regularMarketChangePercent?: number;
      regularMarketChange?: number;
      regularMarketVolume?: number;
      marketCap?: number;
    }>;
    return quotes
      .filter((q) => q.symbol && q.regularMarketPrice != null)
      .map((q) => ({
        symbol: q.symbol as string,
        name: q.longName ?? q.shortName ?? null,
        price: q.regularMarketPrice as number,
        changePct: ((q.regularMarketChangePercent ?? 0) as number) * 100,
        change: (q.regularMarketChange ?? 0) as number,
        volume: (q.regularMarketVolume ?? null) as number | null,
        marketCap: (q.marketCap ?? null) as number | null,
      }));
  } catch (err) {
    logger.warn({ err, id }, "Screener fetch failed");
    return [];
  }
}

export async function getMarketMovers(): Promise<MoversData> {
  const [gainers, losers, mostActive] = await Promise.all([
    fetchScreener("day_gainers"),
    fetchScreener("day_losers"),
    fetchScreener("most_actives"),
  ]);

  return { gainers, losers, mostActive, updatedAt: new Date().toISOString() };
}

// ── Sector rotation ──────────────────────────────────────────────────────────

export const SECTOR_ETFS: Array<{ symbol: string; name: string }> = [
  { symbol: "XLK", name: "Technology" },
  { symbol: "XLC", name: "Communication Services" },
  { symbol: "XLY", name: "Consumer Discretionary" },
  { symbol: "XLP", name: "Consumer Staples" },
  { symbol: "XLE", name: "Energy" },
  { symbol: "XLF", name: "Financials" },
  { symbol: "XLV", name: "Health Care" },
  { symbol: "XLI", name: "Industrials" },
  { symbol: "XLB", name: "Materials" },
  { symbol: "XLRE", name: "Real Estate" },
  { symbol: "XLU", name: "Utilities" },
];

async function dailyCloses(symbol: string, days: number): Promise<number[]> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const result = await yahooFinance.chart(symbol, { period1: since, interval: "1d" });
    const quotes = (result.quotes ?? []) as Array<{ close?: number | null }>;
    return quotes.filter((q) => q.close != null).map((q) => q.close as number);
  } catch (err) {
    logger.warn({ err, symbol }, "Chart fetch failed for sector");
    return [];
  }
}

function pctChange(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const start = closes[closes.length - 1 - lookback];
  const end = closes[closes.length - 1];
  if (start === 0) return null;
  return ((end - start) / start) * 100;
}

export interface SectorRotationItem {
  symbol: string;
  name: string;
  change1dPct: number | null;
  change1wPct: number | null;
  change1mPct: number | null;
  relStrengthSpy: number | null; // 1w return minus SPY 1w return
}

export async function getSectorRotation(): Promise<{
  sectors: SectorRotationItem[];
  spy: { change1dPct: number | null; change1wPct: number | null };
  updatedAt: string;
}> {
  const allSymbols = [...SECTOR_ETFS.map((s) => s.symbol), "SPY"];
  const closesMap = new Map<string, number[]>();

  const results = await Promise.allSettled(allSymbols.map((s) => dailyCloses(s, 300)));
  results.forEach((r, i) => {
    closesMap.set(allSymbols[i], r.status === "fulfilled" ? r.value : []);
  });

  const spyCloses = closesMap.get("SPY") ?? [];
  const spy1w = pctChange(spyCloses, 5);

  const sectors: SectorRotationItem[] = SECTOR_ETFS.map((s) => {
    const closes = closesMap.get(s.symbol) ?? [];
    const change1wPct = pctChange(closes, 5);
    return {
      symbol: s.symbol,
      name: s.name,
      change1dPct: pctChange(closes, 1),
      change1wPct,
      change1mPct: pctChange(closes, 21),
      relStrengthSpy:
        change1wPct != null && spy1w != null ? change1wPct - spy1w : null,
    };
  });

  return {
    sectors,
    spy: { change1dPct: pctChange(spyCloses, 1), change1wPct: spy1w },
    updatedAt: new Date().toISOString(),
  };
}

// ── Watchlist summary ────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses -= changes[i];
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i];
    avgGain = (avgGain * (period - 1) + Math.max(0, ch)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -ch)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface WatchlistSummaryItem {
  symbol: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
  rsi: number | null;
}

export async function getWatchlistSummary(tickers: string[]): Promise<WatchlistSummaryItem[]> {
  const results = await Promise.allSettled(
    tickers.map(async (sym) => {
      const closes = await dailyCloses(sym, 120);
      let price: number | null = null;
      let changePct: number | null = null;
      let name: string | null = null;
      try {
        const q = await yahooFinance.quoteSummary(sym, { modules: ["price"] });
        const p = q.price as { regularMarketPrice?: number; regularMarketChangePercent?: number; longName?: string; shortName?: string } | undefined;
        price = p?.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
        changePct = p?.regularMarketChangePercent != null ? p.regularMarketChangePercent * 100 : null;
        name = p?.longName ?? p?.shortName ?? null;
      } catch {
        price = closes.length ? closes[closes.length - 1] : null;
      }
      return { symbol: sym, name, price, changePct, rsi: closes.length ? calcRSI(closes) : null };
    })
  );

  return results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((x): x is WatchlistSummaryItem => x !== null);
}

// ── SPY vs QQQ rotation ──────────────────────────────────────────────────────

export interface SpyQqqPoint {
  date: string;
  spy: number | null; // normalized to 100
  qqq: number | null;
  ratio: number | null; // SPY / QQQ raw ratio
}

export interface SpyQqqRotation {
  available: boolean;
  points: SpyQqqPoint[];
  spy1m: number | null;
  qqq1m: number | null;
  spy3m: number | null;
  qqq3m: number | null;
  signal: "growth-leading" | "value-leading" | "neutral";
  explanation: string;
}

export async function getSpyQqqRotation(): Promise<SpyQqqRotation> {
  const [spyRaw, qqqRaw] = await Promise.all([
    dailyCloses("SPY", 400),
    dailyCloses("QQQ", 400),
  ]);

  const len = Math.min(spyRaw.length, qqqRaw.length);
  if (len < 30) {
    return {
      available: false,
      points: [],
      spy1m: null,
      qqq1m: null,
      spy3m: null,
      qqq3m: null,
      signal: "neutral",
      explanation: "SPY/QQQ rotation data unavailable.",
    };
  }

  // Rebase both to 100 at the start of the window (today - ~1 year)
  const start = Math.max(0, len - 252);
  const spyBase = spyRaw[start] || 1;
  const qqqBase = qqqRaw[start] || 1;

  const points: SpyQqqPoint[] = [];
  for (let i = start; i < len; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (len - 1 - i));
    points.push({
      date: date.toISOString().slice(0, 10),
      spy: (spyRaw[i] / spyBase) * 100,
      qqq: (qqqRaw[i] / qqqBase) * 100,
      ratio: qqqRaw[i] > 0 ? spyRaw[i] / qqqRaw[i] : null,
    });
  }

  const spy1m = pctChange(spyRaw, 21);
  const qqq1m = pctChange(qqqRaw, 21);
  const spy3m = pctChange(spyRaw, 63);
  const qqq3m = pctChange(qqqRaw, 63);

  let signal: SpyQqqRotation["signal"];
  let explanation: string;
  if (qqq3m != null && spy3m != null) {
    if (qqq3m > spy3m + 2) {
      signal = "growth-leading";
      explanation =
        `QQQ (growth/tech) has outperformed SPY (broad market) by ${(qqq3m - spy3m).toFixed(1)}% over 3 months. ` +
        "Money is rotating INTO growth and technology. Beginners: this is the classic 'risk-on' regime — tech leaders carry the index higher. " +
        "Watch for it to reverse (QQQ lagging SPY) as a sign of risk-off rotation.";
    } else if (spy3m > qqq3m + 2) {
      signal = "value-leading";
      explanation =
        `SPY (broad market) has outperformed QQQ (growth/tech) by ${(spy3m - qqq3m).toFixed(1)}% over 3 months. ` +
        "Money is rotating OUT of high-growth tech into value/defensive names. Beginners: this often signals rising rates, profit-taking in tech, or defensiveness.";
    } else {
      signal = "neutral";
      explanation =
        `SPY and QQQ have moved roughly in lockstep over 3 months (SPY ${spy3m.toFixed(1)}% vs QQQ ${qqq3m.toFixed(1)}%). ` +
        "No strong rotation signal between broad market and growth right now.";
    }
  } else {
    signal = "neutral";
    explanation = "Insufficient SPY/QQQ history to compute rotation.";
  }

  return {
    available: true,
    points,
    spy1m,
    qqq1m,
    spy3m,
    qqq3m,
    signal,
    explanation,
  };
}