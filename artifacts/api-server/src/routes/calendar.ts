import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const NASDAQ_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Cache each (type+date) for 6h — NASDAQ data is slow and changes daily.
const cache = new Map<string, { value: unknown; expiresAt: number }>();
function cached(key: string, ttlMs: number, producer: () => Promise<unknown>) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  return producer().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}

async function nasdaqGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://api.nasdaq.com/api/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "User-Agent": NASDAQ_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  return (await res.json()) as any;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalizeEarnings(rows: any[] | undefined) {
  return (rows ?? []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    fiscalQuarterEnding: r.fiscalQuarterEnding ?? null,
    epsForecast: r.epsForecast ?? null,
    lastYearEps: r.lastYearEPS ?? null,
    time: r.time ?? null,
    marketCap: r.marketCap ?? null,
  }));
}

function normalizeDividends(cal: any) {
  return (cal?.rows ?? []).map((r: any) => ({
    symbol: r.symbol,
    name: r.companyName,
    exDate: r.dividend_Ex_Date ?? null,
    paymentDate: r.payment_Date ?? null,
    recordDate: r.record_Date ?? null,
    dividendRate: r.dividend_Rate ?? null,
    annualDividend: r.indicated_Annual_Dividend ?? null,
  }));
}

function normalizeSplits(rows: any[] | undefined) {
  return (rows ?? []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    ratio: r.ratio ?? null,
    executionDate: r.executionDate ?? null,
  }));
}

function normalizeIpo(data: any) {
  const out: any[] = [];
  const buckets: Array<{ key: string; rowsPath: (d: any) => any[]; dateKey: string }> = [
    { key: "priced", rowsPath: (d) => d?.data?.priced?.rows ?? [], dateKey: "pricedDate" },
    { key: "upcoming", rowsPath: (d) => d?.data?.upcoming?.upcomingTable?.rows ?? [], dateKey: "expectedDate" },
    { key: "filed", rowsPath: (d) => d?.data?.filed?.rows ?? [], dateKey: "filedDate" },
  ];
  for (const b of buckets) {
    for (const r of b.rowsPath(data)) {
      out.push({
        symbol: r.proposedTickerSymbol ?? r.symbol ?? null,
        name: r.companyName ?? r.name ?? null,
        exchange: r.proposedExchange ?? null,
        price: r.proposedSharePrice ?? r.expectedPrice ?? null,
        shares: r.sharesOffered ?? null,
        expectedDate: r[b.dateKey] ?? null,
        status: b.key,
      });
    }
  }
  return out;
}

const TTL = 6 * 60 * 60 * 1000;
const VALID = new Set(["earnings", "dividends", "splits", "ipo"]);

router.get("/market-calendar", async (req: Request, res: Response): Promise<void> => {
  const type = String(req.query.type ?? "earnings");
  if (!VALID.has(type)) {
    res.status(400).json({ error: `Invalid type. Use one of: ${[...VALID].join(", ")}` });
    return;
  }
  const date = typeof req.query.date === "string" ? req.query.date : ymd(new Date());

  try {
    if (type === "ipo") {
      const data = await cached(`ipo:${date.slice(0, 7)}`, TTL, () => nasdaqGet("ipo/calendar"));
      const rows = normalizeIpo(data);
      res.json({ type, asOf: date, rows });
      return;
    }

    const data = await cached(`${type}:${date}`, TTL, () => nasdaqGet(`calendar/${type}`, { date }));
    let rows: any[] = [];
    if (type === "earnings") rows = normalizeEarnings(data?.data?.rows);
    else if (type === "dividends") rows = normalizeDividends(data?.data?.calendar);
    else if (type === "splits") rows = normalizeSplits(data?.data?.rows);
    res.json({ type, asOf: date, rows });
  } catch (err) {
    req.log.error({ err, type, date }, "Calendar fetch failed");
    res.status(502).json({ error: "Failed to load calendar data." });
  }
});

export default router;
