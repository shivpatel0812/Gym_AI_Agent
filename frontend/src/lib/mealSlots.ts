import { normalizeMealLabel } from "./recentMeals";
import { mealAnchorKind, type MealAnchor, type WeekdayKey } from "../api/nutritionPlan";

export type HomeMealId = "Breakfast" | "Lunch" | "Pre-Workout" | "Dinner" | "Snacks";

export const HOME_MEALS: {
  id: HomeMealId;
  label: string;
  short: string;
  slots: string[];
  window: string;
  icon: string;
}[] = [
  {
    id: "Breakfast",
    label: "Breakfast",
    short: "Bfast",
    slots: ["breakfast"],
    window: "6:00 AM – 10:00 AM",
    icon: "coffee-outline",
  },
  {
    id: "Lunch",
    label: "Lunch",
    short: "Lunch",
    slots: ["lunch"],
    window: "11:00 AM – 4:00 PM",
    icon: "food-fork-drink",
  },
  {
    id: "Pre-Workout",
    label: "Pre-workout",
    short: "Pre",
    slots: ["pre_workout", "shake"],
    window: "3:00 PM – 6:00 PM",
    icon: "dumbbell",
  },
  {
    id: "Dinner",
    label: "Dinner",
    short: "Dinner",
    slots: ["dinner"],
    window: "5:00 PM – 9:00 PM",
    icon: "silverware-fork-knife",
  },
  {
    id: "Snacks",
    label: "Snacks",
    short: "Snack",
    slots: ["snack", "late_night", "other"],
    window: "Anytime",
    icon: "food-apple-outline",
  },
];

const ALL_DAYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const JS_DAY_TO_KEY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function todayWeekdayKey(date = new Date()): WeekdayKey {
  return JS_DAY_TO_KEY[date.getDay()];
}

/** Resolve the weekdays an anchor (or go-to) applies to. */
export function planItemDays(item: {
  days?: string[] | null;
  frequency?: string | null;
}): WeekdayKey[] {
  const explicit = (item.days || [])
    .map((d) => String(d).slice(0, 3).toLowerCase() as WeekdayKey)
    .filter((d) => ALL_DAYS.includes(d));
  if (explicit.length) return explicit;
  const freq = String(item.frequency || "").toLowerCase();
  if (freq === "daily") return [...ALL_DAYS];
  if (freq === "weekdays") return ["mon", "tue", "wed", "thu", "fri"];
  if (freq === "weekends") return ["sat", "sun"];
  // Empty days + no restrictive frequency → every day (unset schedule).
  return [...ALL_DAYS];
}

export function planItemAppliesToday(
  item: { days?: string[] | null; frequency?: string | null },
  day: WeekdayKey = todayWeekdayKey()
): boolean {
  return planItemDays(item).includes(day);
}

export function slotToMealId(slot?: string | null): HomeMealId {
  const s = normalizeMealLabel(slot);
  if (s === "breakfast") return "Breakfast";
  if (s === "lunch") return "Lunch";
  if (s === "dinner") return "Dinner";
  if (s === "pre_workout" || s === "shake") return "Pre-Workout";
  return "Snacks";
}

export function foodBelongsToMeal(foodMeal: string | undefined, mealId: HomeMealId): boolean {
  if (!foodMeal) return false;
  return slotToMealId(foodMeal) === mealId;
}

/**
 * Which meal card should read as "now" from the local clock.
 * Dinner runs through 9 PM (hour 21) so evening uncertain dinners still surface.
 */
export function currentMealId(hour = new Date().getHours()): HomeMealId {
  if (hour >= 5 && hour < 10) return "Breakfast";
  if (hour >= 10 && hour < 11) return "Pre-Workout";
  if (hour >= 11 && hour < 16) return "Lunch";
  if (hour >= 16 && hour < 17) return "Pre-Workout";
  if (hour >= 17 && hour < 22) return "Dinner";
  return "Snacks";
}

export function stressWord(level: number) {
  if (level <= 3) return "Low";
  if (level <= 6) return "Manageable";
  if (level <= 8) return "High";
  return "Very high";
}

/** Prefer solid anchors for one-tap log; then potential; then uncertain. */
export function sortAnchorsForToday(anchors: MealAnchor[]): MealAnchor[] {
  const rank = (a: MealAnchor) => {
    const kind = mealAnchorKind(a);
    if (kind === "individual") return 0;
    if (kind === "potential") return 1;
    return 2;
  };
  return [...anchors].sort((a, b) => rank(a) - rank(b));
}

/**
 * True when this meal slot is "open" today: uncertain stance, an uncertain
 * meal on today's days, or plan meals exist for the slot but none cover today
 * (e.g. Mon–Wed dinner only → Thu is open / uncertain).
 */
export function mealSlotOpenToday(
  anchorsForSlot: MealAnchor[],
  todayAnchors: MealAnchor[],
  stance?: string | null
): boolean {
  if (todayAnchors.some((a) => mealAnchorKind(a) !== "uncertain")) return false;
  if (todayAnchors.some((a) => mealAnchorKind(a) === "uncertain")) return true;
  if (stance === "uncertain" || stance === "eat_out") return true;
  // Slot has plan meals on other days only — today is an open day.
  if (anchorsForSlot.length > 0 && todayAnchors.length === 0) return true;
  return false;
}
