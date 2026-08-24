import { yahooFinance } from "./yahoo";
import { logger } from "./logger";

/**
 * Historical backtest of a planner allocation: rebalanced-monthly portfolio
 * built from monthly ETF closes vs an SPY benchmark, with CAGR, volatility,
 * and max drawdown. Educational illustration — not investment advice.
 */

export interface BacktestPoint {
  date: string;
  portfolio: number; // indexed to 100 at start
  spy: number | null;
  gold: number | null;
}

export interface BacktestResult {
  etfs: Array<{ ticker: string; percentOfPortfolio: number }>;
  months: number;
  points: BacktestPoint[];
  cagrPct: number | null;
  spyCagrPct: number | null;
  goldCagrPct: number | null;
  volPct: number | null;
  maxDrawdownPct: number | null;
  growthOf10kUsd: number | null;
  disclaimer: string;
}

const MONTH_MS = 30 * 86400_000;

async function monthlyCloses(symbol: string, years: number): Promise<Map<string, number>> {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - Math.min(years + 1, 15) * 365 * 86400_000);
  const res = await yahooFinance.chart(symbol, {
    period1: period1.toISOString().split("T")[0],
    period2: period2.toISOString().split("T")[0],
    interval: "1mo",
  });
  const quotes = (res.quotes ?? []) as Array<{ date?: string; close?: number }>;
  const out = new Map<string, number>();
  for (const q of quotes) {
    if (!q.date || typeof q.close !== "number" || !isFinite(q.close) || q.close <= 0) continue;
    // Normalise to month key (yahoo monthly bars are stamped at month open).
    out.set(new Date(q.date).toISOString().slice(0, 7), q.close);
  }
  return out;
}

function cagr(series: number[], months: number): number | null {
  if (series.length < 2 || series[0] <= 0 || months <= 0) return null;
  return (Math.pow(series[series.length - 1] / series[0], 12 / months) - 1) * 100;
}

function maxDrawdown(series: number[]): number | null {
  if (series.length < 2) return null;
  let peak = series[0];
  let mdd = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = (v / peak - 1) * 100;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

export async function backtestAllocation(
  etfs: Array<{ ticker: string; percentOfPortfolio: number }>,
): Promise<BacktestResult> {
  const usable = etfs.filter((e) => e.percentOfPortfolio > 0);
  const totalPct = usable.reduce((a, b) => a + b.percentOfPortfolio, 0);
  const longest = Math.max(...usable.map(() => 10)); // use full common history up to 10y
  void longest;

  const symbols = [...usable.map((e) => e.ticker), "SPY", "GLD"];
  const results = await Promise.allSettled(symbols.map((s) => monthlyCloses(s, 10)));
  const series = new Map<string, Map<string, number>>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") series.set(symbols[i], r.value);
  });

  // Months present in every requested series.
  let common: string[] | null = null;
  for (const s of usable) {
    const m = series.get(s.ticker);
    if (!m) continue;
    const keys = [...m.keys()].sort();
    common = common ? common.filter((k) => m.has(k)) : keys;
  }
  if (!common || common.length < 13) {
    throw new Error("Not enough overlapping history to backtest this allocation");
  }

  const spyMap = series.get("SPY") ?? null;
  const goldMap = series.get("GLD") ?? null;

  // Monthly returns per component; portfolio = weighted sum each month
  // (equivalent to a monthly-rebalanced portfolio).
  const points: BacktestPoint[] = [
    {
      date: common[0],
      portfolio: 100,
      spy: spyMap?.has(common[0]) ? 100 : null,
      gold: goldMap?.has(common[0]) ? 100 : null,
    },
  ];
  const rets: number[] = [];
  let pv = 100;
  let sv = spyMap && spyMap.has(common[0]) ? 100 : null;
  let gv = goldMap && goldMap.has(common[0]) ? 100 : null;
  for (let i = 1; i < common.length; i++) {
    const prevM = common[i - 1];
    const curM = common[i];
    let portRet = 0;
    let weightUsed = 0;
    for (const e of usable) {
      const m = series.get(e.ticker);
      if (!m?.has(prevM) || !m.has(curM)) continue;
      const w = e.percentOfPortfolio / totalPct;
      portRet += w * (m.get(curM)! / m.get(prevM)! - 1);
      weightUsed += w;
    }
    if (weightUsed === 0) continue;
    pv *= 1 + portRet;
    rets.push(portRet);
    let spyPt: number | null = null;
    if (sv != null && spyMap?.has(prevM) && spyMap.has(curM)) {
      sv *= 1 + (spyMap.get(curM)! / spyMap.get(prevM)! - 1);
      spyPt = sv;
    }
    let goldPt: number | null = null;
    if (gv != null && goldMap?.has(prevM) && goldMap.has(curM)) {
      gv *= 1 + (goldMap.get(curM)! / goldMap.get(prevM)! - 1);
      goldPt = gv;
    }
    points.push({
      date: curM,
      portfolio: Math.round(pv * 100) / 100,
      spy: spyPt != null ? Math.round(spyPt * 100) / 100 : null,
      gold: goldPt != null ? Math.round(goldPt * 100) / 100 : null,
    });
  }

  const vol =
    rets.length > 2
      ? (() => {
          const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
          const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
          return Math.sqrt(variance) * Math.sqrt(12) * 100;
        })()
      : null;

  const values = points.map((p) => p.portfolio);
  const spyValues = points.map((p) => p.spy).filter((x): x is number => x != null);
  const goldValues = points.map((p) => p.gold).filter((x): x is number => x != null);

  const out: BacktestResult = {
    etfs: usable,
    months: points.length,
    points,
    cagrPct: Math.round((cagr(values, points.length) ?? NaN) * 100) / 100 || null,
    spyCagrPct: spyValues.length > 12 ? Math.round((cagr(spyValues, points.length) ?? NaN) * 100) / 100 || null : null,
    goldCagrPct: goldValues.length > 12 ? Math.round((cagr(goldValues, points.length) ?? NaN) * 100) / 100 || null : null,
    volPct: vol != null ? Math.round(vol * 100) / 100 : null,
    maxDrawdownPct: maxDrawdown(values) != null ? Math.round(maxDrawdown(values)! * 100) / 100 : null,
    growthOf10kUsd: Math.round(((values[values.length - 1] ?? 100) / 100) * 10000),
    disclaimer:
      "Historical simulation of the selected allocation with monthly rebalancing, net of nothing (no taxes/fees). Past performance does not guarantee future results.",
  };
  logger.debug({ months: out.months }, "Backtest complete");
  return out;
}
