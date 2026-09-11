/**
 * Moving a logged food between meal slots, and reading the clock off one.
 * Free of React so the bookkeeping can be tested without a renderer.
 */

import type { FoodItem } from "../types";
import { normalizeMealLabel } from "./recentMeals";

export interface DropZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

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

export function isMoved(food: FoodItem): boolean {
  if (!food.moved_from || !food.meal) return false;
  return normalizeMealLabel(food.moved_from) !== normalizeMealLabel(food.meal);
}

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

export function foodClockLabel(food: FoodItem, dateKey: string): string | null {
  const eaten = parseIso(food.eaten_at);
  const when = eaten || parseIso(food.logged_at);
  if (!when) return null;
  if (!eaten && dateKey && localDateKey(when) !== dateKey) return null;
  return when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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

export function formatClockMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
