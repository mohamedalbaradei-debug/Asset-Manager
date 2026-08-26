import React from "react";
import {
  useGetMacroData,
  useGetTrendingTickers,
  getGetMacroDataQueryKey,
  getGetTrendingTickersQueryKey,
} from "@workspace/api-client-react";
import type { CommodityEntry, FearGreedData } from "@workspace/api-client-react";
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Loader2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Flame,
  Bitcoin,
  Droplets,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status?: string | null) {
  switch (status?.toLowerCase()) {
    case "bullish":  return "text-green-500 bg-green-500/10 border border-green-500/20";
    case "bearish":  return "text-destructive bg-destructive/10 border border-destructive/20";
    case "neutral":  return "text-yellow-500 bg-yellow-500/10 border border-yellow-500/20";
    default:         return "text-muted-foreground bg-secondary";
  }
}

function statusIcon(status?: string | null) {
  switch (status?.toLowerCase()) {
    case "bullish": return <ArrowUpRight className="w-4 h-4" />;
    case "bearish": return <ArrowDownRight className="w-4 h-4" />;
    default:        return <Minus className="w-4 h-4" />;
  }
}

// ── Fear & Greed gauge ────────────────────────────────────────────────────────

const FG_ZONES = [
  { max: 25,  label: "Extreme Fear",  color: "#ef4444" },
  { max: 45,  label: "Fear",          color: "#f97316" },
  { max: 55,  label: "Neutral",       color: "#eab308" },
  { max: 75,  label: "Greed",         color: "#84cc16" },
  { max: 100, label: "Extreme Greed", color: "#22c55e" },
];

function fgColor(score: number) {
  return FG_ZONES.find((z) => score <= z.max)?.color ?? "#22c55e";
}

// VIX explanation shown directly under the numeric value.
function vixMeaning(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "Measures expected 30-day S&P 500 volatility. Lower = calmer markets.";
  if (n < 15) return "Low volatility — markets calm, risk appetite high.";
  if (n < 20) return "Normal volatility — mild investor anxiety.";
  if (n < 30) return "Elevated volatility — noticeable fear in markets.";
  return "High volatility — markets in panic mode.";
}

function FearGreedGauge({ data, updatedAt }: { data: FearGreedData; updatedAt?: string }) {
  const color = fgColor(data.score);
  // Semicircle gauge: score 0 = far left (180°), score 100 = far right (0°), sweeping through top.
  const gaugeAngle = (score: number) => 180 - (score / 100) * 180;
  const pointAt = (angleDeg: number, len: number) => ({
    x: 100 + len * Math.cos((angleDeg * Math.PI) / 180),
    y: 100 - len * Math.sin((angleDeg * Math.PI) / 180),
  });
  const needleAngle = gaugeAngle(data.score);
  const needleTip = pointAt(needleAngle, 62);

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground">
          FEAR &amp; GREED INDEX
        </h2>
        <div
          className="px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1.5 border"
          style={{ color, borderColor: `${color}55`, backgroundColor: `${color}1a` }}
        >
          {data.label.toUpperCase()}
        </div>
      </div>

      {/* Gauge SVG */}
      <div className="flex flex-col items-center gap-3">
        <svg viewBox="0 0 200 124" className="w-56 h-auto" aria-label={`Fear & Greed: ${data.score}`}>
          {/* Colored arc segments (semicircle from left through top to right) */}
          {[
            { from: 0,   to: 25,  color: "#ef4444" },
            { from: 25,  to: 45,  color: "#f97316" },
            { from: 45,  to: 55,  color: "#eab308" },
            { from: 55,  to: 75,  color: "#84cc16" },
            { from: 75,  to: 100, color: "#22c55e" },
          ].map((seg, i) => {
            const r = 75, sw = 14;
            const a1 = gaugeAngle(seg.from);
            const a2 = gaugeAngle(seg.to);
            const p1 = pointAt(a1, r);
            const p2 = pointAt(a2, r);
            return (
              <path
                key={i}
                d={`M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`}
                fill="none"
                stroke={seg.color}
                strokeWidth={sw}
                strokeLinecap="round"
                opacity={0.85}
              />
            );
          })}

          {/* Needle — anchored at the arc centre (100,100), length 62 */}
          <motion.line
            x1="100" y1="100"
            x2={needleTip.x}
            y2={needleTip.y}
            stroke={color}
            strokeWidth="3.5"
            strokeLinecap="round"
            initial={{ x2: pointAt(gaugeAngle(0), 62).x, y2: pointAt(gaugeAngle(0), 62).y }}
            animate={{ x2: needleTip.x, y2: needleTip.y }}
            transition={{ type: "spring", stiffness: 60, damping: 18 }}
          />
          <circle cx="100" cy="100" r="6" fill={color} />
          <circle cx="100" cy="100" r="3" fill="hsl(var(--card))" />

          {/* Score text */}
          <text x="100" y="118" textAnchor="middle" fontSize="20" fontWeight="bold" fill={color} fontFamily="monospace">
            {data.score}
          </text>
        </svg>

        <div className="text-center space-y-1">
          <div className="font-mono font-bold text-lg" style={{ color }}>{data.label}</div>
          <p className="text-xs font-mono text-muted-foreground max-w-md text-center leading-relaxed">
            {data.description}
          </p>
        </div>

        {/* Zone legend */}
        <div className="flex flex-wrap justify-center gap-3 pt-1">
          {FG_ZONES.map((z) => (
            <div key={z.label} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: z.color }} />
              {z.label}
            </div>
          ))}
        </div>

        {updatedAt && (
          <div className="text-[10px] font-mono text-muted-foreground/60 text-center pt-1">
            Updated {new Date(updatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Commodity / Crypto card ───────────────────────────────────────────────────

function commodityIcon(symbol: string) {
  if (symbol === "GC=F") return <span className="text-yellow-400 font-bold font-mono text-base">Au</span>;
  if (symbol === "CL=F") return <Droplets className="w-5 h-5 text-blue-400" />;
  if (symbol === "BTC-USD") return <Bitcoin className="w-5 h-5 text-orange-400" />;
  return <TrendingUp className="w-5 h-5 text-muted-foreground" />;
}

function CommodityCard({ c }: { c: CommodityEntry }) {
  const up = c.changePct >= 0;
  const color = fgColor(50); // neutral default; overridden by status below
  void color;

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
            {commodityIcon(c.symbol)}
          </div>
          <div>
            <div className="font-mono font-bold text-base">{c.label}</div>
            <div className="text-[10px] font-mono text-muted-foreground">{c.symbol}</div>
          </div>
        </div>
        <div className={cn("px-2 py-1 rounded text-xs font-mono font-bold flex items-center gap-1 border", statusColor(c.status))}>
          {statusIcon(c.status)}
          {c.status?.toUpperCase()}
        </div>
      </div>

      {/* Price row */}
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xl font-bold">
          {c.currency === "USD" ? "$" : ""}{c.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </span>
        <span className={cn("font-mono text-sm font-medium flex items-center gap-0.5", up ? "text-green-500" : "text-destructive")}>
          {up ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          {up ? "+" : ""}{c.changePct.toFixed(2)}%
        </span>
      </div>

      {/* Equity impact */}
      <div className="border-t border-border pt-3">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">
          EQUITY IMPACT
        </div>
        <p className="text-xs font-mono text-muted-foreground leading-relaxed">{c.equityImpact}</p>
      </div>
    </div>
  );
}

// ── Ticker type helpers ───────────────────────────────────────────────────────

function tickerRegion(symbol: string): string {
  // Commodities & Crypto
  if (["GC=F","CL=F","SI=F","NG=F"].includes(symbol)) return "Commodity";
  if (symbol.endsWith("-USD") || symbol.endsWith("-USDT")) return "Crypto";
  // US ETFs
  if (["SPY","QQQ","DIA","IWM","VTI","VOO","GLD","SLV","XLF","XLE","XLK","XLV","ARKK"].includes(symbol)) return "US ETF";
  // Asia-Pacific indices
  if (symbol === "^N225")      return "Japan";
  if (symbol === "^TWII")      return "Taiwan";
  if (symbol === "^HSI")       return "Hong Kong";
  if (symbol === "000001.SS")  return "China";
  if (symbol === "399001.SZ")  return "China";
  if (symbol === "^KS11")      return "South Korea";
  if (symbol === "^NSEI" || symbol === "^BSESN") return "India";
  if (symbol === "^AXJO")      return "Australia";
  if (symbol === "^NZ50")      return "New Zealand";
  if (symbol === "^STI")       return "Singapore";
  if (symbol === "^JKSE")      return "Indonesia";
  if (symbol === "^KLSE")      return "Malaysia";
  // European indices
  if (symbol === "^FTSE")      return "United Kingdom";
  if (symbol === "^GDAXI")     return "Germany";
  if (symbol === "^FCHI")      return "France";
  if (symbol === "^STOXX50E")  return "Europe";
  if (symbol === "^AEX")       return "Netherlands";
  if (symbol === "^IBEX")      return "Spain";
  if (symbol === "^SSMI")      return "Switzerland";
  if (symbol === "^ATX")       return "Austria";
  if (symbol === "^BFX")       return "Belgium";
  if (symbol === "^OSEAX")     return "Norway";
  if (symbol === "^OMXS30")    return "Sweden";
  if (symbol === "^OMXC25")    return "Denmark";
  if (symbol === "^GSPTSE")    return "Canada";
  // Middle East & Africa
  if (symbol === "^CASE30")    return "Egypt";
  if (symbol === "^TA125.TA" || symbol === "^TA35") return "Israel";
  if (symbol === "^XU100")     return "Turkey";
  // Latin America
  if (symbol === "^BVSP")      return "Brazil";
  if (symbol === "^MXX")       return "Mexico";
  if (symbol === "^MERV")      return "Argentina";
  if (symbol === "^IPSA")      return "Chile";
  // International ADRs / cross-listings
  if (symbol === "TSM")        return "Taiwan";
  if (symbol === "ASML")       return "Netherlands";
  if (symbol === "BABA" || symbol === "NIO") return "China";
  if (symbol === "SAP")        return "Germany";
  if (symbol === "TM" || symbol === "SONY") return "Japan";
  if (symbol === "HDB")        return "India";
  if (symbol === "SHOP")       return "Canada";
  if (symbol === "ARM")        return "United Kingdom";
  // Anything else with ^ is an index
  if (symbol.startsWith("^"))  return "Index";
  return "United States";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MarketPage() {
  const { data: macroData, isPending: isMacroPending } = useGetMacroData({
    query: { queryKey: getGetMacroDataQueryKey() },
  });
  const { data: trendingTickers, isPending: isTrendingPending } = useGetTrendingTickers({
    query: { queryKey: getGetTrendingTickersQueryKey() },
  });

  const isLoading = isMacroPending || isTrendingPending;

  // Group trending tickers by region category for the table tag
  const formatPrice = (t: { price: number; symbol: string }) => {
    if (t.symbol === "BTC-USD" || t.symbol === "ETH-USD") {
      return `$${t.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }
    return t.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Page header */}
      <div className="flex items-end justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tighter">MACRO_OVERVIEW</h1>
          <p className="text-muted-foreground font-mono mt-2">SYSTEM WIDE MARKET CONDITIONS</p>
        </div>
        {macroData?.updatedAt && (
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <Activity className="w-3 h-3 text-primary" />
            UPDATED: {new Date(macroData.updatedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center items-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {macroData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* ── Fear & Greed ── */}
          {macroData.fearGreed && (
            <section>
              <FearGreedGauge data={macroData.fearGreed} updatedAt={macroData.updatedAt} />
            </section>
          )}

          {/* ── Commodities & Crypto ── */}
          {macroData.commodities && macroData.commodities.length > 0 && (
            <section>
              <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">
                COMMODITIES &amp; CRYPTO — EQUITY IMPACT
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {macroData.commodities.map((c) => (
                  <CommodityCard key={c.symbol} c={c} />
                ))}
              </div>
            </section>
          )}

          {/* ── Economic Indicators ── */}
          <section>
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">
              ECONOMIC INDICATORS
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {macroData.macro.map((item, i) => (
                <div
                  key={i}
                  className="bg-card border border-border p-4 rounded-xl flex flex-col justify-between"
                >
                  <div className="text-xs text-muted-foreground font-mono mb-3">{item.label}</div>
                  <div className="flex items-end justify-between">
                    <div className="font-mono text-xl font-bold">{item.value}</div>
                    {item.status && (
                      <div className={cn("p-1 rounded flex items-center justify-center", statusColor(item.status))}>
                        {statusIcon(item.status)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Market Breadth ── */}
          <section>
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">
              MARKET BREADTH &amp; LIQUIDITY
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {macroData.breadth.map((item, i) => (
                <div
                  key={i}
                  className="bg-card border border-border p-5 rounded-xl flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">{item.label}</div>
                    <div className="font-mono text-2xl">{item.value}</div>
                    {item.label.includes("VIX") && (
                      <p className="text-[10px] font-mono text-muted-foreground mt-1.5 max-w-[150px] leading-snug">
                        {vixMeaning(item.value)}
                      </p>
                    )}
                  </div>
                  {item.status && (
                    <div
                      className={cn(
                        "px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1 uppercase tracking-wider",
                        statusColor(item.status)
                      )}
                    >
                      {statusIcon(item.status)}
                      {item.status}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </motion.div>
      )}

      {/* ── Global Market Activity ── */}
      {trendingTickers && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">
            GLOBAL MARKET ACTIVITY
          </h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-sm whitespace-nowrap">
                <thead className="bg-secondary/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-5 py-4 font-normal">SYMBOL</th>
                    <th className="px-5 py-4 font-normal">NAME / INDEX</th>
                    <th className="px-5 py-4 font-normal">REGION</th>
                    <th className="px-5 py-4 font-normal text-right">PRICE</th>
                    <th className="px-5 py-4 font-normal text-right">CHG</th>
                    <th className="px-5 py-4 font-normal text-right">% CHG</th>
                    <th className="px-5 py-4 font-normal text-right">MKT CAP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {trendingTickers.map((t) => {
                    const region = tickerRegion(t.symbol);
                    const isIndex = t.symbol.startsWith("^") || t.symbol === "000001.SS";
                    return (
                      <tr key={t.symbol} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-5 py-3.5">
                          <span className={cn(
                            "font-bold",
                            isIndex ? "text-blue-400" :
                            region === "Crypto" ? "text-orange-400" :
                            region === "Commodity" ? "text-yellow-400" :
                            "text-primary"
                          )}>
                            {t.symbol}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground max-w-[220px] truncate">
                          {t.name ?? "—"}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border font-mono",
                            region === "United States" ? "border-primary/30 text-primary" :
                            region === "Crypto" ? "border-orange-500/30 text-orange-400" :
                            region === "Commodity" ? "border-yellow-500/30 text-yellow-400" :
                            region === "US ETF" ? "border-blue-500/30 text-blue-400" :
                            "border-border text-muted-foreground"
                          )}>
                            {region}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">{formatPrice(t)}</td>
                        <td className={cn(
                          "px-5 py-3.5 text-right font-bold",
                          t.change >= 0 ? "text-green-500" : "text-destructive"
                        )}>
                          {t.change > 0 ? "+" : ""}{t.change.toFixed(2)}
                        </td>
                        <td className={cn(
                          "px-5 py-3.5 text-right",
                          t.change >= 0 ? "text-green-500" : "text-destructive"
                        )}>
                          <div className="flex items-center justify-end gap-1">
                            {t.change >= 0
                              ? <ArrowUpRight className="w-3 h-3" />
                              : <ArrowDownRight className="w-3 h-3" />}
                            {Math.abs(t.changePct).toFixed(2)}%
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right text-muted-foreground">
                          {t.marketCap
                            ? new Intl.NumberFormat("en-US", {
                                notation: "compact",
                                maximumFractionDigits: 1,
                              }).format(t.marketCap)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-3 text-[10px] font-mono text-muted-foreground px-1">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary inline-block"/>US Stocks</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"/>Global Indices / US ETFs</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block"/>Crypto</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"/>Commodities</div>
          </div>
        </motion.section>
      )}
    </div>
  );
}
