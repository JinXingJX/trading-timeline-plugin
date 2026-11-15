import { describe, expect, it } from "vitest";
import { NOW, makeEvent } from "../test/fixtures";
import { mergeDiscoveredEvents, titleSimilarity } from "./merge";

const candidate = (overrides: Parameters<typeof makeEvent>[0], existingId: string | null = null) => ({
  event: makeEvent({ id: "new", sourceUrls: ["https://news.example.com/new"], ...overrides }),
  existingId,
});

describe("mergeDiscoveredEvents", () => {
  it("updates by model-provided id even when the title changed", () => {
    const existing = makeEvent({ id: "fomc", title: "FOMC 会议" });
    const result = mergeDiscoveredEvents([existing], [candidate({ title: "完全不同的措辞" }, "fomc")], NOW);
    expect(result).toMatchObject({ added: 0, updated: 1 });
    expect(result.events[0]).toMatchObject({ id: "fomc", title: "完全不同的措辞" });
    expect(result.events[0].sourceUrls).toEqual(["https://news.example.com/fomc", "https://news.example.com/new"]);
  });

  it("matches near-identical titles at nearby times instead of duplicating", () => {
    const existing = makeEvent({ id: "cpi", title: "美国9月CPI数据公布" });
    const result = mergeDiscoveredEvents([existing], [candidate({ title: "美国 9 月 CPI 数据公布！", scheduledAt: "2026-10-10T10:30:00.000Z" })], NOW);
    expect(result).toMatchObject({ added: 0, updated: 1 });
    expect(titleSimilarity("美国9月CPI数据公布", "美国9月CPI数据发布")).toBeGreaterThanOrEqual(0.6);
  });

  it("adds unrelated or far-apart events", () => {
    const existing = makeEvent({ id: "cpi", title: "美国CPI" });
    const result = mergeDiscoveredEvents([existing], [
      candidate({ id: "a", title: "英伟达财报" }),
      candidate({ id: "b", title: "美国CPI", scheduledAt: "2026-11-12T10:00:00.000Z" }),
    ], NOW);
    expect(result).toMatchObject({ added: 2, updated: 0 });
  });

  it("never replaces a confirmed time with a date-only guess", () => {
    const existing = makeEvent({ id: "cpi" });
    const result = mergeDiscoveredEvents([existing], [candidate({ scheduledAt: "2026-10-10T08:00:00.000Z", timeConfirmed: false }, "cpi")], NOW);
    expect(result.events[0]).toMatchObject({ scheduledAt: existing.scheduledAt, timeConfirmed: true });
  });

  it("revives failed events with new sources and resets schedules when the time moves", () => {
    const failed = makeEvent({ id: "f", status: "failed", attempts: 4 });
    const revived = mergeDiscoveredEvents([failed], [candidate({}, "f")], NOW).events[0];
    expect(revived).toMatchObject({ status: "scheduled", attempts: 0, nextAttemptAt: null });
    const waiting = makeEvent({ id: "w", status: "waiting", nextAttemptAt: NOW + 1 });
    const moved = mergeDiscoveredEvents([waiting], [candidate({ scheduledAt: "2026-10-12T10:00:00.000Z" }, "w")], NOW).events[0];
    expect(moved).toMatchObject({ status: "scheduled", nextAttemptAt: null });
  });

  it("leaves completed, dismissed and in-flight state intact", () => {
    const done = makeEvent({ id: "done", status: "completed" });
    const busy = makeEvent({ id: "busy", title: "其他", status: "analyzing", lease: { owner: "w", expiresAt: NOW + 1 } });
    const result = mergeDiscoveredEvents([done, busy], [candidate({ title: "新标题" }, "done"), candidate({ title: "其他" }, "busy")], NOW);
    expect(result.events.find((event) => event.id === "done")?.title).toBe(done.title);
    expect(result.events.find((event) => event.id === "busy")).toMatchObject({ status: "analyzing", lease: busy.lease });
  });
});
