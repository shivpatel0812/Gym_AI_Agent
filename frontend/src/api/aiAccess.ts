import apiClient from "./client";

/** Where the user stands against their daily AI allowance. */
export interface AiAccessStatus {
  tier: "free" | "extended" | "unlimited";
  unlimited: boolean;
  daily_limit: number;
  used_today: number;
  /** null when the tier is unlimited */
  remaining: number | null;
  lifetime_used: number;
  resets_at: string;
  request_status: "none" | "pending" | "approved" | "denied";
  request_reviewed_note?: string | null;
  can_request: boolean;
}

export interface AccessRequest {
  status: string;
  reason?: string;
  requested_limit?: number;
  created_at?: string;
  review_note?: string | null;
}

export async function fetchAiAccessStatus(): Promise<AiAccessStatus> {
  const { data } = await apiClient.get<AiAccessStatus>("/api/ai-access/status");
  return data;
}

export async function fetchMyAccessRequest(): Promise<AccessRequest> {
  const { data } = await apiClient.get<AccessRequest>("/api/ai-access/request");
  return data;
}

export async function submitAccessRequest(
  reason: string,
  requestedLimit = 50
): Promise<AccessRequest> {
  const { data } = await apiClient.post<AccessRequest>("/api/ai-access/request", {
    reason,
    requested_limit: requestedLimit,
  });
  return data;
}

export const REPORT_REASONS = [
  { id: "harmful_advice", label: "Harmful or unsafe advice" },
  { id: "dangerous_weight_advice", label: "Dangerous weight or diet advice" },
  { id: "offensive", label: "Offensive or inappropriate" },
  { id: "hateful", label: "Hateful or discriminatory" },
  { id: "sexual", label: "Sexual content" },
  { id: "factually_wrong", label: "Factually wrong" },
  { id: "other", label: "Something else" },
] as const;

export async function reportAiContent(params: {
  content: string;
  reason: string;
  details?: string;
  conversationId?: string | null;
}): Promise<{ status: string; message: string }> {
  const { data } = await apiClient.post("/api/content-reports", {
    content: params.content,
    reason: params.reason,
    details: params.details,
    conversation_id: params.conversationId ?? null,
  });
  return data;
}

/**
 * Pulls the structured quota payload out of an axios error, if that's what it
 * is. Returns null for any other failure so callers can fall through.
 */
export function quotaDetailFromError(error: any): {
  message: string;
  daily_limit: number;
  can_request: boolean;
} | null {
  if (error?.response?.status !== 429) return null;
  const detail = error.response.data?.detail;
  if (detail?.error !== "ai_quota_exceeded") return null;
  return detail;
}

/** Same idea for a moderation block (HTTP 400 with error=content_blocked). */
export function blockedDetailFromError(error: any): { message: string } | null {
  if (error?.response?.status !== 400) return null;
  const detail = error.response.data?.detail;
  if (detail?.error !== "content_blocked") return null;
  return detail;
}
