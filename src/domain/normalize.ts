import type { ModelSelection } from "@daily/plugin-sdk";
import type {
  AutomationRun,
  EventAnalysis,
  MarketEvent,
  SeenHeadline,
  TimelineSettings,
  TimelineSource,
  TimelineState,
} from "../types";
import { validTimeZoneValue } from "./time";
import { isSafePublicHttpUrl } from "./urls";
import {
  asRecord,
  clampNumber,
  dedupeById,
  impactValue,
  leaseValue,
  nullableNumber,
  numberValue,
  stringArray,
  stringValue,
} from "./values";

export const MAX_EVENTS = 300;
export const MAX_RUNS = 40;
export const MAX_SOURCES = 20;
export const MAX_SEEN_HEADLINES = 600;
export const SEEN_HEADLINE_TTL_MS = 7 * 24 * 60 * 60_000;

const GOOGLE_NEWS_TEMPLATE =
  "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US%3Aen";
const EVENT_STATUSES: MarketEvent["status"][] = ["scheduled", "waiting", "analyzing", "completed", "failed", "dismissed"];
const RUN_STATUSES: AutomationRun["status"][] = ["running", "completed", "failed", "interrupted"];

export function createDefaultState(now = Date.now()): TimelineState {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  return {
    version: 3,
    settings: {
      watchlist: ["SPY", "QQQ", "BTC", "黄金", "原油", "USD/CNY"],
      timezone,
      discoveryIntervalMinutes: 60,
      analysisDelayMinutes: 10,
      minimumImpact: "medium",
      sources: defaultSources(),
      discoveryModel: null,
      analysisModel: null,
    },
    events: [],
    runs: [],
    seenHeadlines: [],
    discoveryLease: null,
    lastDiscoveryAt: null,
    nextDiscoveryAt: now,
    lastError: null,
    updatedAt: now,
  };
}

export function createSource(input: Pick<TimelineSource, "id" | "name" | "url"> & Partial<TimelineSource>): TimelineSource {
  return {
    enabled: true,
    lastFetchedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    retryAfter: null,
    ...input,
  };
}

export type SourcePreset = Pick<TimelineSource, "id" | "name" | "url" | "enabled">;

/** Built-in feeds, checked to be reachable without a proxy from mainland China. */
export const SOURCE_PRESETS: readonly SourcePreset[] = [
  {
    id: "yahoo-finance-watchlist",
    name: "Yahoo Finance · 自选标的",
    url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY,QQQ,BTC-USD,GC=F,CL=F&region=US&lang=en-US",
    enabled: true,
  },
  { id: "cnbc-markets", name: "CNBC · Markets", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", enabled: true },
  { id: "cnbc-economy", name: "CNBC · Economy", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", enabled: true },
  { id: "marketwatch-top", name: "MarketWatch · 头条", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", enabled: true },
  { id: "fxstreet-news", name: "FXStreet · 外汇", url: "https://www.fxstreet.com/rss/news", enabled: true },
  { id: "oilprice-main", name: "OilPrice · 原油", url: "https://oilprice.com/rss/main", enabled: true },
  { id: "cointelegraph", name: "Cointelegraph · 加密", url: "https://cointelegraph.com/rss", enabled: true },
  {
    id: "wallstreetcn-live",
    name: "华尔街见闻 · 7x24",
    url: "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=50",
    enabled: true,
  },
  { id: "federal-reserve", name: "Federal Reserve · 货币政策", url: "https://www.federalreserve.gov/feeds/press_monetary.xml", enabled: true },
  { id: "ecb-press", name: "ECB · 官方发布", url: "https://www.ecb.europa.eu/rss/press.html", enabled: true },
  { id: "sec-press", name: "SEC · 监管发布", url: "https://www.sec.gov/news/pressreleases.rss", enabled: true },
  // Keyword search is unreachable on many networks in mainland China; opt in when it works.
  { id: "google-market-pulse", name: "Google News · 市场脉冲", url: GOOGLE_NEWS_TEMPLATE, enabled: false },
];

/** Built-in sources whose v2 defaults are replaced by the current preset unless the user edited the URL. */
const V2_DEFAULT_URLS: Record<string, string> = {
  "google-market-pulse": GOOGLE_NEWS_TEMPLATE,
  "federal-reserve": "https://www.federalreserve.gov/feeds/press_all.xml",
};

function defaultSources(): TimelineSource[] {
  return SOURCE_PRESETS.map((preset) => createSource({ ...preset }));
}

/** Upgrades untouched v2 built-ins to their current presets and appends presets the user never had. */
function migrateSourcesToV3(sources: TimelineSource[]): TimelineSource[] {
  const upgraded = sources.map((source) => {
    const preset = SOURCE_PRESETS.find((item) => item.id === source.id);
    return preset && V2_DEFAULT_URLS[source.id] === source.url
      ? { ...source, ...preset, lastError: null, consecutiveFailures: 0, retryAfter: null }
      : source;
  });
  const known = new Set(upgraded.map((source) => source.id));
  const added = defaultSources().filter((source) => !known.has(source.id));
  return [...upgraded, ...added].slice(0, MAX_SOURCES);
}

/** Validates untrusted persisted state and migrates older records to the current shape. */
export function normalizeState(value: unknown, now = Date.now()): TimelineState {
  const fallback = createDefaultState(now);
  const record = asRecord(value);
  if (!record) return fallback;
  const settingsRecord = asRecord(record.settings);
  const storedSources = Array.isArray(settingsRecord?.sources)
    ? dedupeById(settingsRecord.sources.map(normalizeSource).filter((source): source is TimelineSource => source !== null)).slice(0, MAX_SOURCES)
    : fallback.settings.sources;
  const sources = numberValue(record.version, 1) < 3 ? migrateSourcesToV3(storedSources) : storedSources;
  const settings: TimelineSettings = {
    watchlist: stringArray(settingsRecord?.watchlist).map((item) => item.slice(0, 40)).slice(0, 30),
    timezone: validTimeZoneValue(settingsRecord?.timezone, fallback.settings.timezone),
    discoveryIntervalMinutes: clampNumber(settingsRecord?.discoveryIntervalMinutes, 15, 1440, 60),
    analysisDelayMinutes: clampNumber(settingsRecord?.analysisDelayMinutes, 0, 240, 10),
    minimumImpact: impactValue(settingsRecord?.minimumImpact, "medium"),
    sources: sources.length ? sources : fallback.settings.sources,
    discoveryModel: modelSelectionValue(settingsRecord?.discoveryModel),
    analysisModel: modelSelectionValue(settingsRecord?.analysisModel),
  };
  if (!settings.watchlist.length) settings.watchlist = fallback.settings.watchlist;
  const events = Array.isArray(record.events)
    ? capTimelineEvents(dedupeById(record.events.map((item) => normalizeEvent(item, now)).filter((event): event is MarketEvent => event !== null)))
    : [];
  const runs = Array.isArray(record.runs)
    ? dedupeById(record.runs.map((item) => normalizeRun(item, now)).filter((run): run is AutomationRun => run !== null)).slice(0, MAX_RUNS)
    : [];
  return {
    version: 3,
    settings,
    events,
    runs,
    seenHeadlines: pruneSeenHeadlines(Array.isArray(record.seenHeadlines) ? record.seenHeadlines.flatMap(normalizeSeen) : [], now),
    discoveryLease: leaseValue(record.discoveryLease),
    lastDiscoveryAt: nullableNumber(record.lastDiscoveryAt),
    nextDiscoveryAt: numberValue(record.nextDiscoveryAt, now),
    lastError: typeof record.lastError === "string" ? record.lastError.slice(0, 1_000) : null,
    updatedAt: numberValue(record.updatedAt, now),
  };
}

function normalizeSource(value: unknown): TimelineSource | null {
  const source = asRecord(value);
  if (!source || typeof source.id !== "string" || typeof source.url !== "string") return null;
  if (!isSafePublicHttpUrl(source.url, true)) return null;
  return {
    id: source.id.slice(0, 128),
    name: stringValue(source.name, source.id, 120),
    url: source.url.slice(0, 2_048),
    enabled: source.enabled !== false,
    lastFetchedAt: nullableNumber(source.lastFetchedAt),
    lastError: typeof source.lastError === "string" ? source.lastError.slice(0, 1_000) : null,
    consecutiveFailures: clampNumber(source.consecutiveFailures, 0, 100, 0),
    retryAfter: nullableNumber(source.retryAfter),
  };
}

export function normalizeEvent(value: unknown, now = Date.now()): MarketEvent | null {
  const event = asRecord(value);
  if (!event || typeof event.id !== "string" || typeof event.title !== "string") return null;
  const scheduledAt = stringValue(event.scheduledAt, "");
  if (!Number.isFinite(Date.parse(scheduledAt))) return null;
  const lease = leaseValue(event.lease);
  let status = EVENT_STATUSES.includes(event.status as MarketEvent["status"])
    ? event.status as MarketEvent["status"]
    : "scheduled";
  // v1 had no leases: an "analyzing" record without one was orphaned by a crash.
  if (status === "analyzing" && !lease) status = "scheduled";
  return {
    id: event.id.slice(0, 128),
    title: event.title.slice(0, 180),
    scheduledAt,
    timezone: validTimeZoneValue(event.timezone, "UTC"),
    timeConfirmed: event.timeConfirmed !== false,
    category: stringValue(event.category, "市场事件", 40),
    impact: impactValue(event.impact, "medium"),
    symbols: stringArray(event.symbols).map((item) => item.slice(0, 30)).slice(0, 20),
    thesis: stringValue(event.thesis, "", 600),
    rationale: stringValue(event.rationale, "", 1_000),
    searchQuery: stringValue(event.searchQuery, "", 200),
    sourceUrls: stringArray(event.sourceUrls).filter((url) => isSafePublicHttpUrl(url)).slice(0, 12),
    status,
    analysis: normalizeAnalysis(event.analysis, now),
    failureReason: typeof event.failureReason === "string" ? event.failureReason.slice(0, 1_000) : null,
    attempts: clampNumber(event.attempts, 0, 100, 0),
    nextAttemptAt: nullableNumber(event.nextAttemptAt),
    lastAttemptAt: nullableNumber(event.lastAttemptAt),
    lease: status === "analyzing" ? lease : null,
    discoveredAt: numberValue(event.discoveredAt, now),
    createdAt: numberValue(event.createdAt, now),
    updatedAt: numberValue(event.updatedAt, now),
  };
}

function normalizeAnalysis(value: unknown, now: number): EventAnalysis | null {
  const analysis = asRecord(value);
  if (!analysis) return null;
  return {
    summary: stringValue(analysis.summary, "", 1_600),
    marketReaction: stringValue(analysis.marketReaction, "", 1_600),
    verdict: ["bullish", "bearish", "mixed", "neutral"].includes(String(analysis.verdict))
      ? analysis.verdict as EventAnalysis["verdict"]
      : "neutral",
    confidence: clampNumber(analysis.confidence, 0, 100, 0),
    affectedAssets: Array.isArray(analysis.affectedAssets)
      ? analysis.affectedAssets.flatMap((item) => {
          const asset = asRecord(item);
          if (!asset || typeof asset.symbol !== "string") return [];
          const direction = ["up", "down", "volatile", "unclear"].includes(String(asset.direction))
            ? asset.direction as EventAnalysis["affectedAssets"][number]["direction"]
            : "unclear";
          return [{ symbol: asset.symbol.slice(0, 30), direction, reason: stringValue(asset.reason, "", 500) }];
        }).slice(0, 20)
      : [],
    scenarios: stringArray(analysis.scenarios).map((item) => item.slice(0, 1_000)).slice(0, 8),
    evidence: Array.isArray(analysis.evidence)
      ? analysis.evidence.flatMap((item) => {
          const evidence = asRecord(item);
          if (!evidence || typeof evidence.title !== "string") return [];
          const url = stringValue(evidence.url, "", 2_048);
          return [{
            title: evidence.title.slice(0, 280),
            url: isSafePublicHttpUrl(url) ? url : "",
            publishedAt: stringValue(evidence.publishedAt, "", 80),
            source: stringValue(evidence.source, "", 120),
          }];
        }).slice(0, 12)
      : [],
    completedAt: numberValue(analysis.completedAt, now),
  };
}

function normalizeRun(value: unknown, now: number): AutomationRun | null {
  const run = asRecord(value);
  if (!run || typeof run.id !== "string") return null;
  return {
    id: run.id.slice(0, 128),
    kind: run.kind === "analysis" ? "analysis" : "discovery",
    status: RUN_STATUSES.includes(run.status as AutomationRun["status"]) ? run.status as AutomationRun["status"] : "completed",
    message: stringValue(run.message, "", 1_000),
    eventId: typeof run.eventId === "string" ? run.eventId.slice(0, 128) : null,
    owner: typeof run.owner === "string" ? run.owner.slice(0, 128) : null,
    startedAt: numberValue(run.startedAt, now),
    finishedAt: nullableNumber(run.finishedAt),
    headlineCount: numberValue(run.headlineCount, 0),
  };
}

function normalizeSeen(value: unknown): SeenHeadline[] {
  const seen = asRecord(value);
  if (!seen || typeof seen.key !== "string" || typeof seen.seenAt !== "number") return [];
  return [{ key: seen.key.slice(0, 200), seenAt: seen.seenAt }];
}

export function pruneSeenHeadlines(seen: SeenHeadline[], now: number): SeenHeadline[] {
  const latest = new Map<string, number>();
  for (const item of seen) {
    if (now - item.seenAt > SEEN_HEADLINE_TTL_MS) continue;
    latest.set(item.key, Math.max(latest.get(item.key) ?? 0, item.seenAt));
  }
  return [...latest.entries()]
    .map(([key, seenAt]) => ({ key, seenAt }))
    .sort((left, right) => right.seenAt - left.seenAt)
    .slice(0, MAX_SEEN_HEADLINES);
}

/** Keeps actionable events ahead of history when the store hits its size cap. */
export function capTimelineEvents(events: MarketEvent[], limit = MAX_EVENTS): MarketEvent[] {
  const bySchedule = (left: MarketEvent, right: MarketEvent) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt);
  const byRecentUpdate = (left: MarketEvent, right: MarketEvent) => right.updatedAt - left.updatedAt;
  const active = events
    .filter((event) => event.status !== "completed" && event.status !== "dismissed")
    .sort(bySchedule);
  const completed = events.filter((event) => event.status === "completed").sort(byRecentUpdate);
  const dismissed = events.filter((event) => event.status === "dismissed").sort(byRecentUpdate);
  return [...active, ...completed, ...dismissed].slice(0, limit).sort(bySchedule);
}

function modelSelectionValue(value: unknown): ModelSelection | null {
  const record = asRecord(value);
  if (typeof record?.authConfigId !== "string" || typeof record.model !== "string") return null;
  return { authConfigId: record.authConfigId.slice(0, 200), model: record.model.slice(0, 200) };
}
