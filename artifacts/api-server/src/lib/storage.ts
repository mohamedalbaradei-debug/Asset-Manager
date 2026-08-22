import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { hasPg, pgQuery } from "./pg";

/**
 * Watchlist + recommendation performance log.
 *
 * Two interchangeable backends behind one API:
 *  - Postgres (when DATABASE_URL is set): durable across Render deploys.
 *  - JSON/CSV files under DATA_DIR (default ./data): zero-setup fallback.
 */

function dataDir(): string {
  return process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ── Watchlist ────────────────────────────────────────────────────────────────

const watchlistFile = (): string => path.join(dataDir(), "watchlist.json");

async function readWatchlistFile(): Promise<string[]> {
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
  if (hasPg()) {
    try {
      const r = await pgQuery<{ ticker: string }>(
        "SELECT ticker FROM watchlist ORDER BY added_at ASC, ticker ASC",
      );
      return r.rows.map((x) => x.ticker);
    } catch (err) {
      logger.warn({ err }, "Watchlist pg read failed — using files");
    }
  }
  return readWatchlistFile();
}

export async function addToWatchlist(ticker: string): Promise<{ list: string[]; added: boolean }> {
  const upper = ticker.toUpperCase().trim();
  if (hasPg()) {
    try {
      const ins = await pgQuery(
        "INSERT INTO watchlist (ticker) VALUES ($1) ON CONFLICT (ticker) DO NOTHING",
        [upper],
      );
      return { list: await getWatchlist(), added: (ins.rowCount ?? 0) > 0 };
    } catch (err) {
      logger.warn({ err }, "Watchlist pg write failed — using files");
    }
  }
  const list = await readWatchlistFile();
  if (list.includes(upper)) return { list, added: false };
  list.push(upper);
  await writeWatchlist(list);
  return { list, added: true };
}

export async function removeFromWatchlist(ticker: string): Promise<{ list: string[]; removed: boolean }> {
  const upper = ticker.toUpperCase().trim();
  if (hasPg()) {
    try {
      const del = await pgQuery("DELETE FROM watchlist WHERE ticker = $1", [upper]);
      if ((del.rowCount ?? 0) > 0) {
        return { list: await getWatchlist(), removed: true };
      }
      return { list: await getWatchlist(), removed: false };
    } catch (err) {
      logger.warn({ err }, "Watchlist pg delete failed — using files");
    }
  }
  const list = await readWatchlistFile();
  const next = list.filter((t) => t !== upper);
  if (next.length === list.length) return { list, removed: false };
  await writeWatchlist(next);
  return { list: next, removed: true };
}

// ── Per-user watchlist (auth; Postgres only) ────────────────────────────────

export async function getUserWatchlist(userId: string): Promise<string[]> {
  const r = await pgQuery<{ ticker: string }>(
    "SELECT ticker FROM user_watchlist WHERE user_id=$1 ORDER BY added_at ASC, ticker ASC",
    [userId],
  );
  return r.rows.map((x) => x.ticker);
}

export async function addToUserWatchlist(userId: string, ticker: string): Promise<{ list: string[]; added: boolean }> {
  const upper = ticker.toUpperCase().trim();
  const ins = await pgQuery(
    "INSERT INTO user_watchlist (user_id, ticker) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [userId, upper],
  );
  return { list: await getUserWatchlist(userId), added: (ins.rowCount ?? 0) > 0 };
}

export async function removeFromUserWatchlist(userId: string, ticker: string): Promise<{ list: string[]; removed: boolean }> {
  const upper = ticker.toUpperCase().trim();
  const del = await pgQuery("DELETE FROM user_watchlist WHERE user_id=$1 AND ticker=$2", [userId, upper]);
  return { list: await getUserWatchlist(userId), removed: (del.rowCount ?? 0) > 0 };
}

// ── Performance log ──────────────────────────────────────────────────────────

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
  if (hasPg()) {
    try {
      await pgQuery(
        `INSERT INTO performance_log (ts, ticker, action, entry, target, stop_loss)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          isFinite(Date.parse(entry.timestamp)) ? new Date(entry.timestamp) : new Date(),
          entry.ticker,
          entry.action,
          entry.entry,
          entry.target,
          entry.stopLoss,
        ],
      );
      return;
    } catch (err) {
      logger.warn({ err }, "Performance pg insert failed — falling back to CSV");
    }
  }
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

const EMPTY_WIN_RATE_NOTE = "No logged recommendations yet.";

export async function getWinRate(): Promise<WinRateResult> {
  if (hasPg()) {
    try {
      const r = await pgQuery<{ count: string }>("SELECT COUNT(*)::text AS count FROM performance_log");
      const total = parseInt(r.rows[0]?.count ?? "0", 10);
      if (total === 0) {
        return { total: 0, wins: 0, losses: 0, winRate: null, note: EMPTY_WIN_RATE_NOTE };
      }
      return {
        total,
        wins: 0,
        losses: 0,
        winRate: null,
        note: `${total} recommendation(s) logged. Mark outcomes manually to compute win-rate.`,
      };
    } catch (err) {
      logger.warn({ err }, "Win-rate pg read failed — using CSV");
    }
  }
  try {
    const raw = await fs.readFile(perfFile(), "utf-8");
    const lines = raw.split("\n").filter(Boolean).slice(1);
    const rows = lines.map((l) => l.split(","));
    const valid = rows.filter((r) => r.length >= 4 && r[2]);
    if (valid.length === 0) {
      return { total: 0, wins: 0, losses: 0, winRate: null, note: EMPTY_WIN_RATE_NOTE };
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
      return { total: 0, wins: 0, losses: 0, winRate: null, note: EMPTY_WIN_RATE_NOTE };
    }
    logger.warn({ err }, "Win-rate read failed");
    return { total: 0, wins: 0, losses: 0, winRate: null, note: "Could not read performance log." };
  }
}
