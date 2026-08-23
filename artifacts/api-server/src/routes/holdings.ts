import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { requireUser } from "../lib/auth";
import { hasPg, pgQuery } from "../lib/pg";
import { yahooFinance } from "../lib/yahoo";
import type { IRouter } from "express";

/**
 * User portfolio holdings (US-listed tickers). Free-form: users add anything
 * they own with quantity + optional cost basis; we value it live.
 */

const TICKER_RE = /^[A-Z^.\-=]{1,12}$/;

interface HoldingRow {
  id: string;
  user_id: string;
  ticker: string;
  qty: number;
  cost_usd: number | null;
  created_at: Date;
}

function routerWith(): IRouter {
  const router = Router();

  // List holdings valued live (batched quotes).
  router.get("/holdings", requireUser, async (req: Request, res: Response): Promise<void> => {
    if (!hasPg()) {
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    const r = await pgQuery<HoldingRow>(
      "SELECT * FROM user_holdings WHERE user_id=$1 ORDER BY created_at DESC",
      [req.user!.id],
    );
    const rows = r.rows;

    const symbols = [...new Set(rows.map((h) => h.ticker))];
    const quoteMap = new Map<string, { price: number | null; name: string | null; changePct: number | null }>();
    if (symbols.length > 0) {
      try {
        const quotes = await yahooFinance.quote(symbols);
        for (const q of Array.isArray(quotes) ? quotes : [quotes]) {
          if (q?.symbol) {
            quoteMap.set(q.symbol, {
              price: typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null,
              name: q.shortName ?? q.longName ?? null,
              changePct:
                typeof q.regularMarketChangePercent === "number" ? q.regularMarketChangePercent : null,
            });
          }
        }
      } catch {
        // leave map empty — items render with null prices
      }
    }

    let totalValue = 0;
    let totalCost = 0;
    const items = rows.map((h) => {
      const q = quoteMap.get(h.ticker);
      const price = q?.price ?? null;
      const value = price != null ? price * h.qty : null;
      const cost = h.cost_usd != null ? h.cost_usd * h.qty : null;
      const plPct = value != null && cost != null && cost > 0 ? ((value - cost) / cost) * 100 : null;
      if (value != null) totalValue += value;
      if (cost != null) totalCost += cost;
      return {
        id: h.id,
        ticker: h.ticker,
        name: q?.name ?? null,
        qty: h.qty,
        costUsd: h.cost_usd,
        price,
        changePct: q?.changePct ?? null,
        valueUsd: value,
        plPct,
      };
    });

    res.json({
      items,
      totals: {
        valueUsd: rows.length > 0 ? totalValue : null,
        costUsd: totalCost > 0 ? totalCost : null,
        plPct: totalCost > 0 && rows.length > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null,
      },
    });
  });

  router.post("/holdings", requireUser, async (req: Request, res: Response): Promise<void> => {
    if (!hasPg()) {
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    const ticker = String(req.body?.ticker ?? "").trim().toUpperCase();
    const qty = Number(req.body?.qty);
    const cost = req.body?.costUsd != null && req.body.costUsd !== "" ? Number(req.body.costUsd) : null;
    if (!TICKER_RE.test(ticker)) {
      res.status(400).json({ error: "invalid_ticker" });
      return;
    }
    if (!isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: "invalid_qty" });
      return;
    }
    if (cost != null && (!isFinite(cost) || cost < 0)) {
      res.status(400).json({ error: "invalid_cost" });
      return;
    }
    const count = await pgQuery<{ n: number }>(
      "SELECT count(*)::int AS n FROM user_holdings WHERE user_id=$1",
      [req.user!.id],
    );
    if ((count.rows[0]?.n ?? 0) >= 100) {
      res.status(400).json({ error: "quota_reached" });
      return;
    }
    const id = `h_${crypto.randomUUID()}`;
    await pgQuery(
      "INSERT INTO user_holdings (id,user_id,ticker,qty,cost_usd) VALUES ($1,$2,$3,$4,$5)",
      [id, req.user!.id, ticker, qty, isFinite(cost as number) ? cost : null],
    );
    res.json({ ok: true, id });
  });

  router.patch("/holdings/:id", requireUser, async (req: Request, res: Response): Promise<void> => {
    if (!hasPg()) {
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (req.body?.qty !== undefined) {
      const q = Number(req.body.qty);
      if (!isFinite(q) || q <= 0) {
        res.status(400).json({ error: "invalid_qty" });
        return;
      }
      sets.push(`qty=$${vals.push(q)}`);
    }
    if (req.body?.costUsd !== undefined) {
      const c = req.body.costUsd == null || req.body.costUsd === "" ? null : Number(req.body.costUsd);
      if (c != null && (!isFinite(c) || c < 0)) {
        res.status(400).json({ error: "invalid_cost" });
        return;
      }
      sets.push(`cost_usd=$${vals.push(c)}`);
    }
    if (sets.length === 0) {
      res.json({ ok: true });
      return;
    }
    vals.push(req.params.id, req.user!.id);
    await pgQuery(
      `UPDATE user_holdings SET ${sets.join(",")} WHERE id=$${vals.length - 1} AND user_id=$${vals.length}`,
      vals,
    );
    res.json({ ok: true });
  });

  router.delete("/holdings/:id", requireUser, async (req: Request, res: Response): Promise<void> => {
    if (!hasPg()) {
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    await pgQuery("DELETE FROM user_holdings WHERE id=$1 AND user_id=$2", [
      req.params.id,
      req.user!.id,
    ]);
    res.json({ ok: true });
  });

  // Quick quote lookup so the add-form can validate a symbol live.
  router.get("/holdings/quote/:ticker", requireUser, async (req: Request, res: Response): Promise<void> => {
    const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      res.status(400).json({ error: "invalid_ticker" });
      return;
    }
    try {
      const quotes = await yahooFinance.quote(ticker);
      const q = Array.isArray(quotes) ? quotes[0] : quotes;
      res.json({
        ticker,
        name: q?.shortName ?? q?.longName ?? null,
        price: typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : null,
      });
    } catch {
      res.status(502).json({ error: "quote_failed" });
    }
  });

  return router;
}

export default routerWith();
