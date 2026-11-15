import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAutomationCycle } from "./automation";
import { mutateTimelineState, STATE_KEY } from "./domain/store";
import { installFakeHost, jsonFeed, uninstallFakeHost, type FakeHost } from "./test/fakeHost";
import { makeEvent, makeState, NOW } from "./test/fixtures";
import type { TimelineState } from "./types";

const FEED_ITEMS = [
  { title: "US CPI report due October 15 - Reuters", url: "https://n.example.com/cpi" },
  { title: "Fed minutes released", url: "https://n.example.com/fed" },
];

function stored(host: FakeHost): TimelineState {
  return host.storage.get(STATE_KEY) as TimelineState;
}

const discoveryReply = JSON.stringify({
  events: [{
    title: "美国9月CPI",
    scheduledAt: "2026-10-15T12:30:00Z",
    timeConfirmed: true,
    impact: "high",
    symbols: ["SPY"],
    searchQuery: "US CPI September",
    sourceUrls: ["https://n.example.com/cpi"],
  }],
});

const occurredReply = JSON.stringify({
  eventStatus: "occurred",
  summary: "利率维持不变",
  verdict: "neutral",
  confidence: 70,
  evidence: [{ url: "https://n.example.com/fed" }],
});

describe("automation cycle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    uninstallFakeHost();
  });

  it("discovers events, then skips the model when nothing new arrived", async () => {
    const host = installFakeHost({ model: () => discoveryReply, fetch: (url) => jsonFeed(url, FEED_ITEMS) });
    host.storage.set(STATE_KEY, makeState({ nextDiscoveryAt: NOW - 1 }));

    const first = await runAutomationCycle({ owner: "w" });
    expect(first.job).toEqual({ kind: "discovery", forced: false });
    expect(first.state.events).toHaveLength(1);
    expect(first.state.events[0]).toMatchObject({ title: "美国9月CPI", searchQuery: "US CPI September", status: "scheduled" });
    expect(first.state.discoveryLease).toBeNull();
    expect(first.state.seenHeadlines).toHaveLength(2);
    expect(first.state.runs[0]).toMatchObject({ status: "completed" });

    host.storage.set(STATE_KEY, { ...stored(host), nextDiscoveryAt: NOW - 1 });
    const second = await runAutomationCycle({ owner: "w" });
    expect(host.modelCalls).toHaveLength(1);
    expect(second.state.runs[0].message).toContain("无新增信息");
    expect(second.state.nextDiscoveryAt).toBeGreaterThan(NOW);
  });

  it("re-reads everything on a manual scan", async () => {
    const host = installFakeHost({ model: () => discoveryReply, fetch: (url) => jsonFeed(url, FEED_ITEMS) });
    host.storage.set(STATE_KEY, makeState({ seenHeadlines: FEED_ITEMS.map((item) => ({ key: "x", seenAt: NOW })) }));
    await runAutomationCycle({ owner: "dash", forceDiscovery: true });
    expect(host.modelCalls).toHaveLength(1);
  });

  it("completes a due event using event-search evidence", async () => {
    const host = installFakeHost({ model: () => occurredReply, fetch: (url) => jsonFeed(url, FEED_ITEMS) });
    host.storage.set(STATE_KEY, makeState({ events: [makeEvent()] }));
    const result = await runAutomationCycle({ owner: "w" });
    expect(result.job).toEqual({ kind: "analysis", eventId: "event-1", manual: false });
    expect(result.state.events[0]).toMatchObject({ status: "completed", lease: null, attempts: 0, analysis: { summary: "利率维持不变" } });
    expect(host.fetchCalls.some((url) => decodeURIComponent(url).includes("FOMC rate decision when:2d"))).toBe(true);
  });

  it("waits when the model reports the event has not happened", async () => {
    const host = installFakeHost({ model: () => JSON.stringify({ eventStatus: "not_yet", reason: "结果尚未公布" }), fetch: (url) => jsonFeed(url, FEED_ITEMS) });
    host.storage.set(STATE_KEY, makeState({ events: [makeEvent()] }));
    const { state } = await runAutomationCycle({ owner: "w" });
    expect(state.events[0]).toMatchObject({ status: "waiting", failureReason: "结果尚未公布", attempts: 0 });
    expect(state.events[0].nextAttemptAt).toBeGreaterThan(NOW);
    expect(state.runs[0].status).toBe("completed");
  });

  it("schedules a retry after a model transport failure", async () => {
    const host = installFakeHost({
      model: () => { throw new Error("Failed to read Codex stream event: Transport error: error decoding response body"); },
      fetch: (url) => jsonFeed(url, FEED_ITEMS),
    });
    host.storage.set(STATE_KEY, makeState({ events: [makeEvent()] }));
    const { state } = await runAutomationCycle({ owner: "w" });
    expect(state.events[0]).toMatchObject({ status: "scheduled", attempts: 1, nextAttemptAt: NOW + 5 * 60_000 });
    expect(state.events[0].failureReason).toMatch(/^模型连接中断/);
    expect(state.runs[0].status).toBe("failed");
  });

  it("lets the user edit while analysis runs, and discards results for dismissed events", async () => {
    const host = installFakeHost({
      fetch: (url) => jsonFeed(url, FEED_ITEMS),
      model: async () => {
        // The storage lock is free during the model call, so this edit succeeds immediately.
        await mutateTimelineState("user", (latest) => ({
          ...latest,
          events: latest.events.map((event) => ({ ...event, status: "dismissed", lease: null })),
        }));
        return occurredReply;
      },
    });
    host.storage.set(STATE_KEY, makeState({ events: [makeEvent()] }));
    const { state } = await runAutomationCycle({ owner: "w" });
    expect(state.events[0]).toMatchObject({ status: "dismissed", analysis: null });
    expect(state.runs[0].status).toBe("interrupted");
  });

  it("rejects explicit requests that conflict with running work", async () => {
    const host = installFakeHost();
    host.storage.set(STATE_KEY, makeState({
      events: [makeEvent({ status: "analyzing", lease: { owner: "other", expiresAt: NOW + 60_000 } })],
    }));
    await expect(runAutomationCycle({ owner: "dash", analyzeEventId: "event-1" })).rejects.toThrow("正在分析");
    await expect(runAutomationCycle({ owner: "w" })).resolves.toMatchObject({ job: null });
  });

  it("re-runs an exhausted event manually with a fresh retry budget", async () => {
    const host = installFakeHost({ model: () => occurredReply, fetch: (url) => jsonFeed(url, FEED_ITEMS) });
    host.storage.set(STATE_KEY, makeState({ events: [makeEvent({ status: "failed", attempts: 4 })] }));
    const { state } = await runAutomationCycle({ owner: "dash", analyzeEventId: "event-1" });
    expect(state.events[0]).toMatchObject({ status: "completed", attempts: 0 });
  });
});
