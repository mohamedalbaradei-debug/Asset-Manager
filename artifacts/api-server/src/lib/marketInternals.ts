import { yahooFinance } from "./yahoo";
import { logger } from "./logger";

/**
 * Market internals: Arms Index (TRIN) and excess-liquidity proxy.
 *
 * TRIN (Trading Index / Arms Index) gauges whether volume is flowing into
 * advancing or declining issues:
 *   - TRIN > 1  → more volume in declining stocks (bearish pressure)
 *   - TRIN < 1  → more volume in advancing stocks (bullish pressure)
 *
 * Liquidity proxy uses the 10Y Treasury yield as the discount-rate backdrop:
 *   - < 3.5%  → ample liquidity
 *   - > 5%    → tight liquidity
 *   - else    → moderate
 */

async function latestClose(symbol: string): Promise<number | null> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 15);
    const result = await yahooFinance.chart(symbol, { period1: since, interval: "1d" });
    const quotes = (result.quotes ?? []) as Array<{ close?: number | null }>;
    const closes = quotes.filter((q) => q.close != null).map((q) => q.close as number);
    return closes.length > 0 ? closes[closes.length - 1] : null;
  } catch (err) {
    logger.warn({ err, symbol }, "Market internal fetch failed");
    return null;
  }
}

export interface MarketInternals {
  trin: number | null;
  trinSignal: "bullish" | "bearish" | "neutral";
  trinExplanation: string;
  tnxYield: number | null;
  liquidityAssessment: "ample" | "moderate" | "tight" | "unknown";
  liquidityExplanation: string;
}

export async function getMarketInternals(): Promise<MarketInternals> {
  const [trin, tnx] = await Promise.all([latestClose("^TRIN"), latestClose("^TNX")]);

  let trinSignal: MarketInternals["trinSignal"] = "neutral";
  let trinExplanation: string;
  if (trin == null) {
    trinExplanation = "TRIN (Arms Index) unavailable.";
  } else if (trin > 1) {
    trinSignal = "bearish";
    trinExplanation =
      `TRIN at ${trin.toFixed(2)} (> 1) — volume is flowing into declining stocks, ` +
      "a sign of selling pressure under the surface.";
  } else if (trin < 1) {
    trinSignal = "bullish";
    trinExplanation =
      `TRIN at ${trin.toFixed(2)} (< 1) — volume is flowing into advancing stocks, ` +
      "a sign of broad buying participation.";
  } else {
    trinExplanation = `TRIN at ${trin.toFixed(2)} — balanced advancing/declining volume.`;
  }

  let liquidityAssessment: MarketInternals["liquidityAssessment"] = "unknown";
  let liquidityExplanation: string;
  if (tnx == null) {
    liquidityExplanation = "10Y Treasury yield unavailable — cannot assess liquidity.";
  } else if (tnx < 3.5) {
    liquidityAssessment = "ample";
    liquidityExplanation =
      `10Y yield at ${tnx.toFixed(2)}% (< 3.5%) — ample liquidity, a supportive backdrop for risk assets ` +
      "as the discount rate is low and credit is easy.";
  } else if (tnx > 5) {
    liquidityAssessment = "tight";
    liquidityExplanation =
      `10Y yield at ${tnx.toFixed(2)}% (> 5%) — tight liquidity, elevated discount rates pressure high-` +
      "valuation equities and increase borrowing costs.";
  } else {
    liquidityAssessment = "moderate";
    liquidityExplanation =
      `10Y yield at ${tnx.toFixed(2)}% — moderate liquidity backdrop, neither extremely easy nor tight.`;
  }

  return {
    trin,
    trinSignal,
    trinExplanation,
    tnxYield: tnx,
    liquidityAssessment,
    liquidityExplanation,
  };
}