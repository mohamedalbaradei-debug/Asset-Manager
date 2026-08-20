/**
 * Black-Scholes option greeks.
 *
 * Yahoo's free options chain provides strike, IV, bid/ask, volume and open
 * interest but not the advanced greeks, so we compute delta / gamma / charm
 * ourselves with the standard Black-Scholes model. This matches how free GEX
 * dashboards derive their numbers. Dividend yield defaults to 0.
 */

// Standard normal CDF (Abramowitz & Stegun approximation, max error ~7.5e-8)
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  let p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

// Standard normal PDF
function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp((-x * x) / 2);
}

export interface BsmGreeks {
  delta: number;
  gamma: number;
  charm: number;
  d1: number;
  d2: number;
}

export interface BsmInputs {
  spot: number;
  strike: number;
  timeToExpiryYears: number;
  impliedVolatility: number; // annualized, as a decimal (e.g. 0.25)
  riskFreeRate: number; // decimal, default 0.0425
  dividendYield?: number; // decimal, default 0
}

/**
 * Compute delta, gamma and charm for a call option.
 * charm = d(delta)/dT decay per calendar day (negative → delta decays).
 */
export function callGreeks({
  spot,
  strike,
  timeToExpiryYears,
  impliedVolatility,
  riskFreeRate = 0.0425,
  dividendYield = 0,
}: BsmInputs): BsmGreeks {
  const T = Math.max(timeToExpiryYears, 1 / (365 * 24)); // floor at 1 hour
  const sigma = Math.max(impliedVolatility, 0.0001);
  const q = dividendYield;

  const d1 = (Math.log(spot / strike) + (riskFreeRate - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const delta = Math.exp(-q * T) * normCdf(d1);
  const gamma = (Math.exp(-q * T) * normPdf(d1)) / (spot * sigma * Math.sqrt(T));

  // Charm = -d(delta)/dT. Standard form (e.g. Wikipedia "Charm (finance)"):
  //   charm_call = -e^{-qT} φ(d1) * (2(r-q)T - d2·σ·√T) / (2·T·σ·√T) + q·e^{-qT}·N(d1)
  const charm =
    -(
      Math.exp(-q * T) *
      normPdf(d1) *
      ((2 * (riskFreeRate - q) * T - d2 * sigma * Math.sqrt(T)) / (2 * T * sigma * Math.sqrt(T)))
    ) +
    q * Math.exp(-q * T) * normCdf(d1);

  return { delta, gamma, charm, d1, d2 };
}

/** Delta, gamma and charm for a put option (gamma and charm have the same magnitude, delta differs). */
export function putGreeks({
  spot,
  strike,
  timeToExpiryYears,
  impliedVolatility,
  riskFreeRate = 0.0425,
  dividendYield = 0,
}: BsmInputs): BsmGreeks {
  const T = Math.max(timeToExpiryYears, 1 / (365 * 24));
  const sigma = Math.max(impliedVolatility, 0.0001);
  const q = dividendYield;

  const d1 = (Math.log(spot / strike) + (riskFreeRate - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const delta = -Math.exp(-q * T) * normCdf(-d1);
  const gamma = (Math.exp(-q * T) * normPdf(d1)) / (spot * sigma * Math.sqrt(T));

  // charm_put = -d(delta_put)/dT = +e^{-qT}φ(d1)·(2(r-q)T - d2σ√T)/(2Tσ√T) - q·e^{-qT}·N(-d1)
  const charm =
    Math.exp(-q * T) *
      normPdf(d1) *
      ((2 * (riskFreeRate - q) * T - d2 * sigma * Math.sqrt(T)) / (2 * T * sigma * Math.sqrt(T))) -
    q * Math.exp(-q * T) * normCdf(-d1);

  return { delta, gamma, charm, d1, d2 };
}

/** Human-readable interpretation of delta/gamma/charm for beginners. */
export function greekExplanation(optionType: "call" | "put", g: BsmGreeks): string {
  const gammaNote =
    g.gamma > 0.1
      ? "High gamma — the option's delta will swing sharply as the price moves; expect amplified positioning shifts around the strike."
      : "Moderate/low gamma — delta changes relatively slowly with the underlying price.";

  const deltaNote =
    optionType === "call"
      ? `Delta ≈ ${g.delta.toFixed(2)} means the call behaves like roughly ${(g.delta * 100).toFixed(0)} shares of the stock.`
      : `Delta ≈ ${g.delta.toFixed(2)} means the put behaves like roughly ${(Math.abs(g.delta) * 100).toFixed(0)} shares sold short.`;

  const charmNote =
    g.charm < 0
      ? `Charm ≈ ${g.charm.toFixed(4)} — this option's delta decays as time passes (negative charm), a headwind for long options and a tailwind for market makers.`
      : `Charm ≈ ${g.charm.toFixed(4)} — this option's delta is building as time passes (positive charm).`;

  return `${deltaNote} ${gammaNote} ${charmNote}`;
}