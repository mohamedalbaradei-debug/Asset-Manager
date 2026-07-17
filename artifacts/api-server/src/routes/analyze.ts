import { Router, type IRouter } from "express";
import { AnalyzeStockBody, AnalyzeStockResponse } from "@workspace/api-zod";
import { analyzeStock } from "../lib/stockAnalysis";

const router: IRouter = Router();

router.post("/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeStockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ticker } = parsed.data;

  try {
    const result = await analyzeStock(ticker);
    res.json(AnalyzeStockResponse.parse(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    if (message.includes("No data found")) {
      res.status(404).json({ error: `Ticker "${ticker}" not found or has no data.` });
    } else {
      req.log.error({ err, ticker }, "Stock analysis failed");
      res.status(500).json({ error: "Failed to analyze ticker. Please try again." });
    }
  }
});

export default router;
