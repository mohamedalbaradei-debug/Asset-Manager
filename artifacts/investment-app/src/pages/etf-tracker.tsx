import {
  useGetEtfTracker,
  getGetEtfTrackerQueryKey,
} from "@workspace/api-client-react";
import { SectionHeader, SectionTitle, LoadingState, ErrorState } from "@/components/panels";
import { cn } from "@/lib/utils";

const PERF_COLS: Array<{ key: string; label: string }> = [
  { key: "changePct", label: "1D" },
  { key: "perfWeek", label: "1W" },
  { key: "perfMonth1", label: "1M" },
  { key: "perfMonth3", label: "3M" },
  { key: "perfMonth6", label: "6M" },
  { key: "perfYtd", label: "YTD" },
  { key: "perfYear", label: "1Y" },
];

function PerfChip({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) {
    return (
      <span className="inline-block min-w-[52px] text-center px-2 py-1 rounded font-mono text-[11px] text-muted-foreground/50 border border-border">
        {label} —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-block min-w-[52px] text-center px-2 py-1 rounded font-mono text-[11px] font-bold border",
        value >= 0
          ? "text-green-500 border-green-500/30 bg-green-500/5"
          : "text-destructive border-destructive/30 bg-destructive/5"
      )}
    >
      {label} {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

export default function EtfTrackerPage() {
  const { data, isPending, isError } = useGetEtfTracker({
    query: { queryKey: getGetEtfTrackerQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="ETF_TRACKER" updatedAt={data?.updatedAt} />
      <p className="text-xs font-mono text-muted-foreground -mt-4 leading-relaxed max-w-3xl">
        Recent performance for a curated universe of liquid US-listed ETFs — broad equity,
        international, sectors, bonds and gold. Performance windows are total-change percentages;
        TER is the annual expense ratio. Use it to sanity-check what the Planner allocates to.
      </p>

      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load ETF tracker." />}

      {data?.groups.map((g) => (
        <section key={g.category}>
          <SectionTitle>{g.category.toUpperCase()}</SectionTitle>
          <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left font-mono text-sm whitespace-nowrap">
              <thead className="bg-secondary/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-5 py-3.5 font-normal">TICKER</th>
                  <th className="px-5 py-3.5 font-normal">NAME</th>
                  <th className="px-5 py-3.5 font-normal text-right">PRICE</th>
                  <th className="px-5 py-3.5 font-normal text-right">TER</th>
                  <th className="px-5 py-3.5 font-normal">PERFORMANCE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {g.etfs.map((e) => (
                  <tr key={e.ticker} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-primary">{e.ticker}</td>
                    <td className="px-5 py-3.5 text-muted-foreground max-w-[280px] truncate text-xs">
                      {e.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right">{e.price != null ? e.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td className="px-5 py-3.5 text-right text-muted-foreground text-xs">
                      {e.expenseRatioPct != null ? `${e.expenseRatioPct}%` : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {PERF_COLS.map((c) => (
                          <PerfChip
                            key={c.key}
                            label={c.label}
                            value={(e as unknown as Record<string, number | null>)[c.key]}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
