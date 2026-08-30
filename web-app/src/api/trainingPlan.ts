import apiClient from "../lib/api-client";

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
}

export interface TrainingPlan {
  id: string;
  plan_name: string;
  primary_goal?: string;
  status: PlanStatus;
  plan_mode?: PlanMode;
  duration_weeks?: number;
  start_date?: string;
  strategy?: string[];
  guidelines?: string[];
  weekly_schedule: Record<string, string>;
  days: PlanDay[];
}

export interface PlanProgress {
  current_week?: number | null;
  total_weeks?: number | null;
  days_elapsed?: number;
  ends_on?: string;
}

export interface PlanEnvelope {
  plan: TrainingPlan;
  progress: PlanProgress;
}

// === Projection ===========================================================

/** One week on a projected trajectory. */
export interface WeekPoint {
  week: number;
  weight: number;
  reps: number;
  e1rm: number;
  decision?: string;
}

export interface ProjectedExercise {
  exercise_id: string;
  exercise_name: string;
  day_name: string;
  sessions_per_week: number;
  /** False when there was no history to seed from — treat the curve as a guess. */
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
  priority?: string;
  goal?: string;
  sets?: number;
  target_rep_range?: [number, number];
  notes?: string;
  last_trained?: string | null;
  recent_sessions?: Array<{
    date?: string;
    sets?: Array<{ weight?: number; reps?: number; completed?: boolean }>;
  }>;
}

export interface ProjectedDay {
  day_name: string;
  focus?: string;
  day_goal?: string;
  day_type?: string;
  goal?: string;
  sessions_per_week: number;
  exercises: ProjectedExercise[];
}

export interface NutritionWeek {
  week: number;
  calories: number;
  protein: number;
  expected_weight_change_lb?: number;
  expected_weight_lb?: number;
}

export interface NutritionTrajectory {
  goal: string;
  weekly_step: number;
  maintenance_calories: number | null;
  rationale: string;
  /** Where the plan's own numbers contradict its stated goal. */
  warnings: string[];
  weeks: NutritionWeek[];
  plan_id?: string;
  plan_name?: string;
  pacing?: {
    style: string;
    label?: string;
    blurb?: string;
    weekly_step: number;
    hold_weeks?: number;
    break_every_n_weeks?: number;
    refeed_days?: string[];
    training_day_bump?: number;
  };
  day_tilt?: {
    mode: string;
    high_days?: string[];
    bump?: number;
    training_day_bump?: number;
  };
}

export interface Adherence {
  rate: number;
  sessions_logged: number;
  target_hit_rate: number | null;
  /** False means the rate is a default, not something measured from history. */
  measured: boolean;
}

export interface PlanProjection {
  weeks: number;
  plan_id: string;
  plan_name: string;
  primary_goal?: string;
  strategy?: string[];
  guidelines?: string[];
  weekly_schedule?: Record<string, string>;
  progress: PlanProgress;
  adherence: Adherence;
  days: ProjectedDay[];
  nutrition: NutritionTrajectory | null;
}

// === Requests =============================================================

export async function getActivePlan(): Promise<PlanEnvelope | null> {
  const res = await apiClient.get("/api/training-plan/active");
  if (res.data?.status === "no_plan") return null;
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function getPlanProjection(weeks?: number): Promise<PlanProjection | null> {
  const res = await apiClient.get("/api/training-plan/projection", {
    params: weeks ? { weeks } : undefined,
  });
  if (res.data?.status === "no_plan") return null;
  return res.data.projection;
}

export async function adjustPlan(params: {
  adjustment: string;
  conversationId?: string;
  planMode?: PlanMode;
}): Promise<PlanEnvelope> {
  const res = await apiClient.post("/api/training-plan/adjust", {
    adjustment: params.adjustment,
    conversation_id: params.conversationId,
    plan_mode: params.planMode,
  });
  return { plan: res.data.plan, progress: res.data.progress };
}

export async function activatePlan(planId: string): Promise<PlanEnvelope> {
  const res = await apiClient.post(`/api/training-plan/${planId}/activate`);
  return { plan: res.data.plan, progress: res.data.progress };
}
