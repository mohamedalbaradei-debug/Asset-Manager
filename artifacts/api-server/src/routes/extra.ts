import { Router, type IRouter, type Request, type Response } from "express";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getUserWatchlist,
  addToUserWatchlist,
  removeFromUserWatchlist,
  getWinRate,
} from "../lib/storage";
import { hasPg } from "../lib/pg";
import { getCalendar } from "../lib/calendar";
import { getWatchlistSummary } from "../lib/equityPanels";

const router: IRouter = Router();

/** Signed-in users get their own list; anonymous traffic keeps the global one. */
async function resolveWatchlist(req: Request): Promise<{ tickers: string[]; scoped: boolean }> {
  if (req.user && hasPg()) {
    const list = await getUserWatchlist(req.user.id);
    return { tickers: list, scoped: true };
  }
  return { tickers: await getWatchlist(), scoped: false };
}

router.get("/watchlist", async (req: Request, res: Response): Promise<void> => {
  try {
    const { tickers } = await resolveWatchlist(req);
    res.json({ watchlist: tickers });
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
    const result =
      req.user && hasPg()
        ? await addToUserWatchlist(req.user.id, ticker)
        : await addToWatchlist(ticker);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

router.delete("/watchlist/:ticker", async (req: Request, res: Response): Promise<void> => {
  try {
    const result =
      req.user && hasPg()
        ? await removeFromUserWatchlist(req.user.id, String(req.params.ticker))
        : await removeFromWatchlist(String(req.params.ticker));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

router.get("/watchlist/summary", async (req: Request, res: Response): Promise<void> => {
  try {
    const { tickers: watchlist } = await resolveWatchlist(req);
    const items = await getWatchlistSummary(watchlist);
    res.json({ watchlist, items, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to build watchlist summary" });
  }
});

router.get("/calendar", async (req: Request, res: Response): Promise<void> => {
  try {
    const { tickers: userTickers } = await resolveWatchlist(req);
    // Signed-in users see their own calendar even if empty → fall back to
    // global list first, then mega-caps for fresh accounts.
    let watchlist = userTickers;
    if (userTickers.length === 0) {
      const global = req.user ? await getWatchlist() : [];
      watchlist = global;
    }
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