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
  price: number;
  last_triggered_at: Date | null;
  chat_id: string | null;
}

async function allPriceAlertsWithChats(): Promise<PriceAlertRow[]> {
  const r = await pgQuery<PriceAlertRow>(
    `SELECT a.id, a.user_id, a.ticker, a.direction, a.price, a.last_triggered_at, t.chat_id
     FROM price_alerts a LEFT JOIN telegram_chats t ON t.user_id = a.user_id`,
  );
  return r.rows;
}

let checking = false;

export async function checkPriceAlerts(): Promise<{ checked: number; sent: number }> {
  if (!hasPg()) return { checked: 0, sent: 0 };
  let sent = 0;
  const alerts = await allPriceAlertsWithChats();
  if (alerts.length === 0) return { checked: 0, sent: 0 };

  // One batched quote call for every distinct ticker.
  const symbols = [...new Set(alerts.map((a) => a.ticker))];
  let quoteMap = new Map<string, { price: number | null; name: string | null }>();
  try {
    const quotes = await yahooFinance.quote(symbols);
    for (const q of Array.isArray(quotes) ? quotes : [quotes]) {
      if (q?.symbol) {
        quoteMap.set(q.symbol, {
          price: typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null,
          name: q.shortName ?? q.longName ?? null,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "alert quote fetch failed");
    return { checked: alerts.length, sent: 0 };
  }

  for (const a of alerts) {
    const hit =
      a.direction === "above"
        ? (quoteMap.get(a.ticker)?.price ?? null)! > a.price
        : (quoteMap.get(a.ticker)?.price ?? Number.POSITIVE_INFINITY)! < a.price;
    const px = quoteMap.get(a.ticker)?.price;
    if (px == null || !hit) continue;

    const last = a.last_triggered_at ? Date.parse(String(a.last_triggered_at)) : 0;
    if (Date.now() - last < 24 * 3600_000) continue;

    const msg =
      `Asset Manager — ${a.ticker} $${px.toFixed(2)} is ${a.direction} your alert level $${Number(a.price).toFixed(2)}`;
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
