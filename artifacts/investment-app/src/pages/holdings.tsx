import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHoldings,
  useAddHolding,
  useUpdateHolding,
  useDeleteHolding,
  getGetHoldingsQueryKey,
} from "@workspace/api-client-react";
import { Plus, Trash2, Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtNum, fmtPct, pctColor, Card } from "@/components/panels";

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
      <SectionHeader title="HOLDINGS" />

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
        <input
          required
          placeholder="TICKER (AAPL)"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          className="w-36 bg-card border-2 border-border rounded-lg px-3 py-2.5 text-sm font-mono uppercase placeholder:text-muted-foreground focus:outline-none focus:border-primary"
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
            Tip: edit quantities inline. Set cost basis to see per-position P/L.
          </p>
        </section>
      )}
    </div>
  );
}
