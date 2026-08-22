import { Router, type IRouter } from "express";
import { CreateInvestmentPlanBody, CreateInvestmentPlanResponse } from "@workspace/api-zod";
import { createPlan, etfAllocationFor } from "../lib/planner";
import { backtestAllocation } from "../lib/backtest";

const router: IRouter = Router();

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
    const validated = CreateInvestmentPlanResponse.parse(plan);
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
