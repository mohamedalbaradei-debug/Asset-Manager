// Tier limits — every quota gate in the app reads from here so flipping the
// paywall later is an env-var change, not a code change.
// Defaults keep current behavior generous while the product grows.
const num = (k: string, d: number): number => {
  const v = process.env[k];
  return v === undefined || v === "" || !isFinite(Number(v)) ? d : Number(v);
};

export interface TierLimits {
  alerts: number;
  aiMessagesPerDay: number;
  holdings: number;
  watchlist: number;
  performanceMaxDays: number;
  backtestsPerDay: number;
}

export const TIERS: Record<"free" | "premium", TierLimits> = {
  free: {
    alerts: num("FREE_ALERT_LIMIT", 3),
    aiMessagesPerDay: num("FREE_AI_DAILY_LIMIT", 5),
    holdings: num("FREE_HOLDING_LIMIT", 20),
    watchlist: num("FREE_WATCHLIST_LIMIT", 10),
    performanceMaxDays: num("FREE_PERFORMANCE_MAX_DAYS", 90),
    backtestsPerDay: num("FREE_BACKTESTS_PER_DAY", 3),
  },
  premium: {
    alerts: num("PREMIUM_ALERT_LIMIT", 100),
    aiMessagesPerDay: num("PREMIUM_AI_DAILY_LIMIT", 50),
    holdings: num("PREMIUM_HOLDING_LIMIT", 250),
    watchlist: num("PREMIUM_WATCHLIST_LIMIT", 100),
    performanceMaxDays: num("PREMIUM_PERFORMANCE_MAX_DAYS", 365),
    backtestsPerDay: num("PREMIUM_BACKTESTS_PER_DAY", 200),
  },
};

export type UserLike = { id: string; email: string; tier?: string } | null | undefined;

export function tierOf(user: UserLike): "free" | "premium" {
  return user?.tier === "premium" ? "premium" : "free";
}

export function limitsFor(user: UserLike): TierLimits {
  return TIERS[tierOf(user)];
}

/** Standard 403 payload consumed by the client to show quota UI. */
export function quotaPayload(used: number, max: number) {
  return { error: "quota_reached", quota: { used, max } };
}

/** Daily-use counter keyed by user id (or IP) — resets naturally via `day`. */
export class DailyCounter {
  private hits = new Map<string, { day: string; count: number }>();
  private timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.hits.clear(), 24 * 3600_000);
    this.timer.unref?.();
  }

  /** Returns true when allowed (and increments), false when over the cap. */
  tryConsume(key: string, max: number): boolean {
    if (max <= 0) return false;
    const day = new Date().toISOString().slice(0, 10);
    const entry = this.hits.get(key);
    const used = entry && entry.day === day ? entry.count : 0;
    if (used >= max) return false;
    this.hits.set(key, { day, count: used + 1 });
    return true;
  }
}
