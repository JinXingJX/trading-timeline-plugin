import { dailyHost } from "../host";
import type { TimelineState, WorkerStatus } from "../types";
import { createDefaultState, normalizeState } from "./normalize";
import { recoverStale } from "./scheduler";
import { asRecord, stringValue } from "./values";

export const STATE_KEY = "timeline.state.v1";
export const WORKER_STATUS_KEY = "timeline.worker.status";
export const AUTOMATION_LOCK_KEY = "timeline.automation.lock";

/**
 * The storage lock only guards a single read-modify-write of the state document, which
 * takes milliseconds. Long jobs never hold it; they use per-job leases inside the state.
 */
const LOCK_LEASE_MS = 30_000;
const LOCK_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1_500, 2_000];

type LockValue = { owner: string; expiresAt: number };

export async function loadTimelineState(now = Date.now()): Promise<TimelineState> {
  const stored = await dailyHost().storage.get(STATE_KEY);
  return stored ? normalizeState(stored, now) : createDefaultState(now);
}

/** Read-only view with crashed jobs healed, for display and scheduling decisions. */
export async function loadRecoveredState(now = Date.now()): Promise<TimelineState> {
  return recoverStale(await loadTimelineState(now), now);
}

export type Transaction<T> = {
  /** The state to persist, or undefined to leave storage untouched. */
  next?: TimelineState;
  result: T;
};

/**
 * Runs `update` against the latest stored state under the storage lock and persists its
 * result. Stale jobs are recovered first so every writer sees a healed document.
 */
export async function transact<T>(
  owner: string,
  update: (latest: TimelineState, now: number) => Transaction<T>,
): Promise<{ state: TimelineState; result: T }> {
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await withTimelineLock(owner, async () => {
      const now = Date.now();
      const loaded = await loadTimelineState(now);
      const latest = recoverStale(loaded, now);
      const { next, result } = update(latest, now);
      const toSave = next ?? (latest === loaded ? null : latest);
      if (!toSave) return { state: latest, result };
      const saved = normalizeState({ ...toSave, updatedAt: now }, now);
      await dailyHost().storage.set(STATE_KEY, saved);
      return { state: saved, result };
    });
    if (outcome) return outcome;
    if (attempt >= LOCK_RETRY_DELAYS_MS.length) {
      throw new Error("时间线正忙，请稍后重试。");
    }
    await sleep(LOCK_RETRY_DELAYS_MS[attempt]);
  }
}

export async function mutateTimelineState(
  owner: string,
  mutation: (latest: TimelineState, now: number) => TimelineState,
): Promise<TimelineState> {
  return (await transact(owner, (latest, now) => ({ next: mutation(latest, now), result: null }))).state;
}

export async function withTimelineLock<T>(owner: string, task: () => Promise<T>): Promise<T | null> {
  if (!(await acquireTimelineLock(owner))) return null;
  try {
    return await task();
  } finally {
    await releaseTimelineLock(owner).catch(() => undefined);
  }
}

async function acquireTimelineLock(owner: string): Promise<boolean> {
  const host = dailyHost();
  const currentValue = await host.storage.get(AUTOMATION_LOCK_KEY);
  const current = asRecord(currentValue);
  if (current && typeof current.owner === "string" && typeof current.expiresAt === "number"
    && current.expiresAt > Date.now() && current.owner !== owner) {
    return false;
  }
  const lock: LockValue = { owner, expiresAt: Date.now() + LOCK_LEASE_MS };
  return host.storage.compareAndSet(AUTOMATION_LOCK_KEY, currentValue, lock);
}

async function releaseTimelineLock(owner: string): Promise<void> {
  const host = dailyHost();
  const currentValue = await host.storage.get(AUTOMATION_LOCK_KEY);
  const current = asRecord(currentValue);
  if (current?.owner === owner) {
    await host.storage.compareAndRemove(AUTOMATION_LOCK_KEY, currentValue);
  }
}

export async function loadWorkerStatus(): Promise<WorkerStatus | null> {
  const value = asRecord(await dailyHost().storage.get(WORKER_STATUS_KEY));
  if (!value || typeof value.owner !== "string" || typeof value.heartbeatAt !== "number") {
    return null;
  }
  const phase = ["idle", "discovering", "analyzing", "error"].includes(String(value.phase))
    ? value.phase as WorkerStatus["phase"]
    : "error";
  return {
    owner: value.owner.slice(0, 128),
    phase,
    message: stringValue(value.message, "", 1_000),
    heartbeatAt: value.heartbeatAt,
  };
}

export async function saveWorkerStatus(status: WorkerStatus): Promise<void> {
  await dailyHost().storage.set(WORKER_STATUS_KEY, status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
