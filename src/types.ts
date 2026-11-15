import type { ModelSelection } from "@daily/plugin-sdk";

export type ImpactLevel = "high" | "medium" | "low";
/**
 * - scheduled: waiting for its analysis time (or a retry after a failure).
 * - waiting:   analysed, but the model reported the event has not happened yet.
 * - analyzing: an executor holds `lease` and is analysing it right now.
 * - failed:    retries exhausted; only a manual analysis re-runs it.
 */
export type EventStatus = "scheduled" | "waiting" | "analyzing" | "completed" | "failed" | "dismissed";
export type MarketVerdict = "bullish" | "bearish" | "mixed" | "neutral";

export type Lease = {
  owner: string;
  expiresAt: number;
};

export type TimelineSource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Failing sources are skipped until this time. */
  retryAfter: number | null;
};

export type Headline = {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  sourceId: string;
  sourceName: string;
};

export type AnalysisEvidence = {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
};

export type AffectedAsset = {
  symbol: string;
  direction: "up" | "down" | "volatile" | "unclear";
  reason: string;
};

export type EventAnalysis = {
  summary: string;
  marketReaction: string;
  verdict: MarketVerdict;
  confidence: number;
  affectedAssets: AffectedAsset[];
  scenarios: string[];
  evidence: AnalysisEvidence[];
  completedAt: number;
};

export type MarketEvent = {
  id: string;
  title: string;
  scheduledAt: string;
  timezone: string;
  /** False when the source only confirmed the date, not the time of day. */
  timeConfirmed: boolean;
  category: string;
  impact: ImpactLevel;
  symbols: string[];
  thesis: string;
  rationale: string;
  /** English news-search keywords used to collect evidence once the event is due. */
  searchQuery: string;
  sourceUrls: string[];
  status: EventStatus;
  analysis: EventAnalysis | null;
  failureReason: string | null;
  /** Consecutive failed analysis attempts; reset by success or a manual run. */
  attempts: number;
  /** Overrides the default due time after a failure or a "not yet happened" result. */
  nextAttemptAt: number | null;
  lastAttemptAt: number | null;
  lease: Lease | null;
  discoveredAt: number;
  createdAt: number;
  updatedAt: number;
};

export type TimelineSettings = {
  watchlist: string[];
  timezone: string;
  discoveryIntervalMinutes: number;
  analysisDelayMinutes: number;
  minimumImpact: ImpactLevel;
  sources: TimelineSource[];
  /** Models for scanning headlines and for analysing due events; null follows the Daily default. */
  discoveryModel: ModelSelection | null;
  analysisModel: ModelSelection | null;
};

export type AutomationRun = {
  id: string;
  kind: "discovery" | "analysis";
  status: "running" | "completed" | "failed" | "interrupted";
  message: string;
  eventId: string | null;
  owner: string | null;
  startedAt: number;
  finishedAt: number | null;
  headlineCount: number;
};

export type SeenHeadline = {
  key: string;
  seenAt: number;
};

export type TimelineState = {
  version: 3;
  settings: TimelineSettings;
  events: MarketEvent[];
  runs: AutomationRun[];
  /** Headlines already sent to discovery, so each scan only pays for new information. */
  seenHeadlines: SeenHeadline[];
  discoveryLease: Lease | null;
  lastDiscoveryAt: number | null;
  nextDiscoveryAt: number;
  lastError: string | null;
  updatedAt: number;
};

export type WorkerStatus = {
  owner: string;
  phase: "idle" | "discovering" | "analyzing" | "error";
  message: string;
  heartbeatAt: number;
};

export type NetworkFetchResponse = {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
};

export type HostContext = {
  plugin: {
    identifier: string;
  };
};
