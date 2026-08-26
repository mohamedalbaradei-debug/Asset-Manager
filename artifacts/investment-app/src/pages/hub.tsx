import React from "react";
import { Search, Loader2, ArrowUpRight, ArrowDownRight, BarChart3, AlertCircle, Activity, TrendingUp, LineChart as LineChartIcon, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { useAnalyzeStock, useGetTrendingTickers, useGetSymbolSearch, getGetTrendingTickersQueryKey, getGetSymbolSearchQueryKey, type SymbolSearchResult } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { VixGauge } from "@/components/VixGauge";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import {
  FairValueSection,
  PriceVsEpsSection,
  SentimentSection,
  MarketInternalsSection,
  OptionsFlowSection,
  GreeksSection,
  MacroContextSection,
  AiReportSection,
  DisclaimerSection,
} from "@/components/report";
import { CandleChart } from "@/components/CandleChart";
import { PremiumSectionLock } from "@/components/premium-gate";

const POPULAR_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMD"];

const EXCHANGE_NAMES: Record<string, string> = {
  NYQ: "NYSE", NMS: "NASDAQ", NMQ: "NASDAQ", NGM: "NASDAQ", PCX: "NYSE",
  GER: "Frankfurt", FRA: "Frankfurt", XET: "Xetra",
  LSE: "London", LON: "London",
  EBS: "Swiss", VTX: "Swiss", SWX: "Swiss",
  AQS: "Amsterdam", AMS: "Amsterdam", PA: "Paris",
  MIL: "Milan", BUD: "Budapest", MAD: "Madrid",
};

function exchangeName(code: string | null | undefined): string {
  return code ? (EXCHANGE_NAMES[code] ?? code) : "";
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
const formatNumber = (val: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(val);

type RecLabel = "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL";

function recStyles(rec: string) {
  if (rec === "STRONG BUY")
    return {
      badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40 shadow-[0_0_18px_rgba(52,211,153,0.15)]",
      bar: "bg-emerald-500",
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />,
    };
  if (rec === "BUY")
    return {
      badge: "bg-green-500/15 text-green-400 border-green-500/40 shadow-[0_0_18px_rgba(34,197,94,0.12)]",
      bar: "bg-green-500",
      icon: <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />,
    };
  if (rec === "SELL")
    return {
      badge: "bg-red-500/15 text-red-400 border-red-500/40 shadow-[0_0_18px_rgba(239,68,68,0.12)]",
      bar: "bg-red-500",
      icon: <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />,
    };
  if (rec === "STRONG SELL")
    return {
      badge: "bg-rose-600/15 text-rose-400 border-rose-600/40 shadow-[0_0_18px_rgba(225,29,72,0.15)]",
      bar: "bg-rose-600",
      icon: <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />,
    };
  // HOLD
  return {
    badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40 shadow-[0_0_18px_rgba(234,179,8,0.12)]",
    bar: "bg-yellow-500",
    icon: <MinusCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />,
  };
}

interface RecCardProps {
  label: string;
  icon: React.ReactNode;
  recommendation: string;
  score: number;
  rationale: string[];
}

function RecCard({ label, icon, recommendation, score, rationale }: RecCardProps) {
  const styles = recStyles(recommendation);
  // Normalise score to a 0-100 fill. Trader score ranges roughly -7..+7, investor -8..+8
  const fillPct = Math.round(Math.min(100, Math.max(0, ((score + 8) / 16) * 100)));

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-muted-foreground uppercase">
          {icon}
          {label}
        </div>
        <div className={cn("px-3 py-1 rounded-md text-xs font-mono font-bold tracking-widest border-2", styles.badge)}>
          {recommendation}
        </div>
      </div>

      {/* Score bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>SELL</span>
          <span className="text-foreground font-bold">Score: {score.toFixed(1)}</span>
          <span>BUY</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${fillPct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={cn("h-full rounded-full", styles.bar)}
          />
        </div>
      </div>

      {/* Rationale */}
      <ul className="space-y-2">
        {rationale.map((line, i) => (
          <li key={i} className="flex gap-2 items-start text-xs font-mono text-muted-foreground leading-relaxed">
            {styles.icon}
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HubPage() {
  const [ticker, setTicker] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<"overview" | "technicals">("overview");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [showDropdown, setShowDropdown] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);

  const analyzeStock = useAnalyzeStock();
  const { data: trendingTickers } = useGetTrendingTickers({
    query: { queryKey: getGetTrendingTickersQueryKey() },
  });
  const { data: searchData } = useGetSymbolSearch(
    { q: debouncedSearch },
    { query: { queryKey: getGetSymbolSearchQueryKey({ q: debouncedSearch }), enabled: debouncedSearch.trim().length >= 2 } }
  );

  const searchResults = searchData?.results ?? [];

  React.useEffect(() => {
    const q = ticker.trim();
    if (q.length < 2) {
      setDebouncedSearch("");
      setShowDropdown(false);
      return;
    }
    const t = setTimeout(() => setDebouncedSearch(q), 300);
    return () => clearTimeout(t);
  }, [ticker]);

  const selectResult = (symbol: string) => {
    setTicker(symbol);
    setShowDropdown(false);
    setHighlighted(0);
    analyzeStock.mutate({ data: { ticker: symbol } });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;
    setShowDropdown(false);
    analyzeStock.mutate({ data: { ticker: ticker.toUpperCase() } });
  };

  const handleChipClick = (t: string) => {
    setTicker(t);
    setShowDropdown(false);
    analyzeStock.mutate({ data: { ticker: t } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      const typed = ticker.trim().toUpperCase();
      const exact = searchResults.find((r) => r.symbol.toUpperCase() === typed);
      if (exact) {
        e.preventDefault();
        selectResult(exact.symbol);
      } else {
        const hit = searchResults[highlighted];
        if (hit) {
          e.preventDefault();
          selectResult(hit.symbol);
        }
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
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
              onChange={(e) => { setTicker(e.target.value); setShowDropdown(true); setHighlighted(0); }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="TICKER OR NAME (AAPL, SAP.DE, VOD.L, IUIT...)"
              autoComplete="off"
              className="w-full bg-card border-2 border-border rounded-lg py-4 pl-12 pr-4 text-lg font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary uppercase transition-all"
            />
            <button
              type="submit"
              disabled={isPending || !ticker.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1.5 rounded-md font-mono text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              ANALYZE
            </button>

            {showDropdown && searchResults.length > 0 && !isPending && (
              <div className="absolute z-20 left-0 right-0 top-[calc(100%+6px)] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                {searchResults.slice(0, 8).map((r: SymbolSearchResult, i: number) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectResult(r.symbol); }}
                    onMouseEnter={() => setHighlighted(i)}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors",
                      i === highlighted ? "bg-secondary/60" : "hover:bg-secondary/30"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono font-bold text-sm shrink-0">{r.symbol}</span>
                      <span className="text-xs font-mono text-muted-foreground truncate">{r.name ?? ""}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border border-border text-muted-foreground">
                        {r.type ?? ""}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground">{exchangeName(r.exchange)}</span>
                      {r.price != null && (
                        <span className="text-xs font-mono text-foreground">{r.price.toFixed(2)}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
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

        {/* States */}
        <AnimatePresence mode="wait">
          {isPending && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-24 space-y-6 bg-card border border-border rounded-xl"
            >
              <div className="relative">
                <div className="w-16 h-16 border-4 border-secondary rounded-full" />
                <div className="w-16 h-16 border-4 border-primary rounded-full border-t-transparent animate-spin absolute inset-0" />
                <Activity className="absolute inset-0 m-auto w-6 h-6 text-primary animate-pulse" />
              </div>
              <div className="space-y-1 text-center">
                <div className="font-mono text-primary font-bold tracking-widest text-lg">
                  ANALYZING {ticker.toUpperCase()}
                </div>
                <div className="font-mono text-xs text-muted-foreground tracking-widest">
                  GATHERING MARKET INTEL...
                </div>
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
                <p className="text-muted-foreground font-mono text-sm mt-1">
                  Unable to retrieve data for {ticker.toUpperCase()}. Verify symbol and try again.
                </p>
              </div>
            </motion.div>
          )}

          {/* Results */}
          {!isPending && result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Price header */}
              <div className="bg-card border border-border rounded-xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full pointer-events-none" />
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h1 className="text-4xl font-mono font-bold tracking-tighter">{result.ticker}</h1>
                      <div className="px-2 py-1 bg-secondary rounded text-xs font-mono text-muted-foreground border border-border">
                        {result.companyName ?? "N/A"}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-4 mt-4">
                      <span className="text-5xl font-mono font-bold tracking-tight">
                        {formatCurrency(result.currentPrice)}
                      </span>
                      {result.priceChange != null && result.priceChangePct != null && (
                        <div
                          className={cn(
                            "flex items-center font-mono text-lg font-medium",
                            result.priceChange >= 0 ? "text-green-500" : "text-destructive"
                          )}
                        >
                          {result.priceChange >= 0 ? (
                            <ArrowUpRight className="w-5 h-5 mr-1" />
                          ) : (
                            <ArrowDownRight className="w-5 h-5 mr-1" />
                          )}
                          {result.priceChange > 0 ? "+" : ""}
                          {result.priceChange.toFixed(2)} ({result.priceChangePct > 0 ? "+" : ""}
                          {result.priceChangePct.toFixed(2)}%)
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Dual Recommendation Cards (Premium) ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PremiumSectionLock feature="Trader Signal">
                  {result.traderRec && (
                    <RecCard
                      label="Trader Signal"
                      icon={<TrendingUp className="w-4 h-4" />}
                      recommendation={result.traderRec.recommendation}
                      score={result.traderRec.score}
                      rationale={result.traderRec.rationale}
                    />
                  )}
                </PremiumSectionLock>
                <PremiumSectionLock feature="Investor Signal">
                  {result.investorRec && (
                    <RecCard
                      label="Investor Signal"
                      icon={<LineChartIcon className="w-4 h-4" />}
                      recommendation={result.investorRec.recommendation}
                      score={result.investorRec.score}
                      rationale={result.investorRec.rationale}
                    />
                  )}
                </PremiumSectionLock>
              </div>

              {/* Candlestick chart (1Y OHLC + auto support/resistance) */}
              {result.ohlc1y && result.ohlc1y.length > 0 && (
                <CandleChart
                  ohlc={result.ohlc1y}
                  support={result.support}
                  resistance={result.resistance}
                />
              )}

              {/* Performance chart */}
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground">
                    RELATIVE PERFORMANCE (6M)
                  </h2>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-primary" />
                      <span>{result.ticker}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-muted-foreground/50" />
                      <span>S&P 500</span>
                    </div>
                  </div>
                </div>
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={result.historicalData}
                      margin={{ top: 5, right: 0, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => {
                          const d = new Date(val);
                          return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
                        }}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val.toFixed(0)}`}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                        itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                        labelStyle={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "10px",
                          color: "hsl(var(--muted-foreground))",
                          marginBottom: "4px",
                        }}
                        formatter={(val: number) => [val.toFixed(2), "Normalized"]}
                      />
                      <ReferenceLine
                        y={100}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="3 3"
                        opacity={0.5}
                      />
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
                        activeDot={{ r: 4, fill: "hsl(var(--primary))" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Technical Indicators */}
                <div className="bg-card border border-border rounded-xl p-6 space-y-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3">
                    TECHNICAL SIGNALS
                  </h2>

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
                          result.rsi > 70
                            ? "bg-destructive"
                            : result.rsi < 30
                            ? "bg-green-500"
                            : "bg-primary"
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
                      <div
                        className={cn(
                          "px-2 py-1 rounded text-xs font-mono font-bold",
                          result.macd.histogram > 0
                            ? "bg-green-500/10 text-green-500"
                            : "bg-destructive/10 text-destructive"
                        )}
                      >
                        {result.macd.histogram > 0 ? "BULLISH CROSS" : "BEARISH CROSS"}
                      </div>
                      <p className="text-xs text-muted-foreground flex-1">{result.explanations.macd}</p>
                    </div>
                  </div>

                  {/* SMA */}
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="flex justify-between items-center">
                      <div className="font-mono text-sm font-bold">MOVING AVERAGES</div>
                      <div
                        className={cn(
                          "text-xs font-mono font-bold px-2 py-1 rounded",
                          result.sma50 > result.sma200
                            ? "bg-green-500/10 text-green-500"
                            : "bg-destructive/10 text-destructive"
                        )}
                      >
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
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3">
                    KEY LEVELS & FUNDAMENTALS
                  </h2>

                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">RESISTANCE</div>
                      <div className="font-mono text-lg text-destructive">
                        {formatCurrency(result.resistance)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">SUPPORT</div>
                      <div className="font-mono text-lg text-green-500">
                        {formatCurrency(result.support)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">52W HIGH</div>
                      <div className="font-mono text-base">
                        {result.fiftyTwoWeekHigh ? formatCurrency(result.fiftyTwoWeekHigh) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">52W LOW</div>
                      <div className="font-mono text-base">
                        {result.fiftyTwoWeekLow ? formatCurrency(result.fiftyTwoWeekLow) : "—"}
                      </div>
                    </div>

                    <div className="col-span-2 h-[1px] bg-border my-2" />

                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">MARKET CAP</div>
                      <div className="font-mono text-base">
                        {result.marketCap ? formatNumber(result.marketCap) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">P/E RATIO</div>
                      <div className="font-mono text-base">
                        {result.peRatio ? result.peRatio.toFixed(2) : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">EPS</div>
                      <div className="font-mono text-base">
                        {result.eps != null ? `$${result.eps.toFixed(2)}` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">DIV YIELD</div>
                      <div className="font-mono text-base">
                        {result.dividendYield ? `${result.dividendYield.toFixed(2)}%` : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">VOLUME</div>
                      <div className="font-mono text-base">
                        {result.volume ? formatNumber(result.volume) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">AVG VOLUME</div>
                      <div className="font-mono text-base">
                        {result.avgVolume ? formatNumber(result.avgVolume) : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Fair Value + Price vs EPS + AI report ── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FairValueSection fairValue={result.fairValue} />
                <PriceVsEpsSection priceVsEps={result.priceVsEps} ticker={result.ticker} />
              </div>

              <AiReportSection aiReport={result.aiReport} />

              {/* ── Sentiment + Options + Internals ── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PremiumSectionLock feature="Google News Sentiment">
                  <SentimentSection report={result.newsSentiment} />
                </PremiumSectionLock>
                <PremiumSectionLock feature="Reddit Sentiment">
                  <SentimentSection report={result.socialSentiment} />
                </PremiumSectionLock>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PremiumSectionLock feature="Options Flow">
                  <OptionsFlowSection flow={result.optionsFlow} />
                </PremiumSectionLock>
                <PremiumSectionLock feature="Options Greeks (ATM)">
                  <GreeksSection greeks={result.greeks} />
                </PremiumSectionLock>
              </div>
              <PremiumSectionLock feature="Market Internals">
                <MarketInternalsSection internals={result.marketInternals} />
              </PremiumSectionLock>
              <MacroContextSection items={result.macroContext} />

              {/* News */}
              {result.news && result.news.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3 mb-4">
                    LATEST INTEL
                  </h2>
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

              <DisclaimerSection disclaimer={result.disclaimer} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right Sidebar - Trending */}
      <div className="w-full lg:w-80 flex-shrink-0 space-y-4">
        <VixGauge variant="sidebar" />
        <div className="bg-card border border-border rounded-xl p-6 sticky top-6">
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground">
              TRENDING VOLUME
            </h2>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>

          <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1 scrollbar-thin">
            {trendingTickers?.map((t) => (
              <div
                key={t.symbol}
                onClick={() => handleChipClick(t.symbol)}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary cursor-pointer transition-colors border border-transparent hover:border-border"
              >
                <div>
                  <div className="font-mono font-bold">{t.symbol}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">
                    {t.name ?? t.symbol}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">{t.price.toFixed(2)}</div>
                  <div
                    className={cn(
                      "text-xs font-mono flex items-center justify-end",
                      t.change >= 0 ? "text-green-500" : "text-destructive"
                    )}
                  >
                    {t.change >= 0 ? "+" : ""}
                    {t.changePct.toFixed(2)}%
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
