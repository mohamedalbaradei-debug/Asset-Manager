/**
 * Curated quick-add catalog for watchlist / alerts / holdings forms.
 * Static, hand-picked liquid instruments — anything else can be found via
 * GET /api/search (Yahoo symbol search). Symbols are Yahoo-native.
 */

export interface CatalogAsset {
  symbol: string;
  name: string;
}

export interface CatalogGroup {
  id: string;
  label: string;
  assets: CatalogAsset[];
}

const g = (id: string, label: string, rows: Array<[string, string]>): CatalogGroup => ({
  id,
  label,
  assets: rows.map(([symbol, name]) => ({ symbol, name })),
});

export function getAssetCatalog(): { groups: CatalogGroup[] } {
  return {
    groups: [
      g("mega_cap_stocks", "US Mega-Cap Stocks", [
        ["AAPL", "Apple"],
        ["MSFT", "Microsoft"],
        ["NVDA", "NVIDIA"],
        ["GOOGL", "Alphabet"],
        ["AMZN", "Amazon"],
        ["META", "Meta Platforms"],
        ["TSLA", "Tesla"],
        ["AVGO", "Broadcom"],
        ["BRK-B", "Berkshire Hathaway"],
        ["JPM", "JPMorgan Chase"],
        ["V", "Visa"],
        ["MA", "Mastercard"],
        ["UNH", "UnitedHealth"],
        ["XOM", "Exxon Mobil"],
        ["WMT", "Walmart"],
        ["PG", "Procter & Gamble"],
        ["KO", "Coca-Cola"],
        ["AMD", "AMD"],
        ["NFLX", "Netflix"],
        ["DIS", "Disney"],
      ]),
      g("popular_etfs", "Popular ETFs", [
        ["SPY", "S&P 500"],
        ["QQQ", "Nasdaq 100"],
        ["VOO", "S&P 500 (Vanguard)"],
        ["VTI", "Total US Market"],
        ["VT", "Total World"],
        ["IWM", "Small Caps"],
        ["EEM", "Emerging Markets"],
        ["VXUS", "International"],
        ["ARKK", "ARK Innovation"],
        ["SMH", "Semiconductors"],
        ["IBIT", "iShares Bitcoin Trust"],
        ["TLT", "20Y+ Treasuries"],
        ["AGG", "US Bond Aggregate"],
        ["HYG", "High Yield Bonds"],
        ["SCHD", "Dividend Equity"],
      ]),
      g("commodities", "Commodities", [
        ["GC=F", "Gold Futures"],
        ["SI=F", "Silver Futures"],
        ["PL=F", "Platinum Futures"],
        ["HG=F", "Copper Futures"],
        ["CL=F", "Crude Oil WTI"],
        ["BZ=F", "Brent Crude"],
        ["NG=F", "Natural Gas"],
        ["RB=F", "RBOB Gasoline"],
        ["ZC=F", "Corn Futures"],
        ["ZW=F", "Wheat Futures"],
        ["ZS=F", "Soybean Futures"],
        ["KC=F", "Coffee Futures"],
        ["CC=F", "Cocoa Futures"],
        ["SB=F", "Sugar Futures"],
        ["CT=F", "Cotton Futures"],
        ["GLD", "Gold ETF (GLD)"],
        ["SLV", "Silver ETF (SLV)"],
        ["USO", "Oil ETF (USO)"],
        ["URA", "Uranium ETF"],
        ["COPX", "Copper Miners ETF"],
      ]),
      g("indices", "Indices", [
        ["^GSPC", "S&P 500"],
        ["^NDX", "Nasdaq 100"],
        ["^DJI", "Dow Jones"],
        ["^RUT", "Russell 2000"],
        ["^VIX", "VIX Volatility"],
        ["^STOXX50E", "Euro Stoxx 50"],
        ["^FTSE", "FTSE 100"],
        ["^N225", "Nikkei 225"],
        ["^HSI", "Hang Seng"],
        ["000001.SS", "Shanghai Composite"],
      ]),
      g("fx", "FX Majors", [
        ["EURUSD=X", "EUR/USD"],
        ["GBPUSD=X", "GBP/USD"],
        ["USDJPY=X", "USD/JPY"],
        ["USDCHF=X", "USD/CHF"],
        ["AUDUSD=X", "AUD/USD"],
        ["USDCAD=X", "USD/CAD"],
        ["DX-Y.NYB", "Dollar Index"],
        ["EGP=X", "USD/EGP"],
      ]),
      g("crypto", "Crypto", [
        ["BTC-USD", "Bitcoin"],
        ["ETH-USD", "Ethereum"],
        ["SOL-USD", "Solana"],
        ["BNB-USD", "BNB"],
        ["XRP-USD", "XRP"],
        ["ADA-USD", "Cardano"],
        ["DOGE-USD", "Dogecoin"],
        ["TON-USD", "Toncoin"],
      ]),
    ],
  };
}
