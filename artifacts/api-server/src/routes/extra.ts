import { Router, type IRouter, type Request, type Response } from "express";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getWinRate,
} from "../lib/storage";
import { getCalendar } from "../lib/calendar";
import { getWatchlistSummary } from "../lib/equityPanels";

const router: IRouter = Router();

router.get("/watchlist", async (_req: Request, res: Response): Promise<void> => {
  try {
    const watchlist = await getWatchlist();
    res.json({ watchlist });
  } catch (err) {
    res.status(500).json({ error: "Failed to load watchlist" });
  }
});

router.post("/watchlist", async (req: Request, res: Response): Promise<void> => {
  const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.toUpperCase().trim() : "";
  if (!ticker) {
    res.status(400).json({ error: "ticker is required" });
    return;
  }
  try {
    const result = await addToWatchlist(ticker);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

router.delete("/watchlist/:ticker", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await removeFromWatchlist(String(req.params.ticker));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

router.get("/watchlist/summary", async (_req: Request, res: Response): Promise<void> => {
  try {
    const watchlist = await getWatchlist();
    const items = await getWatchlistSummary(watchlist);
    res.json({ watchlist, items, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to build watchlist summary" });
  }
});

router.get("/calendar", async (_req: Request, res: Response): Promise<void> => {
  try {
    const watchlist = await getWatchlist();
    // Ephemeral disks start with an empty watchlist; show mega-cap earnings
    // rather than an empty panel until the user curates their own list.
    const tickers =
      watchlist.length > 0 ? watchlist : ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA"];
    const data = await getCalendar(tickers);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load calendar" });
  }
});

router.get("/performance", async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await getWinRate();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load performance log" });
  }
});

export default router;