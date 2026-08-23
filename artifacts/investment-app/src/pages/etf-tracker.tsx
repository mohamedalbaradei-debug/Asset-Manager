import React from "react";
import {
  useGetEtfTracker,
  useGetEtfsScan,
  getGetEtfsScanQueryKey,
  type GetEtfsScanParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpDown, ExternalLink } from "lucide-react";
import { SectionHeader, LoadingState, ErrorState, fmtPct, pctColor } from "@/components/panels";
import { cn } from "@/lib/utils";

const SORTS: Array<{ key: string; label: string }> = [
  { key: "changePct", label: "1D" },
  { key: "perfWeek", label: "1W" },
  { key: "perfMonth1", label: "1M" },
  { key: "perfMonth3", label: "3M" },
  { key: "perfMonth6", label: "6M" },
  { key: "perfYtd", label: "YTD" },
  { key: "perfYear", label: "1Y" },
  { key: "perf3Year", label: "3Y" },
];

export default function EtfTrackerPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = React.useState<string>("all");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<NonNullable<GetEtfsScanParams["sort"]>>("perfMonth3");
  const [dir, setDir] = React.useState<NonNullable<GetEtfsScanParams["dir"]>>("desc");

  // Category list from the grouped tracker (cheap, same cache).
  const { data: tracker } = useGetEtfTracker({
    query: { queryKey: ["get-etf-tracker-cats"], staleTime: 30 * 60_000 },
  });
  const categories = React.useMemo(
    () => tracker?.groups.map((g) => g.category) ?? [],
    [tracker],
  );

  const { data, isPending, isError } = useGetEtfsScan(
    {
      sort,
      dir,
      category: category === "all" ? undefined : category,
      q: q.trim() || undefined,
    },
    {
      query: {
        queryKey: getGetEtfsScanQueryKey({ sort, dir, category: category === "all" ? undefined : category, q: q.trim() || undefined }),
        placeholderData: (prev) => prev,
      },
    },
  );

  function setSortDir(k: string) {
    if (sort === k) {
      const nd = dir === "desc" ? "asc" : "desc";
      setDir(nd);
    } else {
      setSort(k as NonNullable<GetEtfsScanParams["sort"]>);
      setDir("desc");
    }
    queryClient.invalidateQueries({ queryKey: getGetEtfsScanQueryKey() });
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <SectionHeader title="ETF_EXPLORER" updatedAt={data?.updatedAt} />
      <p className="text-xs font-mono text-muted-foreground -mt-4 leading-relaxed max-w-3xl">
        Live scanner across ~180 liquid US-listed ETFs — broad equity, international, sectors,
        themes, crypto, bonds, commodities, FX and the leveraged funds retail traders love.
        Sort by any performance window to find what&apos;s hot. Click a row for the full stock
        detail page.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategory("all")}
          className={cn(
            "px-3 py-1.5 rounded-md border font-mono text-xs transition-colors",
            category === "all"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          ALL
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "px-3 py-1.5 rounded-md border font-mono text-xs transition-colors",
              category === c
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {c.toUpperCase()}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          className="ml-auto w-44 bg-card border border-border rounded-md px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      {/* Sort row */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
        <span className="text-muted-foreground">SORT:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSortDir(s.key)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md border transition-colors",
              sort === s.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <ArrowUpDown className="w-3 h-3" /> {s.label}
            {sort === s.key && (dir === "desc" ? " ↓" : " ↑")}
          </button>
        ))}
      </div>

      {isPending && <LoadingState />}
      {isError && !isPending && <ErrorState message="Could not load ETF scan." />}

      {data && (
        <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-left font-mono text-sm whitespace-nowrap">
            <thead className="bg-secondary/50 text-muted-foreground text-xs sticky top-0">
              <tr>
                <th className="px-4 py-3 font-normal">TICKER</th>
                <th className="px-4 py-3 font-normal">NAME</th>
                <th className="px-4 py-3 font-normal hidden lg:table-cell">CATEGORY</th>
                <th className="px-4 py-3 font-normal text-right">PRICE</th>
                {SORTS.map((s) => (
                  <th
                    key={s.key}
                    onClick={() => setSortDir(s.key)}
                    className={cn(
                      "px-3 py-3 font-normal text-right cursor-pointer select-none hover:text-foreground",
                      sort === s.key && "text-primary",
                    )}
                  >
                    {s.label}{sort === s.key ? (dir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data.items ?? []).map((e) => (
                <tr key={e.ticker} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/stocks/${e.ticker}`} className="font-bold text-primary hover:underline">
                      {e.ticker} <ExternalLink className="inline w-3 h-3 opacity-50" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[240px] truncate text-xs">
                    {e.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground/70 text-[11px] hidden lg:table-cell">
                    {e.category}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.price != null ? e.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
                  </td>
                  {[SORTS[0], ...SORTS.slice(1)].map((s) => {
                    const v = (e as unknown as Record<string, number | null>)[s.key];
                    return (
                      <td
                        key={s.key}
                        className={cn(
                          "px-3 py-3 text-right text-xs",
                          v == null ? "text-muted-foreground/40" : pctColor(v),
                        )}
                      >
                        {fmtPct(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {(data.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground text-xs font-mono">
                    NO MATCHES — TRY ANOTHER FILTER
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        Performance windows are total-change percentages from the TradingView scanner, refreshed
        every 30 minutes. Leveraged ETFs decay over time — treat multi-month numbers with care.
      </p>
    </div>
  );
}
