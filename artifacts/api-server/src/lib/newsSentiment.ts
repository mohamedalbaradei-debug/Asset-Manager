import { fetchRss, type RssItem } from "./rss";
import { aggregateSentiment } from "./sentiment";
import { logger } from "./logger";

/**
 * News & social sentiment.
 *
 * Free sources only (Google News RSS + Reddit search RSS), scored with the
 * built-in VADER-style engine. Every function degrades gracefully — if a feed
 * is unreachable the result carries an `available: false` marker and the UI
 * falls back to a friendly note.
 */

export interface SentimentReport {
  available: boolean;
  compound: number;
  label: "Bullish" | "Neutral" | "Bearish";
  explanation: string;
  headlines: Array<{ title: string; score: number; label: string }>;
  source: string;
}

const GOOGLE_NEWS_URL = (ticker: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${ticker} stock`)}&hl=en-US&gl=US&ceid=US:en`;

const REDDIT_RSS_URL = (ticker: string) =>
  `https://www.reddit.com/search.rss?q=${encodeURIComponent(ticker)}&sort=relevance&limit=10`;

function toReport(
  items: RssItem[],
  source: string
): SentimentReport {
  if (items.length === 0) {
    return {
      available: false,
      compound: 0,
      label: "Neutral",
      explanation: "No headlines could be fetched from the free feed right now.",
      headlines: [],
      source,
    };
  }

  const titles = items.map((i) => i.title).slice(0, 10);
  const agg = aggregateSentiment(titles);

  return {
    available: true,
    compound: agg.compound,
    label: agg.label,
    explanation: agg.explanation,
    headlines: agg.perItem.slice(0, 5),
    source,
  };
}

/**
 * Fetch Google News headlines for a ticker and score them with VADER.
 */
export async function getGoogleNewsSentiment(ticker: string): Promise<SentimentReport> {
  const items = await fetchRss(GOOGLE_NEWS_URL(ticker));
  return toReport(items, "Google News");
}

/**
 * Fetch Reddit search results for a ticker and score the post titles.
 * Reddit blocks datacenter IPs, so fall back to Mastodon's public hashtag
 * timeline when the RSS feed is unreachable or empty.
 */
export async function getRedditSentiment(ticker: string): Promise<SentimentReport> {
  try {
    const items = await fetchRss(REDDIT_RSS_URL(ticker));
    if (items.length > 0) return toReport(items, "Reddit");
  } catch (err) {
    logger.warn({ err, ticker }, "Reddit RSS failed, falling back to Mastodon");
  }
  return getMastodonSentiment(ticker);
}

interface MastodonStatus {
  url?: string;
  created_at?: string;
  content?: string;
  spoiler_text?: string;
}

/**
 * Social fallback via Mastodon's keyless public API (mastodon.social).
 */
export async function getMastodonSentiment(ticker: string): Promise<SentimentReport> {
  const tag = ticker.toLowerCase().replace(/[^a-z0-9]/g, "");
  const urls = [
    `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=20`,
    `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(`$${tag}`)}?limit=20`,
  ];

  const items: RssItem[] = [];
  for (const url of urls) {
    if (items.length >= 5) break;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const statuses = (await res.json()) as MastodonStatus[];
      for (const s of statuses) {
        const text = (s.spoiler_text || s.content || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) continue;
        items.push({
          title: text.slice(0, 300),
          link: s.url ?? null,
          description: null,
          publishedAt: s.created_at ?? null,
          source: "Mastodon",
        });
      }
    } catch (err) {
      logger.warn({ err, url }, "Mastodon timeline failed");
    }
  }
  return toReport(items.slice(0, 10), "Mastodon");
}

/** Latest general market headlines from curated free RSS feeds. */
const NEWS_FEEDS: Array<{ name: string; url: string }> = [
  { name: "MarketWatch", url: "http://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
  { name: "CNBC Economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
];

export interface NewsItem {
  title: string;
  link: string | null;
  source: string;
  publishedAt: string | null;
  summary: string | null;
  sentimentLabel: "Bullish" | "Neutral" | "Bearish";
}

export async function getLatestNews(): Promise<{ items: NewsItem[]; updatedAt: string }> {
  const results = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const items = await fetchRss(feed.url);
      return items.slice(0, 12).map((item) => ({ ...item, source: feed.name }));
    })
  );

  const all: Array<RssItem & { source: string }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  // Sort newest first (best-effort date parse), dedupe by title
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const item of all.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  })) {
    const key = item.title.toLowerCase();
    if (seen.has(key) || items.length >= 40) continue;
    seen.add(key);
    const score = aggregateSentiment([item.title]);
    items.push({
      title: item.title,
      link: item.link,
      source: item.source ?? "Finance",
      publishedAt: item.publishedAt,
      summary: item.description,
      sentimentLabel: score.label,
    });
  }

  return { items, updatedAt: new Date().toISOString() };
}