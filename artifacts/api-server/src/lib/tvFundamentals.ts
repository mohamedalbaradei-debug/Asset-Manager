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

const COLUMNS = [
  "name",
  "close",
  "market_cap_basic",
  "price_earnings_ttm",
  "earnings_per_share_diluted_ttm",
  "dividends_yield_current",
  "price_book_fq",
];

// ".DE" → "XETR", ".L" → "LSE", etc. Plain symbols search NASDAQ + NYSE.
const EXCHANGE_BY_SUFFIX: Record<string, string> = {
  DE: "XETR",
  L: "LSE",
  PA: "EPA",
  TO: "TSX",
  AX: "ASX",
  HK: "HKEX",
  T: "TSE",
  VI: "VIE",
  SW: "SIX",
  BR: "BVMF",
  MCE: "BME",
  MI: "MIL",
  MC: "EURONEXT",
};

function tvTickers(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const dot = s.lastIndexOf(".");
  if (dot > 0) {
    const stem = s.slice(0, dot);
    const ex = EXCHANGE_BY_SUFFIX[s.slice(dot + 1)];
    if (ex && stem) return [`${ex}:${stem}`];
    return [];
  }
  return [`NASDAQ:${s}`, `NYSE:${s}`, `AMEX:${s}`];
}

// Small TTL cache — fundamentals move slowly and the scanner is rate-limited.
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { t: number; v: TVFundamentals | null }>();

export async function getTVFundamentalsUS(symbolRaw: string): Promise<TVFundamentals | null> {
  const symbol = symbolRaw.toUpperCase().trim();
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.t < TTL) return cached.v;

  const tickers = tvTickers(symbol);
  if (tickers.length === 0) return null;

  try {
    const res = await fetch("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.tradingview.com" },
      body: JSON.stringify({
        // Direct ticker lookup — the filter-based form is unreliable.
        symbols: { tickers, query: { types: [] } },
        columns: COLUMNS,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn({ symbol, status: res.status }, "TradingView scanner request failed");
      cache.set(symbol, { t: Date.now(), v: null });
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ s: string; d: Array<number | string | null> }> };
    const row = data.data?.[0];
    if (!row) {
      cache.set(symbol, { t: Date.now(), v: null });
      return null;
    }
    const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
    const [, , marketCap, pe, eps, divYield, pb] = row.d.map(num);
    const value: TVFundamentals = {
      pe: num(pe),
      eps: num(eps),
      // dividends_yield_current is already in percent (0.337 = 0.34%).
      dividendYield: num(divYield),
      marketCap: num(marketCap),
      pb: num(pb),
    };
    cache.set(symbol, { t: Date.now(), v: value });
    return value;
  } catch (err) {
    logger.warn({ symbol, err }, "TradingView fundamentals threw");
    cache.set(symbol, { t: Date.now(), v: null });
    return null;
  }
}
