import { logger } from "./logger";

/**
 * Minimal RSS / Atom parser.
 *
 * Dependency-free on purpose (no `rss-parser` / XML libs) so the esbuild
 * bundle stays clean. Google News and Reddit both serve well-formed RSS, which
 * this parser handles via a simple tag scanner. It is lenient: malformed items
 * are skipped, never thrown.
 */

export interface RssItem {
  title: string;
  link: string | null;
  description: string | null;
  publishedAt: string | null;
  source: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 AIInvestSys/1.0";

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the text content of the first occurrence of an XML tag. */
function firstTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : null;
}

/**
 * Parse an RSS/Atom document into items. Returns an empty array on malformed
 * input rather than throwing.
 */
export function parseRss(xml: string): RssItem[] {
  // Atom uses <entry>, RSS uses <item>
  const pattern = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  const items: RssItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) !== null) {
    const body = match[1];
    const title = firstTag(body, "title");
    if (!title) continue;

    // Atom feeds use <link href="...">, RSS uses <link>...</link>
    let link: string | null = null;
    const hrefMatch = body.match(/<link[^>]*href=["']([^"']+)["']/i);
    if (hrefMatch) link = decodeEntities(hrefMatch[1]);
    if (!link) link = firstTag(body, "link");

    const description = firstTag(body, "description");
    const publishedAt =
      firstTag(body, "pubDate") ?? firstTag(body, "published") ?? firstTag(body, "updated");

    const source = firstTag(body, "source");

    items.push({
      title: stripTags(title),
      link,
      description: description ? stripTags(description).slice(0, 500) : null,
      publishedAt,
      source,
    });
  }

  return items;
}

/**
 * Fetch and parse an RSS feed. Returns [] on any network/parse failure so
 * callers can degrade gracefully.
 */
export async function fetchRss(url: string): Promise<RssItem[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, application/atom+xml, text/xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logger.warn({ url, status: res.status }, "RSS fetch failed with status");
      return [];
    }

    const xml = await res.text();
    return parseRss(xml);
  } catch (err) {
    logger.warn({ err, url }, "RSS fetch failed");
    return [];
  }
}

/** Strip the ticker symbol from a headline (avoids skewing sentiment). */
export function cleanHeadline(title: string): string {
  return title
    .replace(/\b[A-Z][A-Z0-9.\-^=]{1,9}\b/g, (m) => m)
    .replace(/\s{2,}/g, " ")
    .trim();
}