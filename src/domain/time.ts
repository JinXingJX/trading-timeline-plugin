export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function validTimeZoneValue(value: unknown, fallback: string): string {
  return typeof value === "string" && isValidTimeZone(value) ? value : fallback;
}

export function zonedDateTimeToIso(value: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) throw new Error(`无效时区：${timeZone}`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error("计划时间格式无效。");
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  if (!Number.isFinite(targetUtc)) throw new Error("计划时间无效。");
  let guess = targetUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = zonedParts(guess, timeZone);
    const renderedUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
    const difference = targetUtc - renderedUtc;
    guess += difference;
    if (difference === 0) break;
  }
  const verified = zonedParts(guess, timeZone);
  if (Object.keys(target).some((key) => target[key as keyof typeof target] !== verified[key as keyof typeof verified])) {
    throw new Error("该本地时间在所选时区中不存在，可能处于夏令时切换区间。");
  }
  return new Date(guess).toISOString();
}

export function localInputValueInTimeZone(timestamp: number, timeZone: string): string {
  const parts = zonedParts(timestamp, validTimeZoneValue(timeZone, "UTC"));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function dateKeyInTimeZone(timestamp: number, timeZone: string): string {
  const parts = zonedParts(timestamp, validTimeZoneValue(timeZone, "UTC"));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
