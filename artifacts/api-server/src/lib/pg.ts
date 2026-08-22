import { logger } from "./logger";

/**
 * Optional Postgres persistence (Neon free tier).
 *
 * When DATABASE_URL is set, durable storage (watchlist, performance log,
 * news archive) lives in Postgres instead of DATA_DIR files — Render's free
 * disk is wiped on every deploy. When unset, callers fall back to the
 * original file-based behavior so local dev needs zero setup.
 */

let poolPromise: Promise<import("pg").Pool> | null = null;

export function hasPg(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function getPool(): Promise<import("pg").Pool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes("localhost")
          ? undefined
          : { rejectUnauthorized: false },
        max: 5,
      });
      await ensureSchema(pool);
      logger.info("Postgres storage ready");
      return pool;
    })().catch((err) => {
      // Reset so a later call can retry after transient boot failures.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/** Run a query against the pool; throws so callers can fall back to files. */
export async function pgQuery<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<import("pg").QueryResult<T>> {
  const pool = await getPool();
  return pool.query<T>(text, values as unknown[]);
}

async function ensureSchema(pool: import("pg").Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      ticker TEXT PRIMARY KEY,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS performance_log (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      entry DOUBLE PRECISION,
      target DOUBLE PRECISION,
      stop_loss DOUBLE PRECISION
    );
    CREATE TABLE IF NOT EXISTS news_archive (
      id BIGSERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT NOT NULL,
      published_at TEXT,
      sentiment TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS news_archive_ticker_idx ON news_archive (ticker);
    CREATE INDEX IF NOT EXISTS news_archive_created_idx ON news_archive (created_at DESC);
  `);
}
