import { logger } from "./logger";

/**
 * AI analyst: Groq (free Llama) report generation + a multi-provider chat
 * proxy for the user-supplied-key chat box.
 *
 * Graceful degradation is mandatory:
 *   - no GROQ_API_KEY → AI report is skipped, raw data still shown
 *   - a failed AI call → never crashes the app
 *   - user API keys are used in-memory only, never logged or persisted
 */

const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** Strip reasoning blocks (e.g. Qwen's <think>…</think>) from model output. */
function cleanContent(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Google Gemini exposes an OpenAI-compatible endpoint under /v1beta/openai.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Which free AI provider is configured. Gemini is preferred when present,
 * falling back to Groq. Returns null if neither key is set.
 */
function freeProvider(): "gemini" | "groq" | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

interface FreeAiConfig {
  base: string;
  model: string;
  key: string;
  provider: "gemini" | "groq";
}

function getFreeAiConfig(): FreeAiConfig | null {
  const provider = freeProvider();
  if (provider === "gemini") {
    return {
      base: GEMINI_BASE,
      model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      key: process.env.GEMINI_API_KEY as string,
      provider,
    };
  }
  if (provider === "groq") {
    return {
      base: GROQ_BASE,
      model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
      key: process.env.GROQ_API_KEY as string,
      provider,
    };
  }
  return null;
}

export interface AiReport {
  available: boolean;
  content: string | null;
  model: string | null;
  provider: string | null;
  note: string | null;
}

interface ReportContext {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  sma50: number;
  sma200: number;
  support: number;
  resistance: number;
  peRatio: number | null;
  eps: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  recommendation: string;
  traderRec: { recommendation: string; rationale: string[] };
  investorRec: { recommendation: string; rationale: string[] };
  newsSentiment: { label: string; compound: number; explanation: string } | null;
  socialSentiment: { label: string; compound: number; explanation: string } | null;
  marketInternals: { trin: number | null; trinSignal: string; liquidityAssessment: string } | null;
  optionsFlow: { signal: string; putCallVolumeRatio: number | null; interpretation: string } | null;
  fairValue: { label: string; percentDifference: number | null; targetMeanPrice: number | null } | null;
  greeks: { signal: string; signalNote: string } | null;
  macroContext: Array<{ label: string; value: string; status: string | null }>;
}

function buildSystemPrompt(ctx: ReportContext): string {
  return [
    "You are a senior investment analyst at a professional research firm.",
    `Analyze ${ctx.ticker}${ctx.companyName ? ` (${ctx.companyName})` : ""} trading at $${ctx.currentPrice.toFixed(2)}.`,
    "",
    "DATA COLLECTED:",
    `- Technicals: RSI ${ctx.rsi.toFixed(1)}, MACD ${ctx.macd.macd.toFixed(2)} vs signal ${ctx.macd.signal.toFixed(2)}, ` +
      `SMA50 ${ctx.sma50.toFixed(2)}, SMA200 ${ctx.sma200.toFixed(2)}, support ${ctx.support.toFixed(2)}, resistance ${ctx.resistance.toFixed(2)}.`,
    `- Combined recommendation (rule-based): ${ctx.recommendation}.`,
    `- Trader signal: ${ctx.traderRec.recommendation}. ${ctx.traderRec.rationale.join(" ")}`,
    `- Investor signal: ${ctx.investorRec.recommendation}. ${ctx.investorRec.rationale.join(" ")}`,
    ctx.newsSentiment ? `- News sentiment (Google News): ${ctx.newsSentiment.label} (${ctx.newsSentiment.compound.toFixed(2)}). ${ctx.newsSentiment.explanation}` : "- News sentiment: unavailable",
    ctx.socialSentiment ? `- Social sentiment (Reddit): ${ctx.socialSentiment.label} (${ctx.socialSentiment.compound.toFixed(2)}). ${ctx.socialSentiment.explanation}` : "- Social sentiment: unavailable",
    ctx.marketInternals
      ? `- Market internals: TRIN ${ctx.marketInternals.trin?.toFixed(2) ?? "n/a"} (${ctx.marketInternals.trinSignal}), liquidity: ${ctx.marketInternals.liquidityAssessment}.`
      : "- Market internals: unavailable",
    ctx.optionsFlow
      ? `- Options flow: ${ctx.optionsFlow.signal}; put/call volume ratio ${ctx.optionsFlow.putCallVolumeRatio?.toFixed(2) ?? "n/a"}. ${ctx.optionsFlow.interpretation}`
      : "- Options flow: unavailable",
    ctx.greeks ? `- Option greeks (ATM, nearest expiry): ${ctx.greeks.signal}. ${ctx.greeks.signalNote}` : "- Option greeks: unavailable",
    ctx.fairValue
      ? `- Fair value: analyst mean target $${ctx.fairValue.targetMeanPrice?.toFixed(2) ?? "n/a"}, ${ctx.fairValue.label} (${ctx.fairValue.percentDifference?.toFixed(1) ?? "n/a"}% from spot).`
      : "- Fair value: unavailable",
    `- Macro context: ${ctx.macroContext.map((m) => `${m.label} ${m.value}`).join("; ") || "unavailable"}`,
    `- Fundamentals: P/E ${ctx.peRatio?.toFixed(2) ?? "n/a"}, EPS $${ctx.eps?.toFixed(2) ?? "n/a"}, div yield ${ctx.dividendYield?.toFixed(2) ?? "n/a"}%, market cap $${ctx.marketCap ? (ctx.marketCap / 1e9).toFixed(0) + "B" : "n/a"}.`,
    "",
    "YOUR TASK:",
    "1. First write a BULLISH argument using the strongest supportive evidence.",
    "2. Then write a BEARISH argument using the strongest risk evidence.",
    "3. Act as a neutral judge: decide which argument is stronger and why.",
    "4. Give a final action: BUY / SELL / HOLD, with an ENTRY price, a STOP-LOSS, a TARGET, and a short rationale.",
    "5. Keep it suitable for a beginner (explain terms) but precise for an expert.",
    "6. Be honest about uncertainty. Never make up numbers not provided above.",
    "",
    "OUTPUT FORMAT (markdown, exactly these sections):",
    "📰 News Sentiment",
    "🐦 Social Sentiment (Reddit)",
    "📈 Technicals (including TRIN/liquidity)",
    "📊 Options Flow",
    "📋 Fundamentals & Fair Value",
    "🔮 Final Verdict",
    "⚠️ Disclaimer",
    "",
    "The Price vs EPS chart is shown separately to the user; mention it in the report but do not describe its image.",
    "End with exactly: ⚠️ This tool is for reference and educational purposes only. Not financial advice.",
  ].join("\n");
}

/**
 * Generate the full AI analyst report using the configured free provider
 * (Google Gemini preferred, else Groq). Returns available:false (never
 * throws) if no key is configured or the call fails.
 */
export async function generateAiReport(ctx: ReportContext): Promise<AiReport> {
  const cfg = getFreeAiConfig();
  if (!cfg) {
    return {
      available: false,
      content: null,
      model: null,
      provider: "ai",
      note: "AI commentary unavailable – using basic analysis. (No AI key configured — set GEMINI_API_KEY or GROQ_API_KEY.)",
    };
  }

  const { base, model, key, provider } = cfg;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(ctx) },
      { role: "user", content: `Produce the investment report for ${ctx.ticker} now.` },
    ],
    temperature: 0.4,
    max_tokens: 1800,
  });

  // Free tiers frequently return 429/503 during demand spikes; retry briefly.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body,
        signal: AbortSignal.timeout(45000),
      });

      if (res.status === 429 || res.status === 503) {
        if (attempt < maxAttempts) {
          const delay = attempt * 2500;
          logger.warn({ status: res.status, attempt, delay }, "AI report rate-limited, retrying");
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        logger.warn({ status: res.status, body: errBody.slice(0, 200) }, "AI report failed");
        return {
          available: false,
          content: null,
          model,
          provider,
          note: `AI commentary unavailable – using basic analysis. (${provider} error ${res.status}.)`,
        };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = cleanContent(data.choices?.[0]?.message?.content ?? "");
      if (!content) {
        return {
          available: false,
          content: null,
          model,
          provider,
          note: "AI commentary unavailable – using basic analysis. (Empty response.)",
        };
      }

      return { available: true, content, model, provider, note: null };
    } catch (err) {
      logger.warn({ err }, "AI report call failed");
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 2500));
        continue;
      }
    }
  }

  return {
    available: false,
    content: null,
    model,
    provider,
    note: "AI commentary unavailable – using basic analysis.",
  };
}

// ── Chat proxy (user-supplied API keys) ─────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  provider: "openai" | "anthropic" | "groq" | "deepseek" | "custom" | "gemini";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  messages: ChatMessage[];
}

const PROVIDER_DEFAULTS: Record<ChatRequest["provider"], string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  groq: GROQ_BASE,
  deepseek: "https://api.deepseek.com/v1",
  custom: "",
  gemini: GEMINI_BASE,
};

export interface ChatReply {
  ok: boolean;
  content?: string;
  error?: string;
}

/** OpenAI-compatible chat completion (works for Groq, DeepSeek, Custom, OpenAI). */
async function openAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string | undefined,
  messages: ChatMessage[]
): Promise<ChatReply> {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload: { messages: ChatMessage[]; model: string; temperature?: number; max_tokens?: number } = {
    model,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    temperature: 0.4,
    max_tokens: 1200,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `API error ${res.status}: ${body.slice(0, 160)}` };
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  const cleaned = content ? cleanContent(content) : null;
  return cleaned ? { ok: true, content: cleaned } : { ok: false, error: "Empty API response." };
}

/** Anthropic native messages API. */
async function anthropicChat(
  apiKey: string,
  model: string,
  systemPrompt: string | undefined,
  messages: ChatMessage[]
): Promise<ChatReply> {
  const url = "https://api.anthropic.com/v1/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: systemPrompt,
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Anthropic error ${res.status}: ${body.slice(0, 160)}` };
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  return text ? { ok: true, content: text } : { ok: false, error: "Empty Anthropic response." };
}

/**
 * Route a chat message to the chosen provider. The API key is passed by the
 * browser and used only in memory — it is never logged or written to disk.
 */
export async function chatWithProvider(req: ChatRequest): Promise<ChatReply> {
  if (!req.apiKey) return { ok: false, error: "Missing API key." };
  if (!req.model) return { ok: false, error: "Missing model name." };

  try {
    if (req.provider === "anthropic") {
      return await anthropicChat(req.apiKey, req.model, req.systemPrompt, req.messages);
    }
    const baseUrl = req.baseUrl || PROVIDER_DEFAULTS[req.provider];
    if (!baseUrl) return { ok: false, error: "Custom provider requires a Base URL." };
    return await openAiCompatible(baseUrl, req.apiKey, req.model, req.systemPrompt, req.messages);
  } catch (err) {
    logger.warn({ err }, "AI chat call failed");
    return { ok: false, error: "Could not reach the AI provider. Check your key, model, and network." };
  }
}

// ── Server-key message quota (tier-based per user + global cost cap) ───────

const GLOBAL_DAILY_CAP = 200; // hard ceiling protecting the shared key
const freeCounter = new Map<string, number>();

interface QuotaUser {
  id: string;
  tier?: string;
}

function aiDailyLimit(user?: QuotaUser | null): number {
  if (user?.tier === "premium") return Number(process.env.PREMIUM_AI_DAILY_LIMIT) || 50;
  return Number(process.env.FREE_AI_DAILY_LIMIT) || 5;
}

export function getFreeQuota(user?: QuotaUser | null): { configured: boolean; remaining: number; limit: number } {
  const day = new Date().toISOString().slice(0, 10);
  const limit = aiDailyLimit(user);
  const used = freeCounter.get(`${day}:${user?.id ?? "anon"}`) ?? 0;
  return {
    configured: freeProvider() !== null,
    remaining: Math.max(0, limit - used),
    limit,
  };
}

export async function freeGroqChat(
  systemPrompt: string,
  messages: ChatMessage[],
  user?: QuotaUser | null
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const quota = getFreeQuota(user);
  if (!quota.configured) {
    return { ok: false, error: "The bot's free AI key is not configured. Add your own key to chat." };
  }
  if (quota.remaining <= 0) {
    return { ok: false, error: "You've used today's AI messages on the server key. Add your own key to keep chatting." };
  }

  const day = new Date().toISOString().slice(0, 10);
  const globalUsed = freeCounter.get(day) ?? 0;
  if (globalUsed >= GLOBAL_DAILY_CAP) {
    return { ok: false, error: "Server AI capacity reached for today — try again tomorrow or use your own key." };
  }
  freeCounter.set(day, globalUsed + 1);
  freeCounter.set(`${day}:${user?.id ?? "anon"}`, (freeCounter.get(`${day}:${user?.id ?? "anon"}`) ?? 0) + 1);

  const cfg = getFreeAiConfig();
  if (!cfg) {
    return { ok: false, error: "The bot's free AI key is not configured. Add your own key to chat." };
  }

  const reply = await openAiCompatible(cfg.base, cfg.key, cfg.model, systemPrompt, messages);
  return reply;
}