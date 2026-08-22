import {
  type PlanRequest,
  type PlanResponse,
  type PlanAllocationSlice,
  type PlanEtfPick,
  type PlanProjection,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

/**
 * Rule-based investment planner.
 *
 * Deterministic allocation matrix by horizon × risk tolerance, concrete
 * low-cost ETF picks, compound-growth projections under three scenarios,
 * and optional display-currency conversion via ECB (frankfurter.dev).
 * Educational output only — never a personalised fiduciary recommendation.
 */

type RiskKey = "conservative" | "balanced" | "aggressive";
type HorizonKey = "short" | "medium" | "long";

interface Mix {
  stocks: number;
  bonds: number;
  gold: number;
  cash: number;
}

const ALLOCATION_MATRIX: Record<HorizonKey, Record<RiskKey, Mix>> = {
  short: {
    conservative: { stocks: 25, bonds: 55, gold: 8, cash: 12 },
    balanced: { stocks: 40, bonds: 40, gold: 10, cash: 10 },
    aggressive: { stocks: 55, bonds: 30, gold: 10, cash: 5 },
  },
  medium: {
    conservative: { stocks: 35, bonds: 45, gold: 12, cash: 8 },
    balanced: { stocks: 55, bonds: 30, gold: 10, cash: 5 },
    aggressive: { stocks: 75, bonds: 15, gold: 7, cash: 3 },
  },
  long: {
    conservative: { stocks: 50, bonds: 30, gold: 12, cash: 8 },
    balanced: { stocks: 70, bonds: 20, gold: 7, cash: 3 },
    aggressive: { stocks: 90, bonds: 5, gold: 4, cash: 1 },
  },
};

const HORIZON_YEARS: Record<HorizonKey, number> = { short: 3, medium: 5, long: 10 };

// Long-run annualised total-return assumptions (nominal, USD).
const RETURN_ASSUMPTIONS = { stocks: 7, bonds: 4.5, gold: 4, cash: 3 };

const RATIONALES: Record<keyof Mix, (h: HorizonKey, r: RiskKey) => string> = {
  stocks: (h) =>
    h === "long"
      ? "Equities are the primary growth engine over long horizons; historically ~7% annualised with high interim volatility that time smooths out."
      : h === "medium"
        ? "Equities drive growth but a 3-7y window can still contain deep bear markets, so exposure is moderated."
        : "With under three years, equities stay a minority slice — there may not be enough time to recover from a drawdown before you need the money.",
  bonds: (_h, r) =>
    r === "conservative"
      ? "High-grade bonds anchor the portfolio, dampening equity drawdowns and providing steady coupon income."
      : "Investment-grade bonds reduce volatility and provide dry powder to rebalance into equity dips.",
  gold: () =>
    "Gold diversifies against inflation surprises and currency shocks; it tends to rally when real rates fall or confidence wobbles.",
  cash: (h) =>
    h === "short"
      ? "A cash/T-bill buffer guarantees liquidity for near-term needs and lets you buy dips without selling anything."
      : "A small cash buffer covers emergencies so long-term positions are never force-sold at the wrong moment.",
};

function buildEtfs(mix: Mix): PlanEtfPick[] {
  const etfs: PlanEtfPick[] = [];
  if (mix.stocks > 0) {
    const usSlice = Math.round(mix.stocks * 0.8 * 10) / 10;
    const intlSlice = Math.round((mix.stocks - usSlice) * 10) / 10;
    etfs.push({
      ticker: "VTI",
      name: "Vanguard Total Stock Market ETF (US)",
      assetClass: "stocks",
      percentOfPortfolio: usSlice,
      expenseRatioPct: 0.03,
    });
    if (intlSlice > 0) {
      etfs.push({
        ticker: "VXUS",
        name: "Vanguard Total International Stock ETF",
        assetClass: "stocks",
        percentOfPortfolio: intlSlice,
        expenseRatioPct: 0.05,
      });
    }
  }
  if (mix.bonds > 0) {
    etfs.push({
      ticker: "BND",
      name: "Vanguard Total Bond Market ETF",
      assetClass: "bonds",
      percentOfPortfolio: mix.bonds,
      expenseRatioPct: 0.03,
    });
  }
  if (mix.gold > 0) {
    etfs.push({
      ticker: "GLD",
      name: "SPDR Gold Shares",
      assetClass: "gold",
      percentOfPortfolio: mix.gold,
      expenseRatioPct: 0.4,
    });
  }
  return etfs;
}

function buildSteps(h: HorizonKey, r: RiskKey, mix: Mix): string[] {
  const steps: string[] = [
    `Keep an emergency fund of 3-6 months of expenses outside this portfolio${mix.cash >= 5 ? " — the cash slice here supplements, not replaces, it" : ""}.`,
    mix.cash >= 5
      ? `Park the ${mix.cash}% cash slice in a high-yield savings account or T-bill ETF (e.g. SGOV/BIL) rather than a checking account.`
      : "Hold your emergency fund separately in T-bills or a high-yield savings account.",
    `Buy the ETF slices in one session and set up automatic monthly contributions — even small ones — to smooth out entry prices (dollar-cost averaging).`,
    `Rebalance back to target weights once a year (${r === "conservative" ? "or whenever any slice drifts ±5%" : "or whenever any slice drifts ±10%"}). Sell high / buy low mechanically.`,
  ];
  if (h === "short") {
    steps.push(
      "Horizon is under 3 years: review the plan quarterly and shift maturing goals into bonds/cash as the deadline approaches."
    );
  } else if (h === "long") {
    steps.push(
      "Horizon is 7+ years: ignore drawdowns below 20% unless your life circumstances changed — history favours staying invested."
    );
  }
  if (r === "conservative") {
    steps.push("If you find yourself wishing for more upside after a full market cycle, revisit risk tolerance rather than improvising mid-cycle.");
  } else if (r === "aggressive") {
    steps.push("Aggressive mixes can drop 30-50% in bear markets — confirm you could hold through that without selling before committing.");
  }
  steps.push("Prefer tax-advantaged retirement accounts for the bond slice where available (interest is usually taxed as income).");
  return steps;
}

async function fetchFxRate(currency: string): Promise<number | null> {
  try {
    // open.er-api.com: keyless, 160+ fiat currencies (ECB-based frankfurter
    // lacks exotic pairs like EGP).
    const res = await fetch(`https://open.er-api.com/v6/latest/USD`);
    if (!res.ok) throw new Error(`FX ${res.status}`);
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    const rate = json.rates?.[currency.toUpperCase()];
    return typeof rate === "number" && rate > 0 ? rate : null;
  } catch (err) {
    logger.warn({ err, currency }, "Planner FX conversion failed");
    return null;
  }
}

/** Concrete ETF allocation for a horizon × risk profile (for backtesting). */
export function etfAllocationFor(horizon: string, risk: string): PlanEtfPick[] {
  const h = (["short", "medium", "long"].includes(horizon) ? horizon : "medium") as HorizonKey;
  const r = (["conservative", "balanced", "aggressive"].includes(risk) ? risk : "balanced") as RiskKey;
  return buildEtfs(ALLOCATION_MATRIX[h][r]);
}

export async function createPlan(input: PlanRequest): Promise<PlanResponse> {
  const horizon = input.horizon as HorizonKey;
  const risk = input.riskTolerance as RiskKey;
  const mix = ALLOCATION_MATRIX[horizon][risk];
  const cash = input.cashUsd;

  const allocation: PlanAllocationSlice[] = (
    [
      ["stocks", "Equities (VTI + VXUS)"],
      ["bonds", "Bonds (BND)"],
      ["gold", "Gold (GLD)"],
      ["cash", "Cash / T-bills"],
    ] as Array<[keyof Mix, string]>
  ).map(([key, label]) => ({
    assetClass: label,
    percent: mix[key],
    amountUsd: Math.round(cash * (mix[key] / 100) * 100) / 100,
    rationale: RATIONALES[key](horizon, risk),
  }));

  const etfs = buildEtfs(mix);

  const years = HORIZON_YEARS[horizon];
  const baseReturn =
    (mix.stocks / 100) * RETURN_ASSUMPTIONS.stocks +
    (mix.bonds / 100) * RETURN_ASSUMPTIONS.bonds +
    (mix.gold / 100) * RETURN_ASSUMPTIONS.gold +
    (mix.cash / 100) * RETURN_ASSUMPTIONS.cash;

  const projections: PlanProjection[] = (
    [
      ["Conservative", baseReturn - 2],
      ["Base", baseReturn],
      ["Optimistic", baseReturn + 2],
    ] as Array<[string, number]>
  ).map(([scenario, r]) => ({
    years,
    scenario,
    expectedAnnualReturnPct: Math.round(r * 100) / 100,
    projectedValueUsd: Math.round(cash * Math.pow(1 + r / 100, years) * 100) / 100,
  }));

  let fx: PlanResponse["fx"] | undefined;
  if (input.currency && input.currency.toUpperCase() !== "USD") {
    const rate = await fetchFxRate(input.currency);
    if (rate != null) {
      const baseProjection = projections.find((p) => p.scenario === "Base");
      fx = {
        currency: input.currency.toUpperCase(),
        rate,
        projectedValueLocal:
          Math.round((baseProjection?.projectedValueUsd ?? cash) * rate * 100) / 100,
      };
    }
  }

  return {
    allocation,
    etfs,
    projections,
    fx,
    steps: buildSteps(horizon, risk, mix),
    disclaimer:
      "Educational illustration based on fixed rules and historical average returns — not financial advice. Markets can and do deviate widely from these estimates; past performance does not guarantee future results.",
  };
}
