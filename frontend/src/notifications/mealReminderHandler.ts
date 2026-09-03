/**
 * Handle lock-screen meal reminder actions: one-tap log, or open the app.
 */

import * as Notifications from "expo-notifications";
import apiClient from "../api/client";
import type { FoodItem, MacroEntry } from "../components/nutrition/types";
import { toDateKey } from "../components/nutrition/types";
import { slotToMealId } from "../lib/mealSlots";
import {
  MEAL_CHOICE_PREFIX,
  MEAL_FOLLOWUP_TYPE,
  MEAL_OPEN_ACTION,
  MEAL_REMINDER_TYPE,
  loadMealChoices,
  type MealReminderSlot,
} from "./mealReminder";
import { requestOpenMealLog } from "./pendingMealLog";

export type OpenMealLogRequest = {
  mealId: MealReminderSlot;
  date: string;
};

type MealLogListener = (request: OpenMealLogRequest) => void;

let openMealLogListener: MealLogListener | null = null;
let responseSub: Notifications.EventSubscription | null = null;
let handledResponseIds = new Set<string>();

export function setOpenMealLogHandler(listener: MealLogListener | null) {
  openMealLogListener = listener;
}

function todayEntry(entries: MacroEntry[], date: string): MacroEntry | undefined {
  return entries.find((e) => String(e.date || "").slice(0, 10) === date);
}

async function appendFoodsToDate(date: string, foods: FoodItem[]): Promise<void> {
  if (!foods.length) return;
  const res = await apiClient.get("/api/macros");
  const rows: MacroEntry[] = Array.isArray(res.data) ? res.data : [];
  const existing = todayEntry(rows, date);
  const current = existing?.food_items || [];

  // Don't double-log the same tagged usual from a repeated tap.
  const toAdd = foods.filter((f) => {
    const tag = f.usual_id || f.anchor_id;
    if (!tag) return true;
    return !current.some((x) => x.usual_id === tag || x.anchor_id === tag);
  });
  if (!toAdd.length) return;

  const next = [...current, ...toAdd];
  if (existing?.id && !String(existing.id).startsWith("local-")) {
    await apiClient.put(`/api/macros/${existing.id}`, {
      date,
      food_items: next,
    });
  } else {
    await apiClient.post("/api/macros", { date, food_items: next });
  }
}

async function cancelFollowUpsForMeal(
  mealId: MealReminderSlot,
  date: string
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => {
        const data = item.content?.data || {};
        return (
          data.type === MEAL_FOLLOWUP_TYPE &&
          data.mealId === mealId &&
          data.date === date
        );
      })
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
  );
}

export async function logMealChoiceFromNotification(
  mealId: MealReminderSlot,
  date: string,
  choiceIndex: number
): Promise<boolean> {
  const choices = await loadMealChoices(date, mealId);
  const choice = choices[choiceIndex];
  if (!choice?.foods?.length) return false;
  await appendFoodsToDate(date, choice.foods);
  await cancelFollowUpsForMeal(mealId, date);
  return true;
}

function isMealReminderType(type: unknown): boolean {
  return type === MEAL_REMINDER_TYPE || type === MEAL_FOLLOWUP_TYPE;
}

export async function handleMealNotificationResponse(
  response: Notifications.NotificationResponse
): Promise<void> {
  const responseId =
    response.notification.request.identifier +
    ":" +
    response.actionIdentifier +
    ":" +
    (response.notification.date || "");
  if (handledResponseIds.has(responseId)) return;
  handledResponseIds.add(responseId);
  if (handledResponseIds.size > 40) {
    handledResponseIds = new Set([...handledResponseIds].slice(-20));
  }

  const data = response.notification.request.content.data || {};
  if (!isMealReminderType(data.type)) return;

  const mealId = data.mealId as MealReminderSlot | undefined;
  const date = String(data.date || toDateKey(new Date()));
  if (!mealId) return;

  const action = response.actionIdentifier;

  if (action === Notifications.DEFAULT_ACTION_IDENTIFIER || action === MEAL_OPEN_ACTION) {
    requestOpenMealLog({ mealId, date });
    openMealLogListener?.({ mealId, date });
    return;
  }

  if (typeof action === "string" && action.startsWith(MEAL_CHOICE_PREFIX)) {
    const index = Number(action.slice(MEAL_CHOICE_PREFIX.length));
    if (!Number.isFinite(index)) return;
    try {
      await logMealChoiceFromNotification(mealId, date, index);
    } catch (error) {
      console.error("Failed to log meal from notification:", error);
      requestOpenMealLog({ mealId, date });
      openMealLogListener?.({ mealId, date });
    }
  }
}

/**
 * Wire response listeners once. Safe to call from App mount.
 * Also drains a cold-start tap that launched the app.
 */
export function setupMealReminderResponseHandler(): () => void {
  if (!responseSub) {
    responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleMealNotificationResponse(response);
    });
  }

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) void handleMealNotificationResponse(response);
  });

  return () => {
    responseSub?.remove();
    responseSub = null;
  };
}

/** True when today's macro log already has something in this meal slot. */
export function mealSlotLoggedInFoods(
  foods: FoodItem[],
  mealId: MealReminderSlot
): boolean {
  return foods.some((f) => slotToMealId(f.meal) === mealId);
}
