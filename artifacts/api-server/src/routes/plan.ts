import { Router, type IRouter } from "express";
import { CreateInvestmentPlanBody, CreateInvestmentPlanResponse } from "@workspace/api-zod";
import { createPlan } from "../lib/planner";

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

export default router;
