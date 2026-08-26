import { yahooFinance } from "./yahoo";

export interface ChartQuote {
  price: number | null;
  name: string | null;
  changePct: number | null;
}

/**
 * Live price/name/change for a symbol via `chart`.
 *
 * Yahoo's `quote` endpoint is blocked from the hosted environment, while
 * `chart` works, so everything that needs a spot price funnels through here.
 */
export async function chartQuote(ticker: string): Promise<ChartQuote> {
  try {
    const p2 = Math.floor(Date.now() / 1000);
    const r = (await yahooFinance.chart(ticker, {
      period1: p2 - 2 * 86400,
      period2: p2,
      interval: "1d",
    })) as {
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

export async function chartQuotes(tickers: string[]): Promise<Map<string, ChartQuote>> {
  const out = new Map<string, ChartQuote>();
  if (tickers.length === 0) return out;
  const res = await Promise.all(tickers.map((t) => chartQuote(t)));
  tickers.forEach((t, i) => out.set(t, res[i]));
  return out;
}
