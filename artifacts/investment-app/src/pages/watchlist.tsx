import React from "react";
import { Link } from "wouter";
import {
  useGetWatchlistSummary,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useGetCalendar,
  useGetPerformance,
  useGetPriceAlerts,
  useCreatePriceAlert,
  useDeletePriceAlert,
  useBindTelegram,
  getGetWatchlistSummaryQueryKey,
  getGetCalendarQueryKey,
  getGetPerformanceQueryKey,
  getGetPriceAlertsQueryKey,
} from "@workspace/api-client-react";
import { Plus, X, Search, TrendingUp, CalendarDays, Target, BellRing, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, StatusBadge, fmtPct, pctColor, fmtNum, Card } from "@/components/panels";
import { useAuth } from "@/lib/auth-context";

/** Price alerts + Telegram delivery — requires sign-in. */
function AlertsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [ticker, setTicker] = React.useState("");
  const [direction, setDirection] = React.useState<"above" | "below">("above");
  const [price, setPrice] = React.useState("");
  const [chatId, setChatId] = React.useState("");
  const [tgMsg, setTgMsg] = React.useState<string | null>(null);

  const enabled = Boolean(user);
  const { data } = useGetPriceAlerts({
    query: { queryKey: getGetPriceAlertsQueryKey(), enabled, retry: false },
  });
  const createMutation = useCreatePriceAlert();
  const deleteMutation = useDeletePriceAlert();
  const bindMutation = useBindTelegram();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetPriceAlertsQueryKey() });

  if (!user) {
    return (
      <Card title="PRICE ALERTS (TELEGRAM)">
        <p className="text-xs font-mono text-muted-foreground">
          Sign in to create price alerts delivered to Telegram.
        </p>
      </Card>
    );
  }

  return (
    <Card title="PRICE ALERTS (TELEGRAM)">
      <div className="space-y-4">
        {data && data.alerts.length > 0 && (
          <ul className="space-y-1.5">
            {data.alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between bg-secondary/60 rounded-md px-3 py-2 font-mono text-sm">
                <span>
                  <b className="text-primary">{a.ticker}</b>{" "}
                  {a.direction === "above" ? "≥" : "≤"} ${fmtNum(a.price)}
                </span>
                <button
                  onClick={() => deleteMutation.mutate({ id: a.id }, { onSuccess: invalidate })}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Delete alert"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = Number(price);
            if (!ticker.trim() || !isFinite(p) || p <= 0) return;
            createMutation.mutate(
              {
                data: { ticker: ticker.trim().toUpperCase(), direction, price: p },
              },
              {
                onSuccess: () => {
                  setTicker("");
                  setPrice("");
                  invalidate();
                },
              },
            );
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            placeholder="TICKER"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="w-24 bg-secondary border border-border rounded-md px-2.5 py-2 text-sm font-mono uppercase focus:outline-none focus:border-primary"
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "above" | "below")}
            className="bg-secondary border border-border rounded-md px-2 py-2 text-xs font-mono focus:outline-none"
          >
            <option value="above">ABOVE</option>
            <option value="below">BELOW</option>
          </select>
          <input
            placeholder="$ PRICE"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 bg-secondary border border-border rounded-md px-2.5 py-2 text-sm font-mono focus:outline-none focus:border-primary"
          />
          <button
            disabled={createMutation.isPending}
            className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-md px-3 py-2 font-mono text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <BellRing className="w-3.5 h-3.5" /> ALERT
          </button>
        </form>

        <div className="border-t border-border pt-3 space-y-2">
          {data?.telegramConfigured ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  placeholder="TELEGRAM CHAT ID"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  className="w-44 bg-secondary border border-border rounded-md px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() =>
                    bindMutation.mutate(
                      { data: { chatId } },
                      {
                        onSuccess: () => {
                          setTgMsg("✓ connected — check Telegram");
                          invalidate();
                        },
                        onError: () => setTgMsg("✗ send failed — press Start on the bot first"),
                      },
                    )
                  }
                  disabled={bindMutation.isPending || !chatId.trim()}
                  className="font-mono text-xs text-primary hover:underline disabled:opacity-50"
                >
                  CONNECT & TEST
                </button>
                {tgMsg && <span className="font-mono text-[11px] text-muted-foreground">{tgMsg}</span>}
              </div>
              {data.chatId && (
                <div className="text-[10px] font-mono text-muted-foreground">
                  Bound chat: {data.chatId}
                </div>
              )}
              <div className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
                Message @userinfobot on Telegram for your numeric chat id. Alerts re-check every 15 min.
              </div>
            </>
          ) : (
            <div className="text-[10px] font-mono text-muted-foreground">
              Alert delivery not configured on this server yet (TELEGRAM_BOT_TOKEN).
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function WatchlistPage() {
  const queryClient = useQueryClient();
  const [newTicker, setNewTicker] = React.useState("");

  const { data, isPending, isError } = useGetWatchlistSummary({
    query: { queryKey: getGetWatchlistSummaryQueryKey() },
  });
  const { data: calendar, isPending: isCalendarPending } = useGetCalendar({
    query: { queryKey: getGetCalendarQueryKey() },
  });
  const { data: perf, isPending: isPerfPending } = useGetPerformance({
    query: { queryKey: getGetPerformanceQueryKey() },
  });

  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetWatchlistSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPerformanceQueryKey() });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicker.trim()) return;
    addMutation.mutate(
      { data: { ticker: newTicker.trim().toUpperCase() } },
      { onSuccess: () => { setNewTicker(""); invalidate(); } }
    );
  };

  const handleRemove = (ticker: string) => {
    removeMutation.mutate(
      { ticker },
      { onSuccess: invalidate }
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="WATCHLIST" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load watchlist." />}

      {/* Add form */}
      <form onSubmit={handleAdd} className="relative group max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <input
          type="text"
          value={newTicker}
          onChange={(e) => setNewTicker(e.target.value)}
          placeholder="ADD TICKER (AAPL)..."
          className="w-full bg-card border-2 border-border rounded-lg py-3 pl-11 pr-16 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary uppercase transition-all"
        />
        <button
          type="submit"
          disabled={!newTicker.trim() || addMutation.isPending}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground p-1.5 rounded-md disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </form>

      {data && (
        <section>
          <SectionTitle>TRACKED POSITIONS</SectionTitle>
          {data.items.length === 0 ? (
            <div className="flex items-center justify-center py-10 border border-dashed border-border rounded-xl text-muted-foreground font-mono text-xs">
              EMPTY — ADD A TICKER TO BEGIN
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
                      <th className="px-5 py-4 font-normal text-right">CHG %</th>
                      <th className="px-5 py-4 font-normal text-right">RSI</th>
                      <th className="px-5 py-4 font-normal text-right">STATUS</th>
                      <th className="px-5 py-4 font-normal text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((it) => (
                      <tr key={it.symbol} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link href="/" className="font-bold text-primary hover:underline">
                            {it.symbol}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground max-w-[200px] truncate">
                          {it.name ?? "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right">{it.price != null ? `$${fmtNum(it.price)}` : "—"}</td>
                        <td className={cn("px-5 py-3.5 text-right font-bold", pctColor(it.changePct))}>
                          {fmtPct(it.changePct)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className={cn(
                            it.rsi != null && (it.rsi > 70 || it.rsi < 30) ? "font-bold text-destructive" : "text-muted-foreground"
                          )}>
                            {it.rsi != null ? it.rsi.toFixed(1) : "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <StatusBadge
                            status={it.rsi != null ? (it.rsi > 70 ? "overbought" : it.rsi < 30 ? "oversold" : "neutral") : null}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => handleRemove(it.symbol)}
                            disabled={removeMutation.isPending}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            aria-label={`Remove ${it.symbol}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Calendar + alerts + performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlertsPanel />

        <Card title="EARNINGS & DIVIDENDS CALENDAR">
          {isCalendarPending ? (
            <div className="flex justify-center py-10"><TrendingUp className="w-5 h-5 animate-pulse text-muted-foreground" /></div>
          ) : calendar ? (
            <div className="space-y-6">
              {calendar.earnings.filter((e) => e.label !== "unknown").length > 0 && (
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-2">EARNINGS</div>
                  <ul className="space-y-2">
                    {calendar.earnings.map((e, i) => (
                      <li key={i} className="flex items-center justify-between font-mono text-sm border-b border-border pb-2 last:border-0">
                        <span className="font-bold text-primary">{e.ticker}</span>
                        <span className="text-muted-foreground">{e.date ?? "—"} {e.epsEstimate != null ? `· est $${fmtNum(e.epsEstimate)}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {calendar.dividends.length > 0 ? (
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-2">DIVIDENDS</div>
                  <ul className="space-y-2">
                    {calendar.dividends.map((d, i) => (
                      <li key={i} className="flex items-center justify-between font-mono text-sm border-b border-border pb-2 last:border-0">
                        <span className="font-bold text-primary">{d.ticker}</span>
                        <span className="text-muted-foreground">{d.exDate ?? "—"} {d.amount != null ? `· $${fmtNum(d.amount)}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs font-mono text-muted-foreground">No dividends in window.</p>
              )}
              <p className="text-[10px] font-mono text-muted-foreground border-t border-border pt-3">{calendar.ipoNote}</p>
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground">Calendar unavailable.</p>
          )}
        </Card>

        <Card title="RECOMMENDATION PERFORMANCE">
          {isPerfPending ? (
            <div className="flex justify-center py-10"><Target className="w-5 h-5 animate-pulse text-muted-foreground" /></div>
          ) : perf ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-secondary rounded-lg p-4 text-center">
                  <div className="text-xs font-mono text-muted-foreground mb-1">TOTAL</div>
                  <div className="font-mono text-2xl font-bold">{perf.total}</div>
                </div>
                <div className="bg-secondary rounded-lg p-4 text-center">
                  <div className="text-xs font-mono text-muted-foreground mb-1">WINS</div>
                  <div className="font-mono text-2xl font-bold text-green-500">{perf.wins}</div>
                </div>
                <div className="bg-secondary rounded-lg p-4 text-center">
                  <div className="text-xs font-mono text-muted-foreground mb-1">LOSSES</div>
                  <div className="font-mono text-2xl font-bold text-destructive">{perf.losses}</div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-mono text-muted-foreground mb-1.5">
                  <span>WIN RATE</span>
                  <span className="font-bold">{perf.winRate != null ? `${perf.winRate.toFixed(1)}%` : "—"}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", (perf.winRate ?? 0) >= 50 ? "bg-green-500" : "bg-destructive")}
                    style={{ width: `${Math.min(100, perf.winRate ?? 0)}%` }}
                  />
                </div>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground border-t border-border pt-3">{perf.note}</p>
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground">No performance data yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}