/**
 * Moving a logged food between meal slots, and reading the clock off one.
 *
 * Free of React and react-native imports so the bookkeeping — which is where
 * the corrections signal is either recorded honestly or quietly corrupted —
 * can be tested without a native renderer.
 *
 * The server side of this lives in `backend/nutrition/meal_timing.py`.
 */

import type { FoodItem } from "../components/nutrition/types";
import { normalizeMealLabel } from "./recentMeals";

/** A rectangle a dragged food can be dropped on, in screen coordinates. */
export interface DropZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The food as it should be stored after the user moves it to `targetMeal`.
 *
 * `moved_from` records the slot the APP chose, not the previous stop on a tour
 * of the meal list: a food dragged Snacks -> Dinner -> Pre-workout was still
 * mis-filed as a snack, and overwriting the origin at each hop would report
 * "dinner is wrong" instead. Moving it back to where it started clears both
 * flags — a drag that was undone is not evidence of anything, and leaving the
 * marks behind would let fidgeting look like a standing correction.
 *
 * Returns the same object when the move is a no-op, so callers can skip the
 * write.
 */
export function moveFoodToMeal(food: FoodItem, targetMeal: string): FoodItem {
  const current = normalizeMealLabel(food.meal);
  const target = normalizeMealLabel(targetMeal);
  if (current === target) return food;

  const origin = food.moved_from || food.meal;
  const backHome = Boolean(origin) && normalizeMealLabel(origin) === target;

  const next: FoodItem = { ...food, meal: targetMeal };
  if (backHome) {
    delete next.moved_from;
    delete next.slot_source;
  } else {
    next.slot_source = "user";
    if (origin) next.moved_from = origin;
  }
  return next;
}

/** True once the user has filed this row somewhere other than the app did. */
export function isMoved(food: FoodItem): boolean {
  if (!food.moved_from || !food.meal) return false;
  return normalizeMealLabel(food.moved_from) !== normalizeMealLabel(food.meal);
}

/**
 * Replace one item inside a day's list, leaving every other row untouched.
 *
 * `fit` is server-computed and dropped on the way back out; sending it would
 * write a stale score into storage the next read overwrites anyway.
 */
export function replaceFoodAt(
  items: FoodItem[],
  index: number,
  next: FoodItem
): FoodItem[] {
  return items.map((item, i) => {
    const value = i === index ? next : item;
    const { fit: _fit, ...rest } = value;
    return rest as FoodItem;
  });
}

function parseIso(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * "7:42 AM" for a food, or null when the clock says nothing about the meal.
 *
 * Mirrors `meal_time_minutes` on the backend: an explicit `eaten_at` is taken
 * at face value, a write time counts only when it lands on the day the food is
 * filed under. Logging Tuesday's dinner on Wednesday morning is normal, and
 * showing "9:14 AM" on it would be a lie the user has no way to correct.
 */
export function foodClockLabel(food: FoodItem, dateKey: string): string | null {
  const eaten = parseIso(food.eaten_at);
  const when = eaten || parseIso(food.logged_at);
  if (!when) return null;
  if (!eaten && dateKey && localDateKey(when) !== dateKey) return null;
  return when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The zone under a point, or null. Later zones win an overlap. */
export function dropTargetAt(
  x: number,
  y: number,
  zones: DropZone[]
): string | null {
  let hit: string | null = null;
  for (const zone of zones) {
    if (
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height
    ) {
      hit = zone.id;
    }
  }
  return hit;
}

/** Minutes past midnight -> "7:42 AM". Kept for rendering server figures. */
export function formatClockMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "1h 20m" for a span of minutes; "45m" under the hour. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
