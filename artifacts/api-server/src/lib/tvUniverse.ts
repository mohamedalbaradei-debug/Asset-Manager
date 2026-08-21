import { logger } from "./logger";

// One TradingView scanner request covers the whole US stock universe with
// price/change/volume/SMA50 — works from datacenter IPs where Yahoo blocks
// quoteSummary. Powers market breadth, TRIN internals, and trending quotes.

export interface TvUniverseRow {
  ticker: string; // "NYSE:AAPL"
  name: string;
  description: string | null;
  close: number;
  changePct: number; // percent
  changeAbs: number;
  volume: number;
  sma50: number | null;
}

const UNIVERSE_URL = "https://scanner.tradingview.com/america/scan";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 AIInvestSys/1.0";

const TTL = 15 * 60 * 1000;
let cache: { t: number; rows: TvUniverseRow[] } | null = null;

async function fetchOnce(): Promise<TvUniverseRow[]> {
  const body = {
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "volume", operation: "greater", right: 50000 },
      { left: "close", operation: "greater", right: 1 },
    ],
    operation: "and",
    columns: ["name", "close", "change", "change_abs", "volume", "SMA50", "description"],
    range: [0, 6000],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
  };

  const res = await fetch(UNIVERSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: "https://www.tradingview.com" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TV scanner ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ s: string; d: Array<string | number | null> }>;
  };

  return (json.data ?? [])
    .map((row) => {
      const [name, close, changePct, changeAbs, volume, sma50, description] = row.d as [
        string,
        number,
        number,
        number,
        number,
        number | null,
        string | null,
      ];
      if (typeof close !== "number") return null;
      return {
        ticker: row.s,
        name,
        description: typeof description === "string" ? description : null,
        close,
        changePct: typeof changePct === "number" ? changePct : 0,
        changeAbs: typeof changeAbs === "number" ? changeAbs : 0,
        volume: typeof volume === "number" ? volume : 0,
        sma50: typeof sma50 === "number" && sma50 > 0 ? sma50 : null,
      } satisfies TvUniverseRow;
    })
    .filter((r): r is TvUniverseRow => r !== null);
}

/** Full US stock universe (~4k rows), cached for 15 minutes. */
export async function fetchTvUniverse(): Promise<TvUniverseRow[]> {
  if (cache && Date.now() - cache.t < TTL) return cache.rows;
  try {
    const rows = await fetchOnce();
    if (rows.length > 0) cache = { t: Date.now(), rows };
    return rows;
  } catch (err) {
    logger.warn({ err }, "TV universe fetch failed");
    return cache?.rows ?? [];
  }
}

/** Look up a plain US ticker (AAPL / BRK.B / TSM) in the cached universe. */
export function findInUniverse(
  rows: TvUniverseRow[],
  symbol: string
): TvUniverseRow | null {
  const s = symbol.toUpperCase();
  return (
    rows.find((r) => r.ticker.endsWith(`:${s}`)) ??
    rows.find((r) => r.ticker.endsWith(`:${s.replace(".", "-")}`)) ??
    rows.find((r) => r.ticker.endsWith(`:${s.replace("-", ".")}`)) ??
    null
  );
}

/**
 * Arms Index (TRIN) computed across the whole US market:
 *   TRIN = (advancers / decliners) / (advancing volume / declining volume)
 * < 1 → buying pressure, > 1 → selling pressure.
 */
export function computeTrinFromUniverse(rows: TvUniverseRow[]): number | null {
  let adv = 0;
  let dec = 0;
  let advVol = 0;
  let decVol = 0;
  for (const r of rows) {
    if (r.volume <= 0) continue;
    if (r.changePct > 0) {
      adv += 1;
      advVol += r.volume;
    } else if (r.changePct < 0) {
      dec += 1;
      decVol += r.volume;
    }
  }
  if (adv === 0 || dec === 0 || advVol === 0 || decVol === 0) return null;
  return Math.round(((adv / dec) / (advVol / decVol)) * 100) / 100;
}

/** Spot VIX from CBOE's delayed-quotes endpoint (browser UA required). */
export async function fetchVixSpot(): Promise<number | null> {
  try {
    const res = await fetch("https://cdn.cboe.com/api/global/delayed_quotes/options/_VIX.json", {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`CBOE ${res.status}`);
    const json = (await res.json()) as { data?: { current_price?: number } };
    const v = json.data?.current_price;
    return typeof v === "number" && v > 5 ? v : null;
  } catch (err) {
    logger.warn({ err }, "VIX spot fetch failed");
    return null;
  }
}
