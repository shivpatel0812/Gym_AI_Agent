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

export async function getPlanModes(): Promise<PlanModeOption[]> {
  const res = await apiClient.get("/api/training-plan/modes");
  return res.data?.modes ?? [];
}

export async function getActivePlan(): Promise<PlanEnvelope | null> {
  const res = await apiClient.get("/api/training-plan/active");
  if (res.data?.status !== "success" || !res.data?.plan) return null;
  return { plan: res.data.plan, progress: res.data.progress };
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
