import { describe, expect, it } from "vitest";
import { NOW, makeEvent, makeState } from "../test/fixtures";
import {
  analysisDueAt,
  applyAnalysisFailure,
  applyAnalysisWaiting,
  DATE_ONLY_ANALYSIS_DELAY_MS,
  MAX_ANALYSIS_ATTEMPTS,
  planNextJob,
  recoverStale,
  WAIT_LIMIT_MS,
} from "./scheduler";

describe("scheduler", () => {
  it("delays date-only events and honours retry times", () => {
    const settings = makeState().settings;
    const scheduled = Date.parse("2026-10-10T10:00:00.000Z");
    expect(analysisDueAt(makeEvent(), settings)).toBe(scheduled + settings.analysisDelayMinutes * 60_000);
    expect(analysisDueAt(makeEvent({ timeConfirmed: false }), settings)).toBe(scheduled + DATE_ONLY_ANALYSIS_DELAY_MS);
    expect(analysisDueAt(makeEvent({ nextAttemptAt: 42 }), settings)).toBe(42);
  });

  it("plans nothing when idle, discovery when due, then the earliest due event", () => {
    const later = makeEvent({ id: "later", scheduledAt: "2026-10-10T11:00:00.000Z" });
    const earlier = makeEvent({ id: "earlier", scheduledAt: "2026-10-10T09:00:00.000Z" });
    const future = makeEvent({ id: "future", scheduledAt: "2026-10-11T09:00:00.000Z" });
    expect(planNextJob(makeState({ events: [future] }), NOW)).toBeNull();
    expect(planNextJob(makeState({ events: [later, earlier], nextDiscoveryAt: NOW - 1 }), NOW)).toEqual({ kind: "discovery", forced: false });
    expect(planNextJob(makeState({ events: [later, earlier, future] }), NOW)).toEqual({ kind: "analysis", eventId: "earlier", manual: false });
  });

  it("skips failed, completed and leased events for automatic analysis", () => {
    const events = [
      makeEvent({ id: "failed", status: "failed" }),
      makeEvent({ id: "done", status: "completed" }),
      makeEvent({ id: "busy", status: "analyzing", lease: { owner: "other", expiresAt: NOW + 60_000 } }),
    ];
    expect(planNextJob(makeState({ events }), NOW)).toBeNull();
  });

  it("reports busy for explicit requests that conflict with live leases", () => {
    const leased = makeEvent({ status: "analyzing", lease: { owner: "other", expiresAt: NOW + 60_000 } });
    expect(planNextJob(makeState({ events: [leased] }), NOW, { analyzeEventId: leased.id })).toMatchObject({ kind: "busy" });
    const scanning = makeState({ discoveryLease: { owner: "other", expiresAt: NOW + 60_000 } });
    expect(planNextJob(scanning, NOW, { forceDiscovery: true })).toMatchObject({ kind: "busy" });
    expect(planNextJob(makeState({ events: [makeEvent({ status: "failed" })] }), NOW, { analyzeEventId: "event-1" }))
      .toEqual({ kind: "analysis", eventId: "event-1", manual: true });
  });

  it("backs off failed attempts and gives up after the limit", () => {
    let event = makeEvent();
    const delays: number[] = [];
    for (let attempt = 1; attempt < MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
      event = applyAnalysisFailure(event, "boom", NOW);
      expect(event).toMatchObject({ status: "scheduled", attempts: attempt, failureReason: "boom" });
      delays.push((event.nextAttemptAt ?? 0) - NOW);
    }
    expect(delays).toEqual([5 * 60_000, 15 * 60_000, 60 * 60_000]);
    event = applyAnalysisFailure(event, "boom", NOW);
    expect(event).toMatchObject({ status: "failed", attempts: MAX_ANALYSIS_ATTEMPTS, nextAttemptAt: null });
  });

  it("keeps the previous analysis when a re-analysis fails", () => {
    const analysis = { summary: "ok", marketReaction: "", verdict: "neutral" as const, confidence: 50, affectedAssets: [], scenarios: [], evidence: [], completedAt: 1 };
    const event = applyAnalysisFailure(makeEvent({ status: "analyzing", analysis }), "boom", NOW);
    expect(event).toMatchObject({ status: "completed", analysis, failureReason: "boom", nextAttemptAt: null });
  });

  it("waits for unreleased results without passing the conclusion deadline", () => {
    const recent = makeEvent({ scheduledAt: new Date(NOW - 30 * 60_000).toISOString() });
    const waiting = applyAnalysisWaiting(recent, "尚未公布", NOW);
    expect(waiting).toMatchObject({ status: "waiting", attempts: 0 });
    expect(waiting.nextAttemptAt).toBe(NOW + 30 * 60_000);
    expect(applyAnalysisWaiting(makeEvent(), "尚未公布", NOW).nextAttemptAt).toBe(NOW + 60 * 60_000);
    const late = makeEvent({ scheduledAt: new Date(NOW - WAIT_LIMIT_MS + 10 * 60_000).toISOString() });
    expect(applyAnalysisWaiting(late, "尚未公布", NOW).nextAttemptAt).toBe(NOW + 10 * 60_000);
  });

  it("recovers expired leases and orphaned runs, leaving live work alone", () => {
    const state = makeState({
      events: [
        makeEvent({ id: "dead", status: "analyzing", lease: { owner: "w1", expiresAt: NOW - 1 } }),
        makeEvent({ id: "live", status: "analyzing", lease: { owner: "w2", expiresAt: NOW + 60_000 } }),
      ],
      discoveryLease: { owner: "w3", expiresAt: NOW - 1 },
      runs: [
        { id: "r1", kind: "analysis", status: "running", message: "正在分析…", eventId: "dead", owner: "w1", startedAt: 0, finishedAt: null, headlineCount: 0 },
        { id: "r2", kind: "analysis", status: "running", message: "", eventId: "live", owner: "w2", startedAt: 0, finishedAt: null, headlineCount: 0 },
        { id: "r3", kind: "discovery", status: "running", message: "", eventId: null, owner: "w3", startedAt: 0, finishedAt: null, headlineCount: 0 },
      ],
    });
    const recovered = recoverStale(state, NOW);
    expect(recovered.events.find((event) => event.id === "dead")).toMatchObject({ status: "scheduled", attempts: 1, lease: null });
    expect(recovered.events.find((event) => event.id === "live")?.status).toBe("analyzing");
    expect(recovered.discoveryLease).toBeNull();
    expect(recovered.runs.map((run) => run.status)).toEqual(["interrupted", "running", "interrupted"]);
    expect(recoverStale(recovered, NOW)).toBe(recovered);
  });
});
