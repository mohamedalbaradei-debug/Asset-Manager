import { Router, type IRouter } from "express";
import { CreateInvestmentPlanBody, CreateInvestmentPlanResponse } from "@workspace/api-zod";
import { createPlan, etfAllocationFor } from "../lib/planner";
import { backtestAllocation } from "../lib/backtest";
import { getEtfScan } from "../lib/etfTracker";

const router: IRouter = Router();

/** Overlay live performance from the ETF tracker onto suggested picks. */
async function enrichEtfs<T extends { ticker: string }>(etfs: T[]): Promise<T[]> {
  try {
    const { items } = await getEtfScan({});
    const byTicker = new Map(items.map((e) => [e.ticker, e]));
    return etfs.map((e) => {
      const live = byTicker.get(e.ticker);
      if (!live) return e;
      return {
        ...e,
        changePct: live.changePct,
        perfMonth1: live.perfMonth1,
        perfMonth3: live.perfMonth3,
        perfYtd: live.perfYtd,
        perfYear: live.perfYear,
        expenseRatioPct: live.expenseRatioPct ?? (e as { expenseRatioPct?: number | null }).expenseRatioPct ?? null,
      };
    });
  } catch {
    return etfs;
  }
}

router.post("/plan", async (req, res): Promise<void> => {
  const parsed = CreateInvestmentPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `Invalid plan request: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    });
    return;
  }

  try {
    const plan = await createPlan(parsed.data);
    const enriched = { ...plan, etfs: await enrichEtfs(plan.etfs) };
    const validated = CreateInvestmentPlanResponse.parse(enriched);
    res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Failed to create investment plan");
    res.status(500).json({ error: "Failed to create investment plan" });
  }
});

router.post("/plan/backtest", async (req, res): Promise<void> => {
  const body = req.body as { horizon?: string; riskTolerance?: string };
  const horizon = typeof body.horizon === "string" ? body.horizon : "medium";
  const riskTolerance = typeof body.riskTolerance === "string" ? body.riskTolerance : "balanced";
  try {
    const etfs = etfAllocationFor(horizon, riskTolerance);
    if (etfs.length === 0) {
      res.status(400).json({ error: "Allocation has no ETF components" });
      return;
    }
    const result = await backtestAllocation(etfs);
    res.json({ ...result, horizon, riskTolerance });
  } catch (err) {
    req.log.error({ err }, "Backtest failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Backtest failed" });
  }
});

export default router;
