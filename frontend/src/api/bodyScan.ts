import apiClient from "./client";

export const BODY_SCAN_VIEWS = ["front", "side", "back"] as const;
export type BodyScanView = (typeof BODY_SCAN_VIEWS)[number];

export interface BodyScanConsentInfo {
  required_version: string;
  accepted: boolean;
  consent?: { version?: string; accepted_at?: string } | null;
  copy: { title: string; body: string };
}

export interface BodyScanObservations {
  regions?: Record<string, { development?: string; notes?: string | null }>;
  asymmetries?: Array<{
    region?: string;
    side?: string;
    severity?: string;
    notes?: string | null;
  }>;
  posture?: Record<string, string>;
  overall_notes?: string | null;
  confidence?: string;
  limitations?: string | null;
}

export interface BodyScanGoal {
  raw_text?: string;
  direction?: string;
  target_areas?: string[];
  protect_lifts?: string[];
  constraints?: string[];
  parsed_confidence?: string;
}

export interface BodyScanSynthesis {
  emphasis?: Record<string, string>;
  protect?: string[];
  volume_bias?: string | null;
  flags?: string[];
  explanation?: string | null;
  next_scan_days?: number;
  applied?: boolean;
}

export interface BodyScanSession {
  id: string;
  created_at?: string;
  next_scan_at?: string;
  photos_retained?: boolean;
  observations?: BodyScanObservations;
  goal?: BodyScanGoal;
  synthesis?: BodyScanSynthesis;
  history_summary?: {
    undertrained_groups?: string[];
    high_volume_groups?: string[];
    sessions_considered?: number;
  };
}

export async function getBodyScanConsent(): Promise<BodyScanConsentInfo> {
  const res = await apiClient.get("/api/body-scan/consent");
  return {
    required_version: res.data?.required_version || "body_scan_v1",
    accepted: !!res.data?.accepted,
    consent: res.data?.consent,
    copy: res.data?.copy || {
      title: "Body scan privacy",
      body: "Photos are analyzed then deleted. We keep coaching notes only.",
    },
  };
}

export async function acceptBodyScanConsent(): Promise<void> {
  await apiClient.post("/api/body-scan/consent", { accepted: true });
}

export async function getLatestBodyScan(): Promise<BodyScanSession | null> {
  const res = await apiClient.get("/api/body-scan/latest");
  return res.data?.scan ?? null;
}

export async function listBodyScans(): Promise<BodyScanSession[]> {
  const res = await apiClient.get("/api/body-scan/");
  return res.data?.scans || [];
}

export async function analyzeBodyScan(params: {
  goalText: string;
  frontUri: string;
  sideUri: string;
  backUri: string;
  model?: string;
}): Promise<BodyScanSession> {
  const form = new FormData();
  form.append("goal_text", params.goalText);
  if (params.model) form.append("model", params.model);

  const appendImage = (field: string, uri: string) => {
    const name = `${field}.jpg`;
    form.append(field, {
      uri,
      name,
      type: "image/jpeg",
    } as any);
  };
  appendImage("front", params.frontUri);
  appendImage("side", params.sideUri);
  appendImage("back", params.backUri);

  const res = await apiClient.post("/api/body-scan/analyze", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180000,
  });
  return res.data.scan;
}

export async function applyBodyScanFocus(scanId: string): Promise<{
  scan: BodyScanSession;
  focuses: any[];
}> {
  const res = await apiClient.post(`/api/body-scan/${scanId}/apply`, { apply: true });
  return { scan: res.data.scan, focuses: res.data.focuses || [] };
}
