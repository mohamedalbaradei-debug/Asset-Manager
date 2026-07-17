import React from "react";
import { useGetMacroData, useGetTrendingTickers, getGetMacroDataQueryKey, getGetTrendingTickersQueryKey } from "@workspace/api-client-react";
import { Activity, ArrowUpRight, ArrowDownRight, Minus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export default function MarketPage() {
  const { data: macroData, isPending: isMacroPending } = useGetMacroData({
    query: { queryKey: getGetMacroDataQueryKey() }
  });

  const { data: trendingTickers, isPending: isTrendingPending } = useGetTrendingTickers({
    query: { queryKey: getGetTrendingTickersQueryKey() }
  });

  const getStatusColor = (status?: string | null) => {
    if (!status) return "text-muted-foreground bg-secondary";
    switch (status.toLowerCase()) {
      case "bullish": return "text-green-500 bg-green-500/10 border border-green-500/20";
      case "bearish": return "text-destructive bg-destructive/10 border border-destructive/20";
      case "neutral": return "text-yellow-500 bg-yellow-500/10 border border-yellow-500/20";
      default: return "text-muted-foreground bg-secondary";
    }
  };

  const getStatusIcon = (status?: string | null) => {
    if (!status) return <Minus className="w-4 h-4" />;
    switch (status.toLowerCase()) {
      case "bullish": return <ArrowUpRight className="w-4 h-4" />;
      case "bearish": return <ArrowDownRight className="w-4 h-4" />;
      case "neutral": return <Minus className="w-4 h-4" />;
      default: return <Minus className="w-4 h-4" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
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

      {(isMacroPending || isTrendingPending) && (
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
          {/* Macro Data Cards */}
          <section>
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">ECONOMIC INDICATORS</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {macroData.macro.map((item, i) => (
                <div key={i} className="bg-card border border-border p-4 rounded-xl flex flex-col justify-between">
                  <div className="text-xs text-muted-foreground font-mono mb-3">{item.label}</div>
                  <div className="flex items-end justify-between">
                    <div className="font-mono text-xl font-bold">{item.value}</div>
                    {item.status && (
                      <div className={cn("p-1 rounded flex items-center justify-center", getStatusColor(item.status))}>
                        {getStatusIcon(item.status)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Market Breadth */}
          <section>
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">MARKET BREADTH & LIQUIDITY</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {macroData.breadth.map((item, i) => (
                <div key={i} className="bg-card border border-border p-5 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">{item.label}</div>
                    <div className="font-mono text-2xl">{item.value}</div>
                  </div>
                  {item.status && (
                    <div className={cn("px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1 uppercase tracking-wider", getStatusColor(item.status))}>
                      {getStatusIcon(item.status)}
                      {item.status}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </motion.div>
      )}

      {trendingTickers && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">MARKET ACTIVITY (TRENDING)</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-sm whitespace-nowrap">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-4 font-normal">SYMBOL</th>
                    <th className="px-6 py-4 font-normal">COMPANY</th>
                    <th className="px-6 py-4 font-normal text-right">PRICE</th>
                    <th className="px-6 py-4 font-normal text-right">CHANGE</th>
                    <th className="px-6 py-4 font-normal text-right">% CHANGE</th>
                    <th className="px-6 py-4 font-normal text-right">MKT CAP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {trendingTickers.map((t) => (
                    <tr key={t.symbol} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-6 py-4 font-bold text-primary">{t.symbol}</td>
                      <td className="px-6 py-4 text-muted-foreground max-w-[200px] truncate">{t.name || '-'}</td>
                      <td className="px-6 py-4 text-right">${t.price.toFixed(2)}</td>
                      <td className={cn(
                        "px-6 py-4 text-right font-bold",
                        t.change >= 0 ? "text-green-500" : "text-destructive"
                      )}>
                        {t.change > 0 ? '+' : ''}{t.change.toFixed(2)}
                      </td>
                      <td className={cn(
                        "px-6 py-4 text-right",
                        t.change >= 0 ? "text-green-500" : "text-destructive"
                      )}>
                        <div className="flex items-center justify-end gap-1">
                          {t.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {Math.abs(t.changePct).toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-muted-foreground">
                        {t.marketCap ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(t.marketCap) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.section>
      )}
    </div>
  );
}
