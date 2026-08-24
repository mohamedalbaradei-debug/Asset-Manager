import { logger } from "./logger";
import { hasPg, pgQuery } from "./pg";
import { yahooFinance } from "./yahoo";

/**
 * Telegram delivery for price alerts. Reuses a bot token (create free via
 * @BotFather). Alerts re-arm only after 24h to avoid spamming on every tick.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export async function tgSend(chatId: string, text: string): Promise<boolean> {
  if (!TOKEN || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return r.ok;
  } catch (err) {
    logger.warn({ err }, "telegram send failed");
    return false;
  }
}

interface PriceAlertRow {
  id: string;
  user_id: string;
  ticker: string;
  direction: string;
  kind?: string;
  price: number;
  last_triggered_at: Date | null;
  chat_id: string | null;
}

async function allPriceAlertsWithChats(): Promise<PriceAlertRow[]> {
  const r = await pgQuery<PriceAlertRow>(
    `SELECT a.id, a.user_id, a.ticker, a.direction, COALESCE(a.kind,'price') AS kind, a.price, a.last_triggered_at, t.chat_id
     FROM price_alerts a LEFT JOIN telegram_chats t ON t.user_id = a.user_id`,
  );
  return r.rows;
}

// ── RSI (14) from daily closes — same algorithm as the summary panels ──────

function calcRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses -= changes[i];
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i];
    avgGain = (avgGain * (period - 1) + Math.max(0, ch)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -ch)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function rsiMap(tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.allSettled(
    tickers.map(async (sym) => {
      try {
        const since = new Date(Date.now() - 180 * 86400_000);
        const chart = await yahooFinance.chart(sym, {
          period1: since.toISOString().slice(0, 10),
          interval: "1d",
        });
        // yahoo-finance2 v4 chart result shape varies; pull closes defensively.
        const quotes =
          ((chart as { quotes?: Array<{ close?: number | null }> }).quotes ?? []) as Array<{
            close?: number | null;
          }>;
        const closes = quotes.map((q) => q.close).filter((c): c is number => typeof c === "number");
        const rsi = calcRsi(closes);
        if (rsi != null) out.set(sym, rsi);
      } catch (err) {
        logger.warn({ err, sym }, "rsi fetch failed for alert");
      }
    }),
  );
  return out;
}

let checking = false;

export async function checkPriceAlerts(): Promise<{ checked: number; sent: number }> {
  if (!hasPg()) return { checked: 0, sent: 0 };
  let sent = 0;
  const alerts = await allPriceAlertsWithChats();
  if (alerts.length === 0) return { checked: 0, sent: 0 };

  const priceTickers = [...new Set(alerts.filter((a) => (a.kind ?? "price") === "price").map((a) => a.ticker))];
  const rsiTickers = [...new Set(alerts.filter((a) => (a.kind ?? "price").startsWith("rsi_")).map((a) => a.ticker))];
  const perfTickers = [...new Set(alerts.filter((a) => (a.kind ?? "price").startsWith("perf_")).map((a) => a.ticker))];

  let quoteMap = new Map<string, { price: number | null; name: string | null }>();
  let rsis = new Map<string, number>();
  let perfMap = new Map<string, number>();
  try {
    if (priceTickers.length > 0) {
      const quotes = await yahooFinance.quote(priceTickers);
      for (const q of Array.isArray(quotes) ? quotes : [quotes]) {
        if (q?.symbol) {
          quoteMap.set(q.symbol, {
            price: typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null,
            name: q.shortName ?? q.longName ?? null,
          });
        }
      }
    }
    if (rsiTickers.length > 0) rsis = await rsiMap(rsiTickers);
    if (perfTickers.length > 0) {
      const { getEtfScan } = await import("./etfTracker");
      const { items } = await getEtfScan({});
      for (const it of items) {
        if (it.perfMonth3 != null && isFinite(it.perfMonth3)) perfMap.set(it.ticker, it.perfMonth3);
      }
    }
  } catch (err) {
    logger.warn({ err }, "alert quote fetch failed");
    return { checked: alerts.length, sent: 0 };
  }

  for (const a of alerts) {
    const kind = a.kind ?? "price";
    let hit = false;
    let detail = "";
    if (kind === "price") {
      const px = quoteMap.get(a.ticker)?.price;
      if (px == null || !isFinite(px)) continue;
      hit = a.direction === "above" ? px > a.price : px < a.price;
      detail = `$${px.toFixed(2)} is ${a.direction} your alert level $${Number(a.price).toFixed(2)}`;
    } else if (kind.startsWith("perf_")) {
      const perf = perfMap.get(a.ticker);
      if (perf == null) continue; // not in the tracked ETF universe
      hit = kind === "perf_3m_above" ? perf > a.price : perf < -Math.abs(a.price);
      detail = `3M performance ${perf >= 0 ? "+" : ""}${perf.toFixed(1)}% ${kind === "perf_3m_above" ? `crossed above +${Number(a.price).toFixed(0)}%` : `dropped below -${Number(a.price).toFixed(0)}%`} — momentum alert`;
    } else {
      const rsi = rsis.get(a.ticker);
      if (rsi == null) continue;
      hit = kind === "rsi_oversold" ? rsi < 30 : rsi > 70;
      detail = `RSI ${rsi.toFixed(1)} — ${kind === "rsi_oversold" ? "oversold (<30), possible bounce setup" : "overbought (>70), possible pullback"}`;
    }
    if (!hit) continue;

    const last = a.last_triggered_at ? Date.parse(String(a.last_triggered_at)) : 0;
    if (Date.now() - last < 24 * 3600_000) continue;

    const msg = `Asset Manager — ${a.ticker} ${detail}`;
    const ok = await tgSend(a.chat_id ?? "", msg);
    if (ok) {
      sent++;
      await pgQuery("UPDATE price_alerts SET last_triggered_at = now() WHERE id = $1", [a.id]);
    }
  }
  return { checked: alerts.length, sent };
}

export function startAlertLoop(intervalMs = 15 * 60_000): void {
  if (!TOKEN) {
    logger.info("TELEGRAM_BOT_TOKEN not set — price-alert delivery disabled");
    return;
  }
  if (!hasPg()) {
    logger.info("No DATABASE_URL — price alerts disabled");
    return;
  }
  logger.info("Telegram price-alert delivery active");
  setInterval(() => {
    checkPriceAlerts().catch((err) => logger.warn({ err }, "alert loop failed"));
  }, intervalMs).unref();
}

// ── Daily digest (watchlist movers + upcoming earnings) ────────────────────

interface DigestChatRow {
  user_id: string;
  chat_id: string;
}

async function sendDigests(): Promise<number> {
  if (!hasPg()) return 0;
  const chats = await pgQuery<DigestChatRow>(
    "SELECT user_id, chat_id FROM telegram_chats WHERE digest_enabled",
  );
  let sent = 0;
  for (const row of chats.rows) {
    try {
      const watch = await pgQuery<{ ticker: string }>(
        "SELECT ticker FROM user_watchlist WHERE user_id=$1 ORDER BY added_at LIMIT 12",
        [row.user_id],
      );
      const tickers = watch.rows.map((r) => r.ticker);
      if (tickers.length === 0) continue;

      const lines: string[] = ["📊 Asset Manager daily digest", ""];

      try {
        const quotes = await yahooFinance.quote(tickers.slice(0, 12));
        const list = (Array.isArray(quotes) ? quotes : [quotes])
          .map((q) => ({ s: q?.symbol as string, p: q?.regularMarketPrice as number, c: q?.regularMarketChangePercent as number }))
          .sort((x, y) => (y.c ?? 0) - (x.c ?? 0));
        for (const q of list) {
          if (q.p == null) continue;
          lines.push(`${q.s}: $${q.p.toFixed(2)} (${(q.c ?? 0) >= 0 ? "+" : ""}${(q.c ?? 0).toFixed(2)}%)`);
        }
      } catch {
        /* quote failure — skip movers section */
      }

      // Upcoming earnings within 7 days via SEC-projected calendar.
      try {
        const { getCalendar } = await import("./calendar");
        const cal = await getCalendar(tickers.slice(0, 6));
        const soon = cal.earnings.filter((e) => {
          if (e.label !== "upcoming" || !e.date) return false;
          const d = Date.parse(e.date);
          return isFinite(d) && d - Date.now() < 7 * 86400_000 && d > Date.now() - 86400_000;
        });
        if (soon.length > 0) {
          lines.push("", "🗓 Earnings this week:");
          for (const e of soon) lines.push(`${e.ticker}: ${e.date}${e.epsEstimate != null ? ` · est EPS $${e.epsEstimate.toFixed(2)}` : ""}`);
        }
      } catch {
        /* calendar failure — skip */
      }

      lines.push("", "Manage alerts & digest: https://asset-manager-e8dl.onrender.com/watchlist");
      const ok = await tgSend(row.chat_id, lines.join("\n"));
      if (ok) sent++;
    } catch (err) {
      logger.warn({ err }, "digest failed for chat");
    }
  }
  return sent;
}

/** Fire the digest once per day around 13:00 UTC (9am ET pre-market). */
let lastDigestDay = "";
function digestTick(): void {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hourUtc = now.getUTCHours();
  const minuteUtc = now.getUTCMinutes();
  if (day !== lastDigestDay && hourUtc === 13 && minuteUtc < 30) {
    lastDigestDay = day;
    sendDigests()
      .then((n) => logger.info(`digest sent to ${n} chats`))
      .catch((err) => logger.warn({ err }, "digest loop failed"));
  }
}

export function startDigestLoop(): void {
  if (!TOKEN || !hasPg()) return;
  logger.info("Daily digest loop active (13:00 UTC window)");
  setTimeout(digestTick, 60_000).unref();
  setInterval(digestTick, 20 * 60_000).unref();
}

/** Manual trigger for testing. */
export async function runDigestNow(): Promise<number> {
  return sendDigests();
}
