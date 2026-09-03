/**
 * Cross-screen signal: a meal notification asked to open the food logger.
 */

import type { MealReminderSlot } from "./mealReminder";

export type PendingMealLog = {
  mealId: MealReminderSlot;
  date: string;
};

type Listener = (pending: PendingMealLog) => void;

let pending: PendingMealLog | null = null;
const listeners = new Set<Listener>();

export function requestOpenMealLog(next: PendingMealLog) {
  pending = next;
  listeners.forEach((listener) => listener(next));
}

export function consumePendingMealLog(): PendingMealLog | null {
  const value = pending;
  pending = null;
  return value;
}

export function subscribeMealLogOpen(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) listener(pending);
  return () => {
    listeners.delete(listener);
  };
}
