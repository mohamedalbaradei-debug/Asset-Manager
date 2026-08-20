import React from "react";
import {
  useGetMarketMovers,
  getGetMarketMoversQueryKey,
  type Mover,
} from "@workspace/api-client-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtNum, pctColor } from "@/components/panels";

function MoverTable({ title, rows, accent }: { title: string; rows?: Mover[]; accent: string }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      {!rows || rows.length === 0 ? (
        <div className="flex items-center justify-center py-10 border border-dashed border-border rounded-xl text-muted-foreground font-mono text-xs">
          NO DATA AVAILABLE
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-sm whitespace-nowrap">
              <thead className="bg-secondary/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-5 py-4 font-normal">SYMBOL</th>
                  <th className="px-5 py-4 font-normal">NAME</th>
                  <th className="px-5 py-4 font-normal text-right">PRICE</th>
                  <th className="px-5 py-4 font-normal text-right">CHG</th>
                  <th className="px-5 py-4 font-normal text-right">% CHG</th>
                  <th className="px-5 py-4 font-normal text-right">VOLUME</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.symbol} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className={cn("font-bold", accent)}>{m.symbol}</span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground max-w-[220px] truncate">
                      {m.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right">${fmtNum(m.price)}</td>
                    <td className={cn("px-5 py-3.5 text-right font-bold", pctColor(m.change))}>
                      {m.change > 0 ? "+" : ""}{m.change?.toFixed(2)}
                    </td>
                    <td className={cn("px-5 py-3.5 text-right", pctColor(m.changePct))}>
                      <div className="flex items-center justify-end gap-1">
                        {m.changePct >= 0
                          ? <ArrowUpRight className="w-3 h-3" />
                          : <ArrowDownRight className="w-3 h-3" />}
                        {Math.abs(m.changePct).toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right text-muted-foreground">
                      {m.volume != null ? new Intl.NumberFormat("en-US", { notation: "compact" }).format(m.volume) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default function MoversPage() {
  const { data, isPending, isError } = useGetMarketMovers({
    query: { queryKey: getGetMarketMoversQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="MARKET_MOVERS" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load today's movers." />}
      {data && (
        <div className="space-y-8">
          <MoverTable title="TOP GAINERS" rows={data.gainers} accent="text-green-500" />
          <MoverTable title="TOP LOSERS" rows={data.losers} accent="text-destructive" />
          <MoverTable title="MOST ACTIVE" rows={data.mostActive} accent="text-primary" />
        </div>
      )}
      <p className="text-[10px] font-mono text-muted-foreground text-center">
        Source: Yahoo Finance screener
      </p>
    </div>
  );
}