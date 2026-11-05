import { fetchFredSeries, latestValue } from "./fredMacro";
import { yahooFinance } from "./yahoo";
import { logger } from "./logger";
import { hasPg, readMacroCache, writeMacroCache } from "./pg";

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
  { series: "M2SL", label: "M2 Money Supply", fmt: (v) => `$${(v / 1000).toFixed(2)}T` }, // FRED reports $B
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

// CPI as YoY % computed from index levels (CPIAUCSL-style series are price
// indices; dividing by the value 12 months back gives a true year-over-year
// rate). The OECD CPALTT01* "growth rate" series are monthly MoM and some
// (Euro area / Brazil) have been withdrawn from FRED entirely.
const GLOBAL_CPI_INDEX_SERIES: Array<{ country: string; code: string; series: string }> = [
  { country: "USA", code: "US", series: "CPIAUCSL" },
  { country: "CHN", code: "CN", series: "CHNCPIALLMINMEI" },
  { country: "JPN", code: "JP", series: "JPNCPIALLMINMEI" },
  { country: "DEU", code: "DE", series: "CP0000EZ19M086NEST" },
  { country: "GBR", code: "GB", series: "GBRCPIALLMINMEI" },
  { country: "IND", code: "IN", series: "INDCPIALLMINMEI" },
  { country: "BRA", code: "BR", series: "BRACPIALLMINMEI" },
];

const GLOBAL_SHORT_RATE_SERIES: Array<{ country: string; series: string; label: string }> = [
  { country: "USA", series: "IR3TIB01USM156N", label: "United States" },
  { country: "CHN", series: "IRSTCI01CNM156N", label: "China" },
  { country: "JPN", series: "IR3TIB01JPM156N", label: "Japan" },
  { country: "DEU", series: "IR3TIB01EZM156N", label: "Euro Area" },
  { country: "GBR", series: "IR3TIB01GBM156N", label: "United Kingdom" },
  { country: "IND", series: "IRSTCI01INM156N", label: "India" },
  { country: "BRA", series: "IRSTCI01BRM156N", label: "Brazil" }, // IR3TIB01BRM156N withdrawn
];

/** YoY % change from an index-level series (last vs 12 observations back). */
async function latestYoYFromIndex(seriesId: string): Promise<number | null> {
  const obs = await fetchFredSeries(seriesId, 14);
  if (obs.length < 13) return null;
  const now = parseFloat(obs[0].value);
  const yearAgo = parseFloat(obs[12].value);
  if (!isFinite(now) || !isFinite(yearAgo) || yearAgo <= 0) return null;
  return Math.round(((now / yearAgo - 1) * 100) * 100) / 100;
}

const COUNTRY_LABELS: Record<string, string> = {
  USA: "United States",
  CHN: "China",
  JPN: "Japan",
  DEU: "Euro Area",
  GBR: "United Kingdom",
  IND: "India",
  BRA: "Brazil",
};

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
    GLOBAL_CPI_INDEX_SERIES.map(async (c) => ({
      country: c.country,
      v: await latestYoYFromIndex(c.series),
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

  const rows: GlobalMacroRow[] = GLOBAL_CPI_INDEX_SERIES.map((c) => ({
    country: COUNTRY_LABELS[c.country] ?? c.country,
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
      // WALCL/TREAST/WSHOMCB are reported in millions of dollars.
      return {
        label: r.value.label,
        value: `$${(r.value.v / 1e6).toFixed(2)}T`,
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
      const json = (await res.json()) as {
        pd?: { timeseries?: Array<{ asofdate?: string; keyid?: string; value?: number | string }> };
      };
      const ts = json?.pd?.timeseries ?? [];
      const vals = ts.filter((x) => x.value != null && x.value !== "");
      const last = vals[vals.length - 1];
      if (last) {
        const parsed = typeof last.value === "number" ? last.value : parseFloat(String(last.value ?? ""));
        if (!isNaN(parsed)) {
          pdValue = parsed / 1000; // NY Fed reports $ millions -> $ billions for display
          pdNote =
            "Primary dealers' total U.S. Treasury positions (NY Fed, keyless). Value in $ billions. Positive = dealers holding (supportive); negative = dealers reducing.";
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
  // Primary: frankfurter.dev (free ECB reference rates, no API key, works
  // from datacenter IPs). Fallback: Yahoo quoteSummary.
  try {
    const m = symbol.match(/^([A-Z]{3})([A-Z]{3})=X$/);
    if (m) {
      const base = m[1];
      let quote = m[2];
      if (quote === "CNH") quote = "CNY"; // frankfurter lists onshore CNY
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`);
      if (res.ok) {
        const data = (await res.json()) as { rates?: Record<string, number> };
        const rate = data.rates?.[quote];
        if (typeof rate === "number" && isFinite(rate)) return rate;
      }
    }
  } catch {
    // fall through to Yahoo
  }
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
    const html = (await res.text()).replace(/&[a-zA-Z0-9#]+;/g, " ");
    const rows = [
      ...html.matchAll(
        /<tr[^>]*>\s*<td>([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>\s*([\d.,]+)/gi
      ),
    ];
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

const PORTWATCH_DAILY = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

async function arcgisQuery(
  url: string,
  where = "1=1",
  extra = "",
  opts?: { outFields?: string; timeoutMs?: number },
): Promise<unknown> {
  // NOTE: outFields must NOT be percent-encoded — ArcGIS rejects an encoded
  // comma list ("Invalid query parameters"). Commas are legal in a query
  // string, so pass them through verbatim.
  const u = `${url}?where=${encodeURIComponent(where)}&outFields=${opts?.outFields ?? "*"}&returnGeometry=false&f=json${extra}`;
  const res = await fetch(u, { signal: AbortSignal.timeout(opts?.timeoutMs ?? 20000) });
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
  return res.json();
}

async function arcgisQueryPaged(url: string, where: string, pages: number): Promise<Array<{ attributes: Record<string, unknown> }>> {
  // ArcGIS caps resultRecordCount at 1000; page with resultOffset to cover a full year.
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      arcgisQuery(url, where, `&resultRecordCount=1000&resultOffset=${i * 1000}&orderByFields=date%20DESC`)
    )
  );
  return results.flatMap(
    (r) => (r as { features?: Array<{ attributes: Record<string, unknown> }> })?.features ?? []
  );
}

export interface ShippingPoint {
  date: string;
  volumeTonnes: number | null;
  vessels: number | null;
}

export interface ShippingRow {
  chokepoint: string;
  volumeTonnes: number | null;
  vessels: number | null;
  status: "bullish" | "neutral" | "bearish";
  note: string;
  series: ShippingPoint[];
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SHIPPING_FEATURED: Array<{ name: string; aliases: string[] }> = [
  { name: "Suez Canal", aliases: ["suez"] },
  { name: "Panama Canal", aliases: ["panama"] },
  { name: "Strait of Hormuz", aliases: ["hormuz"] },
  { name: "Strait of Malacca", aliases: ["malacca"] },
  { name: "Bab el-Mandeb", aliases: ["bab el-mandeb", "bab elmandeb"] },
  { name: "Cape of Good Hope", aliases: ["cape of good hope"] },
];

type ShippingSnapshot = {
  rows: ShippingRow[];
  updatedAt: string;
  available: boolean;
  /** Every featured chokepoint has charted history (not a partial refresh). */
  complete?: boolean;
};

const SHIPPING_CACHE_KEY = "shipping:last-good";
const SHIPPING_FIELDS = "portname,date,capacity,n_total";

let lastGoodShipping: ShippingSnapshot | null = null;
let shippingHydrated = false;
let shippingInflight: Promise<ShippingSnapshot> | null = null;
let lastShippingFailureAt = 0;
let lastShippingAttemptAt = 0;
const SHIPPING_FAILURE_COOLDOWN_MS = 60_000;
/** Points needed for a "complete" year-long series. */
const SHIPPING_FULL_SERIES = 300;
/** While a snapshot is incomplete, retry at most this often. */
const SHIPPING_PARTIAL_RETRY_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shipDate(d: unknown): string {
  if (typeof d === "number" && d > 1e12) return new Date(d).toISOString().split("T")[0];
  const s = String(d ?? "");
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.slice(0, 10);
}

interface ShipRec {
  date: string;
  capacity: number | null;
  vessels: number | null;
}

async function arcgisFeatures(
  where: string,
  recordCount: number,
): Promise<Array<{ attributes: Record<string, unknown> }>> {
  const resp = await arcgisQuery(
    PORTWATCH_DAILY,
    where,
    `&resultRecordCount=${recordCount}&orderByFields=date%20DESC`,
    { outFields: SHIPPING_FIELDS, timeoutMs: 6000 },
  );
  const r = resp as {
    features?: Array<{ attributes: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (r.error) throw new Error(`ArcGIS: ${r.error.message ?? "unknown error"}`);
  return r.features ?? [];
}

/**
 * One port's history, retried. ArcGIS intermittently answers with
 * "Invalid URL" / "Invalid query parameters", hangs, or returns a null
 * reference, so a single failed request must not sink the whole panel.
 */
async function fetchPortHistory(alias: string): Promise<Array<{ attributes: Record<string, unknown> }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // ~400 daily points ≈ 13 months: enough for a 1-year chart while being
      // ~2.5x lighter than the layer's 1000-record cap.
      const feats = await arcgisFeatures(`portname LIKE '%${alias}%'`, 400);
      if (feats.length > 0) return feats;
    } catch (err) {
      logger.warn({ err, alias, attempt: attempt + 1 }, "PortWatch port query failed");
    }
    if (attempt < 1) await sleep(400);
  }
  return [];
}

/** Latest window covering every port — one request, works even in short windows. */
async function fetchRecentAllPorts(): Promise<Array<{ attributes: Record<string, unknown> }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 1000 records ≈ 35 days across all 28 chokepoints.
      const feats = await arcgisFeatures("1=1", 1000);
      if (feats.length > 0) return feats;
    } catch (err) {
      logger.warn({ err, attempt: attempt + 1 }, "PortWatch recent query failed");
    }
    if (attempt < 1) await sleep(500);
  }
  return [];
}

function collectPorts(
  byPort: Map<string, ShipRec[]>,
  feats: Array<{ attributes: Record<string, unknown> }>,
): void {
  for (const f of feats) {
    const a = f.attributes;
    const name = String(a["portname"] ?? "").trim();
    if (!name) continue;
    const capacity = a["capacity"] != null ? parseFloat(String(a["capacity"])) : NaN;
    const vessels = a["n_total"] != null ? parseFloat(String(a["n_total"])) : NaN;
    if (isNaN(capacity) && isNaN(vessels)) continue;
    const recs = byPort.get(name) ?? [];
    recs.push({
      date: shipDate(a["date"]),
      capacity: isNaN(capacity) ? null : capacity,
      vessels: isNaN(vessels) ? null : vessels,
    });
    byPort.set(name, recs);
  }
}

/** A snapshot is only usable if it actually contains charted history. */
function isUsableShippingSnapshot(s: ShippingSnapshot | null | undefined): s is ShippingSnapshot {
  return (
    !!s &&
    s.available === true &&
    Array.isArray(s.rows) &&
    s.rows.length > 0 &&
    s.rows.some((r) => Array.isArray(r.series) && r.series.length > 0)
  );
}

/** Union two series by date (newer values win), capped to the last year. */
function mergeSeries(prev: ShippingPoint[], next: ShippingPoint[]): ShippingPoint[] {
  const m = new Map<string, ShippingPoint>();
  for (const p of prev) m.set(p.date, p);
  for (const p of next) m.set(p.date, p);
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-365);
}

/** Restore the last successful snapshot saved in Postgres (survives restarts). */
async function hydrateShipping(): Promise<void> {
  if (shippingHydrated) return;
  shippingHydrated = true;
  if (lastGoodShipping || !hasPg()) return;
  try {
    const saved = await readMacroCache<ShippingSnapshot>(SHIPPING_CACHE_KEY);
    if (!lastGoodShipping && isUsableShippingSnapshot(saved)) {
      // Recompute completeness instead of trusting the stored flag: an older
      // snapshot may predate the full-year check and would otherwise be
      // cached as final with short fallback series.
      saved.complete = saved.rows.every(
        (r) => Array.isArray(r.series) && r.series.length >= SHIPPING_FULL_SERIES,
      );
      lastGoodShipping = saved;
      logger.info({ rows: saved.rows.length }, "Shipping snapshot restored from Postgres");
    } else if (saved) {
      logger.warn("Ignoring unusable shipping snapshot in Postgres");
    }
  } catch (err) {
    logger.warn({ err }, "Shipping snapshot restore failed");
  }
}

async function fetchShippingData(): Promise<ShippingSnapshot> {
  try {
    // Run both strategies at once:
    //  - one `1=1` request covers every port for the last ~35 days, so a short
    //    upstream window still yields real values for all six chokepoints;
    //  - per-port requests extend each series to ~1 year when they succeed.
    const byPort = new Map<string, ShipRec[]>();
    const [recent, perPort] = await Promise.all([
      fetchRecentAllPorts(),
      Promise.all(
        SHIPPING_FEATURED.map(async (fp, i) => {
          // Stagger the burst so ArcGIS doesn't reject every request at once.
          if (i > 0) await sleep(i * 150);
          return fetchPortHistory(fp.aliases[0]);
        }),
      ),
    ]);
    collectPorts(byPort, recent);
    for (const feats of perPort) collectPorts(byPort, feats);

    const rows: ShippingRow[] = [];
    for (const featured of SHIPPING_FEATURED) {
      const match = [...byPort.keys()].find((name) => {
        const norm = normalizeName(name);
        return featured.aliases.some(
          (al) => norm.includes(normalizeName(al)) || normalizeName(al).includes(norm)
        );
      });
      const recs = match ? (byPort.get(match) ?? []) : [];

      let volume: number | null = null;
      let vessels: number | null = null;
      let dataDate: string | null = null;
      let status: ShippingRow["status"] = "neutral";
      let note: string;
      let series: ShippingPoint[] = [];

      if (recs.length === 0) {
        note = "No transit data available for this chokepoint.";
      } else {
        // Dedupe by date — the recent window and per-port history overlap.
        const uniq = new Map<string, ShipRec>();
        for (const r of recs) uniq.set(r.date, r);
        const sorted = [...uniq.values()].sort((x, y) => x.date.localeCompare(y.date));
        const latest = sorted[sorted.length - 1];
        volume = latest.capacity;
        vessels = latest.vessels;
        dataDate = latest.date || null;

        series = sorted.slice(-365).map((r) => ({
          date: r.date,
          volumeTonnes: r.capacity,
          vessels: r.vessels,
        }));

        const history = sorted.slice(0, -1);
        const baselineWindow = history.slice(-90);
        const valid = baselineWindow.filter((r) => r.capacity != null).map((r) => r.capacity as number);
        const baseline = valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;

        if (volume == null) {
          note = `Vessel transits recorded (${vessels ?? "n/a"} ships/day) — no tonnage figure available.`;
        } else {
          const vs = baseline != null && baseline > 0 ? ((volume - baseline) / baseline) * 100 : 0;
          status = vs > 20 ? "bullish" : vs < -20 ? "bearish" : "neutral";
          const pct = baseline != null ? ` (${vs > 0 ? "+" : ""}${vs.toFixed(0)}% vs recent baseline)` : "";
          note = `${(volume / 1e6).toFixed(0)}M tonnes/day${pct}. ${
            status === "bullish"
              ? "Strong trade flows (supportive for global growth)."
              : status === "bearish"
                ? "Reduced flows (trade disruption risk)."
                : "Normal activity."
          }`;
        }
      }

      rows.push({
        chokepoint: featured.name,
        volumeTonnes: volume,
        vessels,
        status,
        note: dataDate ? `${note} Data as of ${dataDate}.` : note,
        series,
      });
    }

    // Preserve longer history from the previous snapshot when this refresh
    // only managed the short recent window (flaky upstream). A partial fetch
    // must never shrink a 1-year series back to 35 days.
    if (lastGoodShipping) {
      const prevByPort = new Map(lastGoodShipping.rows.map((r) => [r.chokepoint, r]));
      for (let i = 0; i < rows.length; i++) {
        const prev = prevByPort.get(rows[i].chokepoint);
        if (!prev) continue;
        if (rows[i].series.length === 0) {
          rows[i] = prev;
        } else if (prev.series.length > 0) {
          rows[i] = { ...rows[i], series: mergeSeries(prev.series, rows[i].series) };
        }
      }
    }

    const result: ShippingSnapshot = {
      rows,
      updatedAt: new Date().toISOString(),
      available: rows.some((r) => r.volumeTonnes != null || r.vessels != null),
      // A partial refresh must stay retryable: consumers skip caching it.
      // Require close to a full year per port so fallback windows (≈35 pts)
      // keep getting enriched instead of freezing the chart at 1 month.
      complete: rows.every((r) => r.series.length >= SHIPPING_FULL_SERIES),
    };
    if (isUsableShippingSnapshot(result)) {
      lastGoodShipping = result;
      // Persist in the background — a slow DB must not delay the response.
      void writeMacroCache(SHIPPING_CACHE_KEY, result).catch((err) =>
        logger.warn({ err }, "Shipping snapshot persist failed"),
      );
    } else {
      lastShippingFailureAt = Date.now();
    }
    return result;
  } catch (err) {
    logger.warn({ err }, "Shipping data unavailable");
    lastShippingFailureAt = Date.now();
    if (lastGoodShipping) return lastGoodShipping;
    return { rows: [], updatedAt: new Date().toISOString(), available: false };
  }
}

export async function getShippingData(): Promise<ShippingSnapshot> {
  await hydrateShipping();
  // Without any cached snapshot there is nothing to show; don't hammer the
  // flaky upstream on every request — back off briefly after a total failure.
  if (
    !lastGoodShipping &&
    lastShippingFailureAt > 0 &&
    Date.now() - lastShippingFailureAt < SHIPPING_FAILURE_COOLDOWN_MS
  ) {
    return { rows: [], updatedAt: new Date().toISOString(), available: false };
  }
  // A partial snapshot (some ports still on the short fallback window) is
  // served, but retried at most every 90s instead of on every request.
  const partial = lastGoodShipping && lastGoodShipping.complete === false;
  if (partial && Date.now() - lastShippingAttemptAt < SHIPPING_PARTIAL_RETRY_MS) {
    return lastGoodShipping as ShippingSnapshot;
  }
  if (!shippingInflight) {
    lastShippingAttemptAt = Date.now();
    shippingInflight = fetchShippingData().finally(() => {
      shippingInflight = null;
    });
  }
  const inflight = shippingInflight;
  if (lastGoodShipping) {
    // Never block a cold instance on a slow upstream: serve the persisted
    // snapshot after 8s while the refresh keeps running in the background.
    return Promise.race([
      inflight,
      sleep(8000).then(() => lastGoodShipping as ShippingSnapshot),
    ]);
  }
  return inflight;
}
