/**
 * Meal-time reminders with lock-screen one-tap log choices.
 *
 * Local notifications (same model as sleep reminders). At each meal window we
 * show the user's usual options for that slot. Tapping a choice logs it via a
 * notification action without opening the app; tapping the body opens GymAI to
 * log something else. A gentler follow-up fires later if the meal is still empty.
 *
 * Choices are stored in AsyncStorage when we schedule — notification payloads
 * stay small and action handlers can rebuild the food list offline-of-plan.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  getActiveNutritionPlan,
  mealAnchorKind,
  type MealAnchor,
  type NutritionPlan,
  type WeekdayKey,
} from "../api/nutritionPlan";
import { normalizeMealLabel } from "../lib/recentMeals";
import {
  HOME_MEALS,
  HomeMealId,
  planItemAppliesToday,
  slotToMealId,
  todayWeekdayKey,
} from "../lib/mealSlots";
import type { FoodItem } from "../components/nutrition/types";
import { toDateKey } from "../components/nutrition/types";

const SETTINGS_KEY = "gymai.notifications.mealReminder";
const CHOICES_KEY_PREFIX = "gymai.notifications.mealChoices.";
const ANDROID_CHANNEL_ID = "meal-reminders";

/** Shared with sleep against iOS's 64 pending-notification cap. */
const HORIZON_DAYS = 5;
const MAX_CHOICES = 3;
/** Soft nudge if the meal still isn't logged. */
const FOLLOW_UP_MINUTES = 90;

export const MEAL_REMINDER_TYPE = "mealreminder";
export const MEAL_FOLLOWUP_TYPE = "mealreminderfollowup";
export const MEAL_OPEN_ACTION = "OPEN_APP";
export const MEAL_CHOICE_PREFIX = "CHOICE";

export type MealReminderSlot = Exclude<HomeMealId, "Snacks">;

export const MEAL_REMINDER_SLOTS: MealReminderSlot[] = [
  "Breakfast",
  "Lunch",
  "Pre-Workout",
  "Dinner",
];

export const DEFAULT_MEAL_TIMES: Record<
  MealReminderSlot,
  { hour: number; minute: number }
> = {
  Breakfast: { hour: 8, minute: 0 },
  Lunch: { hour: 12, minute: 0 },
  "Pre-Workout": { hour: 16, minute: 0 },
  Dinner: { hour: 18, minute: 30 },
};

export interface MealReminderSettings {
  enabled: boolean;
  times: Record<MealReminderSlot, { hour: number; minute: number }>;
  followUpEnabled: boolean;
}

export const DEFAULT_MEAL_REMINDER: MealReminderSettings = {
  enabled: false,
  times: { ...DEFAULT_MEAL_TIMES },
  followUpEnabled: true,
};

export type MealChoice = {
  id: string;
  label: string;
  foods: FoodItem[];
};

export function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export async function loadMealReminderSettings(): Promise<MealReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MEAL_REMINDER, times: { ...DEFAULT_MEAL_TIMES } };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      followUpEnabled: parsed?.followUpEnabled !== false,
      times: {
        ...DEFAULT_MEAL_TIMES,
        ...(parsed?.times || {}),
      },
    };
  } catch {
    return { ...DEFAULT_MEAL_REMINDER, times: { ...DEFAULT_MEAL_TIMES } };
  }
}

export async function saveMealReminderSettings(
  settings: MealReminderSettings
): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal — scheduled locals still stand until next sync.
  }
}

async function ensureMealChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Meal reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: [0, 180],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function ensureMealPermission(): Promise<boolean> {
  await ensureMealChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  if (!existing.canAskAgain) return false;
  const request = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return Boolean(request.granted);
}

function choicesStorageKey(date: string, mealId: MealReminderSlot) {
  return `${CHOICES_KEY_PREFIX}${date}.${mealId}`;
}

export async function storeMealChoices(
  date: string,
  mealId: MealReminderSlot,
  choices: MealChoice[]
): Promise<void> {
  await AsyncStorage.setItem(choicesStorageKey(date, mealId), JSON.stringify(choices));
}

export async function loadMealChoices(
  date: string,
  mealId: MealReminderSlot
): Promise<MealChoice[]> {
  try {
    const raw = await AsyncStorage.getItem(choicesStorageKey(date, mealId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shortLabel(label: string, max = 22): string {
  const trimmed = label.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function anchorToFoods(anchor: MealAnchor, mealId: MealReminderSlot): FoodItem[] {
  return (anchor.foods || [])
    .filter((f) => String(f.name || "").trim())
    .map((f) => ({
      name: String(f.name).trim(),
      amount: f.amount ? String(f.amount) : undefined,
      unit_amount: f.amount ? String(f.amount) : undefined,
      calories: Math.round(Number(f.calories) || 0),
      protein: Number(f.protein) || 0,
      carbs: Number(f.carbs) || 0,
      fats: Number(f.fats) || 0,
      fiber: Number(f.fiber) || 0,
      meal: mealId,
      anchor_id: anchor.id,
      usual_id: anchor.id,
    }));
}

/**
 * Usual options for a slot: plan anchors that apply on that weekday, then
 * go-tos for the same slot. Cap at MAX_CHOICES for lock-screen actions.
 */
export function buildMealChoices(
  plan: NutritionPlan | null,
  mealId: MealReminderSlot,
  weekday: WeekdayKey
): MealChoice[] {
  if (!plan) return [];
  const mealMeta = HOME_MEALS.find((m) => m.id === mealId);
  const slots = new Set((mealMeta?.slots || []).map((s) => normalizeMealLabel(s)));
  const out: MealChoice[] = [];
  const seen = new Set<string>();

  const anchors = (plan.meal_anchors || [])
    .filter((a) => a.id && slots.has(normalizeMealLabel(a.slot)))
    .filter((a) => planItemAppliesToday(a, weekday))
    .filter((a) => mealAnchorKind(a) !== "uncertain")
    .filter((a) => (a.foods || []).some((f) => f.name));

  for (const anchor of anchors) {
    if (out.length >= MAX_CHOICES) break;
    const id = String(anchor.id);
    if (seen.has(id)) continue;
    const foods = anchorToFoods(anchor, mealId);
    if (!foods.length) continue;
    seen.add(id);
    out.push({
      id,
      label: anchor.label || foods[0].name,
      foods,
    });
  }

  if (out.length < MAX_CHOICES) {
    for (const item of plan.go_to_items || []) {
      if (out.length >= MAX_CHOICES) break;
      if (!item.id || !String(item.name || "").trim()) continue;
      if (!slots.has(normalizeMealLabel(item.slot))) continue;
      if (item.days?.length && !planItemAppliesToday(item, weekday)) continue;
      const id = `goto:${item.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: String(item.name).trim(),
        foods: [
          {
            name: String(item.name).trim(),
            amount: item.amount ? String(item.amount) : undefined,
            unit_amount: item.amount ? String(item.amount) : undefined,
            calories: Math.round(Number(item.calories) || 0),
            protein: Number(item.protein) || 0,
            carbs: Number(item.carbs) || 0,
            fats: Number(item.fats) || 0,
            fiber: Number(item.fiber) || 0,
            meal: mealId,
            usual_id: item.id,
            anchor_id: item.id,
          },
        ],
      });
    }
  }

  return out;
}

/** Category ids cannot contain `-` or `:` (Expo). */
export function mealCategoryId(date: string, mealId: MealReminderSlot): string {
  const compact = date.replace(/-/g, "");
  const slot =
    mealId === "Pre-Workout" ? "Pre" : mealId === "Breakfast" ? "Bfast" : mealId;
  return `meal${slot}${compact}`;
}

async function registerCategory(
  categoryId: string,
  choices: MealChoice[]
): Promise<void> {
  const actions: Notifications.NotificationAction[] = choices.map((choice, index) => ({
    identifier: `${MEAL_CHOICE_PREFIX}${index}`,
    buttonTitle: shortLabel(choice.label),
    options: {
      // Log in the background when possible — no full app flash.
      opensAppToForeground: false,
    },
  }));
  actions.push({
    identifier: MEAL_OPEN_ACTION,
    buttonTitle: "Something else",
    options: { opensAppToForeground: true },
  });
  await Notifications.setNotificationCategoryAsync(categoryId, actions, {
    previewPlaceholder: "Log a meal",
  });
}

async function cancelOurs(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => {
        const type = item.content?.data?.type;
        return type === MEAL_REMINDER_TYPE || type === MEAL_FOLLOWUP_TYPE;
      })
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
  );
}

function mealAlreadyLogged(
  mealId: MealReminderSlot,
  foods: FoodItem[]
): boolean {
  return foods.some((f) => slotToMealId(f.meal) === mealId);
}

/**
 * Schedule primary + optional follow-up notifications for the next few days.
 *
 * `loggedByDate` maps YYYY-MM-DD → foods already on that day (usually today only).
 */
export async function syncMealReminders(
  settings: MealReminderSettings,
  plan: NutritionPlan | null,
  loggedByDate: Record<string, FoodItem[]> = {}
): Promise<number> {
  await cancelOurs();
  if (!settings.enabled) return 0;

  const granted = await ensureMealPermission();
  if (!granted) return 0;
  await ensureMealChannel();

  const now = new Date();
  let scheduled = 0;

  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    day.setHours(12, 0, 0, 0);
    const date = toDateKey(day);
    const weekday = todayWeekdayKey(day);
    const dayFoods = loggedByDate[date] || [];

    for (const mealId of MEAL_REMINDER_SLOTS) {
      if (mealAlreadyLogged(mealId, dayFoods)) continue;

      const choices = buildMealChoices(plan, mealId, weekday);
      const time = settings.times[mealId] || DEFAULT_MEAL_TIMES[mealId];
      const when = new Date(day);
      when.setHours(time.hour, time.minute, 0, 0);
      if (when.getTime() <= now.getTime()) continue;

      await storeMealChoices(date, mealId, choices);
      const categoryId = mealCategoryId(date, mealId);
      if (choices.length) {
        await registerCategory(categoryId, choices);
      }

      const choiceLine = choices.map((c) => c.label).join(" · ");
      const body = choices.length
        ? `Usual picks: ${choiceLine}. Tap one to log, or open the app.`
        : "Tap to log this meal — add whatever you ate.";

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${mealId === "Pre-Workout" ? "Pre-workout" : mealId} time`,
          body,
          categoryIdentifier: choices.length ? categoryId : undefined,
          data: {
            type: MEAL_REMINDER_TYPE,
            mealId,
            date,
            choiceIds: choices.map((c) => c.id),
          },
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      });
      scheduled += 1;

      if (!settings.followUpEnabled) continue;
      const followWhen = new Date(when.getTime() + FOLLOW_UP_MINUTES * 60_000);
      if (followWhen.getTime() <= now.getTime()) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Still need to log ${mealId === "Pre-Workout" ? "pre-workout" : mealId.toLowerCase()}?`,
          body: choices.length
            ? `Quick add one of your usuals, or open GymAI when you're ready.`
            : "No rush — tap when you want to log it.",
          categoryIdentifier: choices.length ? categoryId : undefined,
          data: {
            type: MEAL_FOLLOWUP_TYPE,
            mealId,
            date,
            choiceIds: choices.map((c) => c.id),
          },
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: followWhen,
        },
      });
      scheduled += 1;
    }
  }

  return scheduled;
}

export async function clearMealReminders(): Promise<void> {
  await cancelOurs();
}

/** Fire a sample lunch-style reminder in a few seconds for testing. */
export async function sendTestMealReminder(
  plan: NutritionPlan | null = null
): Promise<boolean> {
  const granted = await ensureMealPermission();
  if (!granted) return false;
  await ensureMealChannel();

  const active = plan || (await getActiveNutritionPlan().catch(() => null));
  const mealId: MealReminderSlot = "Lunch";
  const date = toDateKey(new Date());
  const choices = buildMealChoices(active, mealId, todayWeekdayKey());
  await storeMealChoices(date, mealId, choices);
  const categoryId = mealCategoryId(date, mealId);
  if (choices.length) await registerCategory(categoryId, choices);

  const when = new Date(Date.now() + 5_000);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Lunch time",
      body: choices.length
        ? `Usual picks: ${choices.map((c) => c.label).join(" · ")}`
        : "Test meal reminder — tap to open logging.",
      categoryIdentifier: choices.length ? categoryId : undefined,
      data: {
        type: MEAL_REMINDER_TYPE,
        mealId,
        date,
        choiceIds: choices.map((c) => c.id),
        test: true,
      },
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
    },
  });
  return true;
}
