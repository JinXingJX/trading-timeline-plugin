import type { MarketEvent } from "../types";
import { capTimelineEvents } from "./normalize";
import { normalizeTitle } from "./values";

export type DiscoveredEvent = {
  event: MarketEvent;
  /** Id of an existing timeline event the model says this candidate refers to. */
  existingId: string | null;
};

const MATCH_WINDOW_MS = 36 * 60 * 60_000;
const FUZZY_TITLE_THRESHOLD = 0.6;

/**
 * Folds freshly discovered events into the timeline. A candidate updates an existing
 * event when the model names its id, when the normalized titles match, or when titles
 * are similar enough and the times are close; otherwise it is added.
 */
export function mergeDiscoveredEvents(
  existing: MarketEvent[],
  candidates: DiscoveredEvent[],
  now: number,
): { events: MarketEvent[]; added: number; updated: number } {
  const events = [...existing];
  let added = 0;
  let updated = 0;
  for (const candidate of candidates) {
    const index = findMatch(events, candidate);
    if (index < 0) {
      events.push(candidate.event);
      added += 1;
      continue;
    }
    const current = events[index];
    if (current.status === "completed" || current.status === "dismissed") continue;
    events[index] = mergeEvent(current, candidate.event, now);
    updated += 1;
  }
  return { events: capTimelineEvents(events), added, updated };
}

function findMatch(events: MarketEvent[], candidate: DiscoveredEvent): number {
  if (candidate.existingId) {
    const byId = events.findIndex((event) => event.id === candidate.existingId);
    if (byId >= 0) return byId;
  }
  const time = Date.parse(candidate.event.scheduledAt);
  const title = normalizeTitle(candidate.event.title);
  const nearby = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => Math.abs(Date.parse(event.scheduledAt) - time) <= MATCH_WINDOW_MS);
  const exact = nearby.find(({ event }) => normalizeTitle(event.title) === title);
  if (exact) return exact.index;
  let best = { index: -1, score: FUZZY_TITLE_THRESHOLD };
  for (const { event, index } of nearby) {
    const score = titleSimilarity(event.title, candidate.event.title);
    if (score >= best.score) best = { index, score };
  }
  return best.index;
}

function mergeEvent(current: MarketEvent, candidate: MarketEvent, now: number): MarketEvent {
  // Never trade a confirmed time for a date-only guess.
  const takeCandidateTime = candidate.timeConfirmed || !current.timeConfirmed;
  const scheduledAt = takeCandidateTime ? candidate.scheduledAt : current.scheduledAt;
  const timeChanged = scheduledAt !== current.scheduledAt;
  const sourceUrls = [...new Set([...current.sourceUrls, ...candidate.sourceUrls])].slice(0, 12);
  const hasNewSources = sourceUrls.length > current.sourceUrls.length;
  const merged: MarketEvent = {
    ...current,
    title: candidate.title || current.title,
    scheduledAt,
    timezone: takeCandidateTime ? candidate.timezone : current.timezone,
    timeConfirmed: current.timeConfirmed || candidate.timeConfirmed,
    category: candidate.category || current.category,
    impact: candidate.impact,
    symbols: [...new Set([...current.symbols, ...candidate.symbols])].slice(0, 20),
    thesis: candidate.thesis || current.thesis,
    rationale: candidate.rationale || current.rationale,
    searchQuery: candidate.searchQuery || current.searchQuery,
    sourceUrls,
    updatedAt: now,
  };
  if (current.status === "analyzing") return merged;
  if (timeChanged) {
    // A new time invalidates retry/wait schedules computed for the old one.
    return { ...merged, status: "scheduled", attempts: 0, nextAttemptAt: null, failureReason: null };
  }
  if (current.status === "failed" && hasNewSources) {
    return { ...merged, status: "scheduled", attempts: 0, nextAttemptAt: null };
  }
  return merged;
}

/** Dice coefficient over character bigrams; works for both CJK and Latin titles. */
export function titleSimilarity(left: string, right: string): number {
  const a = bigrams(normalizeTitle(left));
  const b = bigrams(normalizeTitle(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function bigrams(value: string): Set<string> {
  const chars = [...value];
  const grams = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) grams.add(chars[index] + chars[index + 1]);
  if (chars.length === 1) grams.add(chars[0]);
  return grams;
}
