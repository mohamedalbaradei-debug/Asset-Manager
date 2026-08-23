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
import { getEtfTracker, getEtfScan } from "../lib/etfTracker";
import { getAssetCatalog } from "../lib/catalog";
import { getStockDetail, getStockHistory } from "../lib/stockDetail";
import { getChokepoints } from "../lib/portwatch";
import { getPetroleumStatus } from "../lib/petroleum";
import { getCryptoOptions } from "../lib/deribit";
import { getInsiders } from "../lib/insiders";
import { collectNews, queryArchive, getEventStudy } from "../lib/newsArchive";
import { getWatchlist } from "../lib/storage";

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
const etfCache = makeCache<object>(30 * 60 * 1000);
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
    const [spx, vix] = await Promise.all([getGexData("^SPX"), getGexData("^VIX")]);
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
router.get("/news", async (req, res): Promise<void> => {
  const cached = newsCache.get();
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const data = await getLatestNews();
    // Archive headlines for later event studies (fire-and-forget).
    collectNews(data.items, await getWatchlist());
    newsCache.set(data);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "News fetch failed");
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

router.get("/news/archive", async (req, res): Promise<void> => {
  try {
    const data = await queryArchive({
      ticker: typeof req.query.ticker === "string" ? req.query.ticker : null,
      from: typeof req.query.from === "string" ? req.query.from : null,
      to: typeof req.query.to === "string" ? req.query.to : null,
      limit: typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined,
    });
    res.json({ ...data, updatedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "News archive query failed");
    res.status(500).json({ error: "Failed to query news archive" });
  }
});

router.get("/news/events", async (req, res): Promise<void> => {
  try {
    const ticker = typeof req.query.ticker === "string" ? req.query.ticker : "";
    if (!ticker) {
      res.status(400).json({ error: "ticker query param required" });
      return;
    }
    const windowDays =
      typeof req.query.window === "string" ? parseInt(req.query.window, 10) : undefined;
    const data = await getEventStudy(ticker, windowDays);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Event study failed");
    res.status(500).json({ error: "Failed to run event study" });
  }
});
router.get("/etfs", (req, res) => serve(req, res, etfCache, getEtfTracker));

// Ranked, filterable flat view over the ETF universe (the "explorer").
router.get("/etfs/scan", async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getEtfScan({
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
      dir: typeof req.query.dir === "string" ? req.query.dir : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "ETF scan failed");
    res.status(500).json({ error: "Failed to scan ETFs" });
  }
});

// Curated quick-add catalog: major stocks, ETFs, commodities, FX, crypto, indices.
router.get("/catalog", (_req: Request, res: Response): void => {
  res.json(getAssetCatalog());
});

const chokepointsCache = makeCache<object>(12 * 60 * 60 * 1000);
const petroleumCache = makeCache<object>(6 * 60 * 60 * 1000);
const cryptoOptionsCache = makeCache<object>(10 * 60 * 1000);

router.get("/shipping/chokepoints", (req, res) => serve(req, res, chokepointsCache, getChokepoints));
router.get("/petroleum", (req, res) => serve(req, res, petroleumCache, getPetroleumStatus));
router.get("/crypto/options", async (req, res): Promise<void> => {  try {
    const currency = typeof req.query.currency === "string" ? req.query.currency : "BTC";
    const data = await getCryptoOptions(currency); // lib-level per-currency cache
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Crypto options fetch failed");
    res.status(500).json({ error: "Failed to fetch crypto options" });
  }
});

router.get("/stocks/:symbol/detail", async (req, res) => {
  const key = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!key) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  try {
    const data = await getStockDetail(key);
    if (!data) {
      res.status(404).json({ error: `Unknown ticker ${key}` });
      return;
    }
    res.json(data); // cached inside stockDetail lib (per symbol, 15 min)
  } catch {
    res.status(500).json({ error: "Failed to load stock detail" });
  }
});

router.get("/stocks/:symbol/history", async (req, res) => {
  const key = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!key) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  const range = String(req.query.range ?? "1Y");
  const interval = typeof req.query.interval === "string" ? req.query.interval : undefined;
  try {
    const data = await getStockHistory(key, range, interval);
    if (!data) {
      res.status(404).json({ error: `No history for ${key}` });
      return;
    }
    res.json(data); // cached inside stockDetail lib (per symbol+range, 60 s)
  } catch {
    res.status(500).json({ error: "Failed to load history" });
  }
});

router.get("/stocks/:symbol/insiders", async (req, res): Promise<void> => {
  const key = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!key) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  try {
    const data = await getInsiders(key); // cached inside insiders lib (6 h)
    if (!data || data.trades.length === 0) {
      res.json({ symbol: key, issuer: null, trades: [], netBuyValueUsd: null, updatedAt: new Date().toISOString() });
      return;
    }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Insiders fetch failed");
    res.status(500).json({ error: "Failed to load insider activity" });
  }
});

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