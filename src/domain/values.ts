import type { ImpactLevel, Lease } from "../types";

export function createId(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function stringValue(value: unknown, fallback: string, maxLength = 2_048): string {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength);
}

export function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Math.min(maximum, Math.max(minimum, numberValue(value, fallback)));
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 2_048))
    : [];
}

export function impactValue(value: unknown, fallback: ImpactLevel): ImpactLevel {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

export function impactRank(impact: ImpactLevel): number {
  return impact === "high" ? 3 : impact === "medium" ? 2 : 1;
}

export function leaseValue(value: unknown): Lease | null {
  const lease = asRecord(value);
  if (!lease || typeof lease.owner !== "string" || typeof lease.expiresAt !== "number") return null;
  return { owner: lease.owner.slice(0, 128), expiresAt: lease.expiresAt };
}

export function isLeaseActive(lease: Lease | null, now: number): lease is Lease {
  return Boolean(lease && lease.expiresAt > now);
}

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/** Lowercased letters/digits only, so wording and punctuation variants compare equal. */
export function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
