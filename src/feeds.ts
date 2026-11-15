import { safeHeadlineUrl } from "./domain/urls";
import { createId, errorText, normalizeTitle } from "./domain/values";
import { dailyHost } from "./host";
import type { Headline, MarketEvent, TimelineSource, TimelineState } from "./types";

export type SourceStatus = Pick<TimelineSource, "id" | "url" | "lastFetchedAt" | "lastError" | "consecutiveFailures" | "retryAfter">;

export type FetchResult = {
  headlines: Headline[];
  /** Health updates for configured sources, applied by id when the job commits. */
  sourceStatus: SourceStatus[];
  errors: string[];
};

const FETCH_TIMEOUT_MS = 20_000;
const MAX_ITEMS_PER_FEED = 50;
const SOURCE_BACKOFF_BASE_MS = 5 * 60_000;
const SOURCE_BACKOFF_MAX_MS = 6 * 60 * 60_000;
const EVENT_SOURCE_PREFIX = "event-search-";

/** English aliases so CJK watchlist entries still match en-US Google News results. */
const WATCHLIST_ALIASES: Record<string, string> = {
  "黄金": "gold",
  "白银": "silver",
  "原油": "crude oil",
  "铜": "copper",
  "天然气": "natural gas",
  "美元": "US dollar",
  "人民币": "yuan",
  "USD/CNY": "yuan",
  "美债": "Treasury yields",
  "比特币": "bitcoin",
  "以太坊": "ethereum",
  "A股": "China stocks",
  "港股": "Hang Seng",
};

export async function fetchMarketHeadlines(
  state: TimelineState,
  options: { event?: MarketEvent; limit: number; now?: number },
): Promise<FetchResult> {
  const now = options.now ?? Date.now();
  const enabled = state.settings.sources.filter((source) => source.enabled);
  const ready = enabled.filter((source) => source.retryAfter === null || source.retryAfter <= now);
  const skipped = enabled.length - ready.length;
  const eventSource = options.event ? eventSearchSource(options.event, state) : null;
  const targets = eventSource ? [eventSource, ...ready] : ready;
  const results = await Promise.all(targets.map((source) => fetchSource(source, state, now)));
  const errors = results.flatMap((result) => result.error ? [`${result.source.name}: ${result.error}`] : []);
  if (skipped && !results.some((result) => result.headlines.length)) {
    errors.push(`${skipped} 个数据源因连续失败暂停抓取`);
  }
  const eventHeadlines = results.filter((result) => result.source.id.startsWith(EVENT_SOURCE_PREFIX)).flatMap((result) => result.headlines);
  const generalHeadlines = results.filter((result) => !result.source.id.startsWith(EVENT_SOURCE_PREFIX)).flatMap((result) => result.headlines);
  return {
    headlines: prioritizeHeadlines(eventHeadlines, generalHeadlines, options.limit),
    sourceStatus: results
      .filter((result) => !result.source.id.startsWith(EVENT_SOURCE_PREFIX))
      .map((result) => sourceStatus(result.source, result.error, now)),
    errors,
  };
}

/**
 * Deduplicates syndicated copies, then keeps event-specific evidence first (up to two
 * thirds of the budget) and fills the remainder with the most recent general headlines.
 */
export function prioritizeHeadlines(primary: Headline[], general: Headline[], limit: number): Headline[] {
  const seen = new Set<string>();
  const unique = (items: Headline[]) => items.filter((item) => {
    const key = headlineKey(item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const byRecency = (left: Headline, right: Headline) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  const first = unique([...primary].sort(byRecency)).slice(0, primary.length ? Math.ceil(limit * 2 / 3) : 0);
  const rest = unique([...general].sort(byRecency));
  return [...first, ...rest].slice(0, limit);
}

/** Stable identity for a story: syndicated copies differ only in the " - Publisher" suffix. */
export function headlineKey(title: string): string {
  return normalizeTitle(title.replace(/\s+[-–—|]\s+[^-–—|]{2,60}$/u, "")).slice(0, 160);
}

export function nextSourceBackoff(consecutiveFailures: number, now: number): number {
  const delay = SOURCE_BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1);
  return now + Math.min(delay, SOURCE_BACKOFF_MAX_MS);
}

function sourceStatus(source: TimelineSource, error: string | null, now: number): SourceStatus {
  if (!error) {
    return { id: source.id, url: source.url, lastFetchedAt: now, lastError: null, consecutiveFailures: 0, retryAfter: null };
  }
  const failures = source.consecutiveFailures + 1;
  return {
    id: source.id,
    url: source.url,
    lastFetchedAt: now,
    lastError: error,
    consecutiveFailures: failures,
    // A single failure is often transient; back off from the second one.
    retryAfter: failures >= 2 ? nextSourceBackoff(failures - 1, now) : null,
  };
}

function eventSearchSource(event: MarketEvent, state: TimelineState): TimelineSource {
  return {
    id: `${EVENT_SOURCE_PREFIX}${event.id}`,
    name: "Google News · 事件追踪",
    url: buildGoogleNewsUrl(`${eventSearchTerms(event, state)} when:2d`),
    enabled: true,
    lastFetchedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    retryAfter: null,
  };
}

export function eventSearchTerms(event: MarketEvent, state: TimelineState): string {
  if (event.searchQuery.trim()) return event.searchQuery.trim();
  // Fall back to ASCII words from the title plus symbols; CJK titles rarely hit en-US news.
  const ascii = event.title.match(/[A-Za-z0-9.&/$-]{2,}/g) ?? [];
  const symbols = event.symbols.map((symbol) => WATCHLIST_ALIASES[symbol] ?? symbol);
  const terms = [...new Set([...ascii, ...symbols])].slice(0, 8);
  return terms.length ? terms.join(" ") : state.settings.watchlist.map((item) => WATCHLIST_ALIASES[item] ?? item).slice(0, 4).join(" OR ");
}

async function fetchSource(source: TimelineSource, state: TimelineState, now: number): Promise<{
  source: TimelineSource;
  headlines: Headline[];
  error: string | null;
}> {
  try {
    const url = resolveSourceUrl(source.url, state);
    const response = await dailyHost().network.fetch(url, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const headlines = parseFeed(response.text, source, response.url, now);
    if (!headlines.length) throw new Error("没有解析到新闻条目");
    return { source, headlines, error: null };
  } catch (error) {
    return { source, headlines: [], error: errorText(error, "抓取失败").slice(0, 300) };
  }
}

export function resolveSourceUrl(template: string, state: TimelineState): string {
  if (!template.includes("{query}")) return template;
  const watchlist = state.settings.watchlist.flatMap((item) => {
    const alias = WATCHLIST_ALIASES[item];
    return alias ? [item, alias] : [item];
  });
  const focus = [
    ...new Set(watchlist),
    "central bank",
    "interest rates",
    "inflation",
    "earnings",
    "regulation",
    "geopolitical risk",
  ].map((term) => term.includes(" ") ? `"${term}"` : term).join(" OR ");
  return template.replaceAll("{query}", encodeURIComponent(`(${focus}) when:1d`));
}

export function buildGoogleNewsUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US%3Aen`;
}

export function parseFeed(
  text: string,
  source: Pick<TimelineSource, "id" | "name">,
  fallbackUrl: string,
  fetchedAt = Date.now(),
): Headline[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonFeed(trimmed, source, fallbackUrl, fetchedAt);
  }
  const parser = new DOMParser();
  const document = parser.parseFromString(trimmed, "text/xml");
  if (!document.querySelector("parsererror")) {
    const nodes = Array.from(document.querySelectorAll("item, entry"));
    const parsed = nodes.flatMap((node) => {
      const title = nodeText(node, ["title"]);
      if (!title) return [];
      const linkNode = node.querySelector("link");
      const url = linkNode?.getAttribute("href") || linkNode?.textContent?.trim() || fallbackUrl;
      const summary = htmlToText(nodeText(node, ["description", "summary", "content", "content:encoded"]));
      const publishedAt = validIsoDate(nodeText(node, ["pubDate", "published", "updated", "dc:date"]), fetchedAt);
      const safeUrl = safeHeadlineUrl(url, fallbackUrl);
      if (!safeUrl) return [];
      return [headline(source, title, safeUrl, summary, publishedAt)];
    });
    if (parsed.length) return parsed.slice(0, MAX_ITEMS_PER_FEED);
  }
  const html = parser.parseFromString(trimmed, "text/html");
  const title = html.querySelector("title")?.textContent?.trim();
  if (!title) return [];
  const description = html.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const safeUrl = safeHeadlineUrl(fallbackUrl, fallbackUrl);
  return safeUrl ? [headline(source, title, safeUrl, description, new Date(fetchedAt).toISOString())] : [];
}

function parseJsonFeed(
  text: string,
  source: Pick<TimelineSource, "id" | "name">,
  fallbackUrl: string,
  fetchedAt: number,
): Headline[] {
  try {
    const payload = JSON.parse(text) as unknown;
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    // Wallstreetcn-style APIs nest the list one level deeper: { data: { items: [...] } }.
    const data = typeof record?.data === "object" && record.data !== null && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : null;
    const candidates = Array.isArray(payload)
      ? payload
      : [record?.articles, record?.items, record?.results, record?.data, data?.items, data?.list].find(Array.isArray) ?? [];
    return candidates.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const value = item as Record<string, unknown>;
      // Live flash items have an empty title and carry the whole story in content_text.
      const title = firstString(value, ["title", "name", "headline", "content_text"]);
      if (!title) return [];
      const url = firstString(value, ["url", "link", "sourceUrl", "uri"]) || fallbackUrl;
      const summary = firstString(value, ["description", "summary", "snippet", "content"]);
      const published = firstString(value, ["publishedAt", "published", "pubDate", "date", "seendate"]);
      const safeUrl = safeHeadlineUrl(url, fallbackUrl);
      if (!safeUrl) return [];
      const publishedAt = published
        ? validIsoDate(published, fetchedAt)
        : unixSecondsDate(value.display_time ?? value.created_at, fetchedAt);
      return [headline(source, title, safeUrl, htmlToText(summary), publishedAt)];
    }).slice(0, MAX_ITEMS_PER_FEED);
  } catch {
    return [];
  }
}

function headline(
  source: Pick<TimelineSource, "id" | "name">,
  title: string,
  url: string,
  summary: string,
  publishedAt: string,
): Headline {
  return {
    id: createId("headline"),
    title: title.trim().slice(0, 280),
    url,
    summary: summary.trim().slice(0, 800),
    publishedAt,
    sourceId: source.id,
    sourceName: source.name,
  };
}

function nodeText(node: Element, names: string[]): string {
  for (const name of names) {
    const exact = Array.from(node.children).find((child) =>
      child.tagName.toLocaleLowerCase() === name.toLocaleLowerCase()
      || child.localName.toLocaleLowerCase() === name.split(":").at(-1)?.toLocaleLowerCase(),
    );
    if (exact?.textContent?.trim()) return exact.textContent.trim();
  }
  return "";
}

function htmlToText(value: string): string {
  if (!value) return "";
  const document = new DOMParser().parseFromString(value, "text/html");
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function validIsoDate(value: string, fallback: number): string {
  const timestamp = Date.parse(value);
  return new Date(Number.isFinite(timestamp) ? timestamp : fallback).toISOString();
}

function unixSecondsDate(value: unknown, fallback: number): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : new Date(fallback).toISOString();
}

function firstString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  return "";
}
