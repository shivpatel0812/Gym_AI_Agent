/**
 * Day blueprint: Breakfast → Lunch → Pre-workout → Dinner → Snack.
 * Each slot has a stance + meal anchors (with weekday days) + optional fast food.
 */

import type {
  FastFoodPlace,
  MealAnchor,
  MealAnchorFood,
  NutritionPlan,
  PrimaryMealSlot,
  SlotProfile,
  SlotStance,
} from "../api/nutritionPlan";
import {
  PRIMARY_SLOT_OPTIONS,
  daysLabel,
  mealAnchorKind,
  mealFoodGroups,
  slotLabel,
  sumGroupedFoodMacros,
} from "../api/nutritionPlan";
import { foodNamesMatch } from "./recentMeals";

export type DayMapKind = "anchor" | "flexible" | "one_time" | "suggest" | "stance" | "goto";

export interface DayMapSlot {
  id: string;
  kind: DayMapKind;
  slot: string;
  band?: string;
  title: string;
  detail: string;
  calories?: number | null;
  caloriesMin?: number | null;
  caloriesMax?: number | null;
  protein?: number | null;
  proteinMin?: number | null;
  proteinMax?: number | null;
  foods?: string[];
  fillWith?: string[];
  /** OR-groups for Previous matching (shake A|B + yogurt X|Y). */
  foodGroups?: Array<{ key: string; names: string[]; matchSimilar?: boolean }>;
  days?: string[];
  daysText?: string;
  sourceId?: string;
  sourceIndex?: number;
  /** Random / varies-each-time meal anchor (potential). */
  varies?: boolean;
  /** Open / undecided meal. */
  uncertain?: boolean;
  /** individual | potential | uncertain */
  mealKind?: "individual" | "potential" | "uncertain";
  /** ai_coach | ai_slot | logged | user — labels the meal row on the plan. */
  source?: string | null;
  /** A pending coach edit targets this meal. */
  aiPending?: boolean;
}

export interface MealTargetRow {
  id: string;
  band?: string;
  slot: string;
  title: string;
  kind: DayMapKind;
  targetText: string;
  fillWith: string[];
  daysText?: string;
}

export interface SlotSection {
  slot: PrimaryMealSlot;
  label: string;
  stance: SlotStance;
  stanceNotes?: string | null;
  anchors: DayMapSlot[];
  goTos: DayMapSlot[];
  places: FastFoodPlace[];
}

export interface DayMapStack {
  target: number;
  anchors: number;
  flexible: number;
  oneTime: number;
  suggested: number;
  free: number;
}

export type DayStatus = "anchored" | "uncertain" | "eat_out" | "skip";

export interface WeeklyBar {
  id: string;
  label: string;
  short: string;
  calories: number;
}

export interface DayMapModel {
  slots: DayMapSlot[];
  /** @deprecated use sections — kept for older callers */
  bands: { band: string; items: DayMapSlot[] }[];
  sections: SlotSection[];
  table: MealTargetRow[];
  stack: DayMapStack;
  proteinTarget: number;
  proteinPlanned: number;
  proteinSuggested: number;
  headline: string;
  goalLabel?: string | null;
  weeklyBars: WeeklyBar[];
  weeklyAvg: number;
  suggestions: unknown[];
}

export const SLOT_TIME_LABELS: Record<string, string> = {
  breakfast: "7:00 AM",
  lunch: "12:30 PM",
  pre_workout: "4:30 PM",
  dinner: "7:00 PM",
  snack: "3:00 PM",
};

const WEEKDAYS = [
  { id: "mon", label: "Mon", short: "M" },
  { id: "tue", label: "Tue", short: "T" },
  { id: "wed", label: "Wed", short: "W" },
  { id: "thu", label: "Thu", short: "T" },
  { id: "fri", label: "Fri", short: "F" },
  { id: "sat", label: "Sat", short: "S" },
  { id: "sun", label: "Sun", short: "S" },
];

function dayIdsOf(slot: DayMapSlot): string[] {
  const days = (slot.days || []).map((d) => String(d).slice(0, 3).toLowerCase());
  if (days.length) return days;
  // No explicit days → treat as most weekdays for planning bars
  return ["mon", "tue", "wed", "thu", "fri"];
}

export function dayStatusForSlot(section: SlotSection, dayId: string): DayStatus {
  const anchors = section.anchors.filter((a) => a.kind === "anchor" || a.kind === "flexible");
  const onDay = anchors.filter((a) => dayIdsOf(a).includes(dayId));
  if (onDay.some((a) => a.mealKind === "individual" || (a.kind === "anchor" && !a.varies && !a.uncertain))) {
    return "anchored";
  }
  if (onDay.some((a) => a.mealKind === "potential" || a.varies)) return "anchored";
  if (onDay.some((a) => a.mealKind === "uncertain" || a.uncertain)) return "uncertain";
  if (section.stance === "eat_out") return "eat_out";
  if (section.stance === "uncertain") return "uncertain";
  if (onDay.length) return "anchored";
  return "skip";
}

export function buildWeeklyBars(sections: SlotSection[], allSlots: DayMapSlot[]): WeeklyBar[] {
  return WEEKDAYS.map((d) => {
    let calories = 0;
    for (const slot of allSlots) {
      if (!dayIdsOf(slot).includes(d.id)) continue;
      if (slot.kind === "flexible") {
        const min = slot.caloriesMin ?? 0;
        const max = slot.caloriesMax ?? min;
        calories += (min + max) / 2;
      } else if (slot.calories) {
        calories += slot.calories;
      }
    }
    return { id: d.id, label: d.label, short: d.short, calories: Math.round(calories) };
  });
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function sumFoods(foods: MealAnchorFood[] = []) {
  return foods.reduce(
    (acc, f) => {
      acc.calories += num(f.calories);
      acc.protein += num(f.protein);
      return acc;
    },
    { calories: 0, protein: 0 }
  );
}

function profileFor(plan: NutritionPlan, slot: PrimaryMealSlot): SlotProfile {
  const found = (plan.slot_profiles || []).find((p) => p.slot === slot);
  return found || { slot, stance: "anchors", notes: null };
}

function mapSlot(slot: string): PrimaryMealSlot | null {
  const s = (slot || "").toLowerCase();
  if (s === "shake") return "pre_workout";
  if (s === "late_night") return "snack";
  if (s === "breakfast" || s === "lunch" || s === "pre_workout" || s === "dinner" || s === "snack") {
    return s;
  }
  return null;
}

export function bandFor(slot: string): string {
  const primary = mapSlot(slot);
  if (primary === "breakfast" || primary === "pre_workout") return "Morning";
  if (primary === "lunch" || primary === "snack") return "Midday";
  if (primary === "dinner") return "Evening";
  return "Late";
}

export function buildDayMap(
  plan: NutritionPlan,
  options?: { pendingTargetIds?: Set<string> | string[] }
): DayMapModel {
  const pendingIds =
    options?.pendingTargetIds instanceof Set
      ? options.pendingTargetIds
      : new Set(options?.pendingTargetIds || []);
  const target = num(plan.targets?.calories);
  const proteinTarget = num(plan.targets?.protein);

  let anchorsCal = 0;
  let anchorsPro = 0;
  const allSlots: DayMapSlot[] = [];

  const anchorsBySlot: Record<string, DayMapSlot[]> = {
    breakfast: [],
    lunch: [],
    pre_workout: [],
    dinner: [],
    snack: [],
  };
  const goTosBySlot: Record<string, DayMapSlot[]> = {
    breakfast: [],
    lunch: [],
    pre_workout: [],
    dinner: [],
    snack: [],
  };

  (plan.meal_anchors || []).forEach((anchor: MealAnchor, i) => {
    const mealKind = mealAnchorKind(anchor);
    const groups = mealFoodGroups(anchor.foods || []);
    const macros =
      mealKind === "individual"
        ? sumGroupedFoodMacros(anchor.foods || [])
        : sumFoods(anchor.foods || []);
    const foods = (anchor.foods || []).map((f) => f.name).filter(Boolean);
    const displayFoods =
      mealKind === "individual" && groups.length
        ? groups.map((g) =>
            g.names.length > 1 || g.matchSimilar
              ? `${g.names[0]}${g.matchSimilar ? " (any similar)" : ` (+${g.names.length - 1})`}`
              : g.names[0]
          )
        : foods;
    const n = Math.max(foods.length, 1);
    // Potential meals: count typical pick (~avg of options), not sum of all.
    const cal = mealKind === "potential" ? macros.calories / n : macros.calories;
    const pro = mealKind === "potential" ? macros.protein / n : macros.protein;
    anchorsCal += cal;
    anchorsPro += pro;
    const slotRaw = String(anchor.slot || "other");
    const primary = mapSlot(slotRaw) || "snack";
    // Materialize frequency-only anchors so the day grid matches what "daily" / "weekdays" mean.
    let days = (anchor.days || [])
      .map((d) => String(d).slice(0, 3).toLowerCase())
      .filter((d) => WEEKDAYS.some((w) => w.id === d));
    if (!days.length) {
      const freq = String(anchor.frequency || "").toLowerCase();
      if (freq === "daily") days = WEEKDAYS.map((w) => w.id);
      else if (freq === "weekdays") days = ["mon", "tue", "wed", "thu", "fri"];
      else if (freq === "weekends") days = ["sat", "sun"];
    }
    const placeBit = anchor.place?.trim() ? `at ${anchor.place.trim()}` : null;
    let detail = displayFoods.join(", ") || "Meal";
    if (mealKind === "potential") {
      detail = [
        placeBit || "Pick from options",
        foods.length ? `${foods.length} options: ${foods.join(", ")}` : "add 3–4 options",
      ]
        .filter(Boolean)
        .join(" · ");
    } else if (mealKind === "uncertain") {
      detail = [placeBit || "Undecided", foods.length ? `ideas: ${foods.join(", ")}` : "open day"]
        .filter(Boolean)
        .join(" · ");
    }
    const mapped: DayMapSlot = {
      id: `anchor-${anchor.id || i}`,
      kind: "anchor",
      slot: primary,
      band: bandFor(primary),
      title: anchor.label || slotLabel(primary),
      detail,
      calories: mealKind === "uncertain" ? null : cal || null,
      protein: mealKind === "uncertain" ? null : pro || null,
      foods: displayFoods,
      fillWith: foods,
      foodGroups: groups.map((g) => ({
        key: g.key,
        names: g.names,
        matchSimilar: g.matchSimilar,
      })),
      days,
      daysText: daysLabel(days, anchor.frequency),
      sourceId: anchor.id,
      sourceIndex: i,
      varies: mealKind === "potential",
      uncertain: mealKind === "uncertain",
      mealKind,
      source: anchor.source || null,
      aiPending: Boolean(anchor.id && pendingIds.has(String(anchor.id))),
    };
    anchorsBySlot[primary].push(mapped);
    allSlots.push(mapped);
  });

  // Flexible meals still count toward the bar; attach under dinner/lunch heuristically.
  let flexCal = 0;
  let flexPro = 0;
  (plan.flexible_meals || []).forEach((meal, i) => {
    const cmin = num(meal.calorie_min);
    const cmax = num(meal.calorie_max) || cmin;
    const mid = cmin && cmax ? (cmin + cmax) / 2 : cmax || cmin;
    const pmin = num(meal.protein_min);
    const pmax = num(meal.protein_max) || pmin;
    const pmid = pmin && pmax ? (pmin + pmax) / 2 : pmax || pmin;
    flexCal += mid;
    flexPro += pmid;
    const name = (meal.name || "").toLowerCase();
    let slot: PrimaryMealSlot = "dinner";
    if (name.includes("lunch")) slot = "lunch";
    else if (name.includes("breakfast")) slot = "breakfast";
    else if (name.includes("snack")) slot = "snack";
    const mapped: DayMapSlot = {
      id: `flex-${meal.id || i}`,
      kind: "flexible",
      slot,
      band: bandFor(slot),
      title: meal.name || "Flexible meal",
      detail: meal.notes?.trim() || "Flexible / not fully controlled",
      caloriesMin: cmin || null,
      caloriesMax: cmax || null,
      proteinMin: pmin || null,
      proteinMax: pmax || null,
      daysText: daysLabel(meal.days, meal.frequency),
      sourceId: meal.id,
      sourceIndex: i,
    };
    anchorsBySlot[slot].push(mapped);
    allSlots.push(mapped);
  });

  let goToCal = 0;
  let goToPro = 0;
  const anchorFoodNames = (plan.meal_anchors || []).flatMap((a) =>
    (a.foods || []).map((f) => String(f.name || "").trim()).filter(Boolean)
  );
  (plan.go_to_items || []).forEach((item, i) => {
    const name = String(item.name || "").trim();
    // Skip go-tos that are already a food inside an anchored meal.
    if (name && anchorFoodNames.some((af) => foodNamesMatch(af, name))) {
      return;
    }
    const primary = mapSlot(String(item.slot || "other")) || "snack";
    const cal = num(item.calories);
    const pro = num(item.protein);
    goToCal += cal;
    goToPro += pro;
    const mapped: DayMapSlot = {
      id: `goto-${item.id || i}`,
      kind: "goto",
      slot: primary,
      band: bandFor(primary),
      title: item.name || "Go-to",
      detail: [item.amount, item.notes].filter(Boolean).join(" · ") || "Go-to item",
      calories: cal || null,
      protein: pro || null,
      foods: item.name ? [item.name] : [],
      fillWith: item.name ? [item.name] : [],
      days: (item.days || []).map(String),
      daysText: daysLabel(item.days),
      sourceId: item.id,
      sourceIndex: i,
    };
    goTosBySlot[primary].push(mapped);
    allSlots.push(mapped);
  });

  const sections: SlotSection[] = PRIMARY_SLOT_OPTIONS.map(({ id, label }) => {
    const profile = profileFor(plan, id);
    const places = (plan.fast_food_places || []).filter((p) =>
      (p.slots || ["lunch", "dinner"]).includes(id)
    );
    return {
      slot: id,
      label,
      stance: (profile.stance as SlotStance) || "anchors",
      stanceNotes: profile.notes,
      anchors: anchorsBySlot[id] || [],
      goTos: goTosBySlot[id] || [],
      places,
    };
  });

  // Blueprint extras are planned calories too — the stack had a slot for them
  // that was always zero, so the day read lighter than the plan actually was.
  let extraCal = 0;
  let extraPro = 0;
  (plan.blueprint_extras || []).forEach((extra) => {
    const cal =
      num(extra.calories) ||
      (num(extra.calorie_min) && num(extra.calorie_max)
        ? (num(extra.calorie_min) + num(extra.calorie_max)) / 2
        : num(extra.calorie_min) || num(extra.calorie_max));
    const pro =
      num(extra.protein) ||
      (num(extra.protein_min) && num(extra.protein_max)
        ? (num(extra.protein_min) + num(extra.protein_max)) / 2
        : num(extra.protein_min) || num(extra.protein_max));
    extraCal += cal;
    extraPro += pro;
  });

  const used = anchorsCal + flexCal + goToCal + extraCal;
  const free = target > 0 ? Math.max(0, target - used) : 0;
  const uncertain = sections.filter((s) => s.stance === "uncertain" || s.stance === "eat_out").length;

  const goal = String(plan.goal || "").toLowerCase();
  let headline = "Your day by meal — anchors, go-tos, and eat-out slots.";
  if (goal.includes("muscle") || goal.includes("recomp")) {
    headline = "Build muscle, keep fat in check.";
  } else if (goal.includes("cut") || goal.includes("loss") || goal.includes("lean")) {
    headline = "Stay in a deficit without losing strength.";
  } else if (goal.includes("bulk") || goal.includes("gain")) {
    headline = "Fuel growth — hit protein every day.";
  } else if (uncertain) {
    headline = `${uncertain} meal${uncertain === 1 ? "" : "s"} marked flexible / eat-out — add anchors where you can.`;
  } else if (target > 0 && free > 200) {
    headline = `About ${Math.round(free)} kcal still open across the day.`;
  } else if (target > 0 && free < 80) {
    headline = "Anchors cover most of your calorie target.";
  } else if (plan.goal_detail?.trim()) {
    headline = plan.goal_detail.trim();
  }

  const table: MealTargetRow[] = allSlots.map((slot) => {
    const parts: string[] = [];
    if (slot.kind === "flexible") {
      if (slot.caloriesMin != null && slot.caloriesMax != null) {
        parts.push(
          slot.caloriesMin === slot.caloriesMax
            ? `${Math.round(slot.caloriesMin)} kcal`
            : `${Math.round(slot.caloriesMin)}–${Math.round(slot.caloriesMax)} kcal`
        );
      }
    } else if (slot.calories) {
      parts.push(`${Math.round(slot.calories)} kcal`);
    }
    if (slot.protein) parts.push(`${Math.round(slot.protein)}g P`);
    return {
      id: slot.id,
      slot: slot.slot,
      band: slot.band,
      title: slot.title,
      kind: slot.kind,
      targetText: parts.join(" · ") || "Set foods / macros",
      fillWith: slot.fillWith || slot.foods || [],
      daysText: slot.daysText,
    };
  });

  const weeklyBars = buildWeeklyBars(sections, allSlots);
  const mappedDays = weeklyBars.filter((b) => b.calories > 0);
  const weeklyAvg = mappedDays.length
    ? Math.round(mappedDays.reduce((s, b) => s + b.calories, 0) / mappedDays.length)
    : Math.round(used);

  return {
    slots: allSlots,
    bands: sections.map((s) => ({ band: s.label, items: [...s.anchors, ...s.goTos] })),
    sections,
    table,
    stack: {
      target: target || used || 1,
      anchors: Math.round(anchorsCal),
      flexible: Math.round(flexCal),
      oneTime: Math.round(extraCal),
      suggested: Math.round(goToCal),
      free: Math.round(free),
    },
    proteinTarget,
    proteinPlanned: Math.round(anchorsPro + flexPro + goToPro + extraPro),
    proteinSuggested: Math.round(goToPro),
    headline,
    goalLabel: plan.goal || null,
    weeklyBars,
    weeklyAvg,
    suggestions: [],
  };
}

export function stackPercents(stack: DayMapStack) {
  const t = Math.max(stack.target, 1);
  const a = Math.min(100, (stack.anchors / t) * 100);
  const f = Math.min(100 - a, (stack.flexible / t) * 100);
  const o = Math.min(100 - a - f, (stack.oneTime / t) * 100);
  const s = Math.min(100 - a - f - o, (stack.suggested / t) * 100);
  const free = Math.max(0, 100 - a - f - o - s);
  return { anchors: a, flexible: f, oneTime: o, suggested: s, free };
}

export function defaultMacrosForAdd(slot: string) {
  if (slot === "pre_workout") {
    return { calories: 140, protein: 4, calorie_min: 100, calorie_max: 180, protein_min: 2, protein_max: 10 };
  }
  if (slot === "shake") {
    return { calories: 160, protein: 30, calorie_min: 120, calorie_max: 220, protein_min: 20, protein_max: 40 };
  }
  if (slot === "snack") {
    return { calories: 180, protein: 12, calorie_min: 120, calorie_max: 250, protein_min: 8, protein_max: 20 };
  }
  return { calories: 300, protein: 20, calorie_min: 200, calorie_max: 450, protein_min: 15, protein_max: 35 };
}

export function slotForBandAdd(_band: string, mealSlot: any) {
  return mealSlot;
}
