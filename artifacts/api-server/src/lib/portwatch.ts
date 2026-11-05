import { logger } from "./logger";
import { hasPg, readMacroCache, writeMacroCache } from "./pg";

/**
 * IMF PortWatch — maritime chokepoint transit counts (keyless ArcGIS).
 * Daily_Chokepoints_Data: one row per chokepoint per day with vessel
 * transit counts by segment; PortWatch_chokepoints_database: metadata.
 */

const ARCGIS_BASE = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";
const DAILY_CHOKEPOINTS = `${ARCGIS_BASE}/Daily_Chokepoints_Data/FeatureServer/0/query`;
const CHOKEPOINTS_DB = `${ARCGIS_BASE}/PortWatch_chokepoints_database/FeatureServer/0/query`;

export interface ChokepointRow {
  id: string;
  name: string;
  date: string;
  cargo: number | null;
  container: number | null;
  dryBulk: number | null;
  generalCargo: number | null;
  roro: number | null;
  tanker: number | null;
  totalTransits: number | null;
}

export interface ChokepointsData {
  chokepoints: ChokepointRow[];
  date: string | null;
  updatedAt: string;
}

interface ArcGisResponse {
  features?: Array<{ attributes: Record<string, unknown> }>;
  error?: { message?: string };
}

async function arcgisQuery(baseUrl: string, opts: { where?: string; orderBy?: string; limit?: number }): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({
    where: opts.where ?? "1=1",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  if (opts.orderBy) qs.set("orderByFields", opts.orderBy);
  if (opts.limit) qs.set("resultRecordCount", String(opts.limit));
  const res = await fetch(`${baseUrl}?${qs.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PortWatch ${res.status}`);
  const data = (await res.json()) as ArcGisResponse;
  if (data.error) throw new Error(`PortWatch ArcGIS error: ${data.error.message ?? "unknown"}`);
  return (data.features ?? []).map((f) => f.attributes);
}

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

let dbCache: Map<string, string> | null = null; // portid -> name

async function chokepointNames(): Promise<Map<string, string>> {
  if (dbCache) return dbCache;
  const rows = await arcgisQuery(CHOKEPOINTS_DB, { limit: 100 });
  const m = new Map<string, string>();
  for (const r of rows) {
    const id = typeof r.portid === "string" ? r.portid : typeof r.chokepointid === "string" ? r.chokepointid : null;
    const name = typeof r.portname === "string" ? r.portname : null;
    if (id && name) m.set(id, name);
  }
  dbCache = m;
  return m;
}

const dayCache = new Map<string, { t: number; v: ChokepointsData }>();

const CHOKEPOINTS_CACHE_KEY = "shipping:chokepoints";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastGoodChokepoints: ChokepointsData | null = null;
let hydrated = false;

function toIsoDate(d: unknown): string | null {
  // ArcGIS 'date' field arrives as epoch millis in JSON mode.
  const n = num(d);
  if (n != null && n > 1e12) return new Date(n).toISOString().split("T")[0];
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return null;
}

/** Restore the last successful table from Postgres (survives restarts). */
async function hydrateChokepoints(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (lastGoodChokepoints || !hasPg()) return;
  try {
    const saved = await readMacroCache<ChokepointsData>(CHOKEPOINTS_CACHE_KEY);
    if (!lastGoodChokepoints && Array.isArray(saved?.chokepoints) && saved.chokepoints.length > 0) {
      lastGoodChokepoints = saved;
      logger.info({ rows: saved.chokepoints.length }, "Chokepoints table restored from Postgres");
    }
  } catch (err) {
    logger.warn({ err }, "Chokepoints table restore failed");
  }
}

export async function getChokepoints(): Promise<ChokepointsData> {
  const hit = dayCache.get("all");
  if (hit && Date.now() - hit.t < 12 * 3600_000) return hit.v;
  await hydrateChokepoints();

  try {
    // ArcGIS intermittently returns empty pages / errors — retry before giving
    // up, otherwise a single flaky response caches an empty table for 12h.
    let latest: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      latest = await arcgisQuery(DAILY_CHOKEPOINTS, { orderBy: "date DESC", limit: 1 });
      if (latest.length > 0) break;
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
    const latestDate = latest.length > 0 ? toIsoDate(latest[0].date) : null;
    if (!latestDate) throw new Error("PortWatch: no daily chokepoint rows found");

    let rows: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      rows = await arcgisQuery(DAILY_CHOKEPOINTS, { where: `date = DATE '${latestDate}'`, limit: 100 });
      if (rows.length > 0) break;
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
    if (rows.length === 0) throw new Error("PortWatch: empty daily chokepoint rows");

    const names = await chokepointNames().catch(() => new Map<string, string>());

    const chokepoints: ChokepointRow[] = rows.map((r) => {
      const id = typeof r.portid === "string" ? r.portid : typeof r.chokepointid === "string" ? r.chokepointid : "?";
      const parts = {
        cargo: num(r.n_cargo),
        container: num(r.n_container),
        dryBulk: num(r.n_dry_bulk),
        generalCargo: num(r.n_general_cargo),
        roro: num(r.n_roro),
        tanker: num(r.n_tanker),
      };
      const sum = Object.values(parts).reduce<number>((a, b) => a + (b ?? 0), 0);
      return {
        id,
        name: names.get(id) ?? (typeof r.portname === "string" ? r.portname : id),
        date: toIsoDate(r.date) ?? latestDate,
        ...parts,
        totalTransits: sum > 0 ? sum : num(r.n_transit),
      };
    });

    const out: ChokepointsData = {
      chokepoints: chokepoints.sort((a, b) => a.name.localeCompare(b.name)),
      date: latestDate,
      updatedAt: new Date().toISOString(),
    };
    dayCache.set("all", { t: Date.now(), v: out });
    lastGoodChokepoints = out;
    void writeMacroCache(CHOKEPOINTS_CACHE_KEY, out).catch((err) =>
      logger.warn({ err }, "Chokepoints table persist failed"),
    );
    return out;
  } catch (err) {
    logger.warn({ err }, "PortWatch chokepoints unavailable");
    // Serve the last known table rather than an empty panel.
    if (lastGoodChokepoints) return lastGoodChokepoints;
    throw err;
  }
}
