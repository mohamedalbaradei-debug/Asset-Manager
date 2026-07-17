// eslint-disable-next-line @typescript-eslint/no-explicit-any
import YahooFinanceClass from "yahoo-finance2";
import { logger } from "./logger";

// yahoo-finance2 v4: the default export is a class, must be instantiated
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yahooFinance = new (YahooFinanceClass as any)();

// ── Technical indicator helpers ──────────────────────────────────────────────

function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    emas.push(values[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

function calcSMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

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

function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number; signal: number; histogram: number } {
  if (closes.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const ema12 = calcEMA(closes, fast);
  const ema26 = calcEMA(closes, slow);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine.slice(slow - 1), signal);
  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  return {
    macd: lastMACD,
    signal: lastSignal,
    histogram: lastMACD - lastSignal,
  };
}

function explainRSI(rsi: number): string {
  if (rsi > 70) return `Overbought (${rsi.toFixed(1)}) — may pull back`;
  if (rsi < 30) return `Oversold (${rsi.toFixed(1)}) — may bounce`;
  return `Neutral (${rsi.toFixed(1)})`;
}

function explainMACD(macd: number, signal: number): string {
  return macd > signal ? "Bullish momentum — MACD above signal" : "Bearish momentum — MACD below signal";
}

function explainSMA(price: number, sma: number, period: number): string {
  if (price > sma) return `Price above ${period}-day SMA ($${sma.toFixed(2)}) — bullish trend`;
  return `Price below ${period}-day SMA ($${sma.toFixed(2)}) — bearish trend`;
}

function calcRecommendation(
  rsi: number,
  macd: number,
  macdSignal: number,
  price: number,
  sma50: number,
  sma200: number
): { recommendation: string; score: number } {
  let score = 0;
  if (rsi < 30) score += 1;
  if (rsi > 70) score -= 1;
  if (macd > macdSignal) score += 1;
  else score -= 1;
  if (price > sma50) score += 0.5;
  else score -= 0.5;
  if (price > sma200) score += 0.5;
  else score -= 0.5;

  let recommendation: string;
  if (score >= 2.5) recommendation = "STRONG BUY";
  else if (score >= 1) recommendation = "BUY";
  else if (score >= -0.5) recommendation = "HOLD";
  else if (score >= -2) recommendation = "SELL";
  else recommendation = "STRONG SELL";

  return { recommendation, score };
}

// ── History helper ───────────────────────────────────────────────────────────

async function fetchHistory(symbol: string, period: "3mo" | "6mo"): Promise<{ date: Date; close: number }[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - (period === "6mo" ? 6 : 3));

  const result = await yahooFinance.chart(symbol, {
    period1: since,
    interval: "1d",
  });

  return (result.quotes ?? [])
    .filter((q) => q.close != null)
    .map((q) => ({ date: new Date(q.date), close: q.close as number }));
}

// ── Main analysis ────────────────────────────────────────────────────────────

export interface AnalysisResult {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
  priceChange: number | null;
  priceChangePct: number | null;
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  sma50: number;
  sma200: number;
  support: number;
  resistance: number;
  peRatio: number | null;
  eps: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  explanations: { rsi: string; macd: string; sma50: string; sma200: string };
  historicalData: Array<{
    date: string;
    price: number;
    priceNorm: number;
    spyPriceNorm: number | null;
  }>;
  news: string[];
  recommendation: string;
  score: number;
}

export async function analyzeStock(tickerRaw: string): Promise<AnalysisResult> {
  const ticker = tickerRaw.toUpperCase().trim();

  // Fetch ticker and SPY history in parallel
  const [history, spyHistory, summary, searchResult] = await Promise.allSettled([
    fetchHistory(ticker, "6mo"),
    fetchHistory("SPY", "6mo"),
    yahooFinance.quoteSummary(ticker, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics"],
    }),
    yahooFinance.search(ticker, { newsCount: 5 }),
  ]);

  const hist = history.status === "fulfilled" ? history.value : [];
  if (hist.length === 0) {
    throw new Error(`No data found for ticker: ${ticker}`);
  }

  const spyHist = spyHistory.status === "fulfilled" ? spyHistory.value : [];
  const sum = summary.status === "fulfilled" ? summary.value : null;
  const searchRes = searchResult.status === "fulfilled" ? searchResult.value : null;

  const closes = hist.map((h) => h.close);
  const spyCloses = spyHist.map((h) => h.close);

  const currentPrice = closes[closes.length - 1];
  const rsi = calcRSI(closes);
  const macdData = calcMACD(closes);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);

  const lows = hist.map((h) => h.close);
  const highs = hist.map((h) => h.close);
  const support = Math.min(...lows.slice(-60));
  const resistance = Math.max(...highs.slice(-60));

  // Build normalized historical data (rebase to 100 at start)
  const basePrice = closes[0];
  const baseSpy = spyCloses[0] ?? null;

  const historicalData = hist.map((h, i) => {
    const spyClose = spyCloses[i] ?? null;
    return {
      date: h.date.toISOString().split("T")[0],
      price: h.close,
      priceNorm: (h.close / basePrice) * 100,
      spyPriceNorm: spyClose != null && baseSpy != null ? (spyClose / baseSpy) * 100 : null,
    };
  });

  // Extract fundamentals from summary
  const price = sum?.price ?? null;
  const summaryDetail = sum?.summaryDetail ?? null;
  const keyStats = sum?.defaultKeyStatistics ?? null;

  const priceChange = price?.regularMarketChange ?? null;
  const priceChangePct = price?.regularMarketChangePercent != null
    ? price.regularMarketChangePercent * 100
    : null;

  const peRatio: number | null =
    (summaryDetail?.trailingPE as number | undefined) ??
    (keyStats?.trailingEps != null && keyStats.trailingEps !== 0
      ? currentPrice / (keyStats.trailingEps as number)
      : null);

  const eps: number | null = (keyStats?.trailingEps as number | undefined) ?? null;
  const dividendYield: number | null = summaryDetail?.dividendYield != null
    ? (summaryDetail.dividendYield as number) * 100
    : null;
  const marketCap: number | null = (price?.marketCap as number | undefined) ?? null;
  const volume: number | null = (price?.regularMarketVolume as number | undefined) ?? null;
  const avgVolume: number | null = (summaryDetail?.averageVolume as number | undefined) ?? null;
  const fiftyTwoWeekHigh: number | null = (summaryDetail?.fiftyTwoWeekHigh as number | undefined) ?? null;
  const fiftyTwoWeekLow: number | null = (summaryDetail?.fiftyTwoWeekLow as number | undefined) ?? null;
  const companyName: string | null = (price?.longName as string | undefined) ?? (price?.shortName as string | undefined) ?? null;

  const { recommendation, score } = calcRecommendation(
    rsi,
    macdData.macd,
    macdData.signal,
    currentPrice,
    sma50,
    sma200
  );

  // News
  const news: string[] = [];
  if (searchRes?.news) {
    for (const item of searchRes.news.slice(0, 5)) {
      if (typeof item.title === "string") news.push(item.title);
    }
  }
  if (news.length === 0) news.push("No recent news available.");

  const explanations = {
    rsi: explainRSI(rsi),
    macd: explainMACD(macdData.macd, macdData.signal),
    sma50: explainSMA(currentPrice, sma50, 50),
    sma200: explainSMA(currentPrice, sma200, 200),
  };

  logger.debug({ ticker, rsi, recommendation }, "Stock analysis complete");

  return {
    ticker,
    companyName,
    currentPrice,
    priceChange,
    priceChangePct,
    rsi,
    macd: macdData,
    sma50,
    sma200,
    support,
    resistance,
    peRatio,
    eps,
    dividendYield,
    marketCap,
    volume,
    avgVolume,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    explanations,
    historicalData,
    news,
    recommendation,
    score,
  };
}

// ── Trending tickers ─────────────────────────────────────────────────────────

const TRENDING_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "SPY", "QQQ", "JPM",
];

export interface TrendingTickerData {
  symbol: string;
  name: string | null;
  price: number;
  change: number;
  changePct: number;
  marketCap: number | null;
}

export async function getTrendingTickers(): Promise<TrendingTickerData[]> {
  const results = await Promise.allSettled(
    TRENDING_SYMBOLS.map((sym) =>
      yahooFinance.quoteSummary(sym, { modules: ["price"] })
    )
  );

  return results
    .map((r, i) => {
      if (r.status !== "fulfilled") return null;
      const p = r.value.price;
      if (!p || p.regularMarketPrice == null) return null;
      return {
        symbol: TRENDING_SYMBOLS[i],
        name: (p.longName as string | undefined) ?? (p.shortName as string | undefined) ?? null,
        price: p.regularMarketPrice as number,
        change: (p.regularMarketChange as number | undefined) ?? 0,
        changePct: p.regularMarketChangePercent != null
          ? (p.regularMarketChangePercent as number) * 100
          : 0,
        marketCap: (p.marketCap as number | undefined) ?? null,
      };
    })
    .filter((t): t is TrendingTickerData => t !== null);
}

// ── Breadth calculation ──────────────────────────────────────────────────────

const MEGA_CAP_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "JPM", "JNJ",
];

export async function calcMarketBreadth(): Promise<{
  aboveSMA50Pct: number;
  vix: number | null;
  tnxYield: number | null;
  fvxYield: number | null;
  yieldSpread: number | null;
}> {
  const since = new Date();
  since.setMonth(since.getMonth() - 3);

  const [megaResults, vixResult, tnxResult, fvxResult] = await Promise.allSettled([
    Promise.allSettled(
      MEGA_CAP_SYMBOLS.map(async (sym) => {
        const h = await fetchHistory(sym, "3mo");
        if (h.length < 50) return false;
        const closes = h.map((d) => d.close);
        const sma50 = calcSMA(closes, 50);
        return closes[closes.length - 1] > sma50;
      })
    ),
    yahooFinance.quoteSummary("^VIX", { modules: ["price"] }),
    yahooFinance.quoteSummary("^TNX", { modules: ["price"] }),
    yahooFinance.quoteSummary("^FVX", { modules: ["price"] }),
  ]);

  let aboveSMA50Pct = 0;
  if (megaResults.status === "fulfilled") {
    const above = megaResults.value.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;
    aboveSMA50Pct = Math.round((above / MEGA_CAP_SYMBOLS.length) * 100 * 10) / 10;
  }

  const vix =
    vixResult.status === "fulfilled"
      ? ((vixResult.value.price?.regularMarketPrice as number | undefined) ?? null)
      : null;
  const tnx =
    tnxResult.status === "fulfilled"
      ? ((tnxResult.value.price?.regularMarketPrice as number | undefined) ?? null)
      : null;
  const fvx =
    fvxResult.status === "fulfilled"
      ? ((fvxResult.value.price?.regularMarketPrice as number | undefined) ?? null)
      : null;

  return {
    aboveSMA50Pct,
    vix,
    tnxYield: tnx,
    fvxYield: fvx,
    yieldSpread: tnx != null && fvx != null ? Math.round((tnx - fvx) * 100) / 100 : null,
  };
}
