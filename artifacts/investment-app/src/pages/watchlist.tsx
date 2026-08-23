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
  useToggleDigest,
  getGetWatchlistSummaryQueryKey,
  getGetCalendarQueryKey,
  getGetPerformanceQueryKey,
  getGetPriceAlertsQueryKey,
} from "@workspace/api-client-react";
import { Plus, X, Search, TrendingUp, CalendarDays, Target, BellRing, Trash2, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, StatusBadge, fmtPct, pctColor, fmtNum, Card } from "@/components/panels";
import { useSymbolSuggestions } from "@/components/symbol-input";
import { useAuth } from "@/lib/auth-context";

/** Watchlist add-form with live symbol autocomplete for any tradable asset. */
function WatchlistAddForm({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [value, setValue] = React.useState("");
  const { options, listId } = useSymbolSuggestions(value);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (!t) return;
        onSubmit(t);
        setValue("");
      }}
      className="relative group max-w-md"
    >
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        list={listId}
        placeholder="ADD ANY ASSET — AAPL, SPY, GLD…"
        className="w-full bg-card border-2 border-border rounded-lg py-3 pl-11 pr-16 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary uppercase transition-all"
      />
      <datalist id={listId}>
        {options.slice(0, 8).map((o) => (
          <option key={o.symbol} value={o.symbol}>
            {o.name ?? o.symbol}
          </option>
        ))}
      </datalist>
      <button
        type="submit"
        disabled={!value.trim()}
        className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground p-1.5 rounded-md disabled:opacity-50 hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>
    </form>
  );
}

/** Beginner-proof 3-step Telegram connect guide. */
function TgSteps() {
  const step = "flex items-start gap-2 text-[11px] font-mono text-muted-foreground";
  const num =
    "shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold mt-0.5";
  return (
    <div className="space-y-1.5 border border-dashed border-border rounded-lg p-3">
      <div className="text-[10px] font-mono font-bold tracking-wider text-foreground uppercase">
        Connect Telegram in 3 steps
      </div>
      <div className={step}>
        <span className={num}>1</span>
        <span>
          Open{" "}
          <a
            href="https://t.me/AssetManagerProBot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            t.me/AssetManagerProBot
          </a>{" "}
          and press <b>Start</b>.
        </span>
      </div>
      <div className={step}>
        <span className={num}>2</span>
        <span>
          Message{" "}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            @userinfobot
          </a>{" "}
          to get your numeric <b>Chat ID</b> (it looks like 123456789).
        </span>
      </div>
      <div className={step}>
        <span className={num}>3</span>
        <span>Paste the Chat ID above, hit CONNECT &amp; TEST — you&apos;ll get a test message instantly.</span>
      </div>
    </div>
  );
}

function alertLabel(a: { kind?: string; direction?: string; price?: number }) {
  if (a.kind === "rsi_oversold") return "RSI < 30 (oversold)";
  if (a.kind === "rsi_overbought") return "RSI > 70 (overbought)";
  return `${a.direction === "above" ? "≥" : "≤"} $${fmtNum(a.price)}`;
}

/** Price/signal alerts + daily digest via Telegram — requires sign-in. */
function AlertsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [ticker, setTicker] = React.useState("");
  const [kind, setKind] = React.useState<"price" | "rsi_oversold" | "rsi_overbought">("price");
  const [direction, setDirection] = React.useState<"above" | "below">("above");
  const [price, setPrice] = React.useState("");
  const [chatId, setChatId] = React.useState("");
  const [tgMsg, setTgMsg] = React.useState<string | null>(null);
  const alertSuggestions = useSymbolSuggestions(ticker);

  const enabled = Boolean(user);
  const { data } = useGetPriceAlerts({
    query: { queryKey: getGetPriceAlertsQueryKey(), enabled, retry: false },
  });
  const createMutation = useCreatePriceAlert();
  const deleteMutation = useDeletePriceAlert();
  const bindMutation = useBindTelegram();
  const digestMutation = useToggleDigest();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetPriceAlertsQueryKey() });

  if (!user) {
    return (
      <Card title="ALERTS & SIGNALS (TELEGRAM)">
        <p className="text-xs font-mono text-muted-foreground">
          Sign in to create price &amp; RSI signal alerts delivered to Telegram — plus a free daily digest of your
          watchlist.
        </p>
      </Card>
    );
  }

  const isRsi = kind !== "price";

  return (
    <Card title="ALERTS & SIGNALS (TELEGRAM)">
      <div className="space-y-4">
        {data && (
          <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              {data.alerts.length}/{data.quota?.max ?? 25} alerts used
            </span>
            {data.chatId && (
              <button
                onClick={() =>
                  digestMutation.mutate(
                    { data: { enabled: !data.digestEnabled } },
                    { onSuccess: invalidate },
                  )
                }
                disabled={digestMutation.isPending}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors",
                  data.digestEnabled
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Send className="w-3 h-3" />
                DAILY DIGEST {data.digestEnabled ? "ON" : "OFF"}
              </button>
            )}
          </div>
        )}

        {data && data.alerts.length > 0 && (
          <ul className="space-y-1.5">
            {data.alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between bg-secondary/60 rounded-md px-3 py-2 font-mono text-sm">
                <span>
                  <b className="text-primary">{a.ticker}</b> {alertLabel(a)}
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
            if (!ticker.trim()) return;
            const p = Number(price);
            if (!isRsi && (!isFinite(p) || p <= 0)) return;
            createMutation.mutate(
              {
                data: isRsi
                  ? { ticker: ticker.trim().toUpperCase(), kind }
                  : { ticker: ticker.trim().toUpperCase(), direction, price: p },
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
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            list={alertSuggestions.listId}
            className="w-28 bg-secondary border border-border rounded-md px-2.5 py-2 text-sm font-mono uppercase focus:outline-none focus:border-primary"
          />
          <datalist id={alertSuggestions.listId}>
            {alertSuggestions.options.slice(0, 8).map((o) => (
              <option key={o.symbol} value={o.symbol}>
                {o.name ?? o.symbol}
              </option>
            ))}
          </datalist>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="bg-secondary border border-border rounded-md px-2 py-2 text-xs font-mono focus:outline-none"
          >
            <option value="price">PRICE</option>
            <option value="rsi_oversold">RSI OVERSOLD (&lt;30)</option>
            <option value="rsi_overbought">RSI OVERBOUGHT (&gt;70)</option>
          </select>
          {!isRsi && (
            <>
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
            </>
          )}
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
              {!data.chatId && <TgSteps />}
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
                  CONNECT &amp; TEST
                </button>
                {tgMsg && <span className="font-mono text-[11px] text-muted-foreground">{tgMsg}</span>}
              </div>
              {data.chatId && (
                <div className="text-[10px] font-mono text-muted-foreground">
                  Bound chat: {data.chatId} · digest sent daily around 13:00 UTC · alerts re-check every 15 min.
                </div>
              )}
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
      <WatchlistAddForm
        onSubmit={(t) =>
          addMutation.mutate(
            { data: { ticker: t.toUpperCase() } },
            { onSuccess: invalidate },
          )
        }
      />

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