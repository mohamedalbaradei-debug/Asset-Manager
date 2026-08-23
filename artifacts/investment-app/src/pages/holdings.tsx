import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHoldings,
  useAddHolding,
  useUpdateHolding,
  useDeleteHolding,
  useGetHoldingsPerformance,
  getGetHoldingsQueryKey,
  getGetHoldingsPerformanceQueryKey,
} from "@workspace/api-client-react";
import { Plus, Trash2, Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtNum, fmtPct, pctColor, Card } from "@/components/panels";
import { SymbolInput } from "@/components/symbol-input";

type HoldingItem = {
  id: string;
  ticker: string;
  name?: string | null;
  qty: number;
  costUsd?: number | null;
  price?: number | null;
  changePct?: number | null;
  valueUsd?: number | null;
  plPct?: number | null;
};

const WINDOWS = [
  { days: 30, label: "1M" },
  { days: 90, label: "3M" },
  { days: 180, label: "6M" },
  { days: 365, label: "1Y" },
];

/** Portfolio growth vs Gold (GLD) and S&P 500 (^GSPC), rebased to 0%. */
function PerfChart() {
  const [days, setDays] = React.useState(180);
  const { data } = useGetHoldingsPerformance(
    { days },
    {
      query: {
        queryKey: getGetHoldingsPerformanceQueryKey({ days }),
        staleTime: 10 * 60_000,
        retry: false,
      },
    },
  );

  if (!data || !data.hasPortfolioData) return null;

  const series = data.series ?? [];
  const W = 560;
  const H = 170;
  const PAD = 4;
  const values = series.flatMap((p) => [p.portfolioPct, p.goldPct, p.spxPct].filter((v): v is number => v != null));
  if (values.length < 2) return null;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const x = (i: number) =>
    series.length > 1 ? PAD + (i / (series.length - 1)) * (W - 2 * PAD) : W / 2;
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
  const path = (key: "portfolioPct" | "goldPct" | "spxPct") => {
    let started = false;
    let d = "";
    series.forEach((p, i) => {
      const v = p[key];
      if (v == null) return;
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };
  const summary = data.summary ?? {};
  const rows: Array<{ label: string; v: number | null; cls: string }> = [
    { label: "PORTFOLIO", v: summary.portfolioPct ?? null, cls: "text-primary" },
    { label: "GOLD", v: summary.goldPct ?? null, cls: "text-amber-400" },
    { label: "S&P 500", v: summary.spxPct ?? null, cls: "text-sky-400" },
  ];

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <SectionTitle>PERFORMANCE VS GOLD & S&P 500</SectionTitle>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={cn(
                "px-2.5 py-1 rounded-md border font-mono text-[11px] transition-colors",
                days === w.days
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none" role="img" aria-label="Portfolio vs gold and S&P 500 chart">
          <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="currentColor" strokeDasharray="3 4" className="text-border" strokeWidth="1" />
          <path d={path("goldPct")} fill="none" stroke="#fbbf24" strokeWidth="1.5" opacity="0.9" />
          <path d={path("spxPct")} fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.9" />
          <path d={path("portfolioPct")} fill="none" stroke="var(--primary)" strokeWidth="2.25" />
        </svg>

        <div className="grid grid-cols-3 gap-3 pt-1 border-t border-border">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                <span className={cn("inline-block w-2 h-0.5", r.cls.replace("text-", "bg-"))} />
                {r.label}
              </div>
              <div className={cn("font-mono text-lg font-bold", pctColor(r.v))}>{fmtPct(r.v)}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
          Each line rebased to 0% at its own start of window. Snapshots are recorded daily as you use the app.
        </p>
      </div>
    </section>
  );
}

export default function HoldingsPage() {
  const queryClient = useQueryClient();
  const [ticker, setTicker] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [cost, setCost] = React.useState("");

  const enabled = true; // page is only reachable when signed in (data 401s otherwise)
  const { data, isPending, isError } = useGetHoldings({
    query: { queryKey: getGetHoldingsQueryKey(), enabled, retry: false },
  });
  const addMutation = useAddHolding();
  const deleteMutation = useDeleteHolding();
  const updateMutation = useUpdateHolding();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetHoldingsQueryKey() });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim() || !Number(qty)) return;
    addMutation.mutate(
      {
        data: {
          ticker: ticker.trim().toUpperCase(),
          qty: Number(qty),
          ...(cost ? { costUsd: Number(cost) } : {}),
        },
      },
      {
        onSuccess: () => {
          setTicker("");
          setQty("");
          setCost("");
          invalidate();
        },
      },
    );
  }

  const items = data?.items ?? [];
  const totals = data?.totals;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="PORTFOLIO" />

      {!isPending && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Card title="PORTFOLIO VALUE">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-primary" />
              <span className="font-mono text-3xl font-bold">
                {totals?.valueUsd != null ? `$${fmtNum(totals.valueUsd)}` : "—"}
              </span>
            </div>
          </Card>
          <Card title="COST BASIS">
            <span className="font-mono text-3xl font-bold text-muted-foreground">
              {totals?.costUsd != null ? `$${fmtNum(totals.costUsd)}` : "—"}
            </span>
          </Card>
          <Card title="TOTAL P/L">
            <div className="flex items-center gap-2">
              {totals?.plPct != null && (totals.plPct >= 0 ? <TrendingUp className="w-5 h-5 text-green-500" /> : <TrendingDown className="w-5 h-5 text-destructive" />)}
              <span className={cn("font-mono text-3xl font-bold", pctColor(totals?.plPct ?? null))}>
                {totals?.plPct != null ? fmtPct(totals.plPct) : "—"}
              </span>
            </div>
          </Card>
        </div>
      )}

      {/* Add form */}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <SymbolInput
          required
          value={ticker}
          onChange={setTicker}
          placeholder="Search any ticker… AAPL, GC=F, EURUSD=X"
          className="w-64"
        />
        <input
          required
          inputMode="decimal"
          placeholder="QTY"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-24 bg-card border-2 border-border rounded-lg px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        <input
          inputMode="decimal"
          placeholder="AVG COST $ (optional)"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="w-44 bg-card border-2 border-border rounded-lg px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        <button
          disabled={addMutation.isPending}
          className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg px-4 py-2.5 font-mono text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> ADD HOLDING
        </button>
        {addMutation.isError && (
          <span className="text-xs font-mono text-destructive">Could not add — check ticker.</span>
        )}
      </form>

      {isPending && <LoadingState />}
      {isError && !isPending && <ErrorState message="Could not load holdings." />}

      {data && (
        <section>
          <SectionTitle>YOUR POSITIONS</SectionTitle>
          {items.length === 0 ? (
            <div className="flex items-center justify-center py-10 border border-dashed border-border rounded-xl text-muted-foreground font-mono text-xs">
              EMPTY — ADD WHAT YOU OWN TO TRACK IT LIVE
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-sm whitespace-nowrap">
                  <thead className="bg-secondary/50 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-5 py-4 font-normal">SYMBOL</th>
                      <th className="px-5 py-4 font-normal text-right">PRICE</th>
                      <th className="px-5 py-4 font-normal text-right">CHG %</th>
                      <th className="px-5 py-4 font-normal text-right">QTY</th>
                      <th className="px-5 py-4 font-normal text-right">VALUE</th>
                      <th className="px-5 py-4 font-normal text-right">P/L</th>
                      <th className="px-5 py-4 font-normal text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((h: HoldingItem) => (
                      <tr key={h.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-primary">{h.ticker}</div>
                          <div className="text-xs text-muted-foreground max-w-[180px] truncate">{h.name ?? ""}</div>
                        </td>
                        <td className="px-5 py-3.5 text-right">{h.price != null ? `$${fmtNum(h.price)}` : "—"}</td>
                        <td className={cn("px-5 py-3.5 text-right font-bold", pctColor(h.changePct ?? null))}>
                          {fmtPct(h.changePct ?? null)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <input
                            defaultValue={h.qty}
                            onBlur={(e) => {
                              const q = Number(e.target.value);
                              if (isFinite(q) && q > 0 && q !== h.qty)
                                updateMutation.mutate({ id: h.id, data: { qty: q } }, { onSuccess: invalidate });
                            }}
                            className="w-16 bg-secondary border border-border rounded-md px-1.5 py-1 text-right text-xs focus:outline-none focus:border-primary"
                            aria-label={`Quantity for ${h.ticker}`}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-right">{h.valueUsd != null ? `$${fmtNum(h.valueUsd)}` : "—"}</td>
                        <td className={cn("px-5 py-3.5 text-right font-bold", pctColor(h.plPct ?? null))}>
                          {fmtPct(h.plPct ?? null)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => deleteMutation.mutate({ id: h.id }, { onSuccess: invalidate })}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            aria-label={`Remove ${h.ticker}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] font-mono text-muted-foreground">
            Tip: edit quantities inline. Set cost basis to see per-position P/L. Search finds any
            Yahoo-tracked asset — stocks, ETFs, commodities futures, FX pairs and crypto.
          </p>
        </section>
      )}

      <PerfChart />
    </div>
  );
}
