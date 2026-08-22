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
  uncertain?: boolean;
  /** One-tap usual undo id. */
  usual_id?: string;
  /** Nutrition-plan meal anchor this log fulfills. */
  anchor_id?: string;
}

export interface MacroEntry {
  id?: string;
  date: string;
  food_items?: FoodItem[];
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
