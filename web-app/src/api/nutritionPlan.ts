import apiClient from "../lib/api-client";

export type NutritionGoal = "fat_loss" | "maintain" | "muscle" | "lean_bulk" | "health";
export type MealSlot = "breakfast" | "lunch" | "snack" | "shake" | "dinner" | "late_night" | "other";
export type MealFrequency =
  | "daily"
  | "most_days"
  | "weekdays"
  | "weekends"
  | "few_times_week"
  | "occasionally";
export type NutritionPlanStatus = "draft" | "active" | "paused" | "completed";

export interface MealAnchorFood {
  name: string;
  amount?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fiber?: number | null;
}

export interface MealAnchor {
  id?: string;
  slot: MealSlot | string;
  label: string;
  foods: MealAnchorFood[];
  frequency: MealFrequency | string;
  notes?: string | null;
}

export interface FlexibleMeal {
  id?: string;
  name: string;
  frequency: MealFrequency | string;
  calorie_min?: number | null;
  calorie_max?: number | null;
  protein_min?: number | null;
  protein_max?: number | null;
  user_controls_food?: boolean;
  notes?: string | null;
}

export interface NutritionPlanPreferences {
  likes?: string[];
  dislikes?: string[];
  dietary_restrictions?: string | null;
  foods_on_hand?: string[];
  preferred_meal_count?: number | null;
  larger_dinner?: boolean | null;
  guidance_style?: "strict" | "flexible" | string;
}

export interface NutritionPlanTargets {
  calories?: number | null;
  calories_min?: number | null;
  calories_max?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fiber?: number | null;
}

export interface NutritionPlan {
  id: string;
  goal: NutritionGoal | string;
  goal_detail?: string | null;
  status: NutritionPlanStatus;
  targets: NutritionPlanTargets;
  strategy?: string | null;
  meal_anchors: MealAnchor[];
  flexible_meals: FlexibleMeal[];
  preferences: NutritionPlanPreferences;
  food_priorities: string[];
  typical_day_notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TodayGuidance {
  has_plan: boolean;
  status?: string;
  goal?: string;
  strategy?: string;
  headline?: string | null;
  messages?: string[];
  logged?: { calories: number; protein: number; carbs: number; fats: number; fiber: number };
  targets?: NutritionPlanTargets;
  remaining?: { calories: number | null; protein: number | null };
  remaining_flexible_meals?: FlexibleMeal[];
}

export const GOAL_OPTIONS: { id: NutritionGoal; label: string }[] = [
  { id: "fat_loss", label: "Lose fat" },
  { id: "maintain", label: "Maintain" },
  { id: "muscle", label: "Gain muscle" },
  { id: "lean_bulk", label: "Lean bulk" },
  { id: "health", label: "General health" },
];

export const SLOT_OPTIONS: { id: MealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "shake", label: "Shake" },
  { id: "snack", label: "Snack" },
  { id: "dinner", label: "Dinner" },
  { id: "late_night", label: "Late night" },
  { id: "other", label: "Other" },
];

export const FREQUENCY_OPTIONS: { id: MealFrequency; label: string }[] = [
  { id: "daily", label: "Every day" },
  { id: "most_days", label: "Most days" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekends", label: "Weekends" },
  { id: "few_times_week", label: "A few times a week" },
  { id: "occasionally", label: "Occasionally" },
];

export function frequencyLabel(id?: string | null) {
  return FREQUENCY_OPTIONS.find((f) => f.id === id)?.label || id || "";
}

export function goalLabel(id?: string | null) {
  return GOAL_OPTIONS.find((g) => g.id === id)?.label || id || "";
}

export interface SuggestedGoal {
  goal: NutritionGoal;
  label: string;
  from_training: boolean;
  reason: string;
  plan_name?: string | null;
}

export async function getSuggestedGoal(): Promise<SuggestedGoal | null> {
  try {
    const res = await apiClient.get("/api/nutrition-plan/suggested-goal");
    return res.data?.suggestion ?? null;
  } catch {
    // A missing suggestion just means the picker stays manual.
    return null;
  }
}

export async function proposeNutritionPlan(answers: {
  goal?: string;
  goal_notes?: string;
  typical_day?: string;
  meal_anchors?: Partial<MealAnchor>[];
  flexible_meals?: Partial<FlexibleMeal>[];
  preferences?: NutritionPlanPreferences;
  conversation_id?: string;
}): Promise<NutritionPlan> {
  const res = await apiClient.post("/api/nutrition-plan/propose", answers, { timeout: 120000 });
  return res.data.plan;
}

export async function activateNutritionPlan(planId: string): Promise<NutritionPlan> {
  const res = await apiClient.post(`/api/nutrition-plan/${planId}/activate`);
  return res.data.plan;
}

export async function getActiveNutritionPlan(): Promise<NutritionPlan | null> {
  const res = await apiClient.get("/api/nutrition-plan/active");
  return res.data?.plan ?? null;
}

export async function getTodayGuidance(date?: string): Promise<TodayGuidance> {
  const res = await apiClient.get("/api/nutrition-plan/today-guidance", {
    params: date ? { date } : undefined,
  });
  return res.data?.guidance ?? { has_plan: false };
}

export async function updateNutritionPlan(
  planId: string,
  patch: Partial<NutritionPlan>
): Promise<NutritionPlan> {
  const res = await apiClient.patch(`/api/nutrition-plan/${planId}`, patch);
  return res.data.plan;
}

export async function pauseNutritionPlan(planId: string): Promise<void> {
  await apiClient.post(`/api/nutrition-plan/${planId}/pause`);
}

export async function resumeNutritionPlan(planId: string): Promise<void> {
  await apiClient.post(`/api/nutrition-plan/${planId}/resume`);
}

export async function endNutritionPlan(planId: string): Promise<void> {
  await apiClient.post(`/api/nutrition-plan/${planId}/end`);
}

export async function deleteNutritionPlan(planId: string): Promise<void> {
  await apiClient.delete(`/api/nutrition-plan/${planId}`);
}
