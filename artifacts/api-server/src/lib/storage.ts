import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/**
 * Lightweight file storage for the watchlist (JSON) and the recommendation
 * performance log (CSV). Files live under DATA_DIR (default ./data), so they
 * can be overridden or persisted on hosting platforms.
 */

function dataDir(): string {
  return process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ── Watchlist ────────────────────────────────────────────────────────────────

const watchlistFile = (): string => path.join(dataDir(), "watchlist.json");

async function readWatchlist(): Promise<string[]> {
  try {
    const raw = await fs.readFile(watchlistFile(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ err }, "Watchlist read failed");
    }
    return [];
  }
}

async function writeWatchlist(list: string[]): Promise<void> {
  await ensureDir(dataDir());
  await fs.writeFile(watchlistFile(), JSON.stringify(list, null, 2), "utf-8");
}

export async function getWatchlist(): Promise<string[]> {
  return readWatchlist();
}

export async function addToWatchlist(ticker: string): Promise<{ list: string[]; added: boolean }> {
  const upper = ticker.toUpperCase().trim();
  const list = await readWatchlist();
  if (list.includes(upper)) return { list, added: false };
  list.push(upper);
  await writeWatchlist(list);
  return { list, added: true };
}

export async function removeFromWatchlist(ticker: string): Promise<{ list: string[]; removed: boolean }> {
  const upper = ticker.toUpperCase().trim();
  const list = await readWatchlist();
  const next = list.filter((t) => t !== upper);
  if (next.length === list.length) return { list, removed: false };
  await writeWatchlist(next);
  return { list: next, removed: true };
}

// ── Performance log (CSV) ────────────────────────────────────────────────────

const perfFile = (): string => path.join(dataDir(), "performance.csv");

export interface PerformanceEntry {
  timestamp: string;
  ticker: string;
  action: string;
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
}

export async function logRecommendation(entry: PerformanceEntry): Promise<void> {
  try {
    await ensureDir(dataDir());
    const exists = await fs
      .stat(perfFile())
      .then(() => true)
      .catch(() => false);
    const line = [
      entry.timestamp,
      entry.ticker,
      entry.action.replace(/,/g, ""),
      entry.entry ?? "",
      entry.target ?? "",
      entry.stopLoss ?? "",
    ].join(",");
    await fs.appendFile(perfFile(), (exists ? "" : "timestamp,ticker,action,entry,target,stop_loss\n") + line + "\n", "utf-8");
  } catch (err) {
    logger.warn({ err }, "Performance log write failed");
  }
}

export interface WinRateResult {
  total: number;
  wins: number;
  losses: number;
  winRate: number | null;
  note: string;
}

export async function getWinRate(): Promise<WinRateResult> {
  try {
    const raw = await fs.readFile(perfFile(), "utf-8");
    const lines = raw.split("\n").filter(Boolean).slice(1);
    const rows = lines.map((l) => l.split(","));
    const valid = rows.filter((r) => r.length >= 4 && r[2]);
    if (valid.length === 0) {
      return { total: 0, wins: 0, losses: 0, winRate: null, note: "No logged recommendations yet." };
    }
    // A win is counted when the target was hit above entry (long) — since we
    // can't track outcome automatically for free, we report the count of
    // logged recommendations and note that win-rate needs manual confirmation.
    return {
      total: valid.length,
      wins: 0,
      losses: 0,
      winRate: null,
      note: `${valid.length} recommendation(s) logged. Mark outcomes manually to compute win-rate.`,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { total: 0, wins: 0, losses: 0, winRate: null, note: "No logged recommendations yet." };
    }
    logger.warn({ err }, "Win-rate read failed");
    return { total: 0, wins: 0, losses: 0, winRate: null, note: "Could not read performance log." };
  }
}