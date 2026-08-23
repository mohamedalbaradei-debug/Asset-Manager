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
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      pw_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_watchlist (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, ticker)
    );
    CREATE TABLE IF NOT EXISTS price_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('above','below')),
      kind TEXT NOT NULL DEFAULT 'price' CHECK (kind IN ('price','rsi_oversold','rsi_overbought')),
      price DOUBLE PRECISION NOT NULL,
      last_triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS price_alerts_user_idx ON price_alerts (user_id);
    CREATE TABLE IF NOT EXISTS user_holdings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      qty DOUBLE PRECISION NOT NULL,
      cost_usd DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS user_holdings_user_idx ON user_holdings (user_id);
    CREATE TABLE IF NOT EXISTS telegram_chats (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      digest_enabled BOOLEAN NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      total_usd DOUBLE PRECISION,
      PRIMARY KEY (user_id, day)
    );
    CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_idx ON portfolio_snapshots (user_id, day);
  `);
  // Migrations for tables created before these columns existed.
  await pool.query(`
    ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'price';
    ALTER TABLE telegram_chats ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT true;
    UPDATE price_alerts SET kind='price' WHERE kind IS NULL;
  `);
}
