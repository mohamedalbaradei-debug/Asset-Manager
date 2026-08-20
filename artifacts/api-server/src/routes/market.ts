import { Router, type IRouter } from "express";
import { GetMacroDataResponse, GetTrendingTickersResponse } from "@workspace/api-zod";
import { getTrendingTickers, calcMarketBreadth, fetchCommoditiesAndCrypto } from "../lib/stockAnalysis";
import { fetchMacroData, type MacroEntry } from "../lib/fredMacro";

const router: IRouter = Router();

// Simple in-memory cache for expensive data
let macroCache: { data: object; expiresAt: number } | null = null;
let trendingCache: { data: object[]; expiresAt: number } | null = null;

const MACRO_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const TRENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

function computeFearGreed(
  vix: number | null,
  aboveSMA50Pct: number,
  yieldSpread: number | null
): { score: number; label: string; description: string; status: string } {
  let score = 50;

  // VIX contribution ±30 (most influential)
  if (vix != null) {
    const vixDelta = (20 - vix) * 2.5; // VIX 12→+20, VIX 20→0, VIX 32→-30
    score += Math.max(-30, Math.min(30, vixDelta));
  }

  // Market breadth contribution ±20
  const breadthDelta = (aboveSMA50Pct - 50) * 0.4;
  score += Math.max(-20, Math.min(20, breadthDelta));

  // Yield curve contribution ±10
  if (yieldSpread != null) {
    if (yieldSpread > 0.5) score += 10;
    else if (yieldSpread > 0) score += 5;
    else if (yieldSpread > -0.5) score -= 5;
    else score -= 10;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label: string;
  let status: string;
  let description: string;

  if (score <= 25) {
    label = "Extreme Fear";
    status = "bullish"; // contrarian: panic = potential buying opportunity
    description = `Markets are in panic mode (score ${score}/100). Extreme fear is historically a contrarian buy signal — equities tend to be undervalued when sentiment is at its worst. VIX-driven selling and defensive positioning dominate.`;
  } else if (score <= 45) {
    label = "Fear";
    status = "neutral";
    description = `Investors are cautious (score ${score}/100). Elevated volatility and defensive rotation are suppressing risk appetite. Watch for a sentiment stabilisation before adding exposure.`;
  } else if (score <= 55) {
    label = "Neutral";
    status = "neutral";
    description = `Markets are balanced (score ${score}/100). Neither greed nor fear is driving prices. Earnings, fundamentals, and macro data are the primary movers right now.`;
  } else if (score <= 75) {
    label = "Greed";
    status = "neutral";
    description = `Optimism is elevated (score ${score}/100). Strong risk-on sentiment is pushing equities higher. Monitor for complacency — extended greed periods often precede consolidation.`;
  } else {
    label = "Extreme Greed";
    status = "bearish"; // contrarian: euphoria = caution
    description = `Markets are euphoric (score ${score}/100). Extreme greed is a contrarian warning sign — equities may be stretched and vulnerable to a sentiment-driven correction.`;
  }

  return { score, label, description, status };
}

router.get("/macro", async (req, res): Promise<void> => {
  // Serve from cache if fresh
  if (macroCache && Date.now() < macroCache.expiresAt) {
    res.json(macroCache.data);
    return;
  }

  try {
    const [macroEntries, breadth, commodities] = await Promise.all([
      fetchMacroData(),
      calcMarketBreadth(),
      fetchCommoditiesAndCrypto(),
    ]);

    const breadthEntries: MacroEntry[] = [];

    if (breadth.aboveSMA50Pct != null) {
      let bStatus: string | null = null;
      if (breadth.aboveSMA50Pct > 70) bStatus = "bullish";
      else if (breadth.aboveSMA50Pct < 30) bStatus = "bearish";
      else bStatus = "neutral";
      breadthEntries.push({
        label: "Stocks Above 50-day MA",
        value: `${breadth.aboveSMA50Pct}%`,
        status: bStatus,
      });
    }

    if (breadth.vix != null) {
      let vixStatus: string | null = null;
      if (breadth.vix < 15) vixStatus = "bullish";
      else if (breadth.vix < 25) vixStatus = "neutral";
      else vixStatus = "bearish";
      breadthEntries.push({
        label: "VIX (Fear Index)",
        value: breadth.vix.toFixed(2),
        status: vixStatus,
      });
    }

    if (breadth.tnxYield != null) {
      breadthEntries.push({
        label: "10-Year Treasury Yield",
        value: `${breadth.tnxYield.toFixed(2)}%`,
        status: null,
      });
    }

    if (breadth.yieldSpread != null) {
      let spreadStatus: string | null = null;
      if (breadth.yieldSpread > 0) spreadStatus = "bullish";
      else if (breadth.yieldSpread > -0.5) spreadStatus = "neutral";
      else spreadStatus = "bearish";
      breadthEntries.push({
        label: "Yield Curve (10Y-5Y)",
        value: `${breadth.yieldSpread.toFixed(2)}%`,
        status: spreadStatus,
      });
    }

    const overallBreadthStatus =
      breadth.aboveSMA50Pct > 70 && (breadth.vix ?? 99) < 20
        ? "bullish"
        : breadth.aboveSMA50Pct < 30 || (breadth.vix ?? 0) > 30
          ? "bearish"
          : "neutral";

    breadthEntries.push({
      label: "Breadth Status",
      value:
        overallBreadthStatus === "bullish"
          ? "Healthy"
          : overallBreadthStatus === "bearish"
            ? "Weak"
            : "Neutral",
      status: overallBreadthStatus,
    });

    const fearGreed = computeFearGreed(
      breadth.vix,
      breadth.aboveSMA50Pct,
      breadth.yieldSpread
    );

    const response = {
      macro: macroEntries,
      breadth: breadthEntries,
      fearGreed,
      commodities,
      updatedAt: new Date().toISOString(),
    };

    const validated = GetMacroDataResponse.parse(response);
    macroCache = { data: validated, expiresAt: Date.now() + MACRO_TTL_MS };
    res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch macro data");
    res.status(500).json({ error: "Failed to fetch macro data" });
  }
});

router.get("/trending", async (req, res): Promise<void> => {
  if (trendingCache && Date.now() < trendingCache.expiresAt) {
    res.json(trendingCache.data);
    return;
  }

  try {
    const tickers = await getTrendingTickers();
    const validated = GetTrendingTickersResponse.parse(tickers);
    trendingCache = { data: validated, expiresAt: Date.now() + TRENDING_TTL_MS };
    res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trending tickers");
    res.status(500).json({ error: "Failed to fetch trending tickers" });
  }
});

export default router;
