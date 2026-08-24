import { Router } from "express";
import crypto from "node:crypto";
import type { IRouter, Request, Response } from "express";
import { logger } from "../lib/logger";
import { requireUser } from "../lib/auth";
import { hasPg, pgQuery } from "../lib/pg";
import { tgSend, checkPriceAlerts, runDigestNow } from "../lib/notify";
import { limitsFor, quotaPayload } from "../lib/tiers";

const router: IRouter = Router();

/** Alert kinds — perf kinds compare 3-month total change against `price` %. */
export const ALERT_KINDS = ["price", "rsi_oversold", "rsi_overbought", "perf_3m_above", "perf_3m_below"] as const;

// ── Price + signal alerts (per user) ────────────────────────────────────────

interface AlertRow {
  id: string;
  ticker: string;
  direction: string;
  kind: string;
  price: number;
  last_triggered_at: Date | null;
}

router.get("/alerts/price", requireUser, async (req, res): Promise<void> => {
  const [alerts, chat] = await Promise.all([
    pgQuery<AlertRow>(
      "SELECT id, ticker, direction, COALESCE(kind,'price') AS kind, price, last_triggered_at FROM price_alerts WHERE user_id=$1 ORDER BY created_at DESC",
      [req.user!.id],
    ),
    pgQuery<{ chat_id: string; digest_enabled: boolean }>(
      "SELECT chat_id, digest_enabled FROM telegram_chats WHERE user_id=$1",
      [req.user!.id],
    ),
  ]);
  res.json({
    alerts: alerts.rows.map((a) => ({
      id: a.id,
      ticker: a.ticker,
      direction: a.direction,
      kind: a.kind,
      price: a.price,
      lastTriggeredAt: a.last_triggered_at ? new Date(a.last_triggered_at).toISOString() : null,
    })),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    chatId: chat.rows[0]?.chat_id ?? null,
    digestEnabled: chat.rows[0]?.digest_enabled ?? false,
    quota: { used: alerts.rows.length, max: limitsFor(req.user).alerts },
  });
});

router.post("/alerts/price", requireUser, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    ticker?: string;
    direction?: string;
    kind?: string;
    price?: number | string;
  };
  const t = String(body.ticker ?? "").toUpperCase().trim();
  if (!/^[A-Z^=\-.A-Z0-9]{1,12}$/.test(t)) {
    res.status(400).json({ error: "invalid_ticker" });
    return;
  }
  const kind = (ALERT_KINDS as readonly string[]).includes(String(body.kind))
    ? String(body.kind)
    : "price";
  const dir = body.direction === "below" ? "below" : "above";

  // Signal alerts use fixed RSI thresholds; price and perf alerts need a
  // target value (absolute price or 3M-change %).
  let p = 1;
  if (kind === "price" || kind.startsWith("perf_")) {
    p = Number(body.price);
    if (!isFinite(p) || p <= 0) {
      res.status(400).json({ error: "invalid_price" });
      return;
    }
  }

  const limits = limitsFor(req.user);
  const count = await pgQuery<{ n: number }>(
    "SELECT count(*)::int AS n FROM price_alerts WHERE user_id=$1",
    [req.user!.id],
  );
  if ((count.rows[0]?.n ?? 0) >= limits.alerts) {
    res.status(403).json(quotaPayload(count.rows[0]?.n ?? 0, limits.alerts));
    return;
  }

  const id = `a_${crypto.randomUUID()}`;
  await pgQuery(
    "INSERT INTO price_alerts (id, user_id, ticker, direction, kind, price) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, req.user!.id, t, dir, kind, p],
  );
  res.json({ id, ticker: t, direction: dir, kind, price: p });
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
  const ok = await tgSend(
    chatId,
    "Asset Manager alert channel connected ✓\nYou will receive price & signal alerts here. Daily digest is ON by default.",
  );
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

/** Toggle the daily digest (default on once Telegram is connected). */
router.post("/alerts/digest", requireUser, async (req, res): Promise<void> => {
  if (!hasPg()) {
    res.status(503).json({ error: "storage_unavailable" });
    return;
  }
  const enabled = Boolean((req.body as { enabled?: boolean })?.enabled);
  const r = await pgQuery<{ user_id: string }>(
    `UPDATE telegram_chats SET digest_enabled=$1 WHERE user_id=$2 RETURNING user_id`,
    [enabled, req.user!.id],
  );
  if (r.rows.length === 0) {
    res.status(400).json({ error: "telegram_not_connected" });
    return;
  }
  res.json({ ok: true, digestEnabled: enabled });
});

/** Manual digest trigger (normally fires daily ~13:00 UTC). */
router.post("/alerts/digest/run", requireUser, async (_req, res): Promise<void> => {
  const sent = await runDigestNow();
  res.json({ sent });
});

/** Manual check trigger (also runs automatically every 15 min). */
router.post("/alerts/check", requireUser, async (_req, res): Promise<void> => {
  const out = await checkPriceAlerts();
  res.json({ ...out, checkedAt: new Date().toISOString() });
});

export default router;
