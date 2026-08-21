import { logger } from "./logger";

// TradingView's public scanner provides fresh TTM fundamentals for US-listed
// stocks and works from datacenter IPs where Yahoo blocks quoteSummary.
export interface TVFundamentals {
  pe: number | null;
  eps: number | null;
  dividendYield: number | null; // percent
  marketCap: number | null;
  pb: number | null;
}

const TV_COLUMNS = [
  "name",
  "close",
  "market_cap_basic",
  "price_earnings_ttm",
  "earnings_per_share_diluted_ttm",
  "dividend_yield_recent",
  "price_book_fq",
];

export async function getTVFundamentalsUS(symbol: string): Promise<TVFundamentals | null> {
  try {
    const res = await fetch("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.tradingview.com" },
      body: JSON.stringify({
        filter: [{ left: "ticker", operation: "equal", right: `NASDAQ:${symbol}` }, { left: "ticker", operation: "equal", right: `NYSE:${symbol}` }],
        operation: "or",
        columns: TV_COLUMNS,
      }),
    });
    if (!res.ok) {
      logger.warn({ symbol, status: res.status }, "TradingView scanner request failed");
      return null;
    }
    const data = (await res.json()) as { totalCount?: number; data?: Array<{ s: string; d: Array<number | string | null> }> };
    const row = data.data?.[0];
    if (!data.totalCount || !row) return null;

    const [, , marketCap, pe, eps, divYield, pb] = row.d as Array<number | string | null>;
    const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
    const rawDiv = num(divYield);
    return {
      pe: num(pe),
      eps: num(eps),
      // TradingView returns dividend yield as a fraction (0.0044 = 0.44%).
      dividendYield: rawDiv != null ? (Math.abs(rawDiv) <= 1 ? rawDiv * 100 : rawDiv) : null,
      marketCap: num(marketCap),
      pb: num(pb),
    };
  } catch (err) {
    logger.warn({ symbol, err }, "TradingView fundamentals threw");
    return null;
  }
}
