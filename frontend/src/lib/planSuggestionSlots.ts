/**
 * Map coach-staged nutrition edits onto breakfast / lunch / dinner (etc.)
 * so the plan page can show them under the meal they touch.
 */

import type { NutritionPlanEdit, PrimaryMealSlot } from "../api/nutritionPlan";
import { PRIMARY_SLOT_OPTIONS } from "../api/nutritionPlan";

const PRIMARY = new Set(PRIMARY_SLOT_OPTIONS.map((s) => s.id));

const SLOT_ALIASES: Record<string, PrimaryMealSlot> = {
  breakfast: "breakfast",
  morning: "breakfast",
  lunch: "lunch",
  midday: "lunch",
  dinner: "dinner",
  evening: "dinner",
  snack: "snack",
  snacks: "snack",
  shake: "snack",
  pre_workout: "pre_workout",
  preworkout: "pre_workout",
  "pre-workout": "pre_workout",
  late_night: "snack",
  other: "snack",
};

export function normalizePrimarySlot(raw: unknown): PrimaryMealSlot | null {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!key) return null;
  const mapped =
    SLOT_ALIASES[key] || (PRIMARY.has(key as PrimaryMealSlot) ? (key as PrimaryMealSlot) : null);
  return mapped;
}

/** Meal slot this edit affects, or null for plan-wide changes (targets, strategy…). */
export function editMealSlot(edit: NutritionPlanEdit): PrimaryMealSlot | null {
  const candidates = [
    edit.payload?.slot,
    edit.before?.slot,
    edit.payload?.band,
    edit.before?.band,
  ];
  for (const c of candidates) {
    const slot = normalizePrimarySlot(c);
    if (slot) return slot;
  }

  // Flexible meals often encode the slot in the name ("Lunch out").
  if (edit.field === "flexible_meals") {
    const name = String(edit.payload?.name || edit.before?.name || "").toLowerCase();
    for (const key of Object.keys(SLOT_ALIASES)) {
      if (name.includes(key.replace("_", " ")) || name.includes(key)) {
        return SLOT_ALIASES[key];
      }
    }
    return "dinner";
  }

  return null;
}

export function groupEditsBySlot(edits: NutritionPlanEdit[] | undefined | null): {
  bySlot: Partial<Record<PrimaryMealSlot, NutritionPlanEdit[]>>;
  general: NutritionPlanEdit[];
} {
  const bySlot: Partial<Record<PrimaryMealSlot, NutritionPlanEdit[]>> = {};
  const general: NutritionPlanEdit[] = [];

  for (const edit of edits || []) {
    if (edit.status !== "pending" && edit.status !== "stale") continue;
    const slot = editMealSlot(edit);
    if (!slot) {
      general.push(edit);
      continue;
    }
    (bySlot[slot] ||= []).push(edit);
  }

  return { bySlot, general };
}

/** Ids of plan items a pending coach edit is about to change or remove. */
export function pendingTargetIds(edits: NutritionPlanEdit[] | undefined | null): Set<string> {
  const ids = new Set<string>();
  for (const edit of edits || []) {
    if (edit.status !== "pending") continue;
    if (edit.target_id) ids.add(String(edit.target_id));
    if (edit.op.startsWith("update_") || edit.op.startsWith("remove_")) {
      const id = edit.payload?.id || edit.before?.id;
      if (id) ids.add(String(id));
    }
  }
  return ids;
}

export function describeEditBullet(edit: NutritionPlanEdit): string {
  if (edit.op === "update_targets") {
    const parts = Object.entries(edit.payload || {}).map(([key, value]) => {
      if (key === "calories") return `${value} kcal`;
      if (key === "protein") return `${value}g protein`;
      return `${key}: ${value}`;
    });
    return parts.join(" · ") || edit.title;
  }
  if (edit.op.startsWith("remove_")) {
    const foods = (edit.before?.foods || []).map((f: any) => f?.name).filter(Boolean);
    return foods.length ? `Remove ${foods.join(" + ")}` : edit.title;
  }
  const foods = (edit.payload?.foods || []).map((f: any) => f?.name).filter(Boolean);
  if (foods.length) {
    const verb = edit.op.startsWith("add_") ? "Add" : "Update";
    return `${verb} ${foods.join(" + ")}`;
  }
  if (edit.payload?.name) {
    const verb = edit.op.startsWith("add_") ? "Add" : "Update";
    return `${verb} ${edit.payload.name}`;
  }
  return edit.title;
}
