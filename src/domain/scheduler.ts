import type { AutomationRun, MarketEvent, TimelineSettings, TimelineState } from "../types";
import { isLeaseActive } from "./values";

/** Long jobs hold a lease instead of the storage lock; executors renew it while working. */
export const JOB_LEASE_MS = 3 * 60_000;
export const LEASE_RENEW_MS = 60_000;
export const MAX_ANALYSIS_ATTEMPTS = 4;
/** After this long past the scheduled time the model must conclude instead of waiting. */
export const WAIT_LIMIT_MS = 36 * 60 * 60_000;
/** Date-only events are analysed late in the day so after-close releases are covered. */
export const DATE_ONLY_ANALYSIS_DELAY_MS = 12 * 60 * 60_000;

const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];
const AUTO_ANALYSIS_STATUSES: MarketEvent["status"][] = ["scheduled", "waiting"];

export type AutomationJob =
  | { kind: "discovery"; forced: boolean }
  | { kind: "analysis"; eventId: string; manual: boolean };

export type JobPlan = AutomationJob | { kind: "busy"; message: string } | null;

export type JobRequest = {
  forceDiscovery?: boolean;
  analyzeEventId?: string;
};

export function analysisDueAt(event: MarketEvent, settings: TimelineSettings): number {
  if (event.nextAttemptAt !== null) return event.nextAttemptAt;
  const delay = event.timeConfirmed ? settings.analysisDelayMinutes * 60_000 : DATE_ONLY_ANALYSIS_DELAY_MS;
  return Date.parse(event.scheduledAt) + delay;
}

export function isEventLeased(event: MarketEvent, now: number): boolean {
  return event.status === "analyzing" && isLeaseActive(event.lease, now);
}

/** Whether the model must give a conclusion now rather than report "not yet happened". */
export function mustConclude(event: MarketEvent, now: number): boolean {
  return now - Date.parse(event.scheduledAt) >= WAIT_LIMIT_MS;
}

/**
 * Picks the single job an executor should run next, or null when nothing is due.
 * Explicit requests (manual scan / analyse) win over scheduled work.
 */
export function planNextJob(state: TimelineState, now: number, request: JobRequest = {}): JobPlan {
  if (request.analyzeEventId) {
    const event = state.events.find((item) => item.id === request.analyzeEventId);
    if (!event || event.status === "dismissed") return { kind: "busy", message: "事件不存在或已移出时间线。" };
    if (isEventLeased(event, now)) return { kind: "busy", message: "该事件正在分析中，请稍候。" };
    return { kind: "analysis", eventId: event.id, manual: true };
  }
  const discoveryRunning = isLeaseActive(state.discoveryLease, now);
  if (request.forceDiscovery) {
    return discoveryRunning
      ? { kind: "busy", message: "市场扫描正在进行，请稍候。" }
      : { kind: "discovery", forced: true };
  }
  if (!discoveryRunning && now >= state.nextDiscoveryAt) {
    return { kind: "discovery", forced: false };
  }
  const due = state.events
    .filter((event) => AUTO_ANALYSIS_STATUSES.includes(event.status))
    .map((event) => ({ event, dueAt: analysisDueAt(event, state.settings) }))
    .filter((item) => item.dueAt <= now)
    .sort((left, right) => left.dueAt - right.dueAt)[0];
  return due ? { kind: "analysis", eventId: due.event.id, manual: false } : null;
}

/** Earliest time any automatic job becomes due; lets the worker skip idle ticks. */
export function nextWakeAt(state: TimelineState, now: number): number {
  const candidates = [isLeaseActive(state.discoveryLease, now) ? state.discoveryLease.expiresAt : state.nextDiscoveryAt];
  for (const event of state.events) {
    if (AUTO_ANALYSIS_STATUSES.includes(event.status)) candidates.push(analysisDueAt(event, state.settings));
    if (event.status === "analyzing" && event.lease) candidates.push(event.lease.expiresAt);
  }
  return Math.min(...candidates);
}

/** Counts a failed attempt and schedules a backoff retry, or gives up after the limit. */
export function applyAnalysisFailure(event: MarketEvent, reason: string, now: number): MarketEvent {
  const attempts = event.attempts + 1;
  const exhausted = attempts >= MAX_ANALYSIS_ATTEMPTS;
  return {
    ...event,
    // A re-analysis of a completed event keeps its previous result on failure.
    status: event.analysis ? "completed" : exhausted ? "failed" : "scheduled",
    lease: null,
    attempts: event.analysis ? 0 : attempts,
    nextAttemptAt: event.analysis || exhausted ? null : now + RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)],
    failureReason: reason.slice(0, 1_000),
    lastAttemptAt: now,
    updatedAt: now,
  };
}

/** The event has not happened yet: check again later, more slowly as time passes. */
export function applyAnalysisWaiting(event: MarketEvent, reason: string, now: number): MarketEvent {
  const elapsed = now - Date.parse(event.scheduledAt);
  const delay = elapsed < 2 * 60 * 60_000 ? 30 * 60_000 : elapsed < 12 * 60 * 60_000 ? 60 * 60_000 : 2 * 60 * 60_000;
  const deadline = Date.parse(event.scheduledAt) + WAIT_LIMIT_MS;
  return {
    ...event,
    status: "waiting",
    lease: null,
    attempts: 0,
    nextAttemptAt: Math.min(now + delay, Math.max(deadline, now + 5 * 60_000)),
    failureReason: reason.slice(0, 1_000),
    lastAttemptAt: now,
    updatedAt: now,
  };
}

/**
 * Heals state left behind by executors that died mid-job (app closed, iframe recycled):
 * expired analysis leases count as a failed attempt, expired discovery leases are dropped,
 * and runs with no live owner are marked interrupted. Returns the input when unchanged.
 */
export function recoverStale(state: TimelineState, now: number): TimelineState {
  let changed = false;
  const events = state.events.map((event) => {
    if (event.status !== "analyzing" || isLeaseActive(event.lease, now)) return event;
    changed = true;
    return applyAnalysisFailure(event, "分析被中断（应用关闭或后台被回收），将自动重试。", now);
  });
  const discoveryLease = isLeaseActive(state.discoveryLease, now) ? state.discoveryLease : null;
  if (discoveryLease !== state.discoveryLease) changed = true;
  const liveOwners = new Set<string>();
  if (discoveryLease) liveOwners.add(`discovery:${discoveryLease.owner}`);
  for (const event of events) {
    if (event.status === "analyzing" && event.lease) liveOwners.add(`analysis:${event.lease.owner}:${event.id}`);
  }
  const runs = state.runs.map((run): AutomationRun => {
    if (run.status !== "running") return run;
    const key = run.kind === "discovery" ? `discovery:${run.owner}` : `analysis:${run.owner}:${run.eventId}`;
    if (liveOwners.has(key)) return run;
    changed = true;
    return { ...run, status: "interrupted", message: `${run.message.replace(/…$/, "")}（已中断）`, finishedAt: now };
  });
  return changed ? { ...state, events, runs, discoveryLease } : state;
}
