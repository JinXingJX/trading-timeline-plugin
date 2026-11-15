import { buildAnalysisRequest, parseAnalysisResponse, type AnalysisOutcome } from "./ai/analysisPrompt";
import { buildDiscoveryRequest, parseDiscoveryResponse } from "./ai/discoveryPrompt";
import { describeJobError, invokeModelJson } from "./ai/modelJson";
import { mergeDiscoveredEvents } from "./domain/merge";
import { MAX_RUNS, pruneSeenHeadlines } from "./domain/normalize";
import {
  analysisDueAt,
  applyAnalysisFailure,
  applyAnalysisWaiting,
  JOB_LEASE_MS,
  LEASE_RENEW_MS,
  mustConclude,

  planNextJob,
  type AutomationJob,
  type JobRequest,
} from "./domain/scheduler";
import { transact } from "./domain/store";
import { createId } from "./domain/values";
import { fetchMarketHeadlines, headlineKey, type FetchResult, type SourceStatus } from "./feeds";
import type { AutomationRun, Headline, MarketEvent, TimelineSource, TimelineState, WorkerStatus } from "./types";

const DISCOVERY_FETCH_LIMIT = 100;
const DISCOVERY_MODEL_LIMIT = 60;
const ANALYSIS_HEADLINE_LIMIT = 60;
const DISCOVERY_RETRY_MAX_MS = 15 * 60_000;

export type CycleOptions = JobRequest & {
  owner: string;
  /** Progress callback for the background worker's status line. */
  onPhase?: (phase: WorkerStatus["phase"], message: string) => void;
};

type Claim = { kind: "busy"; message: string } | { kind: "claimed"; job: AutomationJob; runId: string } | null;

export type CycleResult = {
  state: TimelineState;
  job: AutomationJob | null;
};

/**
 * Runs at most one job. The job is claimed with a lease in a short transaction, executed
 * outside the storage lock (so user edits never wait on network or model calls), and its
 * result is committed against the latest state. Explicit requests throw when busy.
 */
export async function runAutomationCycle(options: CycleOptions): Promise<CycleResult> {
  const { owner } = options;
  const claim = await transact<Claim>(owner, (latest, now) => {
    const plan = planNextJob(latest, now, options);
    if (!plan || plan.kind === "busy") return { result: plan };
    const lease = { owner, expiresAt: now + JOB_LEASE_MS };
    if (plan.kind === "discovery") {
      const run = createRun("discovery", null, owner, now, "正在扫描活跃市场信息…");
      return {
        next: { ...latest, discoveryLease: lease, runs: [run, ...latest.runs].slice(0, MAX_RUNS) },
        result: { kind: "claimed", job: plan, runId: run.id },
      };
    }
    const event = latest.events.find((item) => item.id === plan.eventId);
    if (!event) return { result: null };
    const run = createRun("analysis", event.id, owner, now, `正在分析「${event.title}」…`);
    const claimed: MarketEvent = {
      ...event,
      status: "analyzing",
      lease,
      // A manual run starts a fresh retry budget.
      attempts: plan.manual ? 0 : event.attempts,
      updatedAt: now,
    };
    return {
      next: {
        ...latest,
        events: latest.events.map((item) => item.id === event.id ? claimed : item),
        runs: [run, ...latest.runs].slice(0, MAX_RUNS),
      },
      result: { kind: "claimed", job: plan, runId: run.id },
    };
  });

  const claimed = claim.result;
  if (!claimed) return { state: claim.state, job: null };
  if (claimed.kind === "busy") {
    if (options.forceDiscovery || options.analyzeEventId) throw new Error(claimed.message);
    return { state: claim.state, job: null };
  }

  const { job, runId } = claimed;
  const renewal = startLeaseRenewal(owner, job);
  try {
    const state = job.kind === "discovery"
      ? await runDiscovery(claim.state, owner, runId, job.forced, options.onPhase)
      : await runAnalysis(claim.state, owner, runId, job.eventId, options.onPhase);
    return { state, job };
  } finally {
    renewal.stop();
  }
}

async function runDiscovery(
  state: TimelineState,
  owner: string,
  runId: string,
  forced: boolean,
  onPhase: CycleOptions["onPhase"],
): Promise<TimelineState> {
  onPhase?.("discovering", "抓取市场信息并识别未来事件");
  let fetched: FetchResult | null = null;
  let toSend: Headline[] = [];
  try {
    fetched = await fetchMarketHeadlines(state, { limit: DISCOVERY_FETCH_LIMIT });
    if (!fetched.headlines.length) {
      throw new Error(fetched.errors.join("；") || "所有数据源均未返回可分析的内容。");
    }
    const seen = new Set(state.seenHeadlines.map((item) => item.key));
    // A manual scan re-reads everything (settings such as the impact threshold may have changed).
    toSend = (forced ? fetched.headlines : fetched.headlines.filter((item) => !seen.has(headlineKey(item.title))))
      .slice(0, DISCOVERY_MODEL_LIMIT);
    if (!toSend.length) {
      const result = fetched;
      return await finishDiscovery(owner, runId, (latest, now) => ({
        ...latest,
        lastDiscoveryAt: now,
        nextDiscoveryAt: now + latest.settings.discoveryIntervalMinutes * 60_000,
        lastError: result.errors.length ? result.errors.join("；") : null,
        settings: applySourceStatus(latest.settings, result.sourceStatus),
        runs: finishRun(latest.runs, runId, "completed", `读取 ${result.headlines.length} 条信息，均已分析过，无新增信息。`, result.headlines.length, now),
      }));
    }
    const sent = toSend;
    const candidates = await invokeModelJson(
      buildDiscoveryRequest(state, sent, Date.now()),
      (record) => parseDiscoveryResponse(record, state, sent, Date.now()),
    );
    const result = fetched;
    return await finishDiscovery(owner, runId, (latest, now) => {
      const merged = mergeDiscoveredEvents(latest.events, candidates, now);
      return {
        ...latest,
        events: merged.events,
        seenHeadlines: pruneSeenHeadlines(
          [...sent.map((item) => ({ key: headlineKey(item.title), seenAt: now })), ...latest.seenHeadlines],
          now,
        ),
        lastDiscoveryAt: now,
        nextDiscoveryAt: now + latest.settings.discoveryIntervalMinutes * 60_000,
        lastError: result.errors.length ? result.errors.join("；") : null,
        settings: applySourceStatus(latest.settings, result.sourceStatus),
        runs: finishRun(
          latest.runs,
          runId,
          "completed",
          `分析 ${sent.length} 条新信息，新增 ${merged.added} 个、更新 ${merged.updated} 个事件。`,
          sent.length,
          now,
        ),
      };
    });
  } catch (error) {
    const message = describeJobError(error, "市场扫描失败。");
    const statuses = fetched?.sourceStatus ?? [];
    return finishDiscovery(owner, runId, (latest, now) => ({
      ...latest,
      nextDiscoveryAt: now + Math.min(DISCOVERY_RETRY_MAX_MS, latest.settings.discoveryIntervalMinutes * 60_000),
      lastError: message,
      settings: applySourceStatus(latest.settings, statuses),
      runs: finishRun(latest.runs, runId, "failed", message, 0, now),
    }));
  }
}

/** Commits a discovery result only if this executor still owns the discovery lease. */
async function finishDiscovery(
  owner: string,
  runId: string,
  apply: (latest: TimelineState, now: number) => TimelineState,
): Promise<TimelineState> {
  const { state } = await transact(owner, (latest, now) => {
    if (latest.discoveryLease?.owner !== owner) {
      return { next: { ...latest, runs: finishRun(latest.runs, runId, "interrupted", "扫描租约已失效，结果已丢弃。", 0, now) }, result: null };
    }
    return { next: { ...apply(latest, now), discoveryLease: null }, result: null };
  });
  return state;
}

async function runAnalysis(
  state: TimelineState,
  owner: string,
  runId: string,
  eventId: string,
  onPhase: CycleOptions["onPhase"],
): Promise<TimelineState> {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return state;
  onPhase?.("analyzing", event.title);
  let fetched: FetchResult | null = null;
  let outcome: AnalysisOutcome;
  try {
    fetched = await fetchMarketHeadlines(state, { event, limit: ANALYSIS_HEADLINE_LIMIT });
    const headlines = fetched.headlines;
    if (!headlines.length) {
      outcome = { kind: "insufficient", reason: fetched.errors.join("；") || "事件到期后没有抓取到可用证据。" };
    } else {
      const options = { now: Date.now(), mustConclude: mustConclude(event, Date.now()) };
      outcome = await invokeModelJson(
        buildAnalysisRequest(state, event, headlines, options),
        (record) => parseAnalysisResponse(record, headlines, options),
      );
    }
  } catch (error) {
    outcome = { kind: "insufficient", reason: describeJobError(error, "事件分析失败。") };
  }

  const result = fetched;
  const { state: next } = await transact(owner, (latest, now) => {
    const current = latest.events.find((item) => item.id === eventId);
    const settings = applySourceStatus(latest.settings, result?.sourceStatus ?? []);
    if (!current || current.status !== "analyzing" || current.lease?.owner !== owner) {
      // Dismissed, deleted, or taken over after our lease expired: discard the result.
      return {
        next: { ...latest, settings, runs: finishRun(latest.runs, runId, "interrupted", "事件已变更，分析结果已丢弃。", 0, now) },
        result: null,
      };
    }
    const headlineCount = result?.headlines.length ?? 0;
    let updated: MarketEvent;
    let runStatus: AutomationRun["status"];
    let message: string;
    if (outcome.kind === "occurred") {
      updated = {
        ...current,
        status: "completed",
        analysis: outcome.analysis,
        lease: null,
        attempts: 0,
        nextAttemptAt: null,
        failureReason: null,
        lastAttemptAt: now,
        updatedAt: now,
      };
      runStatus = "completed";
      message = `已基于 ${outcome.analysis.evidence.length} 条证据完成影响分析。`;
    } else if (outcome.kind === "not_yet") {
      updated = applyAnalysisWaiting(current, outcome.reason, now);
      runStatus = "completed";
      message = `事件尚未发生，${formatRelative(analysisDueAt(updated, latest.settings) - now)}后再检查。`;
    } else {
      updated = applyAnalysisFailure(current, outcome.reason, now);
      runStatus = "failed";
      message = updated.nextAttemptAt
        ? `${outcome.reason}（${formatRelative(updated.nextAttemptAt - now)}后第 ${updated.attempts + 1} 次尝试）`
        : outcome.reason;
    }
    return {
      next: {
        ...latest,
        settings,
        events: latest.events.map((item) => item.id === eventId ? updated : item),
        lastError: runStatus === "failed" ? message : latest.lastError,
        runs: finishRun(latest.runs, runId, runStatus, message, headlineCount, now),
      },
      result: null,
    };
  });
  return next;
}

/** Extends the job lease while work is in flight so other executors don't reclaim it. */
function startLeaseRenewal(owner: string, job: AutomationJob): { stop: () => void } {
  const timer = globalThis.setInterval(() => {
    void transact(owner, (latest, now) => {
      const expiresAt = now + JOB_LEASE_MS;
      if (job.kind === "discovery") {
        if (latest.discoveryLease?.owner !== owner) return { result: null };
        return { next: { ...latest, discoveryLease: { owner, expiresAt } }, result: null };
      }
      const event = latest.events.find((item) => item.id === job.eventId);
      if (event?.status !== "analyzing" || event.lease?.owner !== owner) return { result: null };
      return {
        next: { ...latest, events: latest.events.map((item) => item.id === event.id ? { ...item, lease: { owner, expiresAt } } : item) },
        result: null,
      };
    }).catch(() => undefined);
  }, LEASE_RENEW_MS);
  return { stop: () => globalThis.clearInterval(timer) };
}

function applySourceStatus(settings: TimelineState["settings"], statuses: SourceStatus[]): TimelineState["settings"] {
  if (!statuses.length) return settings;
  const byId = new Map(statuses.map((status) => [status.id, status]));
  return {
    ...settings,
    sources: settings.sources.map((source): TimelineSource => {
      const status = byId.get(source.id);
      // Skip updates for sources the user re-pointed while the job was running.
      if (!status || status.url !== source.url) return source;
      const { id: _id, url: _url, ...health } = status;
      return { ...source, ...health };
    }),
  };
}

function createRun(kind: AutomationRun["kind"], eventId: string | null, owner: string, now: number, message: string): AutomationRun {
  return {
    id: createId("run"),
    kind,
    status: "running",
    message,
    eventId,
    owner,
    startedAt: now,
    finishedAt: null,
    headlineCount: 0,
  };
}

function finishRun(
  runs: AutomationRun[],
  runId: string,
  status: Exclude<AutomationRun["status"], "running">,
  message: string,
  headlineCount: number,
  now: number,
): AutomationRun[] {
  return runs.map((run) => run.id === runId
    ? { ...run, status, message: message.slice(0, 1_000), headlineCount, finishedAt: now }
    : run);
}

function formatRelative(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 6) / 10;
  return `${hours} 小时`;
}

/** Status line for the worker when idle. */
export function nextActionMessage(state: TimelineState): string {
  const due = state.events
    .filter((event) => event.status === "scheduled" || event.status === "waiting")
    .map((event) => ({ event, dueAt: analysisDueAt(event, state.settings) }))
    .sort((left, right) => left.dueAt - right.dueAt)[0];
  if (due && due.dueAt < state.nextDiscoveryAt) return `下一检查：${due.event.title}`;
  return `下次扫描：${new Date(state.nextDiscoveryAt).toLocaleString("zh-CN")}`;
}
