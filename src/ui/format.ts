import { MAX_SOURCES } from "../domain/normalize";
import { dateKeyInTimeZone, isValidTimeZone } from "../domain/time";
import { isSafePublicHttpUrl } from "../domain/urls";
import type { AffectedAsset, ImpactLevel, MarketEvent, MarketVerdict, TimelineSettings } from "../types";

export function impactLabel(impact: ImpactLevel): string {
  return impact === "high" ? "高影响" : impact === "medium" ? "中影响" : "低影响";
}

export function statusLabel(event: MarketEvent): string {
  switch (event.status) {
    case "scheduled": return event.attempts > 0 ? "待重试" : "待发生";
    case "waiting": return "等待结果";
    case "analyzing": return "分析中";
    case "completed": return "已分析";
    case "failed": return "需手动重试";
    case "dismissed": return "已忽略";
  }
}

export function verdictLabel(verdict: MarketVerdict) {
  return { bullish: "偏多", bearish: "偏空", mixed: "分化", neutral: "中性" }[verdict];
}

export function directionLabel(direction: AffectedAsset["direction"]) {
  return { up: "↑ 上行", down: "↓ 下行", volatile: "↕ 波动", unclear: "? 待定" }[direction];
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${(minutes / 60).toFixed(1)} 小时`;
}

export function formatDayHeading(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone }).format(date);
}

export function formatShortTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

export function formatFullDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

export function formatDateOnly(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", timeZone }).format(date);
}

export function countdown(timestamp: number) {
  const delta = timestamp - Date.now();
  if (delta <= 0) return "等待分析";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时 ${minutes % 60} 分后`;
  return `${Math.floor(hours / 24)} 天后`;
}

export function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

export function relativeFuture(timestamp: number) {
  const minutes = Math.max(0, Math.round((timestamp - Date.now()) / 60_000));
  if (minutes < 1) return "即将开始";
  if (minutes < 60) return `${minutes} 分钟后`;
  return `${Math.round(minutes / 60)} 小时后`;
}

export function compactUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 54);
  } catch {
    return url.slice(0, 54);
  }
}

export function groupEventsByDay(events: MarketEvent[], timeZone: string) {
  const groups = new Map<string, MarketEvent[]>();
  for (const event of events) {
    const key = dateKeyInTimeZone(Date.parse(event.scheduledAt), timeZone);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const todayKey = dateKeyInTimeZone(Date.now(), timeZone);
  const tomorrowKey = dateKeyInTimeZone(Date.now() + 86_400_000, timeZone);
  const yesterdayKey = dateKeyInTimeZone(Date.now() - 86_400_000, timeZone);
  return [...groups.entries()].map(([key, grouped]) => {
    const date = new Date(grouped[0].scheduledAt);
    const prefix = key === todayKey ? "今天" : key === tomorrowKey ? "明天" : key === yesterdayKey ? "昨天" : null;
    const day = formatDayHeading(date, timeZone);
    return { key, label: prefix ? `${prefix} · ${day}` : day, events: grouped };
  });
}

export function cloneSettings(settings: TimelineSettings): TimelineSettings {
  return { ...settings, watchlist: [...settings.watchlist], sources: settings.sources.map((source) => ({ ...source })) };
}

export function validateSettings(settings: TimelineSettings): string | null {
  if (!settings.watchlist.length) return "至少保留一个关注资产。";
  if (settings.watchlist.length > 30) return "关注资产不能超过 30 个。";
  if (!isValidTimeZone(settings.timezone)) return `无效时区：${settings.timezone}`;
  if (!settings.sources.length) return "至少保留一个数据源。";
  if (settings.sources.length > MAX_SOURCES) return `数据源不能超过 ${MAX_SOURCES} 个。`;
  for (const source of settings.sources) {
    if (!source.name.trim()) return "数据源名称不能为空。";
    if (source.name.length > 120 || source.url.length > 2048) return `数据源“${source.name}”过长。`;
    if (!isSafePublicHttpUrl(source.url, true)) return `数据源“${source.name}”的 URL 无效。`;
  }
  return null;
}
