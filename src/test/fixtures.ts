import { createDefaultState, createSource } from "../domain/normalize";
import type { MarketEvent, TimelineState } from "../types";

export const NOW = Date.parse("2026-10-10T12:00:00.000Z");

export function makeEvent(overrides: Partial<MarketEvent> = {}): MarketEvent {
  return {
    id: "event-1",
    title: "美联储利率决议",
    scheduledAt: "2026-10-10T10:00:00.000Z",
    timezone: "UTC",
    timeConfirmed: true,
    category: "央行",
    impact: "high",
    symbols: ["SPY"],
    thesis: "",
    rationale: "",
    searchQuery: "FOMC rate decision",
    sourceUrls: ["https://news.example.com/fomc"],
    status: "scheduled",
    analysis: null,
    failureReason: null,
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lease: null,
    discoveredAt: NOW - 86_400_000,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
    ...overrides,
  };
}

export function makeState(overrides: Partial<TimelineState> = {}): TimelineState {
  const base = createDefaultState(NOW);
  return {
    ...base,
    settings: {
      ...base.settings,
      timezone: "UTC",
      sources: [createSource({ id: "feed", name: "Test Feed", url: "https://feeds.example.com/markets.json" })],
    },
    nextDiscoveryAt: NOW + 3_600_000,
    ...overrides,
  };
}
