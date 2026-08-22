import React, { useMemo, useState } from "react";
import {
  useGetCryptoOptions,
  type ExpiryChain,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, EmptyNote } from "@/components/panels";

const fmtNum = (v: number | null | undefined) =>
  v != null ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v) : "—";

const fmtOi = (v: number | null | undefined) =>
  v != null ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : "—";

function tickInterval(n: number): number {
  if (n <= 20) return 0;
  if (n <= 40) return Math.floor(n / 12);
  return Math.floor(n / 8);
}

function OiChart({ expiry, spot, maxPain }: { expiry: ExpiryChain; spot: number | null; maxPain: number | null }) {
  // ±35% around spot keeps the chart readable on chains with hundreds of strikes.
  const lo = spot != null ? spot * 0.65 : -Infinity;
  const hi = spot != null ? spot * 1.35 : Infinity;
  const bars = expiry.strikes
    .filter((s) => s.strike != null && s.strike >= lo && s.strike <= hi)
    .map((s) => ({
      strike: s.strike as number,
      callOi: s.callOi ?? 0,
      putOi: -(s.putOi ?? 0),
    }));
  if (bars.length === 0) return <EmptyNote text="No open interest in range." />;

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="strike"
            interval={tickInterval(bars.length)}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <YAxis
            width={52}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtOi(Math.abs(v))}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
            itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
            labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
            formatter={(val: number) => [fmtOi(Math.abs(val)), val >= 0 ? "Call OI" : "Put OI"]}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          {spot != null && (
            <ReferenceLine x={nearestStrike(bars.map((b) => b.strike), spot)} stroke="#3b82f6" strokeDasharray="4 4" />
          )}
          {maxPain != null && (
            <ReferenceLine x={nearestStrike(bars.map((b) => b.strike), maxPain)} stroke="#f59e0b" strokeDasharray="4 4" />
          )}
          <Bar dataKey="callOi" fill="#22c55e" radius={[3, 3, 0, 0]} />
          <Bar dataKey="putOi" fill="#ef4444" radius={[0, 0, 3, 3]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function nearestStrike(strikes: number[], target: number): number {
  return strikes.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), strikes[0]);
}

export default function CryptoOptionsPage() {
  const [currency, setCurrency] = useState<"BTC" | "ETH">("BTC");
  const [expiryIdx, setExpiryIdx] = useState(0);
  const { data, isPending, isError } = useGetCryptoOptions(
    { currency },
    { query: { queryKey: ["getCryptoOptions", currency] } },
  );
  const isFetching = isPending;

  React.useEffect(() => setExpiryIdx(0), [currency]);

  const expiries = data?.expiries ?? [];
  const expiry: ExpiryChain | undefined = expiries[Math.min(expiryIdx, Math.max(expiries.length - 1, 0))];
  const totals = useMemo(() => {
    if (!expiry) return null;
    return {
      callOi: expiry.totalCallOi,
      putOi: expiry.totalPutOi,
      pcr: expiry.putCallRatio,
      maxPain: expiry.maxPain,
    };
  }, [expiry]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <SectionHeader title={`CRYPTO_OPTIONS_${data?.currency ?? currency}`} updatedAt={data?.updatedAt} />

      <div className="flex items-center gap-2">
        {(["BTC", "ETH"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCurrency(c)}
            className={cn(
              "px-4 py-1.5 rounded-lg font-mono text-sm font-bold border transition-colors",
              currency === c ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {isPending && <LoadingState />}
      {(isError || isFetching === false && !isPending && !data) && (
        <ErrorState message="Could not load Deribit options data." />
      )}

      {data && expiries.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Spot</div>
              <div className="font-mono text-xl font-bold">${fmtNum(data.spot)}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Expiry</div>
              <select
                value={expiryIdx}
                onChange={(e) => setExpiryIdx(parseInt(e.target.value, 10))}
                className="w-full bg-transparent font-mono text-lg font-bold outline-none cursor-pointer"
              >
                {expiries.map((e, i) => (
                  <option key={e.date} value={i}>
                    {e.date} ({e.daysToExpiry}d)
                  </option>
                ))}
              </select>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Max Pain</div>
              <div className="font-mono text-xl font-bold text-amber-500">${totals?.maxPain != null ? fmtNum(totals.maxPain) : "—"}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Put/Call OI</div>
              <div className={cn("font-mono text-xl font-bold", (totals?.pcr ?? 1) >= 1 ? "text-red-500" : "text-green-500")}>
                {totals?.pcr != null ? totals.pcr.toFixed(2) : "—"}
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Total OI C / P</div>
              <div className="font-mono text-sm font-bold pt-1">
                <span className="text-green-500">{fmtOi(totals?.callOi)}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-red-500">{fmtOi(totals?.putOi)}</span>
              </div>
            </div>
          </div>

          <section className="bg-card border border-border rounded-xl p-5">
            <SectionTitle>OPEN INTEREST BY STRIKE — {expiry?.date}</SectionTitle>
            <p className="text-[10px] font-mono text-muted-foreground mb-2">
              Calls above zero · puts below · <span className="text-blue-500">blue line</span> = spot ·{" "}
              <span className="text-amber-500">amber line</span> = max pain
            </p>
            {expiry && <OiChart expiry={expiry} spot={data.spot ?? null} maxPain={totals?.maxPain ?? null} />}
          </section>

          {data.futures.length > 0 && (
            <section>
              <SectionTitle>FUTURES TERM STRUCTURE</SectionTitle>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border">
                      {["INSTRUMENT", "MATURITY", "MARK", "LAST", "OPEN INTEREST"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.futures.map((f) => (
                      <tr key={f.instrument} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5 font-mono text-sm">{f.instrument}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{f.maturityDate ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-sm">${f.markPrice != null ? fmtNum(f.markPrice) : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">${f.lastPrice != null ? fmtNum(f.lastPrice) : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{fmtOi(f.openInterest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
