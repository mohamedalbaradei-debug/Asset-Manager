import { Router, type IRouter } from "express";
import { GetMacroDataResponse, GetTrendingTickersResponse } from "@workspace/api-zod";
import { getTrendingTickers, calcMarketBreadth } from "../lib/stockAnalysis";
import { fetchMacroData, type MacroEntry } from "../lib/fredMacro";

const router: IRouter = Router();

// Simple in-memory cache for expensive data
let macroCache: { data: object; expiresAt: number } | null = null;
let trendingCache: { data: object[]; expiresAt: number } | null = null;

const MACRO_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const TRENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

router.get("/macro", async (req, res): Promise<void> => {
  // Serve from cache if fresh
  if (macroCache && Date.now() < macroCache.expiresAt) {
    res.json(macroCache.data);
    return;
  }

  try {
    const [macroEntries, breadth] = await Promise.all([
      fetchMacroData(),
      calcMarketBreadth(),
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

    const response = {
      macro: macroEntries,
      breadth: breadthEntries,
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
