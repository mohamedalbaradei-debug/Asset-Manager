import React from "react";
import {
  useGetSectorRotation,
  getGetSectorRotationQueryKey,
  type SectorRotationItem,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtPct, pctColor, StatusBadge } from "@/components/panels";

function relBadge(rel: number | null | undefined): string {
  if (rel == null) return "neutral";
  if (rel > 0.5) return "bullish";
  if (rel < -0.5) return "bearish";
  return "neutral";
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

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="SECTOR_ROTATION" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load sector rotation." />}
      {data && (
        <>
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