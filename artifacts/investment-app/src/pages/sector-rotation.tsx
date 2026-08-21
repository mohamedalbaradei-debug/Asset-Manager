import React from "react";
import {
  useGetSectorRotation,
  getGetSectorRotationQueryKey,
  type SectorRotationItem,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtPct, pctColor, StatusBadge } from "@/components/panels";

const COLORS = [
  "#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24",
  "#60a5fa", "#fb7185", "#4ade80", "#facc15", "#2dd4bf", "#c084fc",
];

function relBadge(rel: number | null | undefined): string {
  if (rel == null) return "neutral";
  if (rel > 0.5) return "bullish";
  if (rel < -0.5) return "bearish";
  return "neutral";
}

function shortDate(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function fullDate(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

interface RotationPoint {
  date: string;
  [key: string]: string | number | null;
}

function buildRotationData(
  sectors: SectorRotationItem[],
  spyDaily: Array<{ date: string; retPct: number | null }> | undefined
): RotationPoint[] {
  const byDate = new Map<string, RotationPoint>();
  for (const s of sectors) {
    for (const p of s.daily ?? []) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.symbol] = p.retPct;
      byDate.set(p.date, row);
    }
  }
  for (const p of spyDaily ?? []) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row["SPY"] = p.retPct;
    byDate.set(p.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function SectorRow({ s }: { s: SectorRotationItem }) {
  const rel = s.relStrengthSpy;
  return (
    <tr className="hover:bg-secondary/30 transition-colors">
      <td className="px-5 py-3.5 font-bold text-primary">{s.symbol}</td>
      <td className="px-5 py-3.5 text-muted-foreground">{s.name}</td>
      <td className={cn("px-5 py-3.5 text-right", pctColor(s.change1dPct))}>{fmtPct(s.change1dPct)}</td>
      <td className={cn("px-5 py-3.5 text-right", pctColor(s.change1wPct))}>{fmtPct(s.change1wPct)}</td>
      <td className={cn("px-5 py-3.5 text-right", pctColor(s.change1mPct))}>{fmtPct(s.change1mPct)}</td>
      <td className="px-5 py-3.5 text-right">
        <StatusBadge status={relBadge(rel)} />
        {rel != null && <span className="ml-2 text-muted-foreground">{rel > 0 ? "+" : ""}{rel.toFixed(2)}%</span>}
      </td>
      {/* Relative strength bar */}
      <td className="px-5 py-3.5 w-40">
        {rel != null ? (
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                rel >= 0 ? "bg-green-500" : "bg-destructive"
              )}
              style={{ width: `${Math.min(100, Math.abs(rel) * 20)}%`, marginLeft: rel < 0 ? "50%" : "auto", marginRight: rel >= 0 ? "50%" : "auto" }}
            />
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

export default function SectorRotationPage() {
  const { data, isPending, isError } = useGetSectorRotation({
    query: { queryKey: getGetSectorRotationQueryKey() },
  });

  const rotationData = data ? buildRotationData(data.sectors, data.spy.daily) : [];

  const relSorted = data
    ? [...data.sectors].sort((a, b) => (b.relStrengthSpy ?? 0) - (a.relStrengthSpy ?? 0))
    : [];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="SECTOR_ROTATION" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load sector rotation." />}
      {data && (
        <>
          <section>
            <SectionTitle>ROTATION TREND — CUMULATIVE RETURN VS 90 DAYS AGO</SectionTitle>
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rotationData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDate} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={50} />
                    <YAxis tickFormatter={(v: number) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}
                      labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                      labelFormatter={(label: string) => fullDate(label)}
                      formatter={(val: number, name: string) => [`${val > 0 ? "+" : ""}${val?.toFixed?.(2) ?? val}%`, name]}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    {data.sectors.map((s, i) => (
                      <Line key={s.symbol} dataKey={s.symbol} name={s.symbol} stroke={COLORS[i % COLORS.length]} strokeWidth={1.2} dot={false} />
                    ))}
                    <Line dataKey="SPY" name="SPY" stroke="hsl(var(--foreground))" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
                {data.sectors.map((s, i) => (
                  <span key={s.symbol} className="inline-flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {s.symbol}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-foreground">
                  <span className="w-3 h-0.5" style={{ background: "hsl(var(--foreground))" }} />
                  SPY
                </span>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>RELATIVE STRENGTH VS SPY (1 WEEK)</SectionTitle>
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={relSorted} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v: number) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="symbol" width={110} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                      labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                      formatter={(val: number) => [`${val > 0 ? "+" : ""}${val?.toFixed?.(2) ?? val}%`, "vs SPY (1W)"]}
                    />
                    <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="relStrengthSpy" radius={[0, 3, 3, 0]}>
                      {relSorted.map((s) => (
                        <Cell key={s.symbol} fill={(s.relStrengthSpy ?? 0) >= 0 ? "#22c55e" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>GICS SECTORS VS SPY</SectionTitle>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-sm whitespace-nowrap">
                  <thead className="bg-secondary/50 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-5 py-4 font-normal">SYMBOL</th>
                      <th className="px-5 py-4 font-normal">SECTOR</th>
                      <th className="px-5 py-4 font-normal text-right">1D</th>
                      <th className="px-5 py-4 font-normal text-right">1W</th>
                      <th className="px-5 py-4 font-normal text-right">1M</th>
                      <th className="px-5 py-4 font-normal text-right">VS SPY</th>
                      <th className="px-5 py-4 font-normal">MOMENTUM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.sectors.map((s) => <SectorRow key={s.symbol} s={s} />)}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">SPY 1D</div>
              <div className={cn("font-mono text-2xl font-bold", pctColor(data.spy.change1dPct))}>
                {fmtPct(data.spy.change1dPct)}
              </div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">SPY 1W</div>
              <div className={cn("font-mono text-2xl font-bold", pctColor(data.spy.change1wPct))}>
                {fmtPct(data.spy.change1wPct)}
              </div>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl">
              <div className="text-xs text-muted-foreground font-mono mb-2">BREADTH VS SPY</div>
              <div className="font-mono text-2xl font-bold">
                {data.sectors.filter((s) => (s.relStrengthSpy ?? 0) > 0).length} / {data.sectors.length} OUTPERFORM
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}