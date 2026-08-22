import React from "react";
import {
  useGetShippingData,
  getGetShippingDataQueryKey,
  useGetChokepoints,
  type ChokepointRow,
  type ShippingRow,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, EmptyNote } from "@/components/panels";

const fmtMt = (v: number | null | undefined) =>
  v != null ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : "—";

function shortDate(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function fullDate(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function statusColor(status: ShippingRow["status"]): string {
  return status === "bullish" ? "#22c55e" : status === "bearish" ? "#ef4444" : "#71717a";
}

function ChokepointChart({ row }: { row: ShippingRow }) {
  const data = (row.series ?? []).filter((p) => p.volumeTonnes != null);
  if (data.length === 0) return null;
  const color = statusColor(row.status);
  const gradId = `ship-grad-${row.chokepoint.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="border-t border-border pt-3">
      <div className="text-[10px] font-mono text-muted-foreground mb-2">VOLUME — LAST 12 MONTHS (TONNES/DAY)</div>
      <div className="h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              stroke="hsl(var(--muted-foreground))"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              minTickGap={50}
            />
            <YAxis
              tickFormatter={(v: number) => `${(v / 1e6).toFixed(0)}M`}
              width={38}
              stroke="hsl(var(--muted-foreground))"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
              itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
              labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
              labelFormatter={(label: string) => fullDate(label)}
              formatter={(val: number) => [`${(val / 1e6).toFixed(2)}M t/day`, "Volume"]}
            />
            <Area dataKey="volumeTonnes" type="monotone" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ShippingPage() {
  const { data, isPending, isError } = useGetShippingData({
    query: { queryKey: getGetShippingDataQueryKey() },
  });
  const { data: daily } = useGetChokepoints({
    query: { queryKey: ["getChokepoints"] },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="SHIPPING_CHOKEPOINTS" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load shipping data." />}
      {data && (
        <section>
          <SectionTitle>IMF PORTWATCH TRANSIT</SectionTitle>
          {data.rows.length === 0 && <EmptyNote text="No transit data available." />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.rows.map((r) => (
              <div key={r.chokepoint} className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-lg">{r.chokepoint}</span>
                  <span className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider border",
                    r.status === "bullish" ? "border-green-500/30 text-green-500" :
                    r.status === "bearish" ? "border-destructive/30 text-destructive" :
                    "border-border text-muted-foreground"
                  )}>
                    {r.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">VOLUME (MT)</div>
                    <div className="font-mono text-xl font-bold">{fmtMt(r.volumeTonnes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">VESSELS</div>
                    <div className="font-mono text-xl font-bold">{r.vessels ?? "—"}</div>
                  </div>
                </div>
                <ChokepointChart row={r} />
                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed border-t border-border pt-3">{r.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      {daily && daily.chokepoints.length > 0 && (
        <section>
          <SectionTitle>DAILY VESSEL TRANSITS — LATEST DAY ({daily.date ?? "?"})</SectionTitle>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  {["CHOKEPOINT", "TOTAL", "TANKER", "CONTAINER", "DRY BULK", "CARGO", "RORO"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...daily.chokepoints]
                  .sort((a, b) => (b.totalTransits ?? 0) - (a.totalTransits ?? 0))
                  .map((c: ChokepointRow) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 font-mono text-sm">{c.name}</td>
                    <td className="px-4 py-2.5 font-mono text-sm font-bold">{c.totalTransits ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.tanker ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.container ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.dryBulk ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.cargo ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.roro ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}