import { Router, type IRouter, type Request, type Response } from "express";
import { getMarketMovers, getSectorRotation, getSpyQqqRotation } from "../lib/equityPanels";
import {
  getFullUsMacro,
  getGlobalMacro,
  getFedData,
  getFxData,
  getValuationData,
  getShippingData,
} from "../lib/macroPanels";
import { getGexData } from "../lib/optionsAnalysis";
import { getLatestNews } from "../lib/newsSentiment";
import { fetchMacroData, type MacroEntry } from "../lib/fredMacro";
import { getMarketInternals } from "../lib/marketInternals";

const router: IRouter = Router();

// Simple TTL cache helper
function makeCache<T>(ttlMs: number) {
  let data: { value: T; expiresAt: number } | null = null;
  return {
    get(): T | null {
      return data && Date.now() < data.expiresAt ? data.value : null;
    },
    set(value: T) {
      data = { value, expiresAt: Date.now() + ttlMs };
    },
  };
}

const moversCache = makeCache<object>(90 * 1000);
const sectorsCache = makeCache<object>(5 * 60 * 1000);
const spyqqqCache = makeCache<object>(5 * 60 * 1000);
const gexCache = makeCache<object>(10 * 60 * 1000);
const macroFullCache = makeCache<object>(30 * 60 * 1000);
const globalCache = makeCache<object>(6 * 60 * 60 * 1000);
const fedCache = makeCache<object>(60 * 60 * 1000);
const fxCache = makeCache<object>(60 * 60 * 1000);
const valuationCache = makeCache<object>(6 * 60 * 60 * 1000);
const shippingCache = makeCache<object>(6 * 60 * 60 * 1000);
const newsCache = makeCache<object>(10 * 60 * 1000);

async function serve<T>(
  req: Request,
  res: Response,
  cache: ReturnType<typeof makeCache<T>>,
  fetcher: () => Promise<T>
): Promise<void> {
  const cached = cache.get();
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const data = await fetcher();
    cache.set(data);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Panel fetch failed");
    res.status(500).json({ error: "Failed to fetch panel data" });
  }
}

router.get("/movers", (req, res) => serve(req, res, moversCache, getMarketMovers));
router.get("/sectors", (req, res) => serve(req, res, sectorsCache, getSectorRotation));
router.get("/spyqqq", (req, res) => serve(req, res, spyqqqCache, getSpyQqqRotation));

router.get("/gex", async (req, res): Promise<void> => {
  const cached = gexCache.get();
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const [spx, vix] = await Promise.all([getGexData("^GSPC"), getGexData("^VIX")]);
    const data = { spx, vix, updatedAt: new Date().toISOString() };
    gexCache.set(data);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "GEX fetch failed");
    res.status(500).json({ error: "Failed to fetch GEX data" });
  }
});

router.get("/macro/full", (req, res) => serve(req, res, macroFullCache, getFullUsMacro));
router.get("/macro/global", (req, res) => serve(req, res, globalCache, getGlobalMacro));
router.get("/fed", (req, res) => serve(req, res, fedCache, getFedData));
router.get("/fx", (req, res) => serve(req, res, fxCache, getFxData));
router.get("/valuation", (req, res) => serve(req, res, valuationCache, getValuationData));
router.get("/shipping", (req, res) => serve(req, res, shippingCache, getShippingData));
router.get("/news", (req, res) => serve(req, res, newsCache, getLatestNews));

router.get("/marketpulse", async (req, res): Promise<void> => {
  try {
    const [macro, internals, movers, sectors] = await Promise.all([
      fetchMacroData(),
      getMarketInternals(),
      getMarketMovers(),
      getSectorRotation(),
    ]);

    const bestSector = sectors.sectors.filter((s) => s.change1dPct != null).sort((a, b) => (b.change1dPct ?? 0) - (a.change1dPct ?? 0))[0];
    const worstSector = sectors.sectors.filter((s) => s.change1dPct != null).sort((a, b) => (a.change1dPct ?? 0) - (b.change1dPct ?? 0))[0];

    const pulse = {
      macro: macro as MacroEntry[],
      internals: {
        trin: internals.trin,
        trinSignal: internals.trinSignal,
        tnxYield: internals.tnxYield,
        liquidityAssessment: internals.liquidityAssessment,
      },
      topGainers: movers.gainers.slice(0, 3),
      topLosers: movers.losers.slice(0, 3),
      sectorRotation: {
        best: bestSector ?? null,
        worst: worstSector ?? null,
        spy1d: sectors.spy.change1dPct,
      },
      updatedAt: new Date().toISOString(),
    };
    res.json(pulse);
  } catch (err) {
    req.log.error({ err }, "Market pulse fetch failed");
    res.status(500).json({ error: "Failed to build market pulse" });
  }
});

export default router;