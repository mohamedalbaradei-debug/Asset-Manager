/**
 * Self-contained VADER-style sentiment engine.
 *
 * This is a TypeScript port of the core VADER (Valence Aware Dictionary and
 * sEntiment Reasoner) algorithm — a rule-based, lexicon-driven model tuned for
 * social media style text. It is deliberately dependency-free so it can never
 * break the esbuild bundle or the app's "no required secrets" rule.
 *
 * It combines a valence lexicon with simple linguistic heuristics:
 *   - negations flip the valence (e.g. "not strong")
 *   - booster words amplify or dampen ("very", "extremely", "somewhat")
 *   - ALL-CAPS words and exclamation marks add intensity
 *   - the final compound score is normalized to [-1, 1]
 */

// Valence lexicon: word -> score in [-4, 4]
const LEXICON: Record<string, number> = {
// ── Finance-specific terms ──
  bullish: 3.5, bearish: -3.5, rally: 2.8, rallying: 2.8, surged: 3.0, surge: 2.6, surging: 2.6, soared: 3.2,
  soar: 3.0, plunge: -3.2, plunged: -3.4, plunging: -3.0, slump: -2.8, slumps: -2.8, crater: -3.4, craters: -3.4,
  crashed: -3.6, crash: -3.4, beat: 2.8, beats: 2.8, beating: 2.6, miss: -2.6, missed: -2.6, misses: -2.6,
  upgrade: 2.6, upgrades: 2.6, upgraded: 2.6, downgrade: -2.6, downgrades: -2.6, downgraded: -2.6, outperform: 3.0, outperforming: 3.0,
  underperform: -3.0, underperforming: -3.0, buy: 2.4, buys: 2.2, buying: 2.2, sell: -2.4, sells: -2.2, selling: -2.2,
  hold: 0.6, overvalued: -2.4, undervalued: 2.4, expensive: -1.6, cheap: 1.2, earnings: 0.5, revenue: 0.5, profit: 2.2,
  profits: 2.2, profitable: 2.4, losses: -2.4, loss: -2.2, loses: -2.0, losing: -2.0, turnaround: 2.4, recovering: 2.6,
  recovery: 2.4, rebound: 2.6, rebounding: 2.6, bounce: 2.0, bounced: 2.2, correction: -1.8, recession: -3.6, recessionary: -3.4,
  inflation: -1.2, deflation: -1.6, growth: 2.2, growing: 2.0, declined: -2.2, decline: -2.0, declines: -2.0, declining: -2.0,
  rose: 2.2, rises: 2.2, rising: 2.0, fell: -2.4, falling: -2.2, falls: -2.2, jump: 2.4, jumped: 2.4,
  jumps: 2.2, drop: -2.2, dropped: -2.4, drops: -2.0, breaking: -2.0, break: 0.4, record: 1.8, best: 2.8,
  worst: -2.8, strong: 2.0, stronger: 2.2, weakest: -2.2, weak: -1.6, weaker: -1.8, stable: 1.0, stabilizing: 1.2,
  volatility: -1.4, volatile: -1.6, risk: -1.2, risky: -1.6, safe: 1.4, safer: 1.6, bullishness: 3.2, bearishness: -3.2,
  momentum: 1.0, outperformed: 3.0, underperformed: -3.0, dividend: 1.2, buyback: 1.6, guidance: 0.6, outlook: 0.8, warning: -2.4,
  warns: -2.4, warned: -2.4, fears: -2.6, fear: -2.6, panic: -3.2, panics: -3.2, selloff: -3.0, bubble: -2.4,
  froth: -1.8, squeeze: -1.4, squeezed: -1.6, capitulation: -3.0, breakout: 2.8, breakouts: 2.8, beaten: -2.6, battered: -2.6,
  robust: 2.2, sluggish: -1.8, accelerating: 2.0, slowing: -1.8, slowdown: -2.0, boom: 2.6, bust: -2.6, expansion: 2.0,
  contraction: -2.0, margin: 0.6, margins: 0.8, ratecut: 2.2, ratehike: -2.0, hawkish: -2.0, dovish: 1.8, tapering: -1.4,
  stimulus: 2.0, bailout: -1.4, bankruptcy: -3.8, bankrupt: -3.8, lawsuit: -2.6, sued: -2.8, fines: -2.4, fined: -2.4,
  probe: -1.6, investigated: -1.8, investigation: -1.8, deal: 1.6, merger: 1.2, acquisition: 1.2, acquired: 1.4, partner: 1.2,
  partnership: 1.4, contract: 1.2, won: 2.6, layoffs: -3.2, layoff: -3.2, cutting: -1.6, cuts: -1.4, hiring: 1.6,
  hired: 1.4, resume: 1.0, resumes: 1.0, halt: -2.0, halted: -2.0, paused: -1.4, resumed: 1.2, delays: -1.6,
  delay: -1.6, postponed: -1.6, approved: 2.0, approval: 1.8, rejected: -2.0, reject: -1.8, flop: -3.0, launched: 1.4,
  launches: 1.4, launch: 1.4, unveils: 1.6, unveiled: 1.6, recall: -2.8, recalled: -2.8, returns: 1.4, return: 1.4,
  strongest: 2.6, biggest: 1.8, largest: 1.4, smallest: -1.2, cash: 1.0, debt: -1.2, leverage: -1.0, quality: 1.8,
  speculative: -0.8, manipulation: -2.6, fraudulent: -3.8, fraud: -3.8, transparent: 1.8, opaque: -1.4, governance: 0.8, activist: 1.2,
  good: 1.9, great: 3.1, excellent: 3.1, amazing: 3.2, awesome: 3.0, fantastic: 3.0, wonderful: 2.9, superb: 3.0,
  impressive: 2.6, outstanding: 3.0, solid: 1.9, positive: 2.0, better: 1.8, happy: 2.6, glad: 2.2, love: 3.0,
  loved: 3.0, win: 2.4, winner: 2.4, winning: 2.4, success: 2.6, successful: 2.6, succeed: 2.4, victory: 2.8,
  celebrate: 2.6, breakthrough: 2.8, thriving: 2.8, promising: 2.2, encouraging: 2.4, upbeat: 2.2, optimistic: 2.0, confidence: 2.0,
  confident: 2.0, strengthen: 1.6, improve: 1.6, improving: 1.8, improved: 1.8, gain: 1.6, gains: 1.6, gained: 1.6,
  advance: 1.6, advances: 1.6, advanced: 1.6, boost: 2.0, boosts: 2.0, raised: 1.6, raising: 1.6, enhance: 1.6,
  enhancing: 1.6, favorable: 1.8, favourable: 1.8, opportunity: 1.8, opportunities: 1.8, benefit: 1.6, benefits: 1.6, fruitful: 2.2,
  productive: 1.8, wow: 3.0, fabulous: 3.0, remarkable: 2.8, exceptional: 2.8, grateful: 2.4, thankful: 2.2, proud: 2.4,
  delighted: 2.8, thrilled: 3.0, joy: 2.6, joyful: 2.8, satisfied: 2.0, satisfaction: 2.0, useful: 1.4, helpful: 1.6,
  beneficial: 1.8, progress: 1.6, bad: -2.5, terrible: -3.4, awful: -3.2, horrible: -3.4, poor: -2.0, negative: -2.0,
  worse: -2.2, sad: -2.2, unhappy: -2.4, hate: -2.8, hated: -2.8, lose: -2.2, lost: -2.4, fail: -2.4,
  failed: -2.4, failure: -2.6, fails: -2.4, defeat: -2.4, defeated: -2.6, disaster: -3.6, crisis: -3.4, catastrophe: -3.8,
  catastrophic: -3.8, tragic: -3.0, devastating: -3.6, severe: -2.4, seriously: -2.2, serious: -2.0, threat: -2.4, threatens: -2.4,
  worried: -2.2, worry: -2.0, worries: -2.0, anxious: -2.2, afraid: -2.2, scared: -2.4, panicked: -3.2, problem: -2.0,
  problems: -2.0, trouble: -2.2, troubled: -2.2, struggling: -2.4, struggle: -2.2, fall: -2.0, collapse: -3.6, collapsed: -3.6,
  damage: -2.6, damaged: -2.6, harm: -2.4, harmed: -2.4, hurt: -2.4, hurts: -2.4, painful: -2.6, pain: -2.2,
  suffering: -2.6, suffers: -2.6, suffer: -2.4, disappointing: -2.6, disappoints: -2.6, disappoint: -2.4, upset: -2.2, upsetting: -2.4,
  angry: -2.4, anger: -2.4, furious: -3.0, frustrated: -2.4, frustration: -2.4, enraged: -3.0, outraged: -3.0, outrage: -2.8,
  violence: -3.0, violent: -3.0, abuse: -3.2, abused: -3.2, corruption: -3.2, corrupt: -3.2, scandal: -3.0, controversial: -2.0,
  controversy: -2.0, conflict: -2.6, war: -3.2, wars: -3.2, emergency: -2.8, dangers: -2.6, danger: -2.6, dangerous: -2.6,
  hazard: -2.6, hazardous: -2.8, toxic: -2.8, poison: -3.0, killed: -3.4, kills: -3.2, kill: -3.0, death: -3.4,
  died: -3.2, dies: -3.0, sick: -2.4, illness: -2.6, disease: -2.6, victim: -2.8, victims: -2.8, exploited: -2.6,
  exploitation: -2.8, unfair: -2.0, unjust: -2.2, injustice: -2.6, inequality: -2.4, discrimination: -2.8, racism: -3.0, hateful: -3.0,
  hopeless: -2.8, hopelessness: -2.8, miserable: -3.0, misery: -3.0, worsened: -2.2, worsening: -2.4, deteriorating: -2.6, deteriorates: -2.6,
  damages: -2.6, announced: 0.4, announces: 0.4, report: 0.3, reports: 0.3, reported: 0.4, says: 0.2, said: 0.2,
  according: 0.3, update: 0.2, updated: 0.2, expected: 0.3, expects: 0.3, plan: 0.4, plans: 0.4, planning: 0.4,
  set: 0.2, sets: 0.2, target: 0.4, targets: 0.4, price: 0.2, shares: 0.2, stock: 0.2, stocks: 0.2,
  market: 0.2, markets: 0.2, trading: 0.2, traded: 0.2, opens: 0.2, closed: 0.2, closes: 0.2, session: 0.2,
  day: 0.1, week: 0.1, month: 0.1, year: 0.1, today: 0.1, yesterday: 0.1, tomorrow: 0.1, first: 0.2,
  last: 0.1, latest: 0.3, new: 0.2, news: 0.3, review: 0.3, reviewed: 0.3, preview: 0.3, forecast: 0.4,
  forecasts: 0.4, quarter: 0.3, quarterly: 0.3, annual: 0.3, fiscal: 0.3, results: 0.3, financial: 0.3, finance: 0.3,
  economic: 0.3, economy: 0.3, gdp: 0.3, unemployment: -0.8, jobs: 0.6, employment: 0.6, wages: 0.8, payrolls: 0.8,
  consumer: 0.4, spending: 0.6, retail: 0.5, sales: 0.6, manufacturing: 0.4, industrial: 0.4, production: 0.4, services: 0.4,
  sector: 0.3, sectors: 0.3, industry: 0.3, corporate: 0.3, federal: 0.3, fed: 0.2, reserve: 0.2, central: 0.2,
  bank: 0.2, fomc: 0.3, minutes: 0.2, statement: 0.2, policy: 0.3, rates: 0.3, yields: 0.3, treasury: 0.3,
  bonds: 0.3, bond: 0.3, yield: 0.3, dollar: 0.2, currency: 0.2, euro: 0.2, eurozone: 0.2, china: 0.2,
  chinese: 0.2, global: 0.3, world: 0.3, international: 0.3, asia: 0.2, europe: 0.2, japan: 0.2, germany: 0.2,
  uk: 0.2,
};


const NEGATIONS = new Set([
  "not", "no", "never", "neither", "cannot", "can't", "cant", "won't",
  "wont", "don't", "dont", "doesn't", "doesnt", "didn't", "didnt",
  "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt", "weren't",
  "werent", "haven't", "havent", "hasn't", "hasnt", "hadn't", "hadnt",
  "without", "nothing", "nowhere", "nobody", "none", "never", "hardly",
  "scarcely", "barely", "less", "least", "minus",
]);

const BOOSTERS: Record<string, number> = {
  very: 1.3, extremely: 1.5, absolutely: 1.5, completely: 1.3, totally: 1.4, really: 1.2, so: 1.1, super: 1.4,
  ultra: 1.5, incredibly: 1.5, hugely: 1.4, massively: 1.4, immensely: 1.4, particularly: 1.2, especially: 1.3, remarkably: 1.3,
  spectacularly: 1.5, utterly: 1.4, unquestionably: 1.5, certainly: 1.2, definitely: 1.2, clearly: 1.2, obviously: 1.1, highly: 1.3,
  severely: 1.4, desperately: 1.4, devastatingly: 1.5, catastrophically: 1.5, somewhat: 0.6, slightly: 0.6, a_little: 0.6, a_bit: 0.6,
  barely: 0.6, hardly: 0.6, kind_of: 0.6, sort_of: 0.6, a_tad: 0.6, mildly: 0.7, modestly: 0.7, moderately: 0.8,
  marginally: 0.7, nearly: 0.8, almost: 0.8, less: 0.7, fairly: 0.8, relatively: 0.8, quite: 1.1, pretty: 1.0,
  rather: 1.0,
};

const SPECIAL_CASE = ["kinda", "kindof", "kinda"];

/** Normalize the raw text into tokens we can score. */
function normalize(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface LexiconToken {
  word: string;
  valence: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Score a single token, applying VADER-style rules around it. */
function scoreToken(tokens: string[], i: number, lexiconTokens: LexiconToken[]): number {
  const raw = tokens[i];
  const original = raw.replace(/'/g, "");

  // Only score tokens present in the lexicon
  let valence = LEXICON[original];
  if (valence == null) return 0;

  const isAllCaps = /[A-Z]/.test(raw) && raw === raw.toUpperCase() && /[a-zA-Z]/.test(raw);

  // 1. Negation check: look back up to 3 tokens
  let negated = false;
  for (let j = Math.max(0, i - 3); j < i; j++) {
    const w = tokens[j];
    if (NEGATIONS.has(w)) {
      negated = true;
      break;
    }
    if (w === "but" || w === "however") break; // contrast stops negation
  }
  if (negated) valence = -valence * 0.85;

  // 2. Booster / dampener: look back one token
  const prev = tokens[i - 1];
  if (prev && prev in BOOSTERS) {
    const factor = BOOSTERS[prev];
    if (valence < 0) valence *= factor;
    else if (valence > 0) valence *= factor;
  }
  // stacked boosters
  const prev2 = tokens[i - 2];
  if (prev2 && prev2 in BOOSTERS) {
    valence *= 0.95;
  }

  // 3. All-caps emphasis
  if (isAllCaps && original.length > 1) {
    if (valence > 0) valence += 0.8;
    else valence -= 0.8;
  }

  // 4. Exclamation emphasis
  const trailing = raw.match(/!+$/);
  if (trailing) {
    const boost = Math.min(2, 0.292 * trailing[0].length);
    if (valence > 0) valence += boost;
    else valence -= boost;
  }

  // 5. Question emphasis (mild)
  const q = raw.match(/\?+/);
  if (q && q[0].length > 1) {
    if (valence > 0) valence += 0.5;
    else valence -= 0.5;
  }

  return valence;
}

/** Normalize a score to [-1, 1] using VADER's compound function. */
function normalizeScore(score: number): number {
  const alpha = 15;
  if (score === 0) return 0;
  return score / Math.sqrt(score * score + alpha);
}

export interface SentimentResult {
  compound: number;
  positive: number;
  neutral: number;
  negative: number;
  label: "Bullish" | "Neutral" | "Bearish";
  explanation: string;
}

/**
 * Run VADER-style sentiment analysis on a piece of text.
 * Returns a compound score in [-1, 1] plus Bullish/Neutral/Bearish label.
 */
export function analyzeSentiment(text: string): SentimentResult {
  const normalized = normalize(text);
  const tokens = tokenize(normalized);

  if (tokens.length === 0) {
    return { compound: 0, positive: 0, neutral: 1, negative: 0, label: "Neutral", explanation: "No analyzable text." };
  }

  let pos = 0;
  let neg = 0;
  let total = 0;

  for (let i = 0; i < tokens.length; i++) {
    const s = scoreToken(tokens, i, []);
    if (s === 0) continue;
    total++;
    if (s > 0) pos += s;
    else neg += Math.abs(s);
  }

  const compound = normalizeScore(pos - neg);
  const posPct = total > 0 ? pos / (pos + neg + (total - pos - neg) || 1) : 0;

  // VADER-style proportional + normalization
  const scored = total > 0 ? pos + neg : 1;
  const positive = pos / scored;
  const negative = neg / scored;
  const neutral = total > 0 ? (total - pos - neg) / total : 1;
  const neutralAdj = Math.max(0, 1 - positive - negative);

  let label: SentimentResult["label"];
  if (compound >= 0.05) label = "Bullish";
  else if (compound <= -0.05) label = "Bearish";
  else label = "Neutral";

  const explanation =
    label === "Bullish"
      ? `Overall tone is bullish (compound ${compound.toFixed(2)}) — headlines skew positive.`
      : label === "Bearish"
        ? `Overall tone is bearish (compound ${compound.toFixed(2)}) — headlines skew negative.`
        : `Overall tone is neutral (compound ${compound.toFixed(2)}) — a balanced mix of positive and negative coverage.`;

  return { compound, positive, neutral: neutralAdj, negative, label, explanation };
}

/** Aggregate sentiment across many headlines. */
export function aggregateSentiment(texts: string[]): {
  compound: number;
  label: "Bullish" | "Neutral" | "Bearish";
  explanation: string;
  perItem: Array<{ title: string; score: number; label: string }>;
} {
  const perItem = texts.map((t) => {
    const r = analyzeSentiment(t);
    return { title: t, score: r.compound, label: r.label };
  });

  const scored = perItem.filter((x) => x.score !== 0);
  const compound =
    scored.length > 0 ? scored.reduce((a, b) => a + b.score, 0) / scored.length : 0;

  let label: "Bullish" | "Neutral" | "Bearish";
  if (compound >= 0.1) label = "Bullish";
  else if (compound <= -0.1) label = "Bearish";
  else label = "Neutral";

  const bullishCount = scored.filter((x) => x.label === "Bullish").length;
  const bearishCount = scored.filter((x) => x.label === "Bearish").length;

  const explanation =
    label === "Bullish"
      ? `${bullishCount} of ${scored.length || texts.length} headlines are bullish vs ${bearishCount} bearish — net positive tone.`
      : label === "Bearish"
        ? `${bearishCount} of ${scored.length || texts.length} headlines are bearish vs ${bullishCount} bullish — net negative tone.`
        : `Sentiment is balanced — ${bullishCount} bullish vs ${bearishCount} bearish headlines.`;

  return { compound, label, explanation, perItem };
}