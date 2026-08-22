import React, { useState } from "react";
import {
  useGetMarketPulse,
  useGetLatestNews,
  useQueryNewsArchive,
  useGetNewsEventStudy,
  getGetMarketPulseQueryKey,
  getGetLatestNewsQueryKey,
} from "@workspace/api-client-react";
import { ArrowUpRight, ArrowDownRight, ExternalLink, Gauge, Droplets, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, StatusBadge, fmtPct, pctColor } from "@/components/panels";

function ArchiveSection() {
  const [ticker, setTicker] = useState("");
  const [query, setQuery] = useState<{ ticker: string | null }>({ ticker: null });

  const { data: archive, isPending } = useQueryNewsArchive(
    {
      ticker: query.ticker ?? undefined,
      limit: 50,
    },
    { query: { queryKey: ["queryNewsArchive", query.ticker], enabled: true } },
  );

  const studyTicker = query.ticker;
  const [window_, setWindow_] = useState(2);
  const { data: study } = useGetNewsEventStudy(
    { ticker: studyTicker ?? "AAPL", window: window_ },
    { query: { queryKey: ["getNewsEventStudy", studyTicker, window_], enabled: !!studyTicker } },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery({ ticker: ticker.trim().toUpperCase() || null });
  };

  return (
    <section className="space-y-4">
      <SectionTitle>NEWS ARCHIVE &amp; EVENT STUDY</SectionTitle>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="TICKER (e.g. NVDA)"
          className="bg-card border border-border rounded-lg px-3 py-1.5 font-mono text-sm w-44 outline-none focus:border-primary"
        />
        <button type="submit" className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold hover:opacity-90">
          Search
        </button>
        <button
          type="button"
          onClick={() => {
            setTicker("");
            setQuery({ ticker: null });
          }}
          className="px-3 py-1.5 rounded-lg border border-border font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          All
        </button>
        {query.ticker && (
          <>
            <span className="ml-2 font-mono text-xs text-muted-foreground">Window (sessions):</span>
            <select
              value={window_}
              onChange={(e) => setWindow_(parseInt(e.target.value, 10))}
              className="bg-card border border-border rounded-lg px-2 py-1.5 font-mono text-sm outline-none"
            >
              {[1, 2, 3, 5].map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </>
        )}
      </form>

      {isPending && <p className="font-mono text-[11px] text-muted-foreground">Loading archive…</p>}

      {study && study.events.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Event Study — return over next {study.windowDays} session{study.windowDays > 1 ? "s" : ""} after headlines ({study.ticker})
            </h3>
            <span className={cn("font-mono text-sm font-bold", (study.avgExcessPct ?? 0) >= 0 ? "text-green-500" : "text-destructive")}>
              avg excess {fmtPct(study.avgExcessPct)}
            </span>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {["EVENT DAY", "HEADLINES", "RETURN", "SPY", "EXCESS"].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {study.events.map((ev) => (
                <tr key={ev.date} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{ev.date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{ev.headlines}</td>
                  <td className={cn("px-3 py-2 font-mono text-xs font-bold", pctColor(ev.retPct))}>{fmtPct(ev.retPct)}</td>
                  <td className={cn("px-3 py-2 font-mono text-xs text-muted-foreground", pctColor(ev.spyRetPct))}>{fmtPct(ev.spyRetPct)}</td>
                  <td className={cn("px-3 py-2 font-mono text-xs font-bold", pctColor(ev.excessPct))}>{fmtPct(ev.excessPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archive && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {archive.articles.length === 0 && (
            <p className="px-5 py-6 font-mono text-[11px] text-muted-foreground">
              No archived articles yet — the archive builds up as the news feed refreshes.
            </p>
          )}
          <ul className="divide-y divide-border">
            {archive.articles.map((a, i) => (
              <li key={i} className="flex items-start gap-4 px-5 py-3 hover:bg-secondary/30 transition-colors">
                <StatusBadge status={a.sentiment === "Bullish" ? "bullish" : a.sentiment === "Bearish" ? "bearish" : null} />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm leading-snug">{a.title}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
                    <span className="text-primary">{a.ticker}</span>
                    <span>{a.source}</span>
                    {a.publishedAt && <span>{new Date(a.publishedAt).toLocaleString()}</span>}
                  </div>
                </div>
                {a.url && (
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors shrink-0">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function NewsPage() {
  const { data: pulse, isPending: isPulsePending, isError: isPulseError } = useGetMarketPulse({
    query: { queryKey: getGetMarketPulseQueryKey() },
  });
  const { data: news, isPending: isNewsPending, isError: isNewsError } = useGetLatestNews({
    query: { queryKey: getGetLatestNewsQueryKey() },
  });

  const isLoading = isPulsePending || isNewsPending;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="MARKET_PULSE" updatedAt={pulse?.updatedAt ?? news?.updatedAt} />
      {isLoading && <LoadingState />}
      {isPulseError && <ErrorState message="Could not load market pulse." />}

      {pulse && (
        <>
          {/* Liquidity */}
          <section>
            <SectionTitle>LIQUIDITY &amp; BREADTH</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card border border-border p-5 rounded-xl flex items-center gap-4">
                <Gauge className="w-8 h-8 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">TRIN</div>
                  <div className="font-mono text-2xl font-bold">
                    {pulse.internals.trin != null ? pulse.internals.trin.toFixed(2) : "—"}
                  </div>
                  <StatusBadge status={pulse.internals.trinSignal} />
                </div>
              </div>
              <div className="bg-card border border-border p-5 rounded-xl flex items-center gap-4">
                <Droplets className="w-8 h-8 text-blue-400" />
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">10Y YIELD (LIQUIDITY)</div>
                  <div className="font-mono text-2xl font-bold">
                    {pulse.internals.tnxYield != null ? `${pulse.internals.tnxYield.toFixed(2)}%` : "—"}
                  </div>
                  <StatusBadge status={pulse.internals.liquidityAssessment} />
                </div>
              </div>
              <div className="bg-card border border-border p-5 rounded-xl flex items-center gap-4">
                <ShieldCheck className="w-8 h-8 text-green-500" />
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">SPY 1D</div>
                  <div className={cn("font-mono text-2xl font-bold", pctColor(pulse.sectorRotation.spy1d))}>
                    {fmtPct(pulse.sectorRotation.spy1d)}
                  </div>
                  <StatusBadge status={pulse.sectorRotation.best ? "bullish" : null} />
                </div>
              </div>
            </div>
          </section>

          {/* Sector rotation */}
          {pulse.sectorRotation.best && (
            <section>
              <SectionTitle>ROTATION</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-card border border-border p-5 rounded-xl">
                  <div className="text-xs text-muted-foreground font-mono mb-2">LEADING SECTOR</div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-lg">{pulse.sectorRotation.best?.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{pulse.sectorRotation.best?.symbol}</div>
                    </div>
                    <div className={cn("font-mono text-2xl font-bold", pctColor(pulse.sectorRotation.best?.change1dPct))}>
                      {fmtPct(pulse.sectorRotation.best?.change1dPct)}
                    </div>
                  </div>
                </div>
                {pulse.sectorRotation.worst && (
                  <div className="bg-card border border-border p-5 rounded-xl">
                    <div className="text-xs text-muted-foreground font-mono mb-2">LAGGING SECTOR</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono font-bold text-lg">{pulse.sectorRotation.worst?.name}</div>
                        <div className="text-xs font-mono text-muted-foreground">{pulse.sectorRotation.worst?.symbol}</div>
                      </div>
                      <div className={cn("font-mono text-2xl font-bold", pctColor(pulse.sectorRotation.worst?.change1dPct))}>
                        {fmtPct(pulse.sectorRotation.worst?.change1dPct)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Movers */}
          {pulse.topGainers.length > 0 && (
            <section>
              <SectionTitle>TOP GAINERS / LOSERS</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {pulse.topGainers.map((m, i) => (
                    <div key={m.symbol} className="flex items-center justify-between px-5 py-3 border-b border-border last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                        <span className="font-mono font-bold">{m.symbol}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm">${m.price.toFixed(2)}</span>
                        <span className={cn("font-mono text-sm font-bold flex items-center", pctColor(m.changePct))}>
                          <ArrowUpRight className="w-3 h-3" />
                          {m.changePct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {pulse.topLosers.map((m, i) => (
                    <div key={m.symbol} className="flex items-center justify-between px-5 py-3 border-b border-border last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                        <span className="font-mono font-bold">{m.symbol}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm">${m.price.toFixed(2)}</span>
                        <span className={cn("font-mono text-sm font-bold flex items-center", pctColor(m.changePct))}>
                          <ArrowDownRight className="w-3 h-3" />
                          {m.changePct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Macro highlights */}
          {pulse.macro.length > 0 && (
            <section>
              <SectionTitle>MACRO HIGHLIGHTS</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {pulse.macro.slice(0, 10).map((item, i) => (
                  <div key={i} className="bg-card border border-border p-4 rounded-xl">
                    <div className="text-xs text-muted-foreground font-mono mb-2">{item.label}</div>
                    <div className="font-mono text-lg font-bold">{item.value}</div>
                    <StatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {isNewsError && <ErrorState message="Could not load headlines." />}
      {news && (
        <section>
          <SectionTitle>LATEST HEADLINES</SectionTitle>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <ul className="divide-y divide-border">
              {news.items.slice(0, 15).map((n, i) => (
                <li key={i} className="flex items-start gap-4 px-5 py-4 hover:bg-secondary/30 transition-colors">
                  <StatusBadge status={n.sentimentLabel} />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm leading-relaxed">{n.title}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] font-mono text-muted-foreground">
                      <span className="text-primary">{n.source}</span>
                      {n.publishedAt && <span>{new Date(n.publishedAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  {n.link && (
                    <a href={n.link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors shrink-0">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ArchiveSection />
    </div>
  );
}