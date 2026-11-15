import { describeJobError } from "./ai/modelJson";
import { nextActionMessage, runAutomationCycle } from "./automation";
import { planNextJob } from "./domain/scheduler";
import { loadRecoveredState, saveWorkerStatus } from "./domain/store";
import { createId } from "./domain/values";
import type { WorkerStatus } from "./types";

const TICK_MS = 30_000;
/** Heartbeat refresh; the dashboard treats the worker as offline after 90s of silence. */
const HEARTBEAT_MS = 45_000;
/** Back-to-back jobs per tick, so a backlog drains without waiting for the next tick. */
const MAX_JOBS_PER_TICK = 5;

/** Runs discovery and due analyses while the plugin is enabled; returns a function that stops it. */
export function startBackgroundWorker(): () => void {
  const owner = createId("background");
  let disposed = false;
  let running = false;
  let lastStatus: WorkerStatus | null = null;

  function report(phase: WorkerStatus["phase"], message: string) {
    const now = Date.now();
    if (lastStatus && lastStatus.phase === phase && lastStatus.message === message
      && now - lastStatus.heartbeatAt < HEARTBEAT_MS) {
      return;
    }
    lastStatus = { owner, phase, message, heartbeatAt: now };
    void saveWorkerStatus(lastStatus).catch(() => undefined);
  }

  async function tick() {
    if (disposed || running) return;
    running = true;
    try {
      for (let jobs = 0; jobs < MAX_JOBS_PER_TICK && !disposed; jobs += 1) {
        // Decide read-only first: idle ticks never take the storage lock.
        const state = await loadRecoveredState();
        const plan = planNextJob(state, Date.now());
        if (!plan || plan.kind === "busy") {
          report("idle", nextActionMessage(state));
          return;
        }
        const result = await runAutomationCycle({ owner, onPhase: report });
        if (!result.job) {
          report("idle", nextActionMessage(result.state));
          return;
        }
      }
    } catch (error) {
      report("error", describeJobError(error, "后台自动化失败。"));
      console.error("Trading Timeline background cycle failed", error);
    } finally {
      running = false;
    }
  }

  void tick();
  const timer = globalThis.setInterval(() => void tick(), TICK_MS);
  return () => {
    disposed = true;
    globalThis.clearInterval(timer);
  };
}
