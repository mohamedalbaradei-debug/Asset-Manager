import React from "react";
import {
  useGetSpyQqqRotation,
  getGetSpyQqqRotationQueryKey,
} from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtPct, pctColor } from "@/components/panels";

export default function SpyQqqPage() {
  const { data, isPending, isError } = useGetSpyQqqRotation({
    query: { queryKey: getGetSpyQqqRotationQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="SPY_VS_QQQ" />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load rotation data." />}
      {data && !data.available && <ErrorState message={data.explanation} />}
      {data?.available && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">SPY 1M</div>
              <div className={cn("font-mono text-2xl font-bold", pctColor(data.spy1m))}>{fmtPct(data.spy1m)}</div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">QQQ 1M</div>
              <div className={cn("font-mono text-2xl font-bold", pctColor(data.qqq1m))}>{fmtPct(data.qqq1m)}</div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">SPY 3M</div>
              <div className={cn("font-mono text-2xl font-bold", pctColor(data.spy3m))}>{fmtPct(data.spy3m)}</div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">QQQ 3M</div>
              <div className={cn("font-mono text-2xl font-bold", pctColor(data.qqq3m))}>{fmtPct(data.qqq3m)}</div>
            </div>
          </div>

          <section>
            <SectionTitle>NORMALIZED PRICE (100 = PERIOD START)</SectionTitle>
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.points} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                      labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                    />
                    <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                    <Line type="monotone" dataKey="spy" name="SPY" stroke="#4f8cff" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="qqq" name="QQQ" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>ROTATION SIGNAL</SectionTitle>
            <div className="bg-card border border-border rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
              <div>
                <div className="text-2xl font-mono font-bold tracking-wider uppercase">{data.signal}</div>
                <p className="text-xs font-mono text-muted-foreground mt-2 max-w-2xl leading-relaxed">{data.explanation}</p>
              </div>
              <div className="font-mono text-2xl font-bold text-primary shrink-0">SPY→QQQ</div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}