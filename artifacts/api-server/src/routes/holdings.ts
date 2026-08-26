import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { requireUser } from "../lib/auth";
import { hasPg, pgQuery } from "../lib/pg";
import { yahooFinance } from "../lib/yahoo";
import { limitsFor, quotaPayload } from "../lib/tiers";
import type { IRouter } from "express";

/**
 * User portfolio holdings (US-listed tickers). Free-form: users add anything
 * they own with quantity + optional cost basis; we value it live.
 */

const TICKER_RE = /^[A-Z^.\-=]{1,12}$/;

/**
 * Live price/name/change for a symbol. Uses `chart` rather than `quote`:
 * Yahoo's `quote` endpoint is blocked from the hosted environment, while
 * `chart` (used elsewhere in the app) works, so holdings stay valu-able.
 */
async function liveQuote(ticker: string): Promise<{ price: number | null; name: string | null; changePct: number | null }> {
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 2 * 86400;
    const r = (await yahooFinance.chart(ticker, { period1, period2, interval: "1d" })) as {
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        shortName?: string;
        longName?: string;
      };
    };
    const meta = r?.meta;
    if (!meta) return { price: null, name: null, changePct: null };
    const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
    const prev =
      typeof meta.chartPreviousClose === "number"
        ? meta.chartPreviousClose
        : typeof meta.previousClose === "number"
          ? meta.previousClose
          : null;
    const changePct = price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
    const name = (meta.shortName ?? meta.longName ?? null) as string | null;
    return { price, name, changePct };
  } catch {
    return { price: null, name: null, changePct: null };
  }
}

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
      const quotes = await Promise.all(symbols.map((s) => liveQuote(s)));
      symbols.forEach((s, i) => quoteMap.set(s, quotes[i]));
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

    // Track performance over time: upsert today's portfolio value snapshot.
    if (totalValue > 0) {
      void pgQuery(
        `INSERT INTO portfolio_snapshots (user_id, day, total_usd) VALUES ($1, CURRENT_DATE, $2)
         ON CONFLICT (user_id, day) DO UPDATE SET total_usd = EXCLUDED.total_usd`,
        [req.user!.id, totalValue],
      ).catch(() => {});
    }

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
    if ((count.rows[0]?.n ?? 0) >= limitsFor(req.user).holdings) {
      res.status(403).json(quotaPayload(count.rows[0]?.n ?? 0, limitsFor(req.user).holdings));
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
      const q = await liveQuote(ticker);
      res.json({ ticker, name: q.name, price: q.price });
    } catch {
      res.status(502).json({ error: "quote_failed" });
    }
  });

  // Portfolio performance over time vs Gold (GLD) and S&P 500 (^GSPC).
  router.get("/holdings/performance", requireUser, async (req: Request, res: Response): Promise<void> => {
    if (!hasPg()) {
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    let days = parseInt(String(req.query.days ?? "180"), 10);
    if (!isFinite(days) || days < 7) days = 180;
    if (days > 365) days = 365;
    const perfMax = limitsFor(req.user).performanceMaxDays;
    let clamped = false;
    if (days > perfMax) {
      days = perfMax;
      clamped = true;
    }

    interface SnapRow { day: string; total_usd: number | null }
    const snaps = await pgQuery<SnapRow>(
      `SELECT to_char(day,'YYYY-MM-DD') AS day, total_usd FROM portfolio_snapshots
       WHERE user_id=$1 AND day >= CURRENT_DATE - ($2::int) ORDER BY day ASC`,
      [req.user!.id, days],
    );
    const port = snaps.rows
      .filter((r) => r.total_usd != null && isFinite(r.total_usd))
      .map((r) => ({ day: r.day, v: r.total_usd as number }));

    // Benchmark daily closes for the same window.
    const period1 = Math.floor((Date.now() - days * 86400_000) / 1000);
    async function closes(sym: string): Promise<Map<string, number>> {
      const out = new Map<string, number>();
      try {
        const res = await yahooFinance.chart(sym, {
          period1,
          period2: Math.floor(Date.now() / 1000),
          interval: "1d",
        });
        const r = Array.isArray(res) ? res[0] : res;
        const quotes = (r as { quotes?: Array<{ date?: string | Date; close?: number | null }> })
          ?.quotes ?? [];
        for (const q of quotes) {
          if (!q?.date || typeof q.close !== "number" || !isFinite(q.close)) continue;
          out.set(new Date(q.date as string | Date).toISOString().slice(0, 10), q.close);
        }
      } catch (err) {
        req.log?.warn({ err, sym }, "benchmark chart failed");
      }
      return out;
    }
    const [gold, spx] = await Promise.all([closes("GLD"), closes("^GSPC")]);

    // Rebase each series to its own earliest point in the window (% growth).
    const rebase = (pts: Array<{ d: string; v: number }>): Map<string, number> => {
      const m = new Map<string, number>();
      if (pts.length === 0) return m;
      const base = pts[0].v;
      if (!(base > 0)) return m;
      for (const p of pts) m.set(p.d, ((p.v - base) / base) * 100);
      return m;
    };
    const portIdx = rebase(port.map((p) => ({ d: p.day, v: p.v })));
    const goldIdx = rebase([...gold.entries()].sort().map(([d, v]) => ({ d, v })));
    const spxIdx = rebase([...spx.entries()].sort().map(([d, v]) => ({ d, v })));

    const allDays = [...new Set([...portIdx.keys(), ...goldIdx.keys(), ...spxIdx.keys()])].sort();
    const series = allDays.map((day) => ({
      day,
      portfolioPct: portIdx.get(day) ?? null,
      goldPct: goldIdx.get(day) ?? null,
      spxPct: spxIdx.get(day) ?? null,
    }));
    const lastOf = (m: Map<string, number>) =>
      m.size > 0 ? ([...m.values()].at(-1) ?? null) : null;

    res.json({
      days,
      clamped,
      series,
      summary: {
        portfolioPct: lastOf(portIdx),
        goldPct: lastOf(goldIdx),
        spxPct: lastOf(spxIdx),
      },
      hasPortfolioData: port.length > 0,
    });
  });

  return router;
}

export default routerWith();
