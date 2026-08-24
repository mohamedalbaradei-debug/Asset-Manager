import React from "react";
import {
  useGetGexData,
  getGetGexDataQueryKey,
  type GexData,
} from "@workspace/api-client-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtNum } from "@/components/panels";
import { VixGauge } from "@/components/VixGauge";

function GexPanel({ g, title }: { g: GexData; title: string }) {
  // Each chart renders its own significance-filtered bar set: a strike can
  // carry huge directional flow while its call/put gamma nets to ~zero, so
  // sharing one array leaves invisible slivers on one of the two charts.
  const gexBars = g.gexChart ?? g.points ?? [];
  const flowBars = g.flowChart ?? g.points ?? [];
  const tickInterval = (n: number) => (n > 20 ? Math.floor(n / 10) : 0);

  // Compact dollar axis labels ($-12B, 750M, ...) so bar proportions are readable
  const fmtAxisUsd = (v: number) => {
    if (v === 0) return "0";
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6) return `${sign}$${Math.round(abs / 1e6)}M`;
    if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
    return `${sign}$${abs}`;
  };

  if (!g.available) {
    return (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <div className="flex items-center justify-center py-10 border border-dashed border-border rounded-xl text-muted-foreground font-mono text-xs">
          {g.explanation}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">SPOT</div>
          <div className="font-mono text-2xl font-bold">${fmtNum(g.spot)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">NET GEX</div>
          <div className={cn("font-mono text-2xl font-bold", (g.netGex ?? 0) >= 0 ? "text-green-500" : "text-destructive")}>
            ${g.netGex != null ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(g.netGex) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">GAMMA FLIP</div>
          <div className="font-mono text-2xl font-bold">
            {g.gammaFlip != null ? `$${fmtNum(g.gammaFlip)}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">NET DELTA-DOLLAR FLOW</div>
          <div className={cn("font-mono text-2xl font-bold", (g.netFlowTotal ?? 0) >= 0 ? "text-green-500" : "text-destructive")}>
            ${g.netFlowTotal != null ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(g.netFlowTotal) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">SIGNAL</div>
          <div className="font-mono text-xl font-bold uppercase">{g.signal}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs font-mono text-muted-foreground mb-3">GAMMA EXPOSURE BY STRIKE</div>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gexBars} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="strike" interval={tickInterval(gexBars.length)} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtAxisUsd} width={58} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                  labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                  formatter={(val: number) => [`$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(val)}`, "Net GEX"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="netGex" radius={[3, 3, 0, 0]}>
                  {gexBars.map((p, i) => (
                    <Cell key={i} fill={(p.netGex ?? 0) >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs font-mono text-muted-foreground mb-3">NET DELTA-DOLLAR FLOW BY STRIKE</div>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flowBars} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="strike" interval={tickInterval(flowBars.length)} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtAxisUsd} width={58} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                  itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                  labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                  formatter={(val: number) => [`$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(val)}`, "Net Flow"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="netFlow" radius={[3, 3, 0, 0]}>
                  {flowBars.map((p, i) => (
                    <Cell key={i} fill={(p.netFlow ?? 0) >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="text-xs font-mono text-muted-foreground mb-2">INTERPRETATION</div>
        <p className="text-xs font-mono text-muted-foreground leading-relaxed">{g.explanation}</p>
      </div>
    </section>
  );
}

export default function GexPage() {
  const { data, isPending, isError } = useGetGexData({
    query: { queryKey: getGetGexDataQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <SectionHeader title="GEX_NET_FLOW" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load gamma exposure." />}
      {data && (
        <>
          <VixGauge variant="panel" />
          <GexPanel g={data.spx} title="S&P 500 (SPX) — GAMMA EXPOSURE" />
          <GexPanel g={data.vix} title="VIX — GAMMA EXPOSURE" />
        </>
      )}
    </div>
  );
}