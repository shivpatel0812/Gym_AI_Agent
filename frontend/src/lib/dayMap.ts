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
  slotLabel,
} from "../api/nutritionPlan";

export type DayMapKind = "anchor" | "flexible" | "one_time" | "suggest" | "stance";

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
  days?: string[];
  daysText?: string;
  sourceId?: string;
  sourceIndex?: number;
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
  suggestions: unknown[];
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

export function buildDayMap(plan: NutritionPlan): DayMapModel {
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

  (plan.meal_anchors || []).forEach((anchor: MealAnchor, i) => {
    const macros = sumFoods(anchor.foods || []);
    anchorsCal += macros.calories;
    anchorsPro += macros.protein;
    const foods = (anchor.foods || []).map((f) => f.name).filter(Boolean);
    const slotRaw = String(anchor.slot || "other");
    const primary = mapSlot(slotRaw) || "snack";
    const days = (anchor.days || []).map(String);
    const mapped: DayMapSlot = {
      id: `anchor-${anchor.id || i}`,
      kind: "anchor",
      slot: primary,
      band: bandFor(primary),
      title: anchor.label || slotLabel(primary),
      detail: foods.join(", ") || "Meal anchor",
      calories: macros.calories || null,
      protein: macros.protein || null,
      foods,
      fillWith: foods,
      days,
      daysText: daysLabel(days, anchor.frequency),
      sourceId: anchor.id,
      sourceIndex: i,
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
      places,
    };
  });

  const used = anchorsCal + flexCal;
  const free = target > 0 ? Math.max(0, target - used) : 0;
  const uncertain = sections.filter((s) => s.stance === "uncertain" || s.stance === "eat_out").length;

  let headline = "Your day by meal — anchors, days, and eat-out slots.";
  if (uncertain) {
    headline = `${uncertain} meal${uncertain === 1 ? "" : "s"} marked flexible / eat-out — add anchors where you can.`;
  } else if (target > 0 && free > 200) {
    headline = `About ${Math.round(free)} kcal still open across the day.`;
  } else if (target > 0 && free < 80) {
    headline = "Anchors cover most of your calorie target.";
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

  return {
    slots: allSlots,
    bands: sections.map((s) => ({ band: s.label, items: s.anchors })),
    sections,
    table,
    stack: {
      target: target || used || 1,
      anchors: Math.round(anchorsCal),
      flexible: Math.round(flexCal),
      oneTime: 0,
      suggested: 0,
      free: Math.round(free),
    },
    proteinTarget,
    proteinPlanned: Math.round(anchorsPro + flexPro),
    proteinSuggested: 0,
    headline,
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
