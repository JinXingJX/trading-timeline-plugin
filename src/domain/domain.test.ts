import { describe, expect, it } from "vitest";
import { NOW, makeEvent } from "../test/fixtures";
import { createManualEvent } from "./manualEvent";
import { capTimelineEvents, normalizeState, pruneSeenHeadlines, SEEN_HEADLINE_TTL_MS, SOURCE_PRESETS } from "./normalize";
import { dateKeyInTimeZone, isValidTimeZone, localInputValueInTimeZone, zonedDateTimeToIso } from "./time";
import { isSafePublicHttpUrl } from "./urls";

describe("time zones", () => {
  it("converts datetime-local values using the configured IANA timezone", () => {
    const iso = zonedDateTimeToIso("2026-07-16T09:30", "Asia/Shanghai");
    expect(iso).toBe("2026-07-16T01:30:00.000Z");
    expect(localInputValueInTimeZone(Date.parse(iso), "Asia/Shanghai")).toBe("2026-07-16T09:30");
    expect(dateKeyInTimeZone(Date.parse(iso), "America/Los_Angeles")).toBe("2026-07-15");
  });

  it("rejects invalid zones and nonexistent daylight-saving times", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(() => zonedDateTimeToIso("2026-03-08T02:30", "America/New_York")).toThrow("夏令时");
  });

  it("stores manual events as UTC with a confirmed time", () => {
    const event = createManualEvent({
      title: "FOMC",
      scheduledAt: "2026-07-16T09:30",
      impact: "high",
      category: "央行",
      symbols: ["SPY", " "],
      thesis: "验证利率路径",
      timezone: "Asia/Shanghai",
    });
    expect(event.scheduledAt).toBe("2026-07-16T01:30:00.000Z");
    expect(event.timezone).toBe("Asia/Shanghai");
    expect(event.timeConfirmed).toBe(true);
    expect(event.symbols).toEqual(["SPY"]);
  });
});

describe("network safety", () => {
  it("rejects local, credentialed, and reserved network targets before host fetch", () => {
    expect(isSafePublicHttpUrl("https://news.google.com/rss")).toBe(true);
    expect(isSafePublicHttpUrl("https://example.com/search?q={query}", true)).toBe(true);
    for (const url of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.2", "http://[::1]/", "https://user:pw@example.com", "file:///etc/passwd", "http://169.254.169.254/"]) {
      expect(isSafePublicHttpUrl(url)).toBe(false);
    }
  });
});

describe("state normalization", () => {
  it("migrates v1 state, healing orphaned analyzing events and filling new fields", () => {
    const state = normalizeState({
      version: 1,
      settings: { watchlist: ["SPY"], timezone: "UTC", sources: [{ id: "s", name: "S", url: "https://example.com/feed" }] },
      events: [{ id: "e", title: "CPI", scheduledAt: "2026-10-10T12:30:00Z", status: "analyzing" }],
      runs: [{ id: "r", kind: "analysis", status: "running" }],
    }, NOW);
    expect(state.version).toBe(3);
    expect(state.events[0]).toMatchObject({ status: "scheduled", lease: null, attempts: 0, timeConfirmed: true, searchQuery: "" });
    expect(state.settings.sources[0]).toMatchObject({ consecutiveFailures: 0, retryAfter: null });
    expect(state.seenHeadlines).toEqual([]);
    expect(state.discoveryLease).toBeNull();
  });

  it("upgrades untouched v2 built-in sources and appends missing presets", () => {
    const state = normalizeState({
      version: 2,
      settings: {
        watchlist: ["SPY"],
        timezone: "UTC",
        sources: [
          { id: "google-market-pulse", name: "Google", url: "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US%3Aen", enabled: true, consecutiveFailures: 4, retryAfter: NOW + 1 },
          { id: "federal-reserve", name: "Fed", url: "https://www.federalreserve.gov/feeds/press_all.xml", enabled: true },
          { id: "mine", name: "Mine", url: "https://example.com/feed", enabled: false },
        ],
      },
    }, NOW);
    const byId = new Map(state.settings.sources.map((source) => [source.id, source]));
    expect(byId.get("google-market-pulse")).toMatchObject({ enabled: false, consecutiveFailures: 0, retryAfter: null });
    expect(byId.get("federal-reserve")?.url).toBe("https://www.federalreserve.gov/feeds/press_monetary.xml");
    expect(byId.get("mine")).toMatchObject({ enabled: false, url: "https://example.com/feed" });
    expect(state.settings.sources.map((source) => source.id)).toEqual(expect.arrayContaining(SOURCE_PRESETS.map((preset) => preset.id)));
    // Once migrated, a user who removes a preset keeps it removed.
    const pruned = normalizeState({ ...state, settings: { ...state.settings, sources: [byId.get("mine")] } }, NOW);
    expect(pruned.settings.sources.map((source) => source.id)).toEqual(["mine"]);
  });

  it("keeps a built-in source the user re-pointed", () => {
    const state = normalizeState({
      version: 2,
      settings: { sources: [{ id: "federal-reserve", name: "Fed speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml" }] },
    }, NOW);
    expect(state.settings.sources[0]).toMatchObject({ name: "Fed speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml" });
  });

  it("normalizes untrusted settings and drops unsafe sources", () => {
    const state = normalizeState({
      settings: {
        watchlist: Array.from({ length: 40 }, (_, index) => `A${index}`),
        timezone: "Mars/Olympus",
        discoveryIntervalMinutes: 1,
        sources: [{ id: "bad", name: "Local", url: "http://127.0.0.1/feed" }],
      },
    }, NOW);
    expect(state.settings.watchlist).toHaveLength(30);
    expect(state.settings.discoveryIntervalMinutes).toBe(15);
    expect(isValidTimeZone(state.settings.timezone)).toBe(true);
    expect(state.settings.sources.every((source) => source.id !== "bad")).toBe(true);
  });

  it("retains actionable events before old completed history at the storage cap", () => {
    const completed = Array.from({ length: 300 }, (_, index) => makeEvent({ id: `history-${index}`, status: "completed", updatedAt: index }));
    const actionable = makeEvent({ id: "next", scheduledAt: "2026-10-11T00:00:00.000Z" });
    const capped = capTimelineEvents([...completed, actionable]);
    expect(capped).toHaveLength(300);
    expect(capped.some((event) => event.id === "next")).toBe(true);
  });

  it("expires and dedupes seen headlines", () => {
    const seen = pruneSeenHeadlines([
      { key: "a", seenAt: NOW - 1_000 },
      { key: "a", seenAt: NOW - 5_000 },
      { key: "old", seenAt: NOW - SEEN_HEADLINE_TTL_MS - 1 },
    ], NOW);
    expect(seen).toEqual([{ key: "a", seenAt: NOW - 1_000 }]);
  });
});
