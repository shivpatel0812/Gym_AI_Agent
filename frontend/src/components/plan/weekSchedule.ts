/**
 * Pure helpers for the THIS WEEK calendar strip.
 * Kept free of React Native so the swap logic can be unit-tested.
 */

import { dayFamilyKey, dayFamilyLabel } from "./dayFamilies";

export const WEEK_STRIP = [
  { key: "monday", short: "Mon" },
  { key: "tuesday", short: "Tue" },
  { key: "wednesday", short: "Wed" },
  { key: "thursday", short: "Thu" },
  { key: "friday", short: "Fri" },
  { key: "saturday", short: "Sat" },
  { key: "sunday", short: "Sun" },
] as const;

export type WeekdayKey = (typeof WEEK_STRIP)[number]["key"];

export function shortScheduleLabel(assignment: string): string {
  const trimmed = String(assignment || "").trim();
  if (!trimmed || /^rest$/i.test(trimmed)) return "Rest";
  return dayFamilyLabel(dayFamilyKey(trimmed)).split(/\s+/)[0] || trimmed;
}

/** Swap two weekday assignments. Missing days become Rest so the write is complete. */
export function swapScheduleDays(
  schedule: Record<string, string>,
  from: string,
  to: string
): Record<string, string> {
  if (from === to) return schedule;
  const next: Record<string, string> = { ...schedule };
  for (const { key } of WEEK_STRIP) {
    if (!next[key]) next[key] = "Rest";
  }
  const a = next[from] || "Rest";
  const b = next[to] || "Rest";
  next[from] = b;
  next[to] = a;
  return next;
}
