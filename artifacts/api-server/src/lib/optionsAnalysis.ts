import { yahooFinance } from "./yahoo";
import { callGreeks, putGreeks } from "./blackScholes";
import { logger } from "./logger";

/**
 * Options-flow analytics built on the free Yahoo Finance chain.
 *
 * Yahoo provides strike, IV, bid/ask, volume and open interest but not the
 * advanced greeks — so delta/gamma/charm and the GEX / net-flow figures are
 * computed locally with the Black-Scholes model. This matches how free GEX
 * dashboards derive their numbers.
 */

const RISK_FREE_RATE = 0.0425;

interface OptionContract {
  strike: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}

function toYears(expiration: Date, now: Date): number {
  return Math.max((expiration.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000), 1 / (365 * 24));
}

// Index option chains on Yahoo are now degraded (single expiration, zero OI/IV),
// so prefer CBOE's delayed chain for indices. Equities still try Yahoo first.
const INDEX_TICKERS = new Set(["SPX", "VIX", "NDX", "RUT", "XSP"]);

async function fetchChain(ticker: string) {
  const isIndex = INDEX_TICKERS.has(ticker.replace(/^\^/, "").toUpperCase());
  if (isIndex) {
    const cboe = await fetchChainCboe(ticker);
    if (cboe) return cboe;
  }
  try {
    const data = await yahooFinance.options(ticker);
    const spot = (data.quote?.regularMarketPrice as number | undefined) ?? null;
    const options = (data.options ?? []) as Array<{
      expirationDate: Date;
      calls: OptionContract[];
      puts: OptionContract[];
    }>;
    // Yahoo sometimes returns a degenerate chain (one expiration, zero OI) for
    // indices — fall through to CBOE in that case.
    const hasRealChain =
      options.length > 0 &&
      options.some((o) => (o.calls.some((c) => (c.openInterest ?? 0) > 0) || o.puts.some((p) => (p.openInterest ?? 0) > 0)));
    if (hasRealChain) return { data, spot, options };
    if (!isIndex) logger.warn({ ticker, expirations: options.length }, "Yahoo chain looks degenerate, trying CBOE");
  } catch (err) {
    logger.warn({ err, ticker }, "Yahoo options fetch failed, trying CBOE");
  }
  const cboe = await fetchChainCboe(ticker);
  if (cboe) return cboe;
  throw new Error(`No options data for ${ticker}`);
}

// CBOE delayed quotes (free, keyless) — fallback when Yahoo blocks the chain.
// Symbols look like SPXW260917C07000000 → root + YYMMDD + C/P + strike×1000.
async function fetchChainCboe(tickerRaw: string) {
  try {
    const ticker = tickerRaw.replace(/^\^/, "").toUpperCase();
    // Index options use an underscore prefix on CBOE (_SPX, _VIX); equities don't.
    const isIndex = ["SPX", "VIX", "NDX", "RUT", "XSP"].includes(ticker);
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${isIndex ? "_" : ""}${ticker}.json`;
    const res = await fetch(url, {
      headers: {
        // CDN sometimes rejects non-browser clients.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(35000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, ticker }, "CBOE chain request failed");
      return null;
    }
    const json = (await res.json()) as {
      data?: { current_price?: number; options?: Array<{ option: string; iv: number; volume: number; open_interest: number }> };
    };
    const raw = json.data?.options ?? [];
    const spot = json.data?.current_price ?? null;
    if (raw.length === 0 || spot == null) return null;

    const byExpiry = new Map<string, { calls: OptionContract[]; puts: OptionContract[] }>();
    for (const o of raw) {
      const m = o.option.match(/^[A-Z0-9]+(\d{6})([CP])(\d{8})$/);
      if (!m) continue;
      const [, ymd, cp, strikeStr] = m;
      const expiration = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
      const strike = parseInt(strikeStr, 10) / 1000;
      if (!isFinite(strike)) continue;
      let bucket = byExpiry.get(expiration);
      if (!bucket) {
        bucket = { calls: [], puts: [] };
        byExpiry.set(expiration, bucket);
      }
      const contract = {
        strike,
        volume: o.volume ?? 0,
        openInterest: o.open_interest ?? 0,
        // CBOE reports IV as a percent (e.g. 15.5 = 15.5%); Black-Scholes
        // needs a decimal. Unquoted strikes report iv = 0.
        impliedVolatility: typeof o.iv === "number" && o.iv > 0 ? o.iv / 100 : 0,
        inTheMoney: cp === "C" ? spot > strike : spot < strike,
      };
      if (cp === "C") bucket.calls.push(contract);
      else bucket.puts.push(contract);
    }

    const options = [...byExpiry.entries()]
      .map(([expiration, { calls, puts }]) => ({ expirationDate: new Date(`${expiration}T20:00:00Z`), calls, puts }))
      .sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime());
    if (options.length === 0) return null;
    return { data: { quote: { regularMarketPrice: spot }, options }, spot, options };
  } catch (err) {
    logger.warn({ err, ticker: tickerRaw }, "CBOE chain fetch failed");
    return null;
  }
}

// ── Options flow (put/call ratio + unusual activity) ─────────────────────────

export interface OptionsFlowResult {
  available: boolean;
  ticker: string;
  expiration: string | null;
  putCallVolumeRatio: number | null;
  putCallOpenInterestRatio: number | null;
  totalCallVolume: number;
  totalPutVolume: number;
  totalOpenInterest: number;
  unusualActivity: boolean;
  unusualNote: string | null;
  premiumFlow: number | null;
  signal: "bullish" | "bearish" | "neutral";
  interpretation: string;
}

export async function analyzeOptionsFlow(ticker: string): Promise<OptionsFlowResult> {
  const base: OptionsFlowResult = {
    available: false,
    ticker,
    expiration: null,
    putCallVolumeRatio: null,
    putCallOpenInterestRatio: null,
    totalCallVolume: 0,
    totalPutVolume: 0,
    totalOpenInterest: 0,
    unusualActivity: false,
    unusualNote: null,
    premiumFlow: null,
    signal: "neutral",
    interpretation: "Options data is unavailable for this ticker.",
  };

  try {
    const { spot, options } = await fetchChain(ticker);
    if (options.length === 0) return base;

    // Use the nearest expiration for the headline flow summary
    const nearest = [...options].sort(
      (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime()
    )[0];

    let callVol = 0;
    let putVol = 0;
    let callOi = 0;
    let putOi = 0;
    let callFlow = 0;
    let putFlow = 0;

    for (const exp of options) {
      for (const c of exp.calls) {
        callVol += c.volume ?? 0;
        callOi += c.openInterest ?? 0;
        if (spot && c.impliedVolatility != null) {
          const g = callGreeks({
            spot,
            strike: c.strike,
            timeToExpiryYears: toYears(exp.expirationDate, new Date()),
            impliedVolatility: c.impliedVolatility,
            riskFreeRate: RISK_FREE_RATE,
          });
          callFlow += g.delta * (c.volume ?? 0) * 100 * spot;
        }
      }
      for (const p of exp.puts) {
        putVol += p.volume ?? 0;
        putOi += p.openInterest ?? 0;
        if (spot && p.impliedVolatility != null) {
          const g = putGreeks({
            spot,
            strike: p.strike,
            timeToExpiryYears: toYears(exp.expirationDate, new Date()),
            impliedVolatility: p.impliedVolatility,
            riskFreeRate: RISK_FREE_RATE,
          });
          putFlow += g.delta * (p.volume ?? 0) * 100 * spot;
        }
      }
    }

    const putCallRatio = callVol > 0 ? putVol / callVol : null;
    const oiRatio = callOi > 0 ? putOi / callOi : null;
    const totalVolume = callVol + putVol;
    const premiumFlow = callFlow + putFlow; // putFlow is negative
    const flowRatio = totalVolume > 0 ? (callFlow + putFlow) / totalVolume : null;

    // Unusual activity heuristic (free feeds don't expose 20-day history,
    // so we flag based on today's chain shape):
    //  1. extreme put/call skew
    //  2. very high volume relative to open interest (fresh positioning)
    //  3. heavy concentration in a single strike
    const unusualReasons: string[] = [];
    if (putCallRatio != null && putCallRatio > 2.5) unusualReasons.push("extreme put/call volume skew");
    if (putCallRatio != null && putCallRatio < 0.4) unusualReasons.push("extreme call-heavy volume skew");
    const totalOi = callOi + putOi;
    if (totalOi > 0 && totalVolume / totalOi > 0.35)
      unusualReasons.push(`volume is ${(totalVolume / totalOi).toFixed(2)}x open interest`);

    let unusualActivity = unusualReasons.length > 0;
    let unusualNote: string | null = null;
    if (unusualActivity) {
      unusualNote =
        `Unusual options activity detected: ${unusualReasons.join(", ")}. ` +
        "This uses today's free chain data (Yahoo doesn't expose 20-day history), so treat it as a heuristic flag.";
    }

    // Beginner interpretation
    let signal: "bullish" | "bearish" | "neutral";
    let interpretation: string;
    if (putCallRatio != null && putCallRatio > 1.2) {
      signal = "bearish";
      interpretation =
        `Put/call volume ratio is ${putCallRatio.toFixed(2)} (> 1.2) — traders are buying more puts than calls, ` +
        "a classic hedging / bearish posture. It can also mean institutional hedging rather than outright selling.";
    } else if (putCallRatio != null && putCallRatio < 0.6) {
      signal = "bullish";
      interpretation =
        `Put/call volume ratio is ${putCallRatio.toFixed(2)} (< 0.6) — call buying dominates, ` +
        "suggesting traders expect upside. Crowded bullish flow can sometimes mark a short-term top.";
    } else if (flowRatio != null && flowRatio > 0.02) {
      signal = "bullish";
      interpretation =
        `Put/call volume is balanced (${putCallRatio?.toFixed(2)}), but net delta-dollar flow is positive ` +
        "(more call premium being paid for upside exposure than put premium for downside protection).";
    } else if (flowRatio != null && flowRatio < -0.02) {
      signal = "bearish";
      interpretation =
        `Put/call volume is balanced (${putCallRatio?.toFixed(2)}), but net delta-dollar flow is negative ` +
        "(more put premium being paid for downside protection).";
    } else {
      signal = "neutral";
      interpretation =
        `Put/call volume ratio is ${putCallRatio != null ? putCallRatio.toFixed(2) : "n/a"} — options activity is ` +
        "balanced with no dominant directional bias.";
    }

    return {
      ...base,
      available: true,
      expiration: nearest.expirationDate.toISOString().slice(0, 10),
      putCallVolumeRatio: putCallRatio,
      putCallOpenInterestRatio: oiRatio,
      totalCallVolume: callVol,
      totalPutVolume: putVol,
      totalOpenInterest: callOi + putOi,
      unusualActivity,
      unusualNote,
      premiumFlow,
      signal,
      interpretation,
    };
  } catch (err) {
    logger.warn({ err, ticker }, "Options flow unavailable");
    return base;
  }
}

// ── Greeks snapshot (gamma / delta / charm) ──────────────────────────────────

export interface GreeksSnapshot {
  available: boolean;
  ticker: string;
  spot: number | null;
  expiration: string | null;
  strike: number | null;
  call: { delta: number; gamma: number; charm: number } | null;
  put: { delta: number; gamma: number; charm: number } | null;
  explanation: string;
  signal: "bullish" | "bearish" | "neutral";
  signalNote: string;
}

export async function getGreeksSnapshot(ticker: string): Promise<GreeksSnapshot> {
  const base: GreeksSnapshot = {
    available: false,
    ticker,
    spot: null,
    expiration: null,
    strike: null,
    call: null,
    put: null,
    explanation: "Greeks data is unavailable for this ticker.",
    signal: "neutral",
    signalNote: "No options data.",
  };

  try {
    const { spot, options } = await fetchChain(ticker);
    if (options.length === 0 || spot == null) return base;

    // Skip zero/near-zero DTE expirations (e.g. contracts expiring today) —
    // Black-Scholes collapses to intrinsic-only at T≈0 (call delta 0, put
    // delta ±1, gamma 0), which is mathematically correct but useless.
    const now = new Date();
    const meaningful = options.filter((o) => toYears(o.expirationDate, now) >= 1 / 365);
    const pool = meaningful.length > 0 ? meaningful : options;
    const nearest = [...pool].sort(
      (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime()
    )[0];

    // ATM strike = closest to spot
    const allStrikes = [
      ...nearest.calls.map((c) => c.strike),
      ...nearest.puts.map((p) => p.strike),
    ];
    if (allStrikes.length === 0) return base;
    const strike = allStrikes.reduce((a, b) =>
      Math.abs(a - spot) < Math.abs(b - spot) ? a : b
    );

    const expiry = nearest.expirationDate;
    const T = toYears(expiry, new Date());

    const callContract = nearest.calls.find((c) => c.strike === strike);
    const putContract = nearest.puts.find((p) => p.strike === strike);

    const call = callContract?.impliedVolatility != null
      ? callGreeks({
          spot,
          strike,
          timeToExpiryYears: T,
          impliedVolatility: callContract.impliedVolatility,
          riskFreeRate: RISK_FREE_RATE,
        })
      : null;
    const put = putContract?.impliedVolatility != null
      ? putGreeks({
          spot,
          strike,
          timeToExpiryYears: T,
          impliedVolatility: putContract.impliedVolatility,
          riskFreeRate: RISK_FREE_RATE,
        })
      : null;

    // Signal: combine ATM call vs put delta magnitude and gamma
    let signal: "bullish" | "bearish" | "neutral";
    let signalNote: string;
    if (call && put) {
      const callPower = call.delta;
      const putPower = Math.abs(put.delta);
      if (callPower > putPower + 0.08) {
        signal = "bullish";
        signalNote =
          "ATM calls carry more delta than ATM puts — the market's short-term option positioning leans bullish.";
      } else if (putPower > callPower + 0.08) {
        signal = "bearish";
        signalNote =
          "ATM puts carry more delta than ATM calls — the market's short-term option positioning leans bearish (more downside hedging).";
      } else {
        signal = "neutral";
        signalNote = "ATM call and put deltas are roughly balanced — no strong directional tilt in option positioning.";
      }
    } else {
      signal = "neutral";
      signalNote = "Insufficient data to read option positioning.";
    }

    const explanation =
      `Greeks are computed with the Black-Scholes model using the nearest expiration (${expiry.toISOString().slice(0, 10)}) ` +
      `at the ATM strike $${strike.toFixed(2)}. ` +
      `Call: delta ${call?.delta.toFixed(2) ?? "n/a"}, gamma ${call?.gamma.toFixed(3) ?? "n/a"}, charm ${call?.charm.toFixed(4) ?? "n/a"}. ` +
      `Put: delta ${put?.delta.toFixed(2) ?? "n/a"}, gamma ${put?.gamma.toFixed(3) ?? "n/a"}, charm ${put?.charm.toFixed(4) ?? "n/a"}. ` +
      "Delta ≈ how many shares each contract mimics; gamma ≈ how fast delta changes; charm ≈ how much delta decays per day.";

    return {
      available: true,
      ticker,
      spot,
      expiration: expiry.toISOString().slice(0, 10),
      strike,
      call: call ? { delta: call.delta, gamma: call.gamma, charm: call.charm } : null,
      put: put ? { delta: put.delta, gamma: put.gamma, charm: put.charm } : null,
      explanation,
      signal,
      signalNote,
    };
  } catch (err) {
    logger.warn({ err, ticker }, "Greeks unavailable");
    return base;
  }
}

// ── GEX / net flow (SPX, VIX, SPY…) ─────────────────────────────────────────

export interface GexPoint {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callFlow: number;
  putFlow: number;
  netFlow: number;
  openInterest: number;
}

export interface GexData {
  available: boolean;
  symbol: string;
  spot: number | null;
  expirations: number;
  netGex: number;
  gammaFlip: number | null;
  callFlowTotal: number;
  putFlowTotal: number;
  netFlowTotal: number;
  points: GexPoint[];
  /** Strikes with meaningful net GEX — bar set for the gamma chart. */
  gexChart?: GexPoint[];
  /** Strikes with meaningful net flow — bar set for the flow chart. */
  flowChart?: GexPoint[];
  signal: "bullish" | "bearish" | "neutral";
  explanation: string;
  /** Strike with the largest positive call gamma (dealers short → upside resistance). */
  callWall: number | null;
  /** Strike with the largest negative put gamma (dealers long → downside support). */
  putWall: number | null;
  /** Beginner-friendly plain-English reading of the signal + the walls. */
  signalExplanation: string;
}

/**
 * Compute per-strike gamma exposure (GEX) and net delta-dollar flow.
 *
 * Convention: market makers are assumed short calls (call GEX negative) and
 * long puts (put GEX positive). Positive net GEX ⇒ dealers are long gamma and
 * dampen price moves; negative net GEX ⇒ dealers are short gamma and can
 * amplify them. Net flow = Σ(delta × volume × 100 × spot) per side.
 */
export async function getGexData(symbol: string, maxExpirations = 8): Promise<GexData> {
  const base: GexData = {
    available: false,
    symbol,
    spot: null,
    expirations: 0,
    netGex: 0,
    gammaFlip: null,
    callFlowTotal: 0,
    putFlowTotal: 0,
    netFlowTotal: 0,
    points: [],
    signal: "neutral",
    explanation: "GEX data is unavailable for this symbol.",
    callWall: null,
    putWall: null,
    signalExplanation: "",
  };

  try {
    const { spot, options } = await fetchChain(symbol);
    if (options.length === 0 || spot == null) return base;

    const now = new Date();
    const meaningfulExps = [...options].filter((o) => toYears(o.expirationDate, now) >= 1 / 365);
    const recent = (meaningfulExps.length > 0 ? meaningfulExps : [...options])
      .sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime())
      .slice(0, maxExpirations);

    // Per-strike aggregation across the selected expirations
    const strikeMap = new Map<number, GexPoint>();

    // CBOE's `iv` field is unreliable: unquoted strikes report exactly 0 and
    // near-dated dailies often report nonsense (0.1% or 500%). Sanitize to a
    // sane band and fall back to a flat 18% vol — the GEX profile shape is
    // driven by the OI distribution, so a flat-vol approximation is standard.
    const FALLBACK_IV = 0.18;
    const saneIV = (iv: number | null | undefined): number =>
      typeof iv === "number" && iv >= 0.02 && iv <= 2 ? iv : FALLBACK_IV;

    for (const exp of recent) {
      const T = toYears(exp.expirationDate, now);
      for (const c of exp.calls) {
        if (c.strike <= 0 || !c.impliedVolatility) continue;
        const g = callGreeks({
          spot,
          strike: c.strike,
          timeToExpiryYears: T,
          impliedVolatility: saneIV(c.impliedVolatility),
          riskFreeRate: RISK_FREE_RATE,
        });
        const oi = c.openInterest ?? 0;
        const vol = c.volume ?? 0;
        const point = strikeMap.get(c.strike) ?? {
          strike: c.strike,
          callGex: 0,
          putGex: 0,
          netGex: 0,
          callFlow: 0,
          putFlow: 0,
          netFlow: 0,
          openInterest: 0,
        };
        // Naive dealer GEX (SqueezeMetrics convention): call gamma positive,
        // put gamma negative. Dollar gamma per 1% move:
        //   Γ × OI × $100 multiplier × S² × 0.01
        point.callGex += g.gamma * oi * 100 * spot * spot * 0.01;
        point.callFlow += g.delta * vol * 100 * spot;
        point.openInterest += oi;
        strikeMap.set(c.strike, point);
      }
      for (const p of exp.puts) {
        if (p.strike <= 0 || !p.impliedVolatility) continue;
        const g = putGreeks({
          spot,
          strike: p.strike,
          timeToExpiryYears: T,
          impliedVolatility: saneIV(p.impliedVolatility),
          riskFreeRate: RISK_FREE_RATE,
        });
        const oi = p.openInterest ?? 0;
        const vol = p.volume ?? 0;
        const point = strikeMap.get(p.strike) ?? {
          strike: p.strike,
          callGex: 0,
          putGex: 0,
          netGex: 0,
          callFlow: 0,
          putFlow: 0,
          netFlow: 0,
          openInterest: 0,
        };
        point.putGex -= g.gamma * oi * 100 * spot * spot * 0.01;
        point.putFlow += g.delta * vol * 100 * spot;
        point.openInterest += oi;
        strikeMap.set(p.strike, point);
      }
    }

    const points = [...strikeMap.values()]
      .map((p) => ({
        ...p,
        netGex: p.callGex + p.putGex,
        netFlow: p.callFlow + p.putFlow,
      }))
      .sort((a, b) => a.strike - b.strike);

    const netGex = points.reduce((a, b) => a + b.netGex, 0);
    const callFlowTotal = points.reduce((a, b) => a + b.callFlow, 0);
    const putFlowTotal = points.reduce((a, b) => a + b.putFlow, 0);
    const netFlowTotal = callFlowTotal + putFlowTotal;

    // Gamma flip: strike where cumulative net GEX crosses zero. Noise at far
    // wings produces spurious crossings, so consider only crossings near the
    // traded band and report the one closest to spot.
    let gammaFlip: number | null = null;
    {
      const lo = spot * 0.88;
      const hi = spot * 1.12;
      let cumulative = 0;
      let prevSign = Math.sign(points[0]?.netGex ?? 0);
      let best: number | null = null;
      for (const p of points) {
        cumulative += p.netGex;
        if (p.strike >= lo && p.strike <= hi && Math.sign(cumulative) !== prevSign && prevSign !== 0) {
          if (best == null || Math.abs(p.strike - spot) < Math.abs(best - spot)) {
            best = p.strike;
          }
        }
        if (cumulative !== 0) prevSign = Math.sign(cumulative);
      }
      gammaFlip = best;
    }

    // Call wall = strike with the largest positive call gamma exposure: dealers
    // are short those calls, so they must sell into strength → upside
    // resistance. Put wall = strike with the largest negative put gamma
    // exposure: dealers are long those puts, so they buy into weakness →
    // downside support.
    let callWall: number | null = null;
    let putWall: number | null = null;
    {
      let maxCall = -Infinity;
      let minPut = Infinity;
      for (const p of points) {
        if (p.callGex > maxCall) {
          maxCall = p.callGex;
          callWall = p.strike;
        }
        if (p.putGex < minPut) {
          minPut = p.putGex;
          putWall = p.strike;
        }
      }
      if (!isFinite(maxCall) || maxCall <= 0) callWall = null;
      if (!isFinite(minPut) || minPut >= 0) putWall = null;
    }

    let signal: "bullish" | "bearish" | "neutral";
    let explanation: string;
    if (netGex < 0) {
      signal = "bearish";
      explanation =
        `Dealer net gamma is negative ($${(netGex / 1e6).toFixed(0)}M) — market makers are short gamma and may ` +
        "amplify sharp moves in either direction. Expect elevated volatility. Net delta-dollar flow is " +
        `${netFlowTotal >= 0 ? "positive (call buying dominant)" : "negative (put buying dominant)"}.`;
    } else if (netGex > 0) {
      signal = "neutral";
      explanation =
        `Dealer net gamma is positive ($${(netGex / 1e6).toFixed(0)}M) — market makers are long gamma and tend to ` +
        "dampen sharp moves (pinning near high-gamma strikes). Net delta-dollar flow is " +
        `${netFlowTotal >= 0 ? "positive (call buying dominant)" : "negative (put buying dominant)"}.`;
    } else {
      signal = "neutral";
      explanation = "Net dealer gamma is near zero — no strong positioning tilt.";
    }

    const signalExplanation =
      signal === "bearish"
        ? "Dealers are short gamma / put buying dominates — sharp moves can be amplified in either direction. The call wall above is resistance; the put wall below is support (risk-off / bearish)."
        : "Dealers are long gamma (or net gamma is flat) — they tend to dampen sharp moves and pin price near high-gamma strikes. The call wall above is resistance; the put wall below is support (neutral).";

    // Keep the charts readable: focus on strikes within ±6% of spot and drop
    // sub-pixel noise bars (a few billion-dollar strikes otherwise flatten
    // hundreds of $10M bars into invisibility). Gamma and flow have different
    // shapes — a strike can carry billions of directional flow while its
    // call/put gamma nets to ~zero — so each chart gets its own bar set,
    // filtered by significance on its own metric.
    const lo = spot * 0.94;
    const hi = spot * 1.06;
    // Strikes with zero open interest are listed but empty — drawing them
    // just adds invisible bars that wreck the visual proportions.
    const band = points.filter(
      (p) => p.strike >= lo && p.strike <= hi && p.openInterest > 0
    );
    let chartPoints = band.length > 0 ? band : points;
    let gexChart = chartPoints;
    let flowChart = chartPoints;
    if (band.length > 0) {
      const maxGex = Math.max(...band.map((p) => Math.abs(p.netGex)), 1);
      const maxFlow = Math.max(...band.map((p) => Math.abs(p.netFlow)), 1);
      // Guard: never filter down to a handful of bars.
      const gexSig = band.filter((p) => Math.abs(p.netGex) >= maxGex * 0.02);
      const flowSig = band.filter((p) => Math.abs(p.netFlow) >= maxFlow * 0.01);
      gexChart = gexSig.length >= 12 ? gexSig : band;
      flowChart = flowSig.length >= 12 ? flowSig : band;
      chartPoints = gexChart;
    }

    return {
      available: true,
      symbol,
      spot,
      expirations: recent.length,
      netGex,
      gammaFlip,
      callFlowTotal,
      putFlowTotal,
      netFlowTotal,
      points: chartPoints,
      gexChart,
      flowChart,
      signal,
      explanation,
      callWall,
      putWall,
      signalExplanation,
    };
  } catch (err) {
    logger.warn({ err, symbol }, "GEX data unavailable");
    return base;
  }
}