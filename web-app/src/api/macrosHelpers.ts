import apiClient from "../lib/api-client";
import type { FoodFit } from "../types";

export type EstimateMacros = {
  name?: string;
  amount?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  components?: Array<{
    name: string;
    amount?: string | null;
    calories?: number;
    protein?: number;
    carbs?: number;
    fats?: number;
    fiber?: number;
  }>;
  analysis?: Record<string, unknown>;
};

export async function previewFit(body: {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber?: number;
  meal?: string;
}): Promise<FoodFit | null> {
  const res = await apiClient.post("/api/macros/fit-preview", body);
  return (res.data?.fit as FoodFit | undefined) ?? null;
}

export async function adjustEstimate(
  body: {
    message: string;
    current_estimate: EstimateMacros;
    conversation_history?: Array<{ role: string; content: string }>;
    photo_log_id?: string | null;
    model?: string;
  },
  opts?: { timeout?: number }
): Promise<{
  reply: string;
  revised_estimate: EstimateMacros;
  conversation_history?: Array<{ role: string; content: string }>;
  photo_log_id?: string;
  photo_attached?: boolean;
  photo_status?: string;
}> {
  const res = await apiClient.post("/api/macros/adjust-estimate", body, {
    timeout: opts?.timeout ?? 120000,
  });
  return res.data;
}

export async function acceptPhotoLog(
  id: string,
  accepted: {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    fiber?: number;
    sugar?: number;
    sodium?: number;
    name?: string;
    amount?: string;
  }
): Promise<void> {
  // Body is AcceptedEstimateRequest at the top level — not nested under
  // `accepted`. Wrapping would 422 and silently skip the ground-truth label.
  await apiClient.post(`/api/macros/photo-logs/${id}/accepted`, accepted);
}
