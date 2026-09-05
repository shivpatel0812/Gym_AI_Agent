/**
 * How well one logged food fits the user's goal — not how "healthy" it is.
 * Absent when the plan has no calorie/protein target to score against, and
 * `score` is null for items too small to judge (a smear of ketchup).
 */
export interface FoodFit {
  score: number | null;
  band: "excellent" | "good" | "fair" | "poor" | "trivial";
  reason: string;
  goal?: string;
  protein_ratio?: number | null;
  slot_share?: number | null;
}

export interface FoodItem {
  name: string;
  calories: number;
  protein: number;
  carbs?: number;
  fats?: number;
  fiber?: number;
  sodium?: number;
  meal?: string;
  amount?: string;
  /**
   * How many units this row represents. Macro fields are always the PRODUCT
   * (per-unit x quantity), so totals need no quantity awareness; this is kept
   * so the row can be re-scaled without re-deriving the per-unit values.
   */
  quantity?: number;
  /** The per-unit label ("1 cake, 9g") that `quantity` multiplies. */
  unit_amount?: string;
  uncertain?: boolean;
  /** One-tap usual undo id. */
  usual_id?: string;
  /** Nutrition-plan meal anchor this log fulfills. */
  anchor_id?: string;
  /** Internal hints for correction-aware photo personalization. */
  log_source?: "photo";
  was_adjusted?: boolean;
  /**
   * When the row was written, on the user's clock. Server-stamped on every
   * write; round-trips on updates, so never strip it when re-saving a day.
   */
  logged_at?: string;
  /** When the food was eaten, when the user says it differs from the log time. */
  eaten_at?: string;
  /** "user" once the row has been moved to another meal by hand. */
  slot_source?: "auto" | "user";
  /** The slot the app first filed this row under. Cleared if it moves back. */
  moved_from?: string;
  /** Server-computed goal fit. Read-only; never sent back on a write. */
  fit?: FoodFit | null;
}

export interface MacroEntry {
  id?: string;
  date: string;
  food_items?: FoodItem[];
  /** Calorie-weighted goal fit across the day. */
  fit_score?: number | null;
  fit_band?: FoodFit["band"] | null;
  total_calories?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fats?: number;
  total_fiber?: number;
}

export interface HydrationEntry {
  id?: string;
  date: string;
  amount_cups: number;
  notes?: string;
}

export type NutritionTargets = {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  water: number;
};

export const DEFAULT_TARGETS: NutritionTargets = {
  calories: 2200,
  protein: 175,
  carbs: 240,
  fats: 80,
  fiber: 30,
  water: 16,
};

export const MEALS = [
  { id: "Breakfast", label: "Breakfast", icon: "☀️" },
  { id: "Lunch", label: "Lunch", icon: "🥗" },
  { id: "Pre-Workout", label: "Pre-Workout", icon: "⚡" },
  { id: "Dinner", label: "Dinner", icon: "🌙" },
  { id: "Snacks", label: "Snacks", icon: "🫐" },
];

export function toDateKey(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
