import { fetchFredSeries, latestValue } from "./fredMacro";
import { yahooFinance } from "./yahoo";
import { logger } from "./logger";

/**
 * Macro / Fed / FX / valuation / shipping panels.
 *
 * Free sources only:
 *   - FRED (free key, already in the project) for US + international series
 *   - multpl.com (keyless scrape) for S&P 500 valuation, SPY fallback
 *   - NY Fed markets API (keyless) for primary dealer positions
 *   - federalreserve.gov (keyless scrape) for FOMC document links
 *   - Yahoo Finance for FX spot
 *   - IMF PortWatch (keyless ArcGIS feature layers) for shipping chokepoints
 *
 * Every function degrades gracefully — a failed source yields a null / note,
 * never a crash.
 */

export interface DataPoint {
  label: string;
  value: string;
  status: "bullish" | "neutral" | "bearish" | null;
}

// ── Full US macro snapshot ───────────────────────────────────────────────────

const US_MACRO_SERIES: Array<{ series: string; label: string; fmt: (v: number) => string }> = [
  { series: "DFF", label: "Fed Funds Effective Rate", fmt: (v) => `${v.toFixed(2)}%` },
  { series: "DGS2", label: "2Y Treasury Yield", fmt: (v) => `${v.toFixed(2)}%` },
  { series: "DGS10", label: "10Y Treasury Yield", fmt: (v) => `${v.toFixed(2)}%` },
  { series: "T10Y2Y", label: "10Y-2Y Spread", fmt: (v) => `${v.toFixed(2)}%` },
  { series: "UNRATE", label: "Unemployment Rate", fmt: (v) => `${v.toFixed(2)}%` },
  { series: "ICSA", label: "Initial Jobless Claims", fmt: (v) => v.toLocaleString("en-US") },
  { series: "DCOILWTICO", label: "WTI Crude (USD/bbl)", fmt: (v) => `$${v.toFixed(2)}` },
  { series: "DTWEXBGS", label: "Broad Dollar Index", fmt: (v) => v.toFixed(2) },
  { series: "PAYEMS", label: "Nonfarm Payrolls (K)", fmt: (v) => `${(v / 1000).toFixed(0)}K` },
  { series: "M2SL", label: "M2 Money Supply", fmt: (v) => `$${(v / 1e12).toFixed(2)}T` },
  { series: "UMCSENT", label: "UMich Consumer Sentiment", fmt: (v) => v.toFixed(1) },
  { series: "T10YIE", label: "10Y Breakeven Inflation", fmt: (v) => `${v.toFixed(2)}%` },
  { series: "DRTSCILM", label: "Banks Tightening C&I (SLOOS)", fmt: (v) => `${v.toFixed(1)}%` },
];

function statusFor(label: string, v: number | null): DataPoint["status"] {
  if (v == null) return null;
  if (label.includes("2Y Treasury") || label.includes("10Y Treasury") || label.includes("Fed Funds")) {
    return v < 3 ? "bullish" : v > 5 ? "bearish" : "neutral";
  }
  if (label.includes("Unemployment")) {
    return v < 4 ? "bullish" : v > 6 ? "bearish" : "neutral";
  }
  if (label.includes("10Y-2Y")) {
    return v > 0 ? "bullish" : v > -0.5 ? "neutral" : "bearish";
  }
  if (label.includes("Breakeven") || label.includes("Tightening")) {
    return v > 3 ? "bearish" : v > 1.5 ? "neutral" : "bullish";
  }
  if (label.includes("Sentiment")) {
    return v > 80 ? "bullish" : v < 60 ? "bearish" : "neutral";
  }
  if (label.includes("Claims")) {
    return v < 220000 ? "bullish" : v > 300000 ? "bearish" : "neutral";
  }
  return null;
}

export async function getFullUsMacro(): Promise<{ items: DataPoint[]; updatedAt: string }> {
  const results = await Promise.allSettled(
    US_MACRO_SERIES.map(async (s) => {
      const obs = await fetchFredSeries(s.series, 2);
      const v = latestValue(obs);
      return { ...s, v };
    })
  );

  const items: DataPoint[] = [];
  results.forEach((r) => {
    if (r.status === "fulfilled") {
      const { label, fmt, v } = r.value;
      items.push({
        label,
        value: v != null ? fmt(v) : "N/A",
        status: statusFor(label, v),
      });
    }
  });

  return { items, updatedAt: new Date().toISOString() };
}

// ── Global macro (cross-country) ─────────────────────────────────────────────

const GLOBAL_CPI_SERIES: Array<{ country: string; code: string; series: string; label: string }> = [
  { country: "USA", code: "US", series: "CPALTT01USM657N", label: "United States" },
  { country: "CHN", code: "CN", series: "CPALTT01CNM657N", label: "China" },
  { country: "JPN", code: "JP", series: "CPALTT01JPM657N", label: "Japan" },
  { country: "DEU", code: "DE", series: "CPALTT01EZ19M657N", label: "Euro Area" },
  { country: "GBR", code: "GB", series: "CPALTT01GBM657N", label: "United Kingdom" },
  { country: "IND", code: "IN", series: "CPALTT01INM657N", label: "India" },
  { country: "BRA", code: "BR", series: "CPALTT01BRM657N", label: "Brazil" },
];

const GLOBAL_SHORT_RATE_SERIES: Array<{ country: string; series: string; label: string }> = [
  { country: "USA", series: "IR3TIB01USM156N", label: "United States" },
  { country: "CHN", series: "IRSTCI01CNM156N", label: "China" },
  { country: "JPN", series: "IR3TIB01JPM156N", label: "Japan" },
  { country: "DEU", series: "IR3TIB01EZM156N", label: "Euro Area" },
  { country: "GBR", series: "IR3TIB01GBM156N", label: "United Kingdom" },
  { country: "IND", series: "IRSTCI01INM156N", label: "India" },
  { country: "BRA", series: "IR3TIB01BRM156N", label: "Brazil" },
];

export interface GlobalMacroRow {
  country: string;
  code: string;
  cpiYoY: number | null;
  shortRate: number | null;
  cli: number | null;
}

export async function getGlobalMacro(): Promise<{
  rows: GlobalMacroRow[];
  updatedAt: string;
  note: string | null;
}> {
  const cpiResults = await Promise.allSettled(
    GLOBAL_CPI_SERIES.map(async (c) => ({
      country: c.country,
      v: latestValue(await fetchFredSeries(c.series, 2)),
    }))
  );
  const rateResults = await Promise.allSettled(
    GLOBAL_SHORT_RATE_SERIES.map(async (c) => ({
      country: c.country,
      v: latestValue(await fetchFredSeries(c.series, 2)),
    }))
  );

  const cpiMap = new Map<string, number | null>();
  cpiResults.forEach((r) => {
    if (r.status === "fulfilled") cpiMap.set(r.value.country, r.value.v);
  });
  const rateMap = new Map<string, number | null>();
  rateResults.forEach((r) => {
    if (r.status === "fulfilled") rateMap.set(r.value.country, r.value.v);
  });

  const rows: GlobalMacroRow[] = GLOBAL_CPI_SERIES.map((c) => ({
    country: c.label,
    code: c.code,
    cpiYoY: cpiMap.get(c.country) ?? null,
    shortRate: rateMap.get(c.country) ?? null,
    cli: null, // OECD CLI attempted separately; keep null if unavailable
  }));

  return { rows, updatedAt: new Date().toISOString(), note: null };
}

// ── Fed dashboard ────────────────────────────────────────────────────────────

const FED_BALANCE_SHEET: Array<{ series: string; label: string }> = [
  { series: "WALCL", label: "Fed Total Assets" },
  { series: "TREAST", label: "Treasury Holdings" },
  { series: "WSHOMCB", label: "MBS Holdings" },
];

export interface FedData {
  balanceSheet: DataPoint[];
  primaryDealerTreasuries: { value: number | null; note: string };
  fomc: Array<{ title: string; link: string }>;
  updatedAt: string;
}

export async function getFedData(): Promise<FedData> {
  const bsResults = await Promise.allSettled(
    FED_BALANCE_SHEET.map(async (s) => ({
      ...s,
      v: latestValue(await fetchFredSeries(s.series, 2)),
    }))
  );

  const balanceSheet: DataPoint[] = bsResults.map((r) => {
    if (r.status === "fulfilled" && r.value.v != null) {
      return {
        label: r.value.label,
        value: `$${(r.value.v / 1e6).toFixed(2)}B`,
        status: null,
      };
    }
    return { label: r.status === "fulfilled" ? r.value.label : "Fed Balance Sheet", value: "N/A", status: null };
  });

  // NY Fed primary dealer positions (keyless)
  let pdValue: number | null = null;
  let pdNote = "Primary dealer data unavailable.";
  try {
    const res = await fetch("https://markets.newyorkfed.org/api/pd/get/PDPOSGST-TOT.json", {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const json = (await res.json()) as { pd?: Array<{ value: number | string }> };
      const vals = (json.pd ?? []).filter((x) => x.value != null && x.value !== "");
      const last = vals[vals.length - 1];
      if (last) {
        const parsed = typeof last.value === "number" ? last.value : parseFloat(last.value);
        if (!isNaN(parsed)) {
          pdValue = parsed;
          pdNote =
            "Primary dealers' net Treasury position (NY Fed, keyless). Positive = dealers holding (supportive); negative = dealers reducing.";
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "NY Fed primary dealer fetch failed");
  }

  // FOMC calendar scrape (keyless)
  let fomc: Array<{ title: string; link: string }> = [];
  try {
    const res = await fetch("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      const links = [...html.matchAll(/<a[^>]+href=["']([^"']+\.htm)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map((m) => ({
          href: m[1],
          text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        }))
        .filter((l) => /(statement|minutes)/i.test(l.href) && /20\d\d/i.test(l.href))
        .slice(-8);
      fomc = links.map((l) => ({
        title: l.text || l.href.split("/").pop() || "FOMC document",
        link: l.href.startsWith("http") ? l.href : `https://www.federalreserve.gov${l.href}`,
      }));
    }
  } catch (err) {
    logger.warn({ err }, "FOMC calendar fetch failed");
  }

  return {
    balanceSheet,
    primaryDealerTreasuries: { value: pdValue, note: pdNote },
    fomc,
    updatedAt: new Date().toISOString(),
  };
}

// ── FX ───────────────────────────────────────────────────────────────────────

const FX_PAIRS = [
  { pair: "EUR/USD", symbol: "EURUSD=X", base: "DEU", quote: "USA" },
  { pair: "USD/JPY", symbol: "USDJPY=X", base: "USA", quote: "JPN" },
  { pair: "GBP/USD", symbol: "GBPUSD=X", base: "GBR", quote: "USA" },
  { pair: "USD/CNH", symbol: "USDCNH=X", base: "USA", quote: "CHN" },
];

async function fxSpot(symbol: string): Promise<number | null> {
  try {
    const q = await yahooFinance.quoteSummary(symbol, { modules: ["price"] });
    const p = q.price?.regularMarketPrice as number | undefined;
    return p ?? null;
  } catch {
    return null;
  }
}

export interface FxRow {
  pair: string;
  spot: number | null;
  rateDifferentialPct: number | null; // base short rate - quote short rate
  interpretation: string;
}

export async function getFxData(globalRates?: Map<string, number | null>): Promise<{ rows: FxRow[]; updatedAt: string }> {
  const rateMap = globalRates ?? new Map<string, number | null>();
  if (rateMap.size === 0) {
    const global = await getGlobalMacro();
    for (const row of global.rows) {
      // rows map label -> country; build code->rate from GLOBAL_SHORT_RATE_SERIES
    }
    // Rebuild code->rate from the short-rate series directly
    const rateResults = await Promise.allSettled(
      GLOBAL_SHORT_RATE_SERIES.map(async (c) => ({
        code: c.country,
        v: latestValue(await fetchFredSeries(c.series, 2)),
      }))
    );
    rateResults.forEach((r) => {
      if (r.status === "fulfilled") rateMap.set(r.value.code, r.value.v);
    });
  }

  const spotResults = await Promise.allSettled(FX_PAIRS.map((p) => fxSpot(p.symbol)));

  const rows: FxRow[] = FX_PAIRS.map((p, i) => {
    const spot = spotResults[i].status === "fulfilled" ? spotResults[i].value : null;
    const baseRate = rateMap.get(p.base) ?? null;
    const quoteRate = rateMap.get(p.quote) ?? null;
    const rateDifferentialPct =
      baseRate != null && quoteRate != null ? baseRate - quoteRate : null;

    let interpretation: string;
    if (rateDifferentialPct == null || spot == null) {
      interpretation = "Spot rate shown; rate differential unavailable.";
    } else {
      interpretation =
        rateDifferentialPct > 0
          ? `${p.base} pays ${rateDifferentialPct.toFixed(2)}% more short-term interest than ${p.quote} — carry favors being long ${p.pair}.`
          : `${p.quote} pays ${Math.abs(rateDifferentialPct).toFixed(2)}% more short-term interest than ${p.base} — carry favors being short ${p.pair}.`;
    }

    return { pair: p.pair, spot, rateDifferentialPct, interpretation };
  });

  return { rows, updatedAt: new Date().toISOString() };
}

// ── S&P 500 valuation ────────────────────────────────────────────────────────

const MULTL_URLS = [
  { key: "pe", url: "https://www.multpl.com/s-p-500-pe-ratio/table/by-month" },
  { key: "cape", url: "https://www.multpl.com/shiller-pe/table/by-month" },
  { key: "earningsYield", url: "https://www.multpl.com/s-p-500-earnings-yield/table/by-month" },
  { key: "dividendYield", url: "https://www.multpl.com/s-p-500-dividend-yield/table/by-month" },
];

async function scrapeMultpl(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const rows = [...html.matchAll(/<tr>\s*<td>(\d{4}-\d{2}-\d{2})<\/td>\s*<td>([\d.,]+)/gi)];
    if (rows.length === 0) return null;
    const first = rows[0];
    return parseFloat(first[2].replace(/,/g, ""));
  } catch (err) {
    logger.warn({ err, url }, "multpl scrape failed");
    return null;
  }
}

export interface ValuationData {
  pe: number | null;
  cape: number | null;
  earningsYield: number | null;
  dividendYield: number | null;
  source: string;
  note: string | null;
  updatedAt: string;
}

export async function getValuationData(): Promise<ValuationData> {
  const [pe, cape, earningsYield, dividendYield] = await Promise.all([
    scrapeMultpl(MULTL_URLS[0].url),
    scrapeMultpl(MULTL_URLS[1].url),
    scrapeMultpl(MULTL_URLS[2].url),
    scrapeMultpl(MULTL_URLS[3].url),
  ]);

  let source = "multpl.com";
  let note: string | null = null;

  // Fall back to SPY-derived metrics if multpl is blocked
  let peF = pe;
  let earningsYieldF = earningsYield;
  let dividendYieldF = dividendYield;
  if (peF == null) {
    try {
      const q = await yahooFinance.quoteSummary("SPY", { modules: ["summaryDetail"] });
      const trailingPe = q.summaryDetail?.trailingPE as number | undefined;
      const divYield = q.summaryDetail?.dividendYield as number | undefined;
      if (trailingPe != null) {
        peF = trailingPe;
        earningsYieldF = (1 / trailingPe) * 100;
        source = "Yahoo Finance (SPY trailing P/E fallback)";
        note = "multpl.com was unreachable; used SPY trailing P/E as a fallback.";
      }
      if (dividendYieldF == null && divYield != null) dividendYieldF = divYield * 100;
    } catch {
      /* ignore */
    }
  }

  return {
    pe: peF,
    cape,
    earningsYield: earningsYieldF,
    dividendYield: dividendYieldF,
    source,
    note,
    updatedAt: new Date().toISOString(),
  };
}

// ── Shipping (IMF PortWatch) ─────────────────────────────────────────────────

const PORTWATCH_CHOKEPOINTS = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_chokepoints_database/FeatureServer/0/query";
const PORTWATCH_DAILY = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

async function arcgisQuery(url: string, where = "1=1", extra = ""): Promise<unknown> {
  const u = `${url}?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&f=json${extra}`;
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
  return res.json();
}

export interface ShippingRow {
  chokepoint: string;
  volumeTonnes: number | null;
  vessels: number | null;
  status: "bullish" | "neutral" | "bearish";
  note: string;
}

export async function getShippingData(): Promise<{ rows: ShippingRow[]; updatedAt: string; available: boolean }> {
  try {
    const [ckJson, dailyJson] = await Promise.all([
      arcgisQuery(PORTWATCH_CHOKEPOINTS),
      arcgisQuery(PORTWATCH_DAILY, "1=1", "&resultRecordCount=500"),
    ]);

    const ckFeatures = (ckJson as { features?: Array<{ attributes: Record<string, unknown> }> })?.features ?? [];
    const dailyFeatures = (dailyJson as { features?: Array<{ attributes: Record<string, unknown> }> })?.features ?? [];

    // Discover attribute keys defensively
    const findKey = (attrs: Record<string, unknown>, candidates: string[]): string | null => {
      const keys = Object.keys(attrs);
      for (const c of candidates) {
        const found = keys.find((k) => k.toLowerCase().includes(c));
        if (found) return found;
      }
      return null;
    };

    const chokepointNames = new Map<string, string>();
    for (const f of ckFeatures) {
      const a = f.attributes;
      const nameKey = findKey(a, ["chokepointname", "name", "chokepoint"]);
      if (nameKey) {
        const name = String(a[nameKey]);
        if (!chokepointNames.has(name)) chokepointNames.set(name, name);
      }
    }

    // Group daily records by chokepoint, keep the latest per point
    const latestByPoint = new Map<string, { volume: number | null; vessels: number | null }>();
    for (const f of dailyFeatures) {
      const a = f.attributes;
      const nameKey = findKey(a, ["chokepointname", "name", "chokepoint"]);
      if (!nameKey) continue;
      const name = String(a[nameKey]);
      const volumeKey = findKey(a, ["tonnage", "volume", "tons", "mass"]);
      const vesselKey = findKey(a, ["vessel_count", "vessels", "vessel", "n_vessel"]);
      const volume = volumeKey ? parseFloat(String(a[volumeKey])) : null;
      const vessels = vesselKey ? parseFloat(String(a[vesselKey])) : null;
      const current = latestByPoint.get(name) ?? { volume: null, vessels: null };
      if (volume != null && !isNaN(volume)) current.volume = volume;
      if (vessels != null && !isNaN(vessels)) current.vessels = vessels;
      latestByPoint.set(name, current);
    }

    const featured = ["Suez Canal", "Panama Canal", "Strait of Hormuz", "Strait of Malacca", "Bab el-Mandeb", "Cape of Good Hope"];
    const rows: ShippingRow[] = [];

    for (const featuredName of featured) {
      const match = chokepointNames.size > 0
        ? [...chokepointNames.values()].find((n) => n.toLowerCase().includes(featuredName.split(" ")[0].toLowerCase()))
        : featuredName;
      const key = match ?? featuredName;
      const data = latestByPoint.get(key) ?? (featured.length === 0 ? latestByPoint.get(featuredName) : undefined);
      const volume = data?.volume ?? null;
      const vessels = data?.vessels ?? null;

      let status: ShippingRow["status"] = "neutral";
      let note: string;
      if (volume == null) {
        note = "No transit data available for this chokepoint.";
      } else {
        status = volume > 1_000_000_000 ? "bullish" : volume < 500_000_000 ? "bearish" : "neutral";
        note = `${(volume / 1e6).toFixed(0)}M tonnes transiting recently — ${status === "bullish" ? "strong trade flows (supportive for global growth)" : status === "bearish" ? "reduced flows (trade disruption risk)" : "normal activity"}.`;
      }

      rows.push({ chokepoint: featuredName, volumeTonnes: volume, vessels, status, note });
    }

    return {
      rows,
      updatedAt: new Date().toISOString(),
      available: rows.some((r) => r.volumeTonnes != null),
    };
  } catch (err) {
    logger.warn({ err }, "Shipping data unavailable");
    return { rows: [], updatedAt: new Date().toISOString(), available: false };
  }
}