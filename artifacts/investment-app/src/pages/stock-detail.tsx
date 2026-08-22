import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetStockDetail,
  useGetStockHistory,
  useGetStockInsiders,
  type HistoryData,
  type GetStockHistoryInterval,
  type InsiderTrade,
} from "@workspace/api-client-react";
import { SectionHeader, LoadingState, ErrorState, DataTile, Card } from "@/components/panels";
import { cn } from "@/lib/utils";

const RANGES = ["1D", "5D", "1M", "3M", "1Y", "5Y", "ALL"] as const;
type Range = (typeof RANGES)[number];

// Valid intervals per range (mirrors server-side RANGE_CFG)
const INTERVALS: Record<Range, string[]> = {
  "1D": ["5m", "15m", "30m"],
  "5D": ["5m", "15m", "30m", "1h"],
  "1M": ["30m", "1h", "1d"],
  "3M": ["1h", "1d"],
  "1Y": ["1d", "1wk"],
  "5Y": ["1d", "1wk", "1mo"],
  ALL: ["1mo", "3mo"],
};
const DEFAULT_INTERVAL: Record<Range, string> = {
  "1D": "5m",
  "5D": "30m",
  "1M": "1h",
  "3M": "1d",
  "1Y": "1d",
  "5Y": "1wk",
  ALL: "1mo",
};

function fmtCompact(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pct(v: number | null | undefined, digits = 2): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}

function MetricTile({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg px-3 py-2.5 bg-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="font-mono text-sm font-bold mt-0.5 truncate">{value ?? "—"}</div>
    </div>
  );
}

function Selector({
  options,
  active,
  onSelect,
}: {
  options: readonly string[];
  active: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex gap-0.5 border border-border rounded-md p-0.5 bg-secondary/40 overflow-x-auto">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onSelect(o)}
          className={cn(
            "px-2.5 py-1 rounded text-xs font-mono transition-colors whitespace-nowrap",
            o === active
              ? "bg-primary text-primary-foreground font-bold"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function HistoryChart({
  symbol,
  range,
  interval,
}: {
  symbol: string;
  range: Range;
  interval: GetStockHistoryInterval;
}) {
  const { data, isPending, isError } = useGetStockHistory(symbol, { range, interval });

  if (isPending) return <LoadingState />;
  if (isError || !data?.bars?.length)
    return <p className="text-xs font-mono text-muted-foreground">No chart data for this combination.</p>;

  const bars: HistoryData["bars"] = data.bars;
  const up = bars[bars.length - 1].c >= bars[0].c;
  const stroke = up ? "#22c55e" : "#ef4444";
  const lo = Math.min(...bars.map((b) => b.l ?? b.c));
  const hi = Math.max(...bars.map((b) => b.h ?? b.c));
  const span = hi - lo || 1;
  // Points in a 0..100 box; the svg stretches via preserveAspectRatio="none".
  const pts = bars.map(
    (b, i) => `${(i / (bars.length - 1)) * 100},${100 - ((b.c - lo) / span) * 94 - 3}`
  );
  const firstDate = new Date(bars[0].t).toISOString().split("T")[0];
  const lastDate = new Date(bars[bars.length - 1].t).toISOString().split("T")[0];

  return (
    <div>
      <p className="text-[10px] font-mono text-muted-foreground mb-2">
        {symbol} · {data.instrumentType ?? "equity"} · delayed · {bars.length} bars · {firstDate} →{" "}
        {lastDate}
      </p>
      <div className="relative h-[280px] w-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id={`grad-${up ? "up" : "dn"}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <polygon points={`0,100 ${pts.join(" ")} 100,100`} fill={`url(#grad-${up ? "up" : "dn"})`} />
          <polyline
            points={pts.join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
        <span>low {fmtNum(lo)}</span>
        <span>high {fmtNum(hi)}</span>
      </div>
    </div>
  );
}

const STATEMENT_TABS = [
  { key: "income", label: "Income" },
  { key: "balance", label: "Balance" },
  { key: "cashflow", label: "Cash Flow" },
] as const;
type StatementTab = (typeof STATEMENT_TABS)[number]["key"];

export default function StockDetailPage() {
  const params = useParams();
  const [, navigate] = useLocation();
  const routeSymbol = (params.symbol ?? "AAPL").toUpperCase();

  const [input, setInput] = useState(routeSymbol);
  const [range, setRange] = useState<Range>("1Y");
  const [interval_, setInterval_] = useState<GetStockHistoryInterval>(DEFAULT_INTERVAL["1Y"] as GetStockHistoryInterval);
  const [tab, setTab] = useState<StatementTab>("income");

  useEffect(() => setInput(routeSymbol), [routeSymbol]);

  const { data: d, isPending, isError } = useGetStockDetail(routeSymbol);
  const { data: insiders } = useGetStockInsiders(routeSymbol, {
    query: { queryKey: ["getStockInsiders", routeSymbol] },
  });

  if (isPending)
    return (
      <div className="max-w-7xl mx-auto">
        <SectionHeader title={`${routeSymbol}_DETAIL`} />
        <LoadingState />
      </div>
    );
  if (isError || !d)
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <SectionHeader title={`${routeSymbol}_DETAIL`} />
        <ErrorState message={`No data for ${routeSymbol}. Check the ticker and try again.`} />
      </div>
    );

  const changeColor = d.changePct != null && d.changePct < 0 ? "text-destructive" : "text-green-500";
  const m = d.metrics;
  const p = d.profile;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = input.trim().toUpperCase();
    if (sym && sym !== routeSymbol) navigate(`/stocks/${sym}`);
  };

  const pickRange = (r: string) => {
    setRange(r as Range);
    setInterval_(DEFAULT_INTERVAL[r as Range] as GetStockHistoryInterval);
  };

  const stmtRows =
    tab === "income" ? d.statements.income : tab === "balance" ? d.statements.balance : d.statements.cashflow;

  const fmtCell = (label: string, v: number | null): string => {
    if (v == null) return "—";
    if (label.startsWith("EPS") || Math.abs(v) < 1e6) return v.toFixed(2);
    return fmtCompact(v);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title={`${d.symbol}_DETAIL`} updatedAt={d.updatedAt} />

      {/* Ticker jump */}
      <form onSubmit={submit} className="-mt-4 flex gap-2 max-w-sm">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="Search ticker e.g. GOOGL"
          className="flex-1 bg-card border border-border rounded-md px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button type="submit" className="px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-secondary/70">
          Go
        </button>
      </form>

      {/* Quote header */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{d.symbol}</h1>
            {d.exchange && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                {d.exchange}
              </span>
            )}
            {p.sector && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground hidden sm:inline">
                {p.sector}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{d.name ?? "—"}</p>
        </div>
        <div className="flex items-baseline gap-3 ml-auto sm:ml-0">
          <span className="text-3xl font-black font-mono">{fmtNum(d.price)}</span>
          {d.changeAbs != null && (
            <span className={cn("font-mono text-sm font-bold", changeColor)}>
              {d.changeAbs > 0 ? "+" : ""}
              {d.changeAbs.toFixed(2)} ({d.changePct! > 0 ? "+" : ""}
              {d.changePct!.toFixed(2)}%)
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <DataTile label="Open" value={fmtNum(d.open)} />
        <DataTile label="Prev" value={fmtNum(d.prevClose)} />
        <DataTile label="High" value={fmtNum(d.dayHigh)} />
        <DataTile label="Low" value={fmtNum(d.dayLow)} />
        <DataTile label="Volume" value={d.volume?.toLocaleString("en-US") ?? "—"} />
        <DataTile label="Mkt Cap" value={fmtCompact(d.marketCap)} />
        <DataTile label="52W High" value={fmtNum(d.fiftyTwoWeekHigh)} />
        <DataTile label="52W Low" value={fmtNum(d.fiftyTwoWeekLow)} />
        <DataTile label="MA50" value={fmtNum(d.ma50)} />
        <DataTile label="MA200" value={fmtNum(d.ma200)} />
      </div>

      {/* Chart */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 justify-between mb-3">
          <Selector
            options={INTERVALS[range]}
            active={interval_}
            onSelect={(v) => v !== interval_ && setInterval_(v as GetStockHistoryInterval)}
          />
          <Selector options={RANGES} active={range} onSelect={pickRange} />
        </div>
        <HistoryChart symbol={d.symbol} range={range} interval={interval_} />
      </Card>

      {/* Profile */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3">Profile</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
          <MetricTile label="Sector" value={p.sector} />
          <MetricTile label="Industry" value={p.industry} />
          <MetricTile label="CEO" value={p.ceo} />
          <MetricTile label="Employees" value={p.employees?.toLocaleString("en-US")} />
          <MetricTile label="HQ" value={p.hq} />
        </div>
        {p.website && (
          <a
            href={`https://${p.website}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-primary underline"
          >
            {p.website}
          </a>
        )}
        {p.description && (
          <p className="text-xs leading-relaxed text-muted-foreground mt-3 max-w-4xl">{p.description}</p>
        )}
      </section>

      {/* Key metrics */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3">Key Metrics</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <MetricTile label="P/E" value={fmtNum(m.pe)} />
          <MetricTile label="PEG" value={fmtNum(m.peg)} />
          <MetricTile label="P/S" value={fmtNum(m.ps)} />
          <MetricTile label="P/B" value={fmtNum(m.pb)} />
          <MetricTile label="EV/EBITDA" value={fmtNum(m.evEbitda)} />
          <MetricTile label="EV/Sales" value={fmtNum(m.evSales)} />
          <MetricTile label="Div Yield" value={pct(m.divYield)} />
          <MetricTile label="ROE" value={pct(m.roe)} />
          <MetricTile label="ROA" value={pct(m.roa)} />
          <MetricTile label="Gross Margin" value={pct(m.grossMargin)} />
          <MetricTile label="Op Margin" value={pct(m.opMargin)} />
          <MetricTile label="Net Margin" value={pct(m.netMargin)} />
          <MetricTile label="Debt/Equity" value={pct(m.debtEquity)} />
          <MetricTile label="Current Ratio" value={fmtNum(m.currentRatio)} />
          <MetricTile label="Market Cap" value={fmtCompact(d.marketCap)} />
          <MetricTile label="Enterprise V" value={fmtCompact(m.enterpriseValue)} />
        </div>
      </section>

      {/* Financial statements */}
      <section>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">Financial Statements</h2>
          <div className="flex gap-1">
            {STATEMENT_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-mono transition-colors",
                  tab === t.key
                    ? "bg-primary text-primary-foreground font-bold"
                    : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {stmtRows.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground">No SEC filings found for this ticker.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-left font-mono text-sm whitespace-nowrap">
              <thead className="bg-secondary/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-normal">Item</th>
                  {d.statements.years.map((y) => (
                    <th key={y} className="px-4 py-3 font-normal text-right">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stmtRows.map((r) => (
                  <tr key={r.label} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.label}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="px-4 py-2.5 text-right">
                        {fmtCell(r.label, v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Insider activity */}
      {insiders && insiders.trades.length > 0 && (
        <section className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Insider Activity — SEC Form 4
            </h2>
            {insiders.netBuyValueUsd != null && (
              <span className={cn("font-mono text-sm font-bold", insiders.netBuyValueUsd >= 0 ? "text-green-500" : "text-destructive")}>
                Net {insiders.netBuyValueUsd >= 0 ? "buying" : "selling"} ${fmtCompact(Math.abs(insiders.netBuyValueUsd))}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  {["FILED", "TRADED", "INSIDER", "ROLE", "ACTION", "SHARES", "PRICE", "VALUE"].map((h) => (
                    <th key={h} className="px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {insiders.trades.map((t: InsiderTrade, i: number) => (
                  <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.filedAt}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.date ?? "—"}</td>
                    <td className="px-3 py-2 text-sm">{t.insider.length > 28 ? `${t.insider.slice(0, 26)}…` : t.insider}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground max-w-[180px] truncate" title={t.role ?? ""}>{t.role ?? "—"}</td>
                    <td className={cn("px-3 py-2 font-mono text-xs font-bold uppercase", t.action === "buy" ? "text-green-500" : t.action === "sell" ? "text-destructive" : "text-muted-foreground")}>
                      {t.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-right">{t.shares != null ? fmtNum(t.shares) : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-right">{t.price != null ? `$${fmtNum(t.price)}` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-right">{t.valueUsd != null ? `$${fmtCompact(t.valueUsd)}` : "—"}</td>
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
