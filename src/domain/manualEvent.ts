import type { ImpactLevel, MarketEvent } from "../types";
import { validTimeZoneValue, zonedDateTimeToIso } from "./time";
import { createId } from "./values";

export function createManualEvent(input: {
  title: string;
  scheduledAt: string;
  impact: ImpactLevel;
  category: string;
  symbols: string[];
  thesis: string;
  timezone: string;
}, now = Date.now()): MarketEvent {
  if (!input.title.trim()) throw new Error("事件标题不能为空。");
  if (input.title.length > 180) throw new Error("事件标题不能超过 180 个字符。");
  return {
    id: createId("event"),
    title: input.title.trim().slice(0, 180),
    scheduledAt: zonedDateTimeToIso(input.scheduledAt, input.timezone),
    timezone: validTimeZoneValue(input.timezone, "UTC"),
    timeConfirmed: true,
    category: input.category.trim().slice(0, 40) || "手动事件",
    impact: input.impact,
    symbols: input.symbols.map((item) => item.trim().slice(0, 30)).filter(Boolean).slice(0, 20),
    thesis: input.thesis.trim().slice(0, 600),
    rationale: "由用户手动加入时间线。",
    searchQuery: "",
    sourceUrls: [],
    status: "scheduled",
    analysis: null,
    failureReason: null,
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lease: null,
    discoveredAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
