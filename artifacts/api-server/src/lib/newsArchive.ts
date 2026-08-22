import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/**
 * Searchable news archive + event study.
 *
 * Every /news refresh appends its headlines to a JSONL file under DATA_DIR
 * (same best-effort persistence as the watchlist). Articles are tagged with
 * tickers via $CASHTAGS and whole-word symbol matches from the watchlist.
 * The event study groups archive rows by day and measures the ticker's
 * close-to-close return over the following N sessions, SPY-normalised.
 */

import type { NewsItem } from "./newsSentiment";
import { yahooFinance } from "./yahoo";

function dataDir(): string {
  return process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
}

function archiveFile(): string {
  return path.join(dataDir(), "news-archive.jsonl");
}

export interface ArchivedArticle {
  ticker: string;
  title: string;
  url: string | null;
  source: string;
  publishedAt: string | null;
  sentiment: string;
}

const seenKeys = new Set<string>();

/** Decode the handful of HTML entities RSS feeds love to leave in titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return code > 32 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return code > 32 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Headlines usually mention mega-caps by name; a compact map covers most
 *  ticker-tagging cases without shipping the whole EDGAR universe. */
const NAME_TO_TICKER: Array<[RegExp, string]> = [
  [/\bAPPLE\b/i, "AAPL"],
  [/\bMICROSOFT\b|\bMSFT\b/i, "MSFT"],
  [/\bNVIDIA\b/i, "NVDA"],
  [/\bTESLA\b|\bMUSK\b/i, "TSLA"],
  [/\bALPHABET\b|\bGOOGLE\b/i, "GOOGL"],
  [/\bAMAZON\b/i, "AMZN"],
  [/\bMETA PLATFORMS\b|\bFACEBOOK\b/i, "META"],
  [/\bBERKSHIRE\b|\bBUFFETT\b/i, "BRK-B"],
  [/\bJPMORGAN\b/i, "JPM"],
  [/\bVISA\b/i, "V"],
  [/\bMASTERCARD\b/i, "MA"],
  [/\bNETFLIX\b/i, "NFLX"],
  [/\bAMD\b/i, "AMD"],
  [/\bINTEL\b/i, "INTC"],
  [/\bBOEING\b/i, "BA"],
  [/\bCOCA-COLA\b/i, "KO"],
  [/\bPEPSICO\b|\bPEPSI\b/i, "PEP"],
  [/\bWALMART\b/i, "WMT"],
  [/\bJOHNSON & JOHNSON\b|\bJOHNSON'S & JOHNSON\b/i, "JNJ"],
  [/\bPFIZER\b/i, "PFE"],
  [/\bMODERNA\b/i, "MRNA"],
  [/\bDISNEY\b/i, "DIS"],
  [/\bSALESFORCE\b/i, "CRM"],
  [/\bORACLE\b/i, "ORCL"],
  [/\bCISCO\b/i, "CSCO"],
  [/\bQUALCOMM\b/i, "QCOM"],
  [/\bUBER\b/i, "UBER"],
  [/\bPALANTIR\b/i, "PLTR"],
  [/\bGOLDMAN\b/i, "GS"],
  [/\bmorgan stanley\b/i, "MS"],
  [/\bCATERPILLAR\b/i, "CAT"],
  [/\bEXXON\b/i, "XOM"],
  [/\bCHEVRON\b/i, "CVX"],
];

/** Extract cashtags, watchlist symbols and well-known company names. */
function extractTickers(text: string, watchlist: string[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) {
    found.add(m[1].toUpperCase());
  }
  for (const [re, ticker] of NAME_TO_TICKER) {
    if (re.test(text)) found.add(ticker);
  }
  const upper = text.toUpperCase();
  for (const t of watchlist) {
    if (t.length >= 3 && new RegExp(`\\b${t}\\b`).test(upper)) found.add(t);
  }
  return [...found];
}

let collectorRunning = false;

/** Fire-and-forget collector called after each successful /news refresh. */
export function collectNews(items: NewsItem[], watchlist: string[]): void {
  if (collectorRunning || items.length === 0) return;
  collectorRunning = true;
  void (async () => {
    try {
      await fs.mkdir(dataDir(), { recursive: true });
      const lines: string[] = [];
      for (const item of items) {
        const key = (item.link ?? item.title).toLowerCase();
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const cleanTitle = decodeEntities(item.title);
        const cleanSummary = item.summary ? decodeEntities(item.summary) : "";
        const tickers = extractTickers(`${cleanTitle} ${cleanSummary}`, watchlist);
        for (const ticker of tickers.length > 0 ? tickers : ["_MARKET"]) {
          lines.push(
            JSON.stringify({
              ticker,
              title: cleanTitle,
              url: item.link,
              source: item.source,
              publishedAt: item.publishedAt,
              sentiment: item.sentimentLabel,
            }),
          );
        }
      }
      if (lines.length > 0) {
        await fs.appendFile(archiveFile(), lines.join("\n") + "\n", "utf-8");
      }
    } catch (err) {
      logger.warn({ err }, "News archive append failed");
    } finally {
      collectorRunning = false;
    }
  })();
}

async function readArchive(): Promise<ArchivedArticle[]> {
  let raw: string;
  try {
    raw = await fs.readFile(archiveFile(), "utf-8");
  } catch {
    return [];
  }
  const out: ArchivedArticle[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as ArchivedArticle;
      if (!obj || typeof obj.title !== "string" || typeof obj.ticker !== "string") continue;
      // One copy per article across collector restarts.
      const key = (obj.url ?? obj.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(obj);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

export async function queryArchive(opts: { ticker?: string | null; from?: string | null; to?: string | null; limit?: number }): Promise<{ articles: ArchivedArticle[]; total: number }> {
  const all = await readArchive();
  const t = opts.ticker?.toUpperCase().trim() || null;
  const filtered = all.filter((a) => {
    if (t && a.ticker !== t && !a.title.toUpperCase().includes(t)) return false;
    const d = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
    if (opts.from && !(isFinite(d) && d >= Date.parse(opts.from))) return false;
    if (opts.to) {
      const toEnd = Date.parse(opts.to) + 86400_000;
      if (!(isFinite(d) && d < toEnd)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
  const limit = Math.min(opts.limit ?? 100, 300);
  return { articles: filtered.slice(0, limit), total: filtered.length };
}

// ── Event study ──────────────────────────────────────────────────────────────

export interface EventStudyEvent {
  date: string;
  headlines: number;
  retPct: number | null;
  spyRetPct: number | null;
  excessPct: number | null;
}

export interface EventStudyResult {
  ticker: string;
  windowDays: number;
  events: EventStudyEvent[];
  avgExcessPct: number | null;
  positiveEvents: number;
  negativeEvents: number;
}

interface DailySeries {
  dates: string[];
  closes: Map<string, number>;
}

async function dailySeries(symbol: string): Promise<DailySeries> {
  const since = new Date();
  since.setDate(since.getDate() - 400);
  const res = await yahooFinance.chart(symbol, { period1: since, interval: "1d" });
  const quotes = (res.quotes ?? []) as Array<{ date?: string; close?: number }>;
  const dates: string[] = [];
  const closes = new Map<string, number>();
  for (const q of quotes) {
    if (!q.date || typeof q.close !== "number" || !isFinite(q.close)) continue;
    const d = new Date(q.date).toISOString().split("T")[0];
    dates.push(d);
    closes.set(d, q.close);
  }
  return { dates: [...new Set(dates)].sort(), closes };
}

const studyCache = new Map<string, { t: number; v: EventStudyResult }>();

export async function getEventStudy(tickerRaw: string, windowDaysRaw?: number): Promise<EventStudyResult> {
  const ticker = tickerRaw.toUpperCase().trim();
  const windowDays = Math.min(Math.max(windowDaysRaw ?? 2, 1), 10);
  const cacheKey = `${ticker}:${windowDays}`;
  const hit = studyCache.get(cacheKey);
  if (hit && Date.now() - hit.t < 30 * 60_000) return hit.v;

  const [archive, tickerSeries, spySeries] = await Promise.all([
    queryArchive({ ticker, limit: 300 }),
    dailySeries(ticker),
    dailySeries("SPY").catch(() => ({ dates: [], closes: new Map<string, number>() })),
  ]);

  // Group article days (only those with a matching archive tag).
  const byDay = new Map<string, number>();
  for (const a of archive.articles) {
    if (a.ticker !== ticker) continue;
    const d = a.publishedAt ? new Date(a.publishedAt).toISOString().split("T")[0] : null;
    if (!d) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }

  const events: EventStudyEvent[] = [];
  for (const [day, count] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 25)) {
    // First trading day on/after the headline day.
    let i = tickerSeries.dates.findIndex((d) => d >= day);
    if (i < 0 || i + windowDays >= tickerSeries.dates.length) continue;
    const start = tickerSeries.closes.get(tickerSeries.dates[i]);
    const end = tickerSeries.closes.get(tickerSeries.dates[i + windowDays]);
    const retPct =
      start != null && end != null && start !== 0 ? ((end - start) / start) * 100 : null;

    let spyRetPct: number | null = null;
    const si = spySeries.dates.findIndex((d) => d >= day);
    if (si >= 0 && si + windowDays < spySeries.dates.length) {
      const s0 = spySeries.closes.get(spySeries.dates[si]);
      const s1 = spySeries.closes.get(spySeries.dates[si + windowDays]);
      if (s0 != null && s1 != null && s0 !== 0) spyRetPct = ((s1 - s0) / s0) * 100;
    }
    const excessPct = retPct != null && spyRetPct != null ? retPct - spyRetPct : null;
    events.push({ date: day, headlines: count, retPct, spyRetPct, excessPct });
  }

  const excesses = events.map((e) => e.excessPct).filter((x): x is number => x != null);
  const out: EventStudyResult = {
    ticker,
    windowDays,
    events,
    avgExcessPct:
      excesses.length > 0 ? excesses.reduce((a, b) => a + b, 0) / excesses.length : null,
    positiveEvents: excesses.filter((x) => x > 0).length,
    negativeEvents: excesses.filter((x) => x <= 0).length,
  };
  studyCache.set(cacheKey, { t: Date.now(), v: out });
  return out;
}
