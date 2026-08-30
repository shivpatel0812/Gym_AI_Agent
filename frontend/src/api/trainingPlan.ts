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
  | "set_notes";

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

export interface TrainingPlan {
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
}

export interface ProjectedExercise extends PlanExercise {
  day_name: string;
  sessions_per_week: number;
  seeded_from_history: boolean;
  current: WeekPoint | null;
  best_case: WeekPoint[];
  realistic: WeekPoint[];
  gain: {
    best_case_e1rm: number;
    realistic_e1rm: number;
    best_case_pct: number | null;
    realistic_pct: number | null;
  };
  last_trained?: string | null;
  recent_sessions?: Array<{
    date?: string;
    sets?: Array<{ weight?: number; reps?: number; completed?: boolean }>;
  }>;
  history_context?: {
    lifetime_session_count: number;
    recent_sessions?: Array<{
      date?: string;
      sets?: Array<{ weight?: number; reps?: number; completed?: boolean }>;
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

export interface PlanProjection {
  weeks: number;
  plan_id: string;
  plan_name: string;
  primary_goal?: string;
  weekly_schedule?: Record<string, string>;
  progress: PlanProgress;
  days: ProjectedDay[];
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

export async function getPlanProjection(weeks = 12): Promise<PlanProjection | null> {
  const res = await apiClient.get("/api/training-plan/projection", { params: { weeks } });
  if (res.data?.status !== "success" || !res.data?.projection) return null;
  return res.data.projection;
}

export async function proposePlan(params: {
  conversationId?: string | null;
  splitId?: string | null;
  planMode: PlanMode;
  goalStatement?: string;
}): Promise<PlanEnvelope> {
  const res = await apiClient.post(
    "/api/training-plan/propose",
    {
      conversation_id: params.conversationId ?? null,
      split_id: params.splitId ?? null,
      plan_mode: params.planMode,
      goal_statement: params.goalStatement ?? null,
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
