import { fetchRss, type RssItem } from "./rss";
import { aggregateSentiment } from "./sentiment";

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
 */
export async function getRedditSentiment(ticker: string): Promise<SentimentReport> {
  const items = await fetchRss(REDDIT_RSS_URL(ticker));
  return toReport(items, "Reddit");
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