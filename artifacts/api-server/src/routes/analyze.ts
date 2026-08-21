import { Router, type IRouter } from "express";
import { AnalyzeStockBody, AnalyzeStockResponse } from "@workspace/api-zod";
import { analyzeStock } from "../lib/stockAnalysis";
import { yahooFinance } from "../lib/yahoo";

const router: IRouter = Router();

interface SearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
  regularMarketPrice?: number | null;
  currency?: string;
}

// Live symbol search across all exchanges (NYSE, LSE, Xetra/Frankfurt, Euronext, ...).
router.get("/search", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }
  try {
    const s = await yahooFinance.search(q, { quotesCount: 10 });
    const results = (s.quotes ?? [])
      .filter((x: SearchQuote) => x?.symbol)
      .map((x: SearchQuote) => ({
        symbol: x.symbol as string,
        name: (x.shortname ?? x.longname ?? null) as string | null,
        exchange: (x.exchange ?? null) as string | null,
        type: (x.quoteType ?? null) as string | null,
        price: (x.regularMarketPrice ?? null) as number | null,
        currency: (x.currency ?? null) as string | null,
      }));
    res.json({ results });
  } catch (err) {
    req.log.error({ err, q }, "Symbol search failed");
    res.json({ results: [] });
  }
});

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
