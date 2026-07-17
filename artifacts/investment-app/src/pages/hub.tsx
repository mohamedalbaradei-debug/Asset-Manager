import React from "react";
import { Search, Loader2, ArrowUpRight, ArrowDownRight, Minus, BarChart3, AlertCircle, Activity } from "lucide-react";
import { useAnalyzeStock, useGetTrendingTickers, getGetTrendingTickersQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMD"];

const formatCurrency = (val: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
const formatNumber = (val: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(val);

export default function HubPage() {
  const [ticker, setTicker] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<"overview" | "technicals">("overview");
  
  const analyzeStock = useAnalyzeStock();
  const { data: trendingTickers } = useGetTrendingTickers({
    query: { queryKey: getGetTrendingTickersQueryKey() }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;
    analyzeStock.mutate({ data: { ticker: ticker.toUpperCase() } });
  };

  const handleChipClick = (t: string) => {
    setTicker(t);
    analyzeStock.mutate({ data: { ticker: t } });
  };

  const result = analyzeStock.data;
  const isPending = analyzeStock.isPending;

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto">
      <div className="flex-1 space-y-6">
        {/* Search Header */}
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="ENTER TICKER SYMBOL..."
              className="w-full bg-card border-2 border-border rounded-lg py-4 pl-12 pr-4 text-lg font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary uppercase transition-all"
            />
            <button 
              type="submit" 
              disabled={isPending || !ticker.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1.5 rounded-md font-mono text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              ANALYZE
            </button>
          </form>
          
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-mono text-muted-foreground mr-2">FREQUENT:</span>
            {POPULAR_TICKERS.map((t) => (
              <button
                key={t}
                onClick={() => handleChipClick(t)}
                className="px-3 py-1 bg-secondary text-secondary-foreground border border-border rounded-full text-xs font-mono hover:border-primary hover:text-primary transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        <AnimatePresence mode="wait">
          {isPending && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-24 space-y-6 bg-card border border-border rounded-xl"
            >
              <div className="relative">
                <div className="w-16 h-16 border-4 border-secondary rounded-full"></div>
                <div className="w-16 h-16 border-4 border-primary rounded-full border-t-transparent animate-spin absolute inset-0"></div>
                <Activity className="absolute inset-0 m-auto w-6 h-6 text-primary animate-pulse" />
              </div>
              <div className="space-y-1 text-center">
                <div className="font-mono text-primary font-bold tracking-widest text-lg">ANALYZING {ticker.toUpperCase()}</div>
                <div className="font-mono text-xs text-muted-foreground tracking-widest">GATHERING MARKET INTEL...</div>
              </div>
            </motion.div>
          )}

          {!isPending && !result && !analyzeStock.isError && (
             <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 space-y-4 border border-dashed border-border rounded-xl text-muted-foreground"
            >
              <BarChart3 className="w-12 h-12 opacity-50" />
              <p className="font-mono text-sm">AWAITING INPUT_</p>
            </motion.div>
          )}

          {!isPending && analyzeStock.isError && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-4"
            >
              <AlertCircle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              <div>
                <h3 className="font-mono font-bold text-destructive text-lg">ANALYSIS FAILED</h3>
                <p className="text-muted-foreground font-mono text-sm mt-1">Unable to retrieve data for {ticker.toUpperCase()}. Verify symbol and try again.</p>
              </div>
            </motion.div>
          )}

          {/* Results State */}
          {!isPending && result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Top Card: Price & Recommendation */}
              <div className="bg-card border border-border rounded-xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full pointer-events-none" />
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h1 className="text-4xl font-mono font-bold tracking-tighter">{result.ticker}</h1>
                      <div className="px-2 py-1 bg-secondary rounded text-xs font-mono text-muted-foreground border border-border">
                        {result.companyName || 'N/A'}
                      </div>
                    </div>
                    
                    <div className="flex items-baseline gap-4 mt-4">
                      <span className="text-5xl font-mono font-bold tracking-tight">
                        {formatCurrency(result.currentPrice)}
                      </span>
                      {result.priceChange != null && result.priceChangePct != null && (
                        <div className={cn(
                          "flex items-center font-mono text-lg font-medium",
                          result.priceChange >= 0 ? "text-green-500" : "text-destructive"
                        )}>
                          {result.priceChange >= 0 ? <ArrowUpRight className="w-5 h-5 mr-1" /> : <ArrowDownRight className="w-5 h-5 mr-1" />}
                          {result.priceChange > 0 ? '+' : ''}{result.priceChange.toFixed(2)} ({result.priceChangePct > 0 ? '+' : ''}{result.priceChangePct.toFixed(2)}%)
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <div className="text-xs font-mono text-muted-foreground mb-2">AI RECOMMENDATION</div>
                    <div className={cn(
                      "px-6 py-3 rounded-lg font-mono font-bold text-lg tracking-widest border-2",
                      result.recommendation.includes("BUY") ? "bg-green-500/10 text-green-500 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]" :
                      result.recommendation.includes("SELL") ? "bg-destructive/10 text-destructive border-destructive/30 shadow-[0_0_15px_rgba(239,68,68,0.15)]" :
                      "bg-yellow-500/10 text-yellow-500 border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.15)]"
                    )}>
                      {result.recommendation}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chart Section */}
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground">RELATIVE PERFORMANCE (6M)</h2>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-primary"></div>
                      <span>{result.ticker}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-muted-foreground/50"></div>
                      <span>S&P 500</span>
                    </div>
                  </div>
                </div>
                
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.historicalData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => {
                          const d = new Date(val);
                          return `${d.getMonth()+1}/${d.getFullYear().toString().slice(2)}`;
                        }}
                      />
                      <YAxis 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val.toFixed(0)}`}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                        itemStyle={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                        labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                        formatter={(val: number) => [val.toFixed(2), 'Normalized']}
                      />
                      <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                      {result.historicalData[0]?.spyPriceNorm !== undefined && (
                        <Line 
                          type="monotone" 
                          dataKey="spyPriceNorm" 
                          stroke="hsl(var(--muted-foreground))" 
                          strokeWidth={1.5} 
                          dot={false}
                          opacity={0.5}
                        />
                      )}
                      <Line 
                        type="monotone" 
                        dataKey="priceNorm" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2} 
                        dot={false}
                        activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Technical Indicators */}
                <div className="bg-card border border-border rounded-xl p-6 space-y-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3">TECHNICAL SIGNALS</h2>
                  
                  {/* RSI */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <div className="font-mono text-sm font-bold">RSI (14)</div>
                      <div className="font-mono text-lg">{result.rsi.toFixed(1)}</div>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden relative">
                      <div className="absolute top-0 left-[30%] w-[1px] h-full bg-muted-foreground/50 z-10" />
                      <div className="absolute top-0 left-[70%] w-[1px] h-full bg-muted-foreground/50 z-10" />
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, Math.max(0, result.rsi))}%` }}
                        className={cn(
                          "h-full transition-all duration-1000",
                          result.rsi > 70 ? "bg-destructive" : result.rsi < 30 ? "bg-green-500" : "bg-primary"
                        )}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{result.explanations.rsi}</p>
                  </div>

                  {/* MACD */}
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="flex justify-between items-center">
                      <div className="font-mono text-sm font-bold">MACD</div>
                      <div className="flex gap-4 text-xs font-mono">
                        <span className="text-primary">M: {result.macd.macd.toFixed(2)}</span>
                        <span className="text-muted-foreground">S: {result.macd.signal.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "px-2 py-1 rounded text-xs font-mono font-bold",
                        result.macd.histogram > 0 ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"
                      )}>
                        {result.macd.histogram > 0 ? "BULLISH CROSS" : "BEARISH CROSS"}
                      </div>
                      <p className="text-xs text-muted-foreground flex-1">{result.explanations.macd}</p>
                    </div>
                  </div>

                  {/* SMA */}
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="flex justify-between items-center">
                      <div className="font-mono text-sm font-bold">MOVING AVERAGES</div>
                      <div className={cn(
                        "text-xs font-mono font-bold px-2 py-1 rounded",
                        result.sma50 > result.sma200 ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"
                      )}>
                        {result.sma50 > result.sma200 ? "GOLDEN CROSS" : "DEATH CROSS"}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="bg-secondary p-3 rounded-lg">
                        <div className="text-xs text-muted-foreground font-mono">SMA50</div>
                        <div className="font-mono text-lg">{formatCurrency(result.sma50)}</div>
                      </div>
                      <div className="bg-secondary p-3 rounded-lg">
                        <div className="text-xs text-muted-foreground font-mono">SMA200</div>
                        <div className="font-mono text-lg">{formatCurrency(result.sma200)}</div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{result.explanations.sma50}</p>
                  </div>
                </div>

                {/* Fundamentals & Levels */}
                <div className="bg-card border border-border rounded-xl p-6 space-y-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3">KEY LEVELS & FUNDAMENTALS</h2>
                  
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">RESISTANCE</div>
                      <div className="font-mono text-lg text-destructive">{formatCurrency(result.resistance)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">SUPPORT</div>
                      <div className="font-mono text-lg text-green-500">{formatCurrency(result.support)}</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">52W HIGH</div>
                      <div className="font-mono text-base">{result.fiftyTwoWeekHigh ? formatCurrency(result.fiftyTwoWeekHigh) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">52W LOW</div>
                      <div className="font-mono text-base">{result.fiftyTwoWeekLow ? formatCurrency(result.fiftyTwoWeekLow) : '-'}</div>
                    </div>

                    <div className="col-span-2 h-[1px] bg-border my-2" />

                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">MARKET CAP</div>
                      <div className="font-mono text-base">{result.marketCap ? formatNumber(result.marketCap) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">P/E RATIO</div>
                      <div className="font-mono text-base">{result.peRatio ? result.peRatio.toFixed(2) : '-'}</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">VOLUME</div>
                      <div className="font-mono text-base">{result.volume ? formatNumber(result.volume) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">AVG VOLUME</div>
                      <div className="font-mono text-base">{result.avgVolume ? formatNumber(result.avgVolume) : '-'}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* News */}
              {result.news && result.news.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3 mb-4">LATEST INTEL</h2>
                  <ul className="space-y-4">
                    {result.news.slice(0, 5).map((n, i) => (
                      <li key={i} className="flex gap-4 items-start group">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0 group-hover:scale-150 transition-transform" />
                        <p className="text-sm hover:text-primary transition-colors cursor-pointer">{n}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right Sidebar - Trending */}
      <div className="w-full lg:w-80 flex-shrink-0">
        <div className="bg-card border border-border rounded-xl p-6 sticky top-6">
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground">TRENDING VOLUME</h2>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          
          <div className="space-y-3">
            {trendingTickers?.map((t) => (
              <div 
                key={t.symbol} 
                onClick={() => handleChipClick(t.symbol)}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary cursor-pointer transition-colors border border-transparent hover:border-border"
              >
                <div>
                  <div className="font-mono font-bold">{t.symbol}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">{t.name || t.symbol}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">{t.price.toFixed(2)}</div>
                  <div className={cn(
                    "text-xs font-mono flex items-center justify-end",
                    t.change >= 0 ? "text-green-500" : "text-destructive"
                  )}>
                    {t.change >= 0 ? '+' : ''}{t.changePct.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
            {!trendingTickers && (
               <div className="flex justify-center py-8">
                 <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
