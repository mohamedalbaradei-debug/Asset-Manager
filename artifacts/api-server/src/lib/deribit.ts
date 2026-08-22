import { logger } from "./logger";

/**
 * Deribit public API (keyless) — crypto options chains and futures.
 * Options: grouped per expiry with OI / mark per strike, plus put/call
 * open-interest ratio and max-pain per expiry. Futures: term structure.
 */

const DERIBIT = "https://www.deribit.com/api/v2";

export interface StrikeRow {
  strike: number;
  callOi: number | null;
  putOi: number | null;
  callMark: number | null;
  putMark: number | null;
}

export interface ExpiryChain {
  date: string; // ISO yyyy-mm-dd
  daysToExpiry: number;
  strikes: StrikeRow[];
  totalCallOi: number;
  totalPutOi: number;
  putCallRatio: number | null;
  maxPain: number | null;
}

export interface FuturesRow {
  instrument: string;
  maturityDate: string | null;
  markPrice: number | null;
  lastPrice: number | null;
  openInterest: number | null;
  annualizedPct: number | null;
}

export interface CryptoOptionsData {
  currency: string;
  spot: number | null;
  expiries: ExpiryChain[];
  futures: FuturesRow[];
  updatedAt: string;
}

interface BookSummary {
  instrument_name?: string;
  mark_price?: number;
  last?: number;
  open_interest?: number;
  underlying_price?: number;
  interest_rate?: number;
  maturity_date?: number;
}

async function bookSummaries(currency: string, kind: "option" | "future"): Promise<BookSummary[]> {
  const res = await fetch(
    `${DERIBIT}/public/get_book_summary_by_currency?currency=${encodeURIComponent(currency)}&kind=${kind}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) throw new Error(`Deribit ${currency} ${kind}: ${res.status}`);
  const d = (await res.json()) as { result?: BookSummary[] };
  return d.result ?? [];
}

/** BTC-27MAR26-60000-C → { date: 2026-03-27, strike: 60000, type: C } */
function parseInstrument(name: string): { date: string | null; ts: number; strike: number; type: "C" | "P" } | null {
  const m = /^([A-Z]{2,3})-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!m) return null;
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const mon = months[m[3]];
  if (mon === undefined) return null;
  const year = 2000 + parseInt(m[4], 10);
  const ts = Date.UTC(year, mon, parseInt(m[2], 10), 8); // Deribit settles 08:00 UTC
  return { date: new Date(ts).toISOString().split("T")[0], ts, strike: parseFloat(m[5]), type: m[6] as "C" | "P" };
}

/** Max pain: the strike where total option-holder payout is minimised. */
function maxPain(strikes: number[], calls: Map<number, number>, puts: Map<number, number>): number | null {
  if (strikes.length === 0) return null;
  let best: { k: number; pain: number } | null = null;
  for (const k of strikes) {
    let pain = 0;
    for (const s of strikes) {
      pain += Math.max(k - s, 0) * (calls.get(s) ?? 0);
      pain += Math.max(s - k, 0) * (puts.get(s) ?? 0);
    }
    if (!best || pain < best.pain) best = { k, pain };
  }
  return best ? best.k : null;
}

const chainsCache = new Map<string, { t: number; v: CryptoOptionsData }>();

export async function getCryptoOptions(currencyRaw: string): Promise<CryptoOptionsData> {
  const currency = ["BTC", "ETH"].includes(currencyRaw.toUpperCase()) ? currencyRaw.toUpperCase() : "BTC";
  const hit = chainsCache.get(currency);
  if (hit && Date.now() - hit.t < 10 * 60_000) return hit.v;

  const [options, futures] = await Promise.all([
    bookSummaries(currency, "option"),
    bookSummaries(currency, "future").catch((err) => {
      logger.warn({ err }, "Deribit futures fetch failed");
      return [] as BookSummary[];
    }),
  ]);

  const byExpiry = new Map<string, { ts: number; strikes: Set<number>; cOi: Map<number, number>; pOi: Map<number, number>; cMark: Map<number, number>; pMark: Map<number, number> }>();
  let spot: number | null = null;

  for (const o of options) {
    const name = o.instrument_name ?? "";
    const parsed = parseInstrument(name);
    if (!parsed?.date) continue;
    spot ??= typeof o.underlying_price === "number" ? o.underlying_price : null;
    let e = byExpiry.get(parsed.date);
    if (!e) {
      e = { ts: parsed.ts, strikes: new Set(), cOi: new Map(), pOi: new Map(), cMark: new Map(), pMark: new Map() };
      byExpiry.set(parsed.date, e);
    }
    e.strikes.add(parsed.strike);
    const oi = typeof o.open_interest === "number" ? o.open_interest : 0;
    if (parsed.type === "C") {
      e.cOi.set(parsed.strike, (e.cOi.get(parsed.strike) ?? 0) + oi);
      if (typeof o.mark_price === "number") e.cMark.set(parsed.strike, o.mark_price);
    } else {
      e.pOi.set(parsed.strike, (e.pOi.get(parsed.strike) ?? 0) + oi);
      if (typeof o.mark_price === "number") e.pMark.set(parsed.strike, o.mark_price);
    }
  }

  const now = Date.now();
  const expiries: ExpiryChain[] = [...byExpiry.entries()]
    .filter(([, e]) => e.ts > now - 24 * 3600_000)
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(0, 8)
    .map(([date, e]) => {
      const strikes = [...e.strikes].sort((a, b) => a - b);
      const rows: StrikeRow[] = strikes.map((k) => ({
        strike: k,
        callOi: e.cOi.get(k) ?? 0,
        putOi: e.pOi.get(k) ?? 0,
        callMark: e.cMark.get(k) ?? null,
        putMark: e.pMark.get(k) ?? null,
      }));
      const tc = [...e.cOi.values()].reduce((a, b) => a + b, 0);
      const tp = [...e.pOi.values()].reduce((a, b) => a + b, 0);
      return {
        date,
        daysToExpiry: Math.max(0, Math.round((e.ts - now) / 86400_000)),
        strikes: rows,
        totalCallOi: tc,
        totalPutOi: tp,
        putCallRatio: tp > 0 ? tc / tp : null,
        maxPain: maxPain(strikes, e.cOi, e.pOi),
      };
    });

  const futureRows: FuturesRow[] = futures
    .filter((f) => typeof f.instrument_name === "string" && !/PERPETUAL/i.test(f.instrument_name))
    .map((f) => ({
      instrument: f.instrument_name!,
      maturityDate:
        typeof f.maturity_date === "number"
          ? new Date(f.maturity_date * (f.maturity_date < 1e12 ? 1000 : 1)).toISOString().split("T")[0]
          : null,
      markPrice: typeof f.mark_price === "number" ? f.mark_price : null,
      lastPrice: typeof f.last === "number" ? f.last : null,
      openInterest: typeof f.open_interest === "number" ? f.open_interest : null,
      annualizedPct: typeof f.interest_rate === "number" ? f.interest_rate * 100 : null,
    }))
    .sort((a, b) => (a.maturityDate ?? "").localeCompare(b.maturityDate ?? ""));

  const out: CryptoOptionsData = {
    currency,
    spot,
    expiries,
    futures: futureRows,
    updatedAt: new Date().toISOString(),
  };
  chainsCache.set(currency, { t: now, v: out });
  return out;
}
