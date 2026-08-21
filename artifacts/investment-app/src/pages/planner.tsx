import { useState } from "react";
import {
  useCreateInvestmentPlan,
  type PlanRequest,
  type PlanResponse,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Calculator, TrendingUp, Shield, Coins, ListChecks, CircleAlert } from "lucide-react";
import { SectionHeader } from "@/components/panels";
import { cn } from "@/lib/utils";

const HORIZONS: Array<{ value: PlanRequest["horizon"]; label: string; hint: string }> = [
  { value: "short", label: "Short", hint: "up to 3 years" },
  { value: "medium", label: "Medium", hint: "3 – 7 years" },
  { value: "long", label: "Long", hint: "7+ years" },
];

const RISKS: Array<{ value: PlanRequest["riskTolerance"]; label: string; hint: string }> = [
  { value: "conservative", label: "Conservative", hint: "protect capital first" },
  { value: "balanced", label: "Balanced", hint: "growth with a cushion" },
  { value: "aggressive", label: "Aggressive", hint: "max long-run growth" },
];

const CURRENCIES = ["USD", "EGP", "EUR", "GBP", "SAR", "AED", "JPY", "CHF"];

const CLASS_COLORS: Record<string, string> = {
  Equities: "#22c55e",
  Bonds: "#3b82f6",
  Gold: "#eab308",
  Cash: "#a855f7",
};

export default function PlannerPage() {
  const [cash, setCash] = useState("10000");
  const [horizon, setHorizon] = useState<PlanRequest["horizon"]>("long");
  const [risk, setRisk] = useState<PlanRequest["riskTolerance"]>("balanced");
  const [currency, setCurrency] = useState("USD");

  const mutation = useCreateInvestmentPlan();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(cash);
    if (!isFinite(n) || n <= 0) return;
    mutation.mutate({
      data: {
        cashUsd: n,
        horizon,
        riskTolerance: risk,
        currency: currency === "USD" ? null : currency,
      },
    });
  };

  const plan: PlanResponse | undefined = mutation.data;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="PLANNER" />

      {/* ── Input form ── */}
      <form onSubmit={submit} className="bg-card border border-border rounded-xl p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-mono text-muted-foreground mb-2 tracking-widest">
              AVAILABLE CASH (USD)
            </label>
            <input
              type="number"
              min="1"
              step="any"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 font-mono text-lg focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="10000"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-muted-foreground mb-2 tracking-widest">
              DISPLAY CURRENCY
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {[
          { label: "TIME HORIZON", items: HORIZONS, value: horizon, set: setHorizon },
          { label: "RISK TOLERANCE", items: RISKS, value: risk, set: setRisk },
        ].map((group) => (
          <div key={group.label}>
            <span className="block text-xs font-mono text-muted-foreground mb-2 tracking-widest">
              {group.label}
            </span>
            <div className="flex flex-wrap gap-2">
              {(group.items as ReadonlyArray<{ value: string; label: string; hint: string }>).map(
                (item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() =>
                      (group.set as (v: string) => void)(item.value)
                    }
                    className={cn(
                      "px-4 py-2.5 rounded-lg border font-mono text-sm transition-colors text-left",
                      group.value === item.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-secondary/40 hover:bg-secondary text-muted-foreground"
                    )}
                  >
                    <div className="font-bold">{item.label}</div>
                    <div className="text-[10px] opacity-70">{item.hint}</div>
                  </button>
                )
              )}
            </div>
          </div>
        ))}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-mono font-bold disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          <Calculator className="w-4 h-4" />
          {mutation.isPending ? "BUILDING PLAN…" : "BUILD MY PLAN"}
        </button>
      </form>

      {mutation.isError && (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive font-mono text-sm">
          <CircleAlert className="w-4 h-4 shrink-0" />
          Could not build plan — check your inputs and try again.
        </div>
      )}

      {/* ── Result ── */}
      {plan && (
        <>
          {/* Allocation */}
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">
              TARGET ALLOCATION
            </h2>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex h-3">
                {plan.allocation.map((a) => (
                  <div
                    key={a.assetClass}
                    style={{
                      width: `${a.percent}%`,
                      backgroundColor:
                        CLASS_COLORS[a.assetClass.split(" ")[0]] ?? "#71717a",
                    }}
                  />
                ))}
              </div>
              <div className="divide-y divide-border">
                {plan.allocation.map((a) => (
                  <div key={a.assetClass} className="p-5">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block"
                          style={{
                            backgroundColor:
                              CLASS_COLORS[a.assetClass.split(" ")[0]] ?? "#71717a",
                          }}
                        />
                        <span className="font-mono font-bold">{a.assetClass}</span>
                      </div>
                      <span className="font-mono text-sm">
                        <span className="font-bold">{a.percent}%</span>
                        <span className="text-muted-foreground ml-2">
                          ${a.amountUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </span>
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground leading-relaxed pl-5">
                      {a.rationale}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>

          {/* ETFs + projections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <Coins className="w-4 h-4" /> ETF SHOPPING LIST
              </h2>
              <div className="space-y-3">
                {plan.etfs.map((e) => (
                  <div
                    key={e.ticker}
                    className="bg-card border border-border rounded-xl p-4 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-mono font-bold">
                        {e.ticker}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {e.name}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1">
                        expense ratio {e.expenseRatioPct ?? "?"}%
                      </div>
                    </div>
                    <div className="font-mono text-xl font-bold text-primary shrink-0 ml-3">
                      {e.percentOfPortfolio}%
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> GROWTH PROJECTION
              </h2>
              <div className="space-y-3">
                {plan.projections.map((p) => (
                  <div
                    key={p.scenario}
                    className="bg-card border border-border rounded-xl p-4 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-mono font-bold text-sm">{p.scenario}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        ~{p.expectedAnnualReturnPct}% / yr · {p.years}y horizon
                      </div>
                    </div>
                    <div className="font-mono text-lg font-bold shrink-0 ml-3">
                      $
                      {p.projectedValueUsd.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  </div>
                ))}
                {plan.fx && (
                  <div className="border border-blue-500/30 bg-blue-500/5 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-mono text-sm">
                      <Shield className="w-4 h-4 text-blue-400" />
                      In {plan.fx.currency} @ {plan.fx.rate.toFixed(2)}
                    </div>
                    <div className="font-mono text-lg font-bold text-blue-400">
                      {plan.fx.projectedValueLocal.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          </div>

          {/* Steps */}
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
              <ListChecks className="w-4 h-4" /> ACTION PLAN
            </h2>
            <ol className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex gap-4 p-4">
                  <span className="font-mono font-bold text-primary shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
            <p className="text-[10px] font-mono text-muted-foreground mt-3 px-1 leading-relaxed">
              {plan.disclaimer}
            </p>
          </motion.section>
        </>
      )}
    </div>
  );
}
