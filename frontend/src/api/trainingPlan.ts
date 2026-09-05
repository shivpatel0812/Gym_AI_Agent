import apiClient from "./client";

export type PlanMode = "follow_split" | "adapt_split" | "build_for_me";
export type PlanStatus = "draft" | "active" | "paused" | "completed";

export interface PlanExercise {
  exercise_id: string;
  exercise_name: string;
  sets: number;
  reps: number;
  order: number;
  notes?: string;
  goal?: string;
  priority?: "high" | "supporting" | "normal";
  target_rep_range?: [number, number];
  intensity?: string;
  /** Destination finish line (e.g. 85 lb × 8). Travels with target_reps. */
  target_weight?: number | null;
  target_reps?: number | null;
  target_weeks?: number | null;
}

export interface PlanDay {
  day_name: string;
  focus: string;
  day_goal?: string;
  day_type?: string;
  goal?: string;
  exercises: PlanExercise[];
  estimated_duration_minutes?: number;
}

export interface PlanChange {
  action: string;
  day_name?: string;
  exercise_name?: string;
  replaces?: string;
  reason?: string;
}

/** What a proposed plan would change about the one it replaces. */
export interface PlanDayDiff {
  day_name: string;
  added: string[];
  removed: string[];
  retargeted: Array<{ exercise_name: string; from: string; to: string }>;
  reordered: boolean;
  added_count: number;
  removed_count: number;
}

export interface PlanDiff {
  is_first_plan: boolean;
  /** True when the proposal deletes a training day. Lead the review with this. */
  is_destructive: boolean;
  removed_days: string[];
  added_days: string[];
  days: PlanDayDiff[];
  schedule_changes: Array<{ weekday: string; from: string; to: string }>;
  exercises_added?: number;
  exercises_removed?: number;
  summary: string;
}

export type PlanEditOp =
  | "set_rep_range"
  | "set_sets"
  | "set_priority"
  | "set_goal"
  | "set_notes"
  | "set_destination"
  | "clear_destination"
  | "add_exercise"
  | "remove_exercise"
  | "add_day"
  | "remove_day"
  | "replace_day_exercises";

export interface PlanEdit {
  id: string;
  op: PlanEditOp;
  day_name?: string;
  exercise_id?: string;
  exercise_name: string;
  field: string;
  from?: unknown;
  value: unknown;
  title: string;
  rationale?: string | null;
  status: "pending" | "applied" | "dismissed";
}

export interface PlanSuggestionSet {
  id: string;
  plan_id: string;
  summary: string;
  edits: PlanEdit[];
  status: string;
  created_at?: string;
}

export interface NutritionCompanion {
  status: "ready" | "needs_profile";
  source: "estimate" | "nutrition_plan";
  goal?: string;
  targets: { calories: number; protein: number; carbs: number; fats: number } | null;
  missing_fields?: string[];
  assumptions?: string[];
  guidelines: string[];
}

export interface TrainingPlan {
  nutrition_companion?: NutritionCompanion;
  id: string;
  plan_name: string;
  primary_goal?: string;
  status: PlanStatus;
  plan_mode?: PlanMode;
  plan_type?: string;
  duration_weeks?: number;
  start_date?: string;
  strategy?: string[];
  guidelines?: string[];
  weekly_schedule: Record<string, string>;
  days: PlanDay[];
  changes?: PlanChange[];
  /** Server-computed comparison against the plan this would replace. */
  diff?: PlanDiff;
  /** Days kept because the conversation never mentioned them. */
  carried_forward_days?: string[];
  /** Exercises the model asked for that could not be honoured. */
  dropped_exercises?: Array<{ day_name: string; exercise_name: string; reason: string }>;
  version?: number;
  created_at?: string;
  ended_at?: string;
}

export interface PlanProgress {
  current_week?: number | null;
  total_weeks?: number | null;
  days_elapsed?: number;
  ends_on?: string;
}

export interface PlanModeOption {
  id: PlanMode;
  label: string;
  description: string;
}

export interface PlanEnvelope {
  plan: TrainingPlan;
  progress: PlanProgress;
}

export interface WeekPoint {
  week: number;
  weight: number;
  reps: number;
  e1rm: number;
  decision?: string;
  /** Which workout within the week (1-based). */
  session?: number;
  /** Every prescribed set, so "80x6, 80x4, 80x4" can be rendered in full. */
  sets?: Array<{ set_number?: number; weight: number; reps: number }>;
}

export interface CardioWeekPoint {
  week: number;
  minutes: number;
  speed?: number;
  decision?: string;
}

export interface ProjectedExercise extends PlanExercise {
  day_name: string;
  sessions_per_week: number;
  seeded_from_history: boolean;
  current: WeekPoint | null;
  best_case: WeekPoint[];
  realistic: WeekPoint[];
  /** One entry per workout: week 1 workout 1, week 1 workout 2, week 2… */
  schedule?: WeekPoint[];
  gain: {
    best_case_e1rm: number;
    realistic_e1rm: number;
    best_case_pct: number | null;
    realistic_pct: number | null;
  };
  /** User-stated finish line when set on the plan exercise. */
  destination?: { weight: number; reps: number; weeks?: number } | null;
  arrived_week?: number | null;
  reachable?: boolean | null;
  /** Cardio projects minutes and pace; the lifting curves are empty when set. */
  is_cardio?: boolean;
  cardio_modality?: "steady" | "sport";
  cardio_current?: CardioWeekPoint | null;
  cardio_best_case?: CardioWeekPoint[];
  cardio_realistic?: CardioWeekPoint[];
  last_trained?: string | null;
  recent_sessions?: Array<{
    date?: string;
    session_id?: string;
    sets?: Array<{ set_number?: number; weight?: number; reps?: number; completed?: boolean }>;
    /**
     * The session's heaviest set, computed server-side without regard to the
     * `completed` flag. Used as a fallback when every set in a session is
     * unticked, which is common in older logs where people entered weight and
     * reps but never tapped the checkbox.
     */
    top_set?: { weight?: number; reps?: number } | null;
  }>;
  history_context?: {
    lifetime_session_count: number;
    recent_sessions?: Array<{
      date?: string;
      session_id?: string;
      sets?: Array<{ set_number?: number; weight?: number; reps?: number; completed?: boolean }>;
      top_set?: { weight?: number; reps?: number } | null;
    }>;
    best_weighted_set?: { weight?: number; reps?: number; date?: string } | null;
    best_bodyweight_rep_set?: { weight?: number; reps?: number; date?: string } | null;
    most_recent_weighted_set?: { weight?: number; reps?: number; date?: string } | null;
    recent_trend?: "up" | "down" | "steady" | "insufficient_history";
  };
}

export interface ProjectedDay extends Omit<PlanDay, "exercises"> {
  sessions_per_week: number;
  exercises: ProjectedExercise[];
}

/** One day's logged work for a muscle group, across every exercise. */
export interface MuscleGroupDay {
  date: string;
  stimulus: number;
  sessions: Array<{
    exercise_id: string;
    exercise_name: string;
    session_id?: string;
    sets: Array<{ set_number?: number; weight: number; reps: number; completed?: boolean }>;
  }>;
}

export interface NutritionWeekPoint {
  week: number;
  calories?: number | null;
  protein?: number | null;
  expected_weight_lb?: number | null;
  expected_weight_change_lb?: number | null;
  maintenance_calories?: number | null;
  phase?: string;
}

export interface NutritionTrajectory {
  plan_id?: string;
  plan_name?: string;
  goal?: string;
  maintenance_calories?: number | null;
  rationale?: string;
  weeks: NutritionWeekPoint[];
  warnings?: string[];
}

export interface PlanProjection {
  nutrition_companion?: NutritionCompanion;
  weeks: number;
  plan_id: string;
  plan_name: string;
  primary_goal?: string;
  weekly_schedule?: Record<string, string>;
  progress: PlanProgress;
  days: ProjectedDay[];
  /**
   * Stimulus per muscle group per day, computed server-side from the whole
   * workout log rather than from the current plan day's exercises — so
   * swapping incline press for cable flies reads as continuity, not a drop.
   */
  muscle_group_history?: Record<string, MuscleGroupDay[]>;
  nutrition?: NutritionTrajectory | null;
}

export async function getPlanModes(): Promise<PlanModeOption[]> {
  const res = await apiClient.get("/api/training-plan/modes");
  return res.data?.modes ?? [];
}

export async function getActivePlan(): Promise<PlanEnvelope | null> {
  const res = await apiClient.get("/api/training-plan/active");
  if (res.data?.status !== "success" || !res.data?.plan) return null;
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function getPlanProjection(weeks?: number): Promise<PlanProjection | null> {
  const res = await apiClient.get("/api/training-plan/projection", { params: { weeks } });
  if (res.data?.status !== "success" || !res.data?.projection) return null;
  return res.data.projection;
}

export async function proposePlan(params: {
  conversationId?: string | null;
  splitId?: string | null;
  /** null when the user never opened the mode selector — the backend then
   *  honours what they told the coach in the interview instead. */
  planMode: PlanMode | null;
  goalStatement?: string;
  durationWeeks?: number | null;
  weeklySchedule?: Record<string, string> | null;
  nutritionGoal?: string | null;
}): Promise<PlanEnvelope> {
  const res = await apiClient.post(
    "/api/training-plan/propose",
    {
      conversation_id: params.conversationId ?? null,
      split_id: params.splitId ?? null,
      plan_mode: params.planMode ?? null,
      goal_statement: params.goalStatement ?? null,
      duration_weeks: params.durationWeeks ?? null,
      weekly_schedule: params.weeklySchedule ?? null,
      nutrition_goal: params.nutritionGoal ?? null,
    },
    // Plan generation is a large GPT-4o call
    { timeout: 120000 }
  );
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function adjustPlan(params: {
  conversationId?: string | null;
  adjustment: string;
}): Promise<PlanEnvelope> {
  const res = await apiClient.post(
    "/api/training-plan/adjust",
    { conversation_id: params.conversationId ?? null, adjustment: params.adjustment },
    { timeout: 120000 }
  );
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function activatePlan(planId: string): Promise<PlanEnvelope> {
  const res = await apiClient.post(`/api/training-plan/${planId}/activate`);
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function pausePlan(planId: string): Promise<void> {
  await apiClient.post(`/api/training-plan/${planId}/pause`);
}

export async function resumePlan(planId: string): Promise<void> {
  await apiClient.post(`/api/training-plan/${planId}/resume`);
}

export async function endPlan(planId: string): Promise<void> {
  await apiClient.post(`/api/training-plan/${planId}/end`);
}

export async function deletePlan(planId: string): Promise<void> {
  await apiClient.delete(`/api/training-plan/${planId}`);
}

export async function getPlanHistory(): Promise<Partial<TrainingPlan>[]> {
  const res = await apiClient.get("/api/training-plan/history");
  return Array.isArray(res.data?.plans) ? res.data.plans : [];
}


export interface PendingPlanSuggestions {
  suggestion: PlanSuggestionSet;
  pendingCount: number;
  planChangedSince: boolean;
}

/** Coach-proposed target changes awaiting Accept or Discard. */
export async function getPlanSuggestions(): Promise<PendingPlanSuggestions | null> {
  const res = await apiClient.get("/api/training-plan/suggestions");
  if (!res.data?.suggestion) return null;
  return {
    suggestion: res.data.suggestion,
    pendingCount: res.data.pending_count ?? 0,
    planChangedSince: Boolean(res.data.plan_changed_since),
  };
}

export async function acceptPlanSuggestions(
  setId: string,
  editIds?: string[]
): Promise<PlanEnvelope> {
  const res = await apiClient.post(`/api/training-plan/suggestions/${setId}/accept`, {
    edit_ids: editIds ?? null,
  });
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function dismissPlanSuggestions(
  setId: string,
  editIds?: string[]
): Promise<void> {
  await apiClient.post(`/api/training-plan/suggestions/${setId}/dismiss`, {
    edit_ids: editIds ?? null,
  });
}

export type ExerciseRole = "building" | "maintaining" | "support";

/**
 * Guided per-exercise revision — Plan Mode, re-entered for one lift.
 *
 * Typed fields rather than prose, so this applies directly instead of staging
 * a suggestion for review: there is nothing inferred that could be wrong.
 */
export async function setExerciseGoal(params: {
  dayName: string;
  exerciseId?: string;
  exerciseName: string;
  role?: ExerciseRole;
  goal?: string;
  targetRepRange?: [number, number];
  sets?: number;
  notes?: string;
  targetWeight?: number | null;
  targetReps?: number | null;
  targetWeeks?: number | null;
  clearDestination?: boolean;
}): Promise<PlanEnvelope> {
  const res = await apiClient.post("/api/training-plan/exercise-goal", {
    day_name: params.dayName,
    exercise_id: params.exerciseId ?? null,
    exercise_name: params.exerciseName,
    role: params.role ?? null,
    goal: params.goal ?? null,
    target_rep_range: params.targetRepRange ?? null,
    sets: params.sets ?? null,
    notes: params.notes ?? null,
    target_weight: params.targetWeight ?? null,
    target_reps: params.targetReps ?? null,
    target_weeks: params.targetWeeks ?? null,
    clear_destination: params.clearDestination ?? null,
  });
  return { plan: res.data.plan, progress: res.data.progress };
}
