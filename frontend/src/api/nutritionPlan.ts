import apiClient from "./client";

export type NutritionGoal = "fat_loss" | "maintain" | "muscle" | "lean_bulk" | "health";
export type MealSlot =
  | "breakfast"
  | "lunch"
  | "snack"
  | "shake"
  | "dinner"
  | "late_night"
  | "pre_workout"
  | "other";

/** The day blueprint's fixed meal times. */
export type PrimaryMealSlot = "breakfast" | "lunch" | "pre_workout" | "dinner" | "snack";

export type DayBand = "Morning" | "Midday" | "Evening" | "Late";

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type SlotStance = "anchors" | "uncertain" | "eat_out" | "flexible";

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
  /**
   * Foods with the same group_key are interchangeable for one meal slot
   * (shake A OR shake B) + (yogurt X OR yogurt Y).
   */
  group_key?: string | null;
  /** Accept same-category foods in Previous matching (any yogurt, any shake…). */
  match_similar?: boolean | null;
}

export interface MealAnchor {
  id?: string;
  slot: MealSlot | string;
  label: string;
  foods: MealAnchorFood[];
  frequency: MealFrequency | string;
  /** Days this anchor usually applies. Empty = use frequency. */
  days?: WeekdayKey[] | string[];
  notes?: string | null;
  /**
   * individual = fixed meal · potential = 3–4 options · uncertain = TBD
   * Falls back from varies / uncertain flags when missing.
   */
  kind?: "individual" | "potential" | "uncertain";
  /** Order/choice changes each time (potential meals). */
  varies?: boolean;
  /** Truly open / undecided meal for those days. */
  uncertain?: boolean;
  /** Place or context when potential/uncertain — e.g. "Fannie Mae". */
  place?: string | null;
}

export function mealAnchorKind(
  anchor: Pick<MealAnchor, "kind" | "varies" | "uncertain">
): "individual" | "potential" | "uncertain" {
  if (anchor.kind === "individual" || anchor.kind === "potential" || anchor.kind === "uncertain") {
    return anchor.kind;
  }
  if (anchor.uncertain) return "uncertain";
  if (anchor.varies) return "potential";
  return "individual";
}

/** Collapse foods into OR-groups for Previous / matching. */
export type MealFoodGroup = {
  key: string;
  names: string[];
  matchSimilar: boolean;
  /** Primary food (first in group) — used for display macros. */
  primary?: MealAnchorFood;
};

export function mealFoodGroups(foods: MealAnchorFood[] = []): MealFoodGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, MealFoodGroup>();
  (foods || []).forEach((f, i) => {
    const name = String(f?.name || "").trim();
    if (!name) return;
    const key = String(f.group_key || "").trim() || `solo:${i}:${name.toLowerCase()}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, names: [], matchSimilar: false, primary: f };
      byKey.set(key, g);
      order.push(key);
    }
    if (!g.names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      g.names.push(name);
    }
    if (f.match_similar) g.matchSimilar = true;
  });
  return order.map((k) => byKey.get(k)!);
}

/** Sum macros once per group (alternates don't double-count). */
export function sumGroupedFoodMacros(foods: MealAnchorFood[] = []) {
  return mealFoodGroups(foods).reduce(
    (acc, g) => {
      const food = g.primary;
      return {
        calories: acc.calories + (Number(food?.calories) || 0),
        protein: acc.protein + (Number(food?.protein) || 0),
        carbs: acc.carbs + (Number(food?.carbs) || 0),
        fats: acc.fats + (Number(food?.fats) || 0),
        fiber: acc.fiber + (Number(food?.fiber) || 0),
      };
    },
    { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 }
  );
}

export interface FlexibleMeal {
  id?: string;
  name: string;
  frequency: MealFrequency | string;
  days?: WeekdayKey[] | string[];
  calorie_min?: number | null;
  calorie_max?: number | null;
  protein_min?: number | null;
  protein_max?: number | null;
  user_controls_food?: boolean;
  notes?: string | null;
}

export interface GoToItem {
  id?: string;
  slot?: MealSlot | string;
  name: string;
  amount?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fiber?: number | null;
  days?: WeekdayKey[] | string[];
  notes?: string | null;
}

/** One-time / band extras on the day blueprint. */
export interface BlueprintExtra {
  id?: string;
  band: DayBand | string;
  slot: MealSlot | string;
  label: string;
  foods?: MealAnchorFood[];
  calories?: number | null;
  protein?: number | null;
  calorie_min?: number | null;
  calorie_max?: number | null;
  protein_min?: number | null;
  protein_max?: number | null;
  notes?: string | null;
}

export interface SlotProfile {
  slot: PrimaryMealSlot | string;
  stance: SlotStance | string;
  notes?: string | null;
}

export interface FastFoodPlace {
  id?: string;
  name: string;
  slots?: Array<"lunch" | "dinner" | string>;
  days?: WeekdayKey[] | string[];
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
  /** Set when a regenerate kept the user's anchors and added on top. */
  carryover_note?: string | null;
  /** Eating-pattern focus, e.g. ["cholesterol"]. Guidance, never treatment. */
  health_focuses?: string[];
  health_notes?: string | null;
  meal_anchors: MealAnchor[];
  flexible_meals: FlexibleMeal[];
  go_to_items?: GoToItem[];
  blueprint_extras?: BlueprintExtra[];
  slot_profiles?: SlotProfile[];
  fast_food_places?: FastFoodPlace[];
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

export interface Usual {
  id: string;
  source: "plan" | "learned";
  slot: MealSlot | string;
  slot_label: string;
  /** Time-of-day heading, e.g. "Lunch time" / "Night time". */
  time_label: string;
  label: string;
  detail?: string;
  frequency: MealFrequency | string;
  calories?: number | null;
  protein?: number | null;
  expected: boolean;
  logged: boolean;
  can_undo: boolean;
  foods: MealAnchorFood[];
}

export interface UsualsSlot {
  slot: MealSlot | string;
  label: string;
  time_label: string;
  is_current: boolean;
  usuals: Usual[];
}

export interface UsualsPayload {
  has_usuals: boolean;
  current_slot?: string | null;
  current_slot_label?: string | null;
  current_time_label?: string | null;
  expected_count: number;
  logged_count: number;
  slots: UsualsSlot[];
  usuals: Usual[];
  /** Null when there is no active plan to measure against. */
  remaining?: { calories: number | null; protein: number | null } | null;
}

export const EMPTY_USUALS: UsualsPayload = {
  has_usuals: false,
  current_slot: null,
  current_slot_label: null,
  current_time_label: null,
  expected_count: 0,
  logged_count: 0,
  slots: [],
  usuals: [],
  remaining: null,
};

export type HealthFocusId = "cholesterol" | "blood_sugar" | "digestion" | "blood_pressure";

/**
 * Optional eating angles a plan can be built around. Mirrors HEALTH_FOCUSES in
 * backend/nutrition/plan_builder.py. These shape food choices — they are not
 * treatment and never replace what a doctor or dietitian said.
 */
export const HEALTH_FOCUS_OPTIONS: { id: HealthFocusId; label: string; aim: string }[] = [
  {
    id: "cholesterol",
    label: "Lower cholesterol",
    aim: "More soluble fiber and unsaturated fat, less saturated fat",
  },
  {
    id: "blood_sugar",
    label: "Steadier blood sugar",
    aim: "Carbs spread through the day, always paired with protein and fiber",
  },
  {
    id: "digestion",
    label: "Easier digestion",
    aim: "Steady fiber, enough fluid, regular meal spacing",
  },
  {
    id: "blood_pressure",
    label: "Blood pressure",
    aim: "Less sodium, more potassium-rich whole foods",
  },
];

export const HEALTH_FOCUS_DISCLAIMER =
  "General eating guidance, not medical advice. Anything your doctor or dietitian told you comes first.";

export function healthFocusLabels(ids?: string[] | null): string[] {
  return (ids || [])
    .map((id) => HEALTH_FOCUS_OPTIONS.find((o) => o.id === id)?.label)
    .filter((label): label is string => !!label);
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
  { id: "pre_workout", label: "Pre-workout" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
  { id: "shake", label: "Shake" },
  { id: "late_night", label: "Late night" },
  { id: "other", label: "Other" },
];

/** Fixed day-blueprint meal times. */
export const PRIMARY_SLOT_OPTIONS: { id: PrimaryMealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "pre_workout", label: "Pre-workout" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

export const WEEKDAY_OPTIONS: { id: WeekdayKey; label: string; short: string }[] = [
  { id: "mon", label: "Mon", short: "M" },
  { id: "tue", label: "Tue", short: "T" },
  { id: "wed", label: "Wed", short: "W" },
  { id: "thu", label: "Thu", short: "T" },
  { id: "fri", label: "Fri", short: "F" },
  { id: "sat", label: "Sat", short: "S" },
  { id: "sun", label: "Sun", short: "S" },
];

export const STANCE_OPTIONS: { id: SlotStance; label: string; hint: string }[] = [
  { id: "anchors", label: "Meal anchors", hint: "Mostly set meals — add anchors with foods & days" },
  {
    id: "uncertain",
    label: "Uncertain",
    hint: "Some days vary — still add anchors for days you know, plus places for the rest",
  },
  { id: "eat_out", label: "Eat out", hint: "Often restaurants — add places, and anchors for cook days" },
  { id: "flexible", label: "Flexible", hint: "Macro range only — you pick foods later" },
];

/** Slot labels for go-to items — "other" reads as Anytime. */
export const GO_TO_SLOT_OPTIONS: { id: MealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "pre_workout", label: "Pre-workout" },
  { id: "shake", label: "Shake" },
  { id: "snack", label: "Snack" },
  { id: "dinner", label: "Dinner" },
  { id: "late_night", label: "Late night" },
  { id: "other", label: "Anytime" },
];

export const DAY_BANDS: DayBand[] = ["Morning", "Midday", "Evening", "Late"];

export const BAND_ADD_OPTIONS: { id: MealSlot; label: string; defaultLabel: string }[] = [
  { id: "snack", label: "Snack", defaultLabel: "Snack" },
  { id: "pre_workout", label: "Pre-workout", defaultLabel: "Pre-workout" },
  { id: "shake", label: "Shake", defaultLabel: "Protein shake" },
  { id: "other", label: "Extra meal", defaultLabel: "Extra meal" },
];

export function slotLabel(id?: string | null) {
  return GO_TO_SLOT_OPTIONS.find((s) => s.id === id)?.label
    || SLOT_OPTIONS.find((s) => s.id === id)?.label
    || (id === "other" ? "Anytime" : id || "Anytime");
}

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

export function daysLabel(days?: string[] | null, frequency?: string | null) {
  if (days?.length) {
    if (days.length === 7) return "Every day";
    const set = new Set(days.map((d) => String(d).slice(0, 3).toLowerCase()));
    return WEEKDAY_OPTIONS.filter((d) => set.has(d.id))
      .map((d) => d.label)
      .join(" · ");
  }
  return frequencyLabel(frequency) || "Most days";
}

export function goalLabel(id?: string | null) {
  return GOAL_OPTIONS.find((g) => g.id === id)?.label || id || "";
}

export async function proposeNutritionPlan(answers: {
  goal?: string;
  goal_notes?: string;
  health_focuses?: string[];
  health_notes?: string;
  typical_day?: string;
  meal_anchors?: Partial<MealAnchor>[];
  flexible_meals?: Partial<FlexibleMeal>[];
  preferences?: NutritionPlanPreferences;
  conversation_id?: string;
  model?: string;
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
    return null;
  }
}

export async function getTodayGuidance(date?: string): Promise<TodayGuidance> {
  const res = await apiClient.get("/api/nutrition-plan/today-guidance", {
    params: date ? { date } : undefined,
  });
  return res.data?.guidance ?? { has_plan: false };
}

/** The hour is the client's, so the current meal slot follows the user's clock. */
export async function getUsuals(date?: string): Promise<UsualsPayload> {
  const res = await apiClient.get("/api/nutrition-plan/usuals", {
    params: { hour: new Date().getHours(), ...(date ? { date } : {}) },
  });
  return res.data?.usuals ?? EMPTY_USUALS;
}

export async function toggleUsual(usualId: string, date?: string): Promise<UsualsPayload> {
  const res = await apiClient.post(`/api/nutrition-plan/usuals/${usualId}/toggle`, {
    hour: new Date().getHours(),
    ...(date ? { date } : {}),
  });
  return res.data?.usuals ?? EMPTY_USUALS;
}

export async function updateNutritionPlan(
  planId: string,
  patch: Partial<NutritionPlan>
): Promise<NutritionPlan> {
  const res = await apiClient.patch(`/api/nutrition-plan/${planId}`, patch);
  return res.data.plan;
}

export async function suggestSlotFills(
  planId: string,
  slot: string,
  stance?: string,
  model?: string,
  opts?: { count?: number; excludeLabels?: string[] }
): Promise<{
  ideas: Array<{
    label: string;
    foods?: MealAnchorFood[];
    days?: string[];
    notes?: string;
  }>;
  notes?: string | null;
  stance_hint?: string | null;
}> {
  const res = await apiClient.post(
    `/api/nutrition-plan/${planId}/suggest-slot`,
    {
      slot,
      stance,
      model,
      count: opts?.count ?? 1,
      exclude_labels: opts?.excludeLabels,
    },
    { timeout: 60000 }
  );
  return res.data?.suggestion ?? { ideas: [] };
}

export async function suggestFastFoodOrders(
  planId: string,
  placeName: string,
  slot?: string,
  remaining?: { calories?: number; protein?: number },
  model?: string
): Promise<{
  place: string;
  slot: string;
  orders: Array<{
    name: string;
    items?: string[];
    calories?: number;
    protein?: number;
    carbs?: number;
    fats?: number;
    why?: string;
  }>;
  tip?: string | null;
}> {
  const res = await apiClient.post(
    `/api/nutrition-plan/${planId}/suggest-fast-food`,
    { place_name: placeName, slot, remaining, model },
    { timeout: 60000 }
  );
  return res.data?.suggestion ?? { place: placeName, slot: slot || "dinner", orders: [] };
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

// --- AI-proposed plan edits ------------------------------------------------

export type NutritionEditStatus = "pending" | "applied" | "dismissed" | "stale";

export type NutritionSuggestionSetStatus =
  | "pending"
  | "partially_applied"
  | "applied"
  | "dismissed"
  | "superseded";

/** One reviewable change the coach staged against the live plan. */
export interface NutritionPlanEdit {
  id: string;
  op: string;
  /** Plan field the edit lands in, e.g. "targets" / "meal_anchors". */
  field?: string;
  target_id?: string | null;
  /** Short human label, e.g. "Breakfast → 520 kcal". */
  title: string;
  rationale?: string | null;
  /** What the edit replaces — null for additions. */
  before?: any;
  payload?: any;
  status: NutritionEditStatus;
}

export interface NutritionSuggestionSet {
  id: string;
  plan_id: string;
  plan_version?: number;
  conversation_id?: string | null;
  status: NutritionSuggestionSetStatus;
  summary: string;
  edits: NutritionPlanEdit[];
  created_at?: string;
  updated_at?: string;
}

export interface PendingSuggestions {
  suggestion: NutritionSuggestionSet | null;
  pending_count: number;
  /** The plan was edited after these were proposed — some may be stale. */
  plan_changed_since: boolean;
}

/** Coach-staged edits awaiting review. Never changes the plan by itself. */
export async function getPendingSuggestions(): Promise<PendingSuggestions> {
  const res = await apiClient.get("/api/nutrition-plan/suggestions");
  return {
    suggestion: res.data?.suggestion ?? null,
    pending_count: res.data?.pending_count ?? 0,
    plan_changed_since: !!res.data?.plan_changed_since,
  };
}

/** Accept staged edits. Omit editIds to accept everything still pending. */
export async function applySuggestions(
  setId: string,
  editIds?: string[]
): Promise<{
  plan: NutritionPlan;
  suggestion: NutritionSuggestionSet;
  applied_edit_ids: string[];
  stale_edit_ids: string[];
  pending_count: number;
}> {
  const res = await apiClient.post(`/api/nutrition-plan/suggestions/${setId}/apply`, {
    edit_ids: editIds,
  });
  return res.data;
}

/** Reject staged edits. Omit editIds to clear the whole set. */
export async function dismissSuggestions(
  setId: string,
  editIds?: string[]
): Promise<{ suggestion: NutritionSuggestionSet; pending_count: number }> {
  const res = await apiClient.post(`/api/nutrition-plan/suggestions/${setId}/dismiss`, {
    edit_ids: editIds,
  });
  return res.data;
}

/** A "3 plan updates ready" card emitted by a nutrition-mode chat turn. */
export interface NutritionSuggestionArtifact {
  type: "nutrition_suggestions";
  suggestion_set_id: string;
  plan_id: string;
  summary: string;
  count: number;
  titles: string[];
}
