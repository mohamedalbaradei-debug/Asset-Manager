// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { yahooFinance } from "./yahoo";
import { logger } from "./logger";
import { getGoogleNewsSentiment, getRedditSentiment } from "./newsSentiment";
import { analyzeOptionsFlow, getGreeksSnapshot } from "./optionsAnalysis";
import { getMarketInternals } from "./marketInternals";
import { fetchMacroData, type MacroEntry } from "./fredMacro";
import { getTVFundamentalsUS } from "./tvFundamentals";
import { generateAiReport } from "./groq";
import { logRecommendation } from "./storage";

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

function scoreToLabel(score: number): string {
  if (score >= 3) return "STRONG BUY";
  if (score >= 1.5) return "BUY";
  if (score >= -0.5) return "HOLD";
  if (score >= -2) return "SELL";
  return "STRONG SELL";
}

export interface RecommendationDetail {
  recommendation: string;
  score: number;
  rationale: string[];
}

function calcTraderRecommendation(
  rsi: number,
  macd: number,
  macdSignal: number,
  macdHistogram: number,
  price: number,
  sma50: number,
  support: number,
  resistance: number,
  volume: number | null,
  avgVolume: number | null,
  closes: number[]
): RecommendationDetail {
  let score = 0;
  const rationale: string[] = [];

  // RSI signal
  if (rsi < 25) {
    score += 2;
    rationale.push(`RSI at ${rsi.toFixed(1)} — deeply oversold, high-probability bounce setup`);
  } else if (rsi < 35) {
    score += 1.5;
    rationale.push(`RSI at ${rsi.toFixed(1)} — oversold territory, short-term reversal likely`);
  } else if (rsi < 45) {
    score += 0.5;
    rationale.push(`RSI at ${rsi.toFixed(1)} — below midpoint, mild bullish bias`);
  } else if (rsi > 75) {
    score -= 2;
    rationale.push(`RSI at ${rsi.toFixed(1)} — severely overbought, pullback risk is high`);
  } else if (rsi > 65) {
    score -= 1;
    rationale.push(`RSI at ${rsi.toFixed(1)} — approaching overbought, momentum may stall`);
  } else {
    rationale.push(`RSI at ${rsi.toFixed(1)} — neutral momentum zone`);
  }

  // MACD signal
  if (macd > macdSignal) {
    score += 1.5;
    rationale.push(
      `MACD (${macd.toFixed(2)}) above signal (${macdSignal.toFixed(2)}) — bullish crossover, upward momentum building`
    );
  } else {
    score -= 1.5;
    rationale.push(
      `MACD (${macd.toFixed(2)}) below signal (${macdSignal.toFixed(2)}) — bearish crossover, downward pressure`
    );
  }

  // Histogram direction (momentum acceleration)
  if (macdHistogram > 0) {
    score += 0.5;
    rationale.push(`MACD histogram positive (${macdHistogram.toFixed(2)}) — momentum is accelerating`);
  } else {
    score -= 0.5;
    rationale.push(`MACD histogram negative (${macdHistogram.toFixed(2)}) — momentum is weakening`);
  }

  // Price vs SMA50
  const pctAboveSMA50 = ((price - sma50) / sma50) * 100;
  if (price > sma50) {
    score += 1;
    rationale.push(
      `Price (${price.toFixed(2)}) is ${pctAboveSMA50.toFixed(1)}% above 50-day SMA (${sma50.toFixed(2)}) — short-term uptrend intact`
    );
  } else {
    score -= 1;
    rationale.push(
      `Price (${price.toFixed(2)}) is ${Math.abs(pctAboveSMA50).toFixed(1)}% below 50-day SMA (${sma50.toFixed(2)}) — short-term downtrend`
    );
  }

  // Support / resistance proximity
  const distToSupport = ((price - support) / price) * 100;
  const distToResistance = ((resistance - price) / price) * 100;
  if (distToSupport < 3) {
    score += 1;
    rationale.push(
      `Price is ${distToSupport.toFixed(1)}% above support (${support.toFixed(2)}) — strong entry near floor`
    );
  } else if (distToResistance < 3) {
    score -= 1;
    rationale.push(
      `Price is ${distToResistance.toFixed(1)}% below resistance (${resistance.toFixed(2)}) — approaching a potential ceiling`
    );
  }

  // Volume confirmation
  if (volume != null && avgVolume != null && avgVolume > 0) {
    const volRatio = volume / avgVolume;
    if (volRatio > 1.5) {
      score += 0.5;
      rationale.push(
        `Volume is ${volRatio.toFixed(1)}x the 30-day average — strong conviction behind current move`
      );
    } else if (volRatio < 0.5) {
      score -= 0.5;
      rationale.push(`Volume is only ${(volRatio * 100).toFixed(0)}% of average — weak participation, less reliable signal`);
    }
  }

  // Short-term 5-day momentum
  if (closes.length >= 6) {
    const momentum = ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
    if (momentum > 3) {
      score += 0.5;
      rationale.push(`5-day price momentum: +${momentum.toFixed(1)}% — strong short-term upswing`);
    } else if (momentum < -3) {
      score -= 0.5;
      rationale.push(`5-day price momentum: ${momentum.toFixed(1)}% — sharp short-term decline`);
    }
  }

  return { recommendation: scoreToLabel(score), score, rationale };
}

function calcInvestorRecommendation(
  rsi: number,
  price: number,
  sma50: number,
  sma200: number,
  peRatio: number | null,
  eps: number | null,
  dividendYield: number | null,
  fiftyTwoWeekHigh: number | null,
  fiftyTwoWeekLow: number | null,
): RecommendationDetail {
  let score = 0;
  const rationale: string[] = [];

  // Long-term trend: SMA200
  const pctAboveSMA200 = ((price - sma200) / sma200) * 100;
  if (price > sma200) {
    score += 1.5;
    rationale.push(
      `Price (${price.toFixed(2)}) is ${pctAboveSMA200.toFixed(1)}% above 200-day SMA (${sma200.toFixed(2)}) — long-term uptrend confirmed`
    );
  } else {
    score -= 1.5;
    rationale.push(
      `Price (${price.toFixed(2)}) is ${Math.abs(pctAboveSMA200).toFixed(1)}% below 200-day SMA (${sma200.toFixed(2)}) — long-term downtrend, caution warranted`
    );
  }

  // Golden / Death cross
  if (sma50 > sma200) {
    score += 1;
    rationale.push(
      `Golden Cross active — 50-day SMA (${sma50.toFixed(2)}) above 200-day SMA (${sma200.toFixed(2)}), a classic long-term bullish signal`
    );
  } else {
    score -= 1;
    rationale.push(
      `Death Cross active — 50-day SMA (${sma50.toFixed(2)}) below 200-day SMA (${sma200.toFixed(2)}), a classic long-term bearish signal`
    );
  }

  // Valuation via P/E
  if (peRatio != null) {
    if (peRatio < 12) {
      score += 2;
      rationale.push(`P/E ratio of ${peRatio.toFixed(1)} is very low — stock appears deeply undervalued relative to earnings`);
    } else if (peRatio < 20) {
      score += 1;
      rationale.push(`P/E ratio of ${peRatio.toFixed(1)} is reasonable — fair value with upside potential`);
    } else if (peRatio < 30) {
      rationale.push(`P/E ratio of ${peRatio.toFixed(1)} is moderate — priced for growth, not a value play`);
    } else if (peRatio < 50) {
      score -= 1;
      rationale.push(`P/E ratio of ${peRatio.toFixed(1)} is elevated — stock carries a growth premium, higher risk if earnings disappoint`);
    } else {
      score -= 2;
      rationale.push(`P/E ratio of ${peRatio.toFixed(1)} is very high — significant earnings growth must materialise to justify price`);
    }
  }

  // EPS
  if (eps != null) {
    if (eps > 0) {
      rationale.push(`EPS of ${eps.toFixed(2)} — company is profitable on a trailing basis`);
    } else {
      score -= 1;
      rationale.push(`Negative EPS (${eps.toFixed(2)}) — company is not yet profitable; speculative investment`);
    }
  }

  // 52-week positioning
  if (fiftyTwoWeekHigh != null && fiftyTwoWeekLow != null) {
    const range = fiftyTwoWeekHigh - fiftyTwoWeekLow;
    if (range > 0) {
      const positionPct = ((price - fiftyTwoWeekLow) / range) * 100;
      if (positionPct < 25) {
        score += 1.5;
        rationale.push(
          `Price is in the bottom 25% of its 52-week range (${fiftyTwoWeekLow.toFixed(2)}–${fiftyTwoWeekHigh.toFixed(2)}) — potentially oversold on a yearly basis, attractive entry`
        );
      } else if (positionPct > 80) {
        score -= 1;
        rationale.push(
          `Price is in the top 20% of its 52-week range (${fiftyTwoWeekLow.toFixed(2)}–${fiftyTwoWeekHigh.toFixed(2)}) — near yearly highs, limited upside margin`
        );
      } else {
        rationale.push(
          `Price is at ${positionPct.toFixed(0)}% of its 52-week range (${fiftyTwoWeekLow.toFixed(2)}–${fiftyTwoWeekHigh.toFixed(2)}) — mid-range positioning`
        );
      }
    }
  }

  // Dividend yield — income bonus
  if (dividendYield != null && dividendYield > 0) {
    if (dividendYield > 4) {
      score += 1;
      rationale.push(`Dividend yield of ${dividendYield.toFixed(2)}% is high — strong income component suitable for buy-and-hold`);
    } else if (dividendYield > 1.5) {
      score += 0.5;
      rationale.push(`Dividend yield of ${dividendYield.toFixed(2)}% provides a steady income cushion`);
    }
  } else {
    rationale.push(`No dividend — returns are purely price-appreciation driven`);
  }

  // RSI as long-term sentiment gauge
  if (rsi < 35) {
    score += 1;
    rationale.push(`RSI at ${rsi.toFixed(1)} — selling pressure may be exhausted, historically a good long-term accumulation zone`);
  } else if (rsi > 70) {
    score -= 0.5;
    rationale.push(`RSI at ${rsi.toFixed(1)} — overbought on technicals; patient investors may wait for a better entry`);
  }

  return { recommendation: scoreToLabel(score), score, rationale };
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
    .filter((q: { close?: number | null }) => q.close != null)
    .map((q: { date: Date | number; close: number }) => ({ date: new Date(q.date), close: q.close as number }));
}

// One year of daily OHLC for the candlestick chart (volumes tracked separately
// for the volume/avgVolume stats).
async function fetchOhlc1y(
  symbol: string,
): Promise<{ candles: Array<{ date: string; open: number; high: number; low: number; close: number }>; volumes: number[] }> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const result = await yahooFinance.chart(symbol, {
    period1: since,
    interval: "1d",
  });

  const candles: Array<{ date: string; open: number; high: number; low: number; close: number }> = [];
  const volumes: number[] = [];
  for (const q of result.quotes ?? []) {
    if (q.open != null && q.high != null && q.low != null && q.close != null) {
      candles.push({
        date: new Date(q.date).toISOString().split("T")[0],
        open: q.open as number,
        high: q.high as number,
        low: q.low as number,
        close: q.close as number,
      });
      volumes.push((q.volume as number) ?? 0);
    }
  }
  return { candles, volumes };
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
  ohlc1y: Array<{ date: string; open: number; high: number; low: number; close: number }>;
  news: string[];
  recommendation: string;
  score: number;
  traderRec: RecommendationDetail;
  investorRec: RecommendationDetail;
  fairValue: {
    targetMeanPrice: number | null;
    percentDifference: number | null;
    label: string;
    explanation: string;
  } | null;
  priceVsEps: { dates: string[]; eps: number[]; price: number[] } | null;
  newsSentiment: {
    available: boolean;
    compound: number;
    label: "Bullish" | "Neutral" | "Bearish";
    explanation: string;
    headlines: Array<{ title: string; score: number; label: string }>;
    source: string;
  } | null;
  socialSentiment: {
    available: boolean;
    compound: number;
    label: "Bullish" | "Neutral" | "Bearish";
    explanation: string;
    headlines: Array<{ title: string; score: number; label: string }>;
    source: string;
  } | null;
  marketInternals: {
    trin: number | null;
    trinSignal: "bullish" | "bearish" | "neutral";
    trinExplanation: string;
    tnxYield: number | null;
    liquidityAssessment: "ample" | "moderate" | "tight" | "unknown";
    liquidityExplanation: string;
  } | null;
  optionsFlow: {
    available: boolean;
    ticker: string;
    expiration: string | null;
    putCallVolumeRatio: number | null;
    putCallOpenInterestRatio: number | null;
    totalCallVolume: number;
    totalPutVolume: number;
    totalOpenInterest: number;
    unusualActivity: boolean;
    unusualNote: string | null;
    premiumFlow: number | null;
    signal: "bullish" | "bearish" | "neutral";
    interpretation: string;
  } | null;
  greeks: {
    available: boolean;
    spot: number | null;
    expiration: string | null;
    strike: number | null;
    call: { delta: number; gamma: number; charm: number } | null;
    put: { delta: number; gamma: number; charm: number } | null;
    explanation: string;
    signal: "bullish" | "bearish" | "neutral";
    signalNote: string;
  } | null;
  macroContext: MacroEntry[];
  aiReport: {
    available: boolean;
    content: string | null;
    model: string | null;
    provider: string | null;
    note: string | null;
  };
  disclaimer: string;
  performedAt: string;
}

// ── Ticker alias map ─────────────────────────────────────────────────────────
// Maps common names / abbreviations → Yahoo Finance symbols
const TICKER_ALIASES: Record<string, string> = {
  // Global index names users commonly type
  "KOSPI":       "^KS11",
  "KOSPI200":    "^KS200",
  "EGX30":       "^CASE30",
  "EGX":         "^CASE30",
  "NIKKEI":      "^N225",
  "NIKKEI225":   "^N225",
  "N225":        "^N225",
  "DAX":         "^GDAXI",
  "DAX40":       "^GDAXI",
  "FTSE":        "^FTSE",
  "FTSE100":     "^FTSE",
  "CAC":         "^FCHI",
  "CAC40":       "^FCHI",
  "EUROSTOXX":   "^STOXX50E",
  "EUROSTOXX50": "^STOXX50E",
  "STOXX50":     "^STOXX50E",
  "IBEX":        "^IBEX",
  "IBEX35":      "^IBEX",
  "SMI":         "^SSMI",
  "ATX":         "^ATX",
  "BEL20":       "^BFX",
  "AEX":         "^AEX",
  "OMXS30":      "^OMXS30",
  "OMXC25":      "^OMXC25",
  "OSLO":        "^OSEAX",
  "HANGSENG":    "^HSI",
  "HSI":         "^HSI",
  "NIFTY":       "^NSEI",
  "NIFTY50":     "^NSEI",
  "SENSEX":      "^BSESN",
  "BSE":         "^BSESN",
  "ASX":         "^AXJO",
  "ASX200":      "^AXJO",
  "NZX":         "^NZ50",
  "NZX50":       "^NZ50",
  "STI":         "^STI",
  "JAKARTA":     "^JKSE",
  "IDX":         "^JKSE",
  "KLCI":        "^KLSE",
  "BURSA":       "^KLSE",
  "TAIWAN":      "^TWII",
  "TAIEX":       "^TWII",
  "SHANGHAI":    "000001.SS",
  "SSE":         "000001.SS",
  "SHENZHEN":    "399001.SZ",
  "SZSE":        "399001.SZ",
  "TSX":         "^GSPTSE",
  "BOVESPA":     "^BVSP",
  "IBOVESPA":    "^BVSP",
  "MERVAL":      "^MERV",
  "IPC":         "^MXX",
  "BMV":         "^MXX",
  "IPSA":        "^IPSA",
  "TA125":       "^TA125.TA",
  "BIST":        "^XU100",
  "BIST100":     "^XU100",
  "XU100":       "^XU100",
  // US index shortcuts
  "SPX":         "^GSPC",
  "SP500":       "^GSPC",
  "S&P500":      "^GSPC",
  "S&P":         "^GSPC",
  "DOW":         "^DJI",
  "DJIA":        "^DJI",
  "DOW30":       "^DJI",
  "NASDAQ":      "^IXIC",
  "NASDAQ100":   "^NDX",
  "NDX":         "^NDX",
  "RUSSELL":     "^RUT",
  "RUSSELL2000": "^RUT",
  "VIX":         "^VIX",
  // Commodities / crypto shortcuts
  "GOLD":        "GC=F",
  "OIL":         "CL=F",
  "CRUDE":       "CL=F",
  "WTI":         "CL=F",
  "BRENT":       "BZ=F",
  "SILVER":      "SI=F",
  "BITCOIN":     "BTC-USD",
  "ETHEREUM":    "ETH-USD",
  "ETH":         "ETH-USD",
  "BTC":         "BTC-USD",
};

export async function analyzeStock(tickerRaw: string): Promise<AnalysisResult> {
  const upper = tickerRaw.toUpperCase().trim().replace(/\s+/g, "");
  let ticker = TICKER_ALIASES[upper] ?? upper;

  // Yahoo uses a hyphen for US class shares (BRK-B) but a dot for exchange suffixes
  // (SAP.DE, VOD.L). If the literal symbol has no history, retry with dots -> hyphens.
  let history = await fetchHistory(ticker, "6mo").catch(() => []);
  if (history.length === 0 && ticker.includes(".")) {
    const alt = ticker.replace(/\./g, "-");
    history = await fetchHistory(alt, "6mo").catch(() => []);
    if (history.length > 0) ticker = alt;
  }

  // Fetch ticker and SPY history in parallel
  const [histResult, spyHistory, ohlcResult0, tvResult, summary, searchResult] = await Promise.allSettled([
    Promise.resolve(history),
    fetchHistory("SPY", "6mo"),
    fetchOhlc1y(ticker),
    getTVFundamentalsUS(ticker.replace(/\.(TO|L|DE|PA)$/i, "")),
    yahooFinance.quoteSummary(ticker, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "earnings"],
    }),
    yahooFinance.search(ticker, { newsCount: 5 }),
  ]);

  const hist = histResult.status === "fulfilled" ? histResult.value : [];
  if (hist.length === 0) {
    throw new Error(`No data found for ticker: ${ticker}`);
  }

  const spyHist = spyHistory.status === "fulfilled" ? spyHistory.value : [];
  const ohlcResult = ohlcResult0.status === "fulfilled" ? ohlcResult0.value : { candles: [], volumes: [] };
  const ohlc1y = ohlcResult.candles;
  const sum = summary.status === "fulfilled" ? summary.value : null;
  const searchRes = searchResult.status === "fulfilled" ? searchResult.value : null;

  const closes = hist.map((h) => h.close);
  const spyCloses = spyHist.map((h) => h.close);

  const currentPrice = closes[closes.length - 1];
  const rsi = calcRSI(closes);
  const macdData = calcMACD(closes);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);

  // Support/resistance from real intraday lows/highs over the last 60 sessions
  // (falls back to closes when OHLC is unavailable).
  const srSource = ohlc1y.length >= 20 ? ohlc1y : hist.map((h) => ({ low: h.close, high: h.close }));
  const support = Math.min(...srSource.slice(-60).map((d) => d.low));
  const resistance = Math.max(...srSource.slice(-60).map((d) => d.high));

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
  // TradingView works from datacenter IPs where Yahoo blocks quoteSummary.
  const tv = tvResult.status === "fulfilled" ? tvResult.value : null;

  const priceChange = price?.regularMarketChange ?? (ohlc1y.length >= 2 ? ohlc1y[ohlc1y.length - 1].close - ohlc1y[ohlc1y.length - 2].close : null);
  const priceChangePct = price?.regularMarketChangePercent != null
    ? price.regularMarketChangePercent * 100
    : priceChange != null && ohlc1y.length >= 2 && ohlc1y[ohlc1y.length - 2].close !== 0
      ? ((priceChange / ohlc1y[ohlc1y.length - 2].close) * 100)
      : null;

  const pick = (tvVal: number | null | undefined, yhVal: number | undefined | null): number | null =>
    (tvVal != null ? tvVal : yhVal ?? null) as number | null;

  const peRatio: number | null =
    pick(tv?.pe, undefined) ??
    (summaryDetail?.trailingPE as number | undefined) ??
    (keyStats?.trailingEps != null && keyStats.trailingEps !== 0
      ? currentPrice / (keyStats.trailingEps as number)
      : null);

  const eps: number | null = pick(tv?.eps, keyStats?.trailingEps as number | undefined);
  const dividendYield: number | null = pick(tv?.dividendYield, summaryDetail?.dividendYield != null ? (summaryDetail.dividendYield as number) * 100 : null);
  const marketCap: number | null = pick(tv?.marketCap, price?.marketCap as number | undefined);
  // Volume stats from the 1y candles; Yahoo fallback when candles lack volume.
  const vols = ohlcResult.volumes.filter((v) => v > 0);
  const volume: number | null =
    vols.length > 0 ? vols[vols.length - 1] : (price?.regularMarketVolume as number | undefined) ?? null;
  const avgVolume: number | null =
    vols.length >= 5 ? Math.round(vols.slice(-30).reduce((a, b) => a + b, 0) / Math.min(vols.length, 30)) : (summaryDetail?.averageVolume as number | undefined) ?? null;
  // 52-week range computed from the candle data itself (always available).
  const fiftyTwoWeekHigh: number | null =
    ohlc1y.length > 0 ? Math.max(...ohlc1y.map((c) => c.high)) : (summaryDetail?.fiftyTwoWeekHigh as number | undefined) ?? null;
  const fiftyTwoWeekLow: number | null =
    ohlc1y.length > 0 ? Math.min(...ohlc1y.map((c) => c.low)) : (summaryDetail?.fiftyTwoWeekLow as number | undefined) ?? null;
  const companyName: string | null = (price?.longName as string | undefined) ?? (price?.shortName as string | undefined) ?? null;

  // ── Fair value (analyst consensus) ────────────────────────────────────────
  const financialData = sum?.financialData as
    | { targetMeanPrice?: { raw?: number } | number }
    | undefined;
  const targetMeanPrice =
    (financialData?.targetMeanPrice as { raw?: number } | number | undefined) == null
      ? null
      : typeof (financialData?.targetMeanPrice as { raw?: number } | number) === "object"
        ? ((financialData?.targetMeanPrice as { raw?: number })?.raw ?? null)
        : (financialData?.targetMeanPrice as number);

  const fairValue =
    targetMeanPrice != null
      ? (() => {
          const diffPct = ((targetMeanPrice - currentPrice) / currentPrice) * 100;
          let label: string;
          let explanation: string;
          if (diffPct >= 5) {
            label = "Undervalued";
            explanation = `Analysts' mean target ($${targetMeanPrice.toFixed(2)}) is ${diffPct.toFixed(1)}% above the current price ($${currentPrice.toFixed(2)}) — the street sees meaningful upside.`;
          } else if (diffPct <= -5) {
            label = "Overvalued";
            explanation = `Analysts' mean target ($${targetMeanPrice.toFixed(2)}) is ${Math.abs(diffPct).toFixed(1)}% below the current price — the street sees downside risk.`;
          } else {
            label = "Fairly valued";
            explanation = `Analysts' mean target ($${targetMeanPrice.toFixed(2)}) is within 5% of the current price — the street considers it fairly valued.`;
          }
          return { targetMeanPrice, percentDifference: diffPct, label, explanation };
        })()
      : null;

  // ── Price vs EPS series (quarterly earnings + closing price) ─────────────
  const earningsModule = sum?.earnings as
    | { earningsChart?: { quarterly?: Array<{ date?: string; actual?: { raw?: number } }> } }
    | undefined;
  let priceVsEps: { dates: string[]; eps: number[]; price: number[] } | null = null;
  {
    const quarterly = earningsModule?.earningsChart?.quarterly ?? [];
    const epsData = quarterly
      .filter((q) => q.date && q.actual?.raw != null)
      .slice(-8)
      .map((q) => ({ date: q.date as string, eps: q.actual?.raw as number }));
    if (epsData.length > 1 && hist.length > 5) {
      const epsDates = epsData.map((e) => Date.parse(e.date));
      const prices = epsData.map((e) => {
        // nearest close on or after the earnings date
        const target = Date.parse(e.date);
        let best = hist[hist.length - 1].close;
        let bestDiff = Infinity;
        for (const h of hist) {
          const diff = Math.abs(h.date.getTime() - target);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = h.close;
          }
        }
        return best;
      });
      priceVsEps = {
        dates: epsData.map((e) => e.date),
        eps: epsData.map((e) => e.eps),
        price: prices,
      };
    }
  }

  const traderRec = calcTraderRecommendation(
    rsi,
    macdData.macd,
    macdData.signal,
    macdData.histogram,
    currentPrice,
    sma50,
    support,
    resistance,
    volume,
    avgVolume,
    closes
  );

  const investorRec = calcInvestorRecommendation(
    rsi,
    currentPrice,
    sma50,
    sma200,
    peRatio,
    eps,
    dividendYield,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow
  );

  // Legacy single recommendation: average of both scores
  const combinedScore = (traderRec.score + investorRec.score) / 2;
  const recommendation = scoreToLabel(combinedScore);
  const score = combinedScore;

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

  // ── Extended analysis (all independent, all gracefully degrade) ──────────
  const DISCLAIMER = "⚠️ This tool is for reference and educational purposes only. Not financial advice.";

  const [newsSentiment, socialSentiment, marketInternals, optionsFlow, greeks, macroContextRes] =
    await Promise.allSettled([
      getGoogleNewsSentiment(ticker),
      getRedditSentiment(ticker),
      getMarketInternals(),
      analyzeOptionsFlow(ticker),
      getGreeksSnapshot(ticker),
      fetchMacroData(),
    ]);

  const newsSentimentVal = newsSentiment.status === "fulfilled" ? newsSentiment.value : null;
  const socialSentimentVal = socialSentiment.status === "fulfilled" ? socialSentiment.value : null;
  const marketInternalsVal = marketInternals.status === "fulfilled" ? marketInternals.value : null;
  const optionsFlowVal = optionsFlow.status === "fulfilled" ? optionsFlow.value : null;
  const greeksVal = greeks.status === "fulfilled" ? greeks.value : null;
  const macroContext = macroContextRes.status === "fulfilled" ? macroContextRes.value : [];

  // AI report (Groq) — assembled from everything above; skipped gracefully if unavailable
  const aiReport = await generateAiReport({
    ticker,
    companyName,
    currentPrice,
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
    recommendation,
    traderRec,
    investorRec,
    newsSentiment: newsSentimentVal
      ? { label: newsSentimentVal.label, compound: newsSentimentVal.compound, explanation: newsSentimentVal.explanation }
      : null,
    socialSentiment: socialSentimentVal
      ? { label: socialSentimentVal.label, compound: socialSentimentVal.compound, explanation: socialSentimentVal.explanation }
      : null,
    marketInternals: marketInternalsVal
      ? { trin: marketInternalsVal.trin, trinSignal: marketInternalsVal.trinSignal, liquidityAssessment: marketInternalsVal.liquidityAssessment }
      : null,
    optionsFlow: optionsFlowVal
      ? { signal: optionsFlowVal.signal, putCallVolumeRatio: optionsFlowVal.putCallVolumeRatio, interpretation: optionsFlowVal.interpretation }
      : null,
    fairValue: fairValue ? { label: fairValue.label, percentDifference: fairValue.percentDifference, targetMeanPrice: fairValue.targetMeanPrice } : null,
    greeks: greeksVal ? { signal: greeksVal.signal, signalNote: greeksVal.signalNote } : null,
    macroContext,
  });

  // Performance log (fire and forget — never blocks the response)
  logRecommendation({
    timestamp: new Date().toISOString(),
    ticker,
    action: recommendation,
    entry: currentPrice,
    target: resistance,
    stopLoss: support,
  }).catch(() => {});

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
    ohlc1y,
    news,
    recommendation,
    score,
    traderRec,
    investorRec,
    fairValue,
    priceVsEps,
    newsSentiment: newsSentimentVal,
    socialSentiment: socialSentimentVal,
    marketInternals: marketInternalsVal,
    optionsFlow: optionsFlowVal,
    greeks: greeksVal,
    macroContext,
    aiReport,
    disclaimer: DISCLAIMER,
    performedAt: new Date().toISOString(),
  };
}

// ── Commodities & Crypto ─────────────────────────────────────────────────────

export interface CommodityData {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  status: string; // equity effect: bullish | neutral | bearish
  equityImpact: string;
}

export async function fetchCommoditiesAndCrypto(): Promise<CommodityData[]> {
  const ASSETS = [
    { symbol: "GC=F",    label: "Gold" },
    { symbol: "CL=F",    label: "WTI Crude Oil" },
    { symbol: "BTC-USD", label: "Bitcoin" },
  ];

  const results = await Promise.allSettled(
    ASSETS.map((a) => yahooFinance.quoteSummary(a.symbol, { modules: ["price"] }))
  );

  return results
    .map((r, i) => {
      if (r.status !== "fulfilled") return null;
      const p = r.value.price;
      if (!p || p.regularMarketPrice == null) return null;

      const price    = p.regularMarketPrice as number;
      const change   = (p.regularMarketChange as number | undefined) ?? 0;
      const changePct =
        p.regularMarketChangePercent != null
          ? (p.regularMarketChangePercent as number) * 100
          : 0;
      const currency = (p.currency as string | undefined) ?? "USD";
      const { symbol, label } = ASSETS[i];

      let status: string;
      let equityImpact: string;

      if (symbol === "GC=F") {
        if (changePct > 1.5) {
          status = "bearish";
          equityImpact = `Gold rising ${changePct.toFixed(1)}% signals risk-off sentiment — investors fleeing to safety. Rising gold typically puts downward pressure on equities as capital rotates away from risk assets.`;
        } else if (changePct < -1.5) {
          status = "bullish";
          equityImpact = `Gold falling ${Math.abs(changePct).toFixed(1)}% signals risk-on appetite — capital is rotating out of safe havens and back into equities. Historically bullish for stock markets.`;
        } else {
          status = "neutral";
          equityImpact = `Gold moving sideways — no strong flight-to-safety or risk-on signal. Equities are not receiving a directional impulse from gold today.`;
        }
      } else if (symbol === "CL=F") {
        if (changePct > 3) {
          status = "bearish";
          equityImpact = `Oil surging ${changePct.toFixed(1)}% raises inflation expectations and squeezes corporate margins — bearish for equities, especially consumer discretionary and transportation sectors. Energy stocks may benefit temporarily.`;
        } else if (changePct < -3) {
          status = "bearish";
          equityImpact = `Oil plunging ${Math.abs(changePct).toFixed(1)}% may reflect deteriorating global demand and growth fears — a bearish macro signal. Energy sector will face earnings pressure.`;
        } else if (changePct > 1.2) {
          status = "neutral";
          equityImpact = `Oil up modestly ${changePct.toFixed(1)}% — suggests steady demand. Watch for inflation pass-through if sustained. Mixed signal for equities.`;
        } else {
          status = "neutral";
          equityImpact = `Oil relatively stable — neutral for equity markets. No significant inflation or demand shock signal today.`;
        }
      } else {
        // Bitcoin
        if (changePct > 4) {
          status = "bullish";
          equityImpact = `Bitcoin up ${changePct.toFixed(1)}% — strong risk-on appetite. Crypto rallies historically correlate with gains in tech, growth stocks, and high-beta equities as investors seek higher returns.`;
        } else if (changePct < -4) {
          status = "bearish";
          equityImpact = `Bitcoin down ${Math.abs(changePct).toFixed(1)}% — risk-off signal. Crypto sell-offs often precede pressure on tech and high-multiple growth stocks, as both attract similar speculative capital.`;
        } else {
          status = "neutral";
          equityImpact = `Bitcoin moving sideways — no strong directional signal for risk assets. Equity markets are not receiving a sentiment push from crypto today.`;
        }
      }

      return { symbol, label, price, change, changePct, currency, status, equityImpact };
    })
    .filter((d): d is CommodityData => d !== null);
}

// ── Trending tickers ─────────────────────────────────────────────────────────

const TRENDING_SYMBOLS = [
  // ── US Large Caps ────────────────────────────────────────────────────────
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "V",   "WMT",
  "BRK-B","XOM",  "UNH",  "JNJ",  "PG",   "CVX",  "HD",   "BAC", "KO",  "LLY",
  "ABBV", "MRK",  "COST", "AVGO", "ACN",  "MCD",  "NKE",  "TXN", "PM",  "MS",
  "GS",   "AMD",  "INTC", "QCOM", "CRM",  "ADBE", "NFLX", "ORCL",

  // ── US ETFs ──────────────────────────────────────────────────────────────
  "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO",
  "GLD", "SLV", "XLF", "XLE", "XLK", "XLV", "ARKK",

  // ── Commodities & Crypto ─────────────────────────────────────────────────
  "GC=F", "CL=F", "BTC-USD", "ETH-USD",

  // ── Asia-Pacific Indices ─────────────────────────────────────────────────
  "^N225",     // Nikkei 225        — Japan
  "^TWII",     // TSEC Weighted     — Taiwan
  "^HSI",      // Hang Seng         — Hong Kong
  "000001.SS", // Shanghai Comp.    — China
  "399001.SZ", // Shenzhen Comp.    — China
  "^KS11",     // KOSPI             — South Korea
  "^NSEI",     // Nifty 50          — India
  "^AXJO",     // ASX 200           — Australia
  "^NZ50",     // NZX 50            — New Zealand
  "^STI",      // Straits Times     — Singapore
  "^JKSE",     // IDX Composite     — Indonesia
  "^KLSE",     // KLCI              — Malaysia

  // ── European Indices ─────────────────────────────────────────────────────
  "^FTSE",     // FTSE 100          — United Kingdom
  "^GDAXI",    // DAX               — Germany
  "^FCHI",     // CAC 40            — France
  "^STOXX50E", // Euro Stoxx 50     — Europe
  "^AEX",      // AEX               — Netherlands
  "^IBEX",     // IBEX 35           — Spain
  "^SSMI",     // SMI               — Switzerland
  "^ATX",      // ATX               — Austria
  "^BFX",      // BEL 20            — Belgium
  "^OSEAX",    // Oslo All-Share     — Norway
  "^OMXS30",   // OMX Stockholm 30  — Sweden
  "^OMXC25",   // OMX Copenhagen 25 — Denmark
  "^GSPTSE",   // TSX Composite     — Canada

  // ── Middle East & Africa Indices ─────────────────────────────────────────
  "^CASE30",   // EGX 30            — Egypt
  "^TA125.TA", // TA-125            — Israel
  "^XU100",    // BIST 100          — Turkey

  // ── Latin America Indices ────────────────────────────────────────────────
  "^BVSP",     // Bovespa           — Brazil
  "^MXX",      // S&P/BMV IPC       — Mexico
  "^MERV",     // MERVAL            — Argentina
  "^IPSA",     // S&P IPSA          — Chile

  // ── International Stocks (US-listed ADRs & cross-listings) ───────────────
  "TSM",  // Taiwan Semiconductor   — Taiwan
  "ASML", // ASML Holding           — Netherlands
  "BABA", // Alibaba                — China
  "SAP",  // SAP SE                 — Germany
  "TM",   // Toyota Motor           — Japan
  "SONY", // Sony Group             — Japan
  "HDB",  // HDFC Bank              — India
  "SHOP", // Shopify                — Canada
  "ARM",  // Arm Holdings           — United Kingdom
  "NIO",  // NIO Inc.               — China
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
