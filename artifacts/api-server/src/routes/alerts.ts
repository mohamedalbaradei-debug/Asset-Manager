import { Router } from "express";
import crypto from "node:crypto";
import type { IRouter, Request, Response } from "express";
import { logger } from "../lib/logger";
import { requireUser } from "../lib/auth";
import { hasPg, pgQuery } from "../lib/pg";
import { tgSend, checkPriceAlerts } from "../lib/notify";

const router: IRouter = Router();

// ── Price alerts (per user) ─────────────────────────────────────────────────

interface AlertRow {
  id: string;
  ticker: string;
  direction: string;
  price: number;
  last_triggered_at: Date | null;
}

router.get("/alerts/price", requireUser, async (req, res): Promise<void> => {
  const [alerts, chat] = await Promise.all([
    pgQuery<AlertRow>(
      "SELECT id, ticker, direction, price, last_triggered_at FROM price_alerts WHERE user_id=$1 ORDER BY created_at DESC",
      [req.user!.id],
    ),
    pgQuery<{ chat_id: string }>("SELECT chat_id FROM telegram_chats WHERE user_id=$1", [req.user!.id]),
  ]);
  res.json({
    alerts: alerts.rows.map((a) => ({
      id: a.id,
      ticker: a.ticker,
      direction: a.direction,
      price: a.price,
      lastTriggeredAt: a.last_triggered_at ? new Date(a.last_triggered_at).toISOString() : null,
    })),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    chatId: chat.rows[0]?.chat_id ?? null,
  });
});

router.post("/alerts/price", requireUser, async (req, res): Promise<void> => {
  const { ticker, direction, price } = (req.body ?? {}) as {
    ticker?: string;
    direction?: string;
    price?: number | string;
  };
  const t = String(ticker ?? "").toUpperCase().trim();
  if (!/^[A-Z^=\-.A-Z0-9]{1,12}$/.test(t)) {
    res.status(400).json({ error: "invalid_ticker" });
    return;
  }
  const dir = direction === "below" ? "below" : "above";
  const p = Number(price);
  if (!isFinite(p) || p <= 0) {
    res.status(400).json({ error: "invalid_price" });
    return;
  }
  const id = `a_${crypto.randomUUID()}`;
  await pgQuery(
    "INSERT INTO price_alerts (id, user_id, ticker, direction, price) VALUES ($1,$2,$3,$4,$5)",
    [id, req.user!.id, t, dir, p],
  );
  res.json({ id, ticker: t, direction: dir, price: p });
});

router.delete("/alerts/price/:id", requireUser, async (req, res): Promise<void> => {
  await pgQuery("DELETE FROM price_alerts WHERE id=$1 AND user_id=$2", [req.params.id, req.user!.id]);
  res.json({ ok: true });
});

/** Bind + verify a Telegram chat for this account. */
router.post("/alerts/telegram", requireUser, async (req, res): Promise<void> => {
  const chatId = String((req.body as { chatId?: string })?.chatId ?? "").trim();
  if (!/^-?\d{4,}$/.test(chatId)) {
    res.status(400).json({ error: "invalid_chat_id" });
    return;
  }
  const ok = await tgSend(chatId, "Asset Manager alert channel connected ✓");
  if (!ok) {
    res.status(400).json({ error: "telegram_send_failed" });
    return;
  }
  await pgQuery(
    `INSERT INTO telegram_chats (user_id, chat_id) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id`,
    [req.user!.id, chatId],
  );
  res.json({ ok: true });
});

/** Manual check trigger (also runs automatically every 15 min). */
router.post("/alerts/check", requireUser, async (_req, res): Promise<void> => {
  const out = await checkPriceAlerts();
  res.json({ ...out, checkedAt: new Date().toISOString() });
});

export default router;
