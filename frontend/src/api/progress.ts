import apiClient from "./client";

/** What the index is doing. "holding" is a legitimate state, not a warning. */
export type ProgressState =
  | "building"
  | "holding"
  | "stalled"
  | "declining"
  | "unknown";

export type IndexPoint = {
  week_start: string;
  label: string;
  level: number | null;
  confidence: number;
  planned_low: boolean;
  estimated: boolean;
  contributions: Record<string, number | null>;
};

export type RangeDelta = {
  value: number | null;
  from_week?: string;
  to_week?: string;
  drivers: { key: string; label: string; change: number }[];
};

export type ProgressIndex = {
  level: number | null;
  confidence: number;
  state: ProgressState;
  state_label: string;
  reason: string;
  week_delta: number | null;
  band: number;
  range_delta: RangeDelta;
};

export type DomainPoint = {
  week_start: string;
  level: number | null;
  current: number | null;
  coverage: number;
  estimated: boolean;
};

export type Position = {
  exercise_id: string;
  name: string;
  baseline_e1rm: number;
  peak_e1rm: number;
  latest_e1rm: number;
  change_pct: number;
  weeks_stale: number;
  estimated: boolean;
};

export type DomainDetail = {
  positions?: Position[];
  movers?: Position[];
  laggards?: Position[];
  tracked?: number;
  expected_per_week?: number;
  sessions_last_week?: number;
  calorie_target?: number | null;
  protein_target?: number | null;
  days_logged_last_week?: number;
  goal_direction?: string;
  expected_weekly_pct?: number;
  latest_weight_lb?: number;
  change_lb?: number;
  weigh_in_count?: number;
};

export type Domain = {
  key: "strength" | "consistency" | "nutrition" | "body";
  label: string;
  level: number | null;
  series: DomainPoint[];
  detail: DomainDetail;
  unavailable_reason: string | null;
  change: number | null;
  coverage: number;
  estimated: boolean;
  lever: {
    metric: string;
    label: string;
    value: number | null;
    target: number | null;
    unit: string;
    direction: string;
  } | null;
};

export type ProgressEvent = {
  week_start: string;
  kind: "pr" | "scan" | "planned_low" | "no_evidence";
  title: string;
  detail: string;
};

export type Coverage = {
  weeks_with_data: number;
  weeks_total: number;
  sessions_logged: number;
  days_food_logged: number;
  weigh_ins: number;
  days_logged_this_week: number;
};

export type ScanRegionChange = {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  direction: "improved" | "unchanged" | "regressed" | null;
  steps: number | null;
};

export type ScanCompare = {
  available: boolean;
  photos_retained: false;
  reason?: string;
  scan_count: number;
  note?: string;
  from_date?: string;
  to_date?: string;
  from_confidence?: string | null;
  to_confidence?: string | null;
  regions?: ScanRegionChange[];
  posture?: ScanRegionChange[];
  changed?: ScanRegionChange[];
  unread?: string[];
};

export type ForwardPoint = {
  week_start: string;
  label: string;
  level: number;
  strength: number;
};

export type ForwardProjection = {
  available: boolean;
  reason?: string;
  weeks?: number;
  best_case?: ForwardPoint[];
  realistic?: ForwardPoint[];
  projected_domains?: string[];
  held_domains?: string[];
  assumption?: string;
  lifts?: number;
  adherence?: { rate: number; sessions_logged: number; measured: boolean };
};

export type ProgressHub = {
  formula_version: string;
  generated_at: string;
  weeks: number;
  goal: string | null;
  goal_direction: string;
  index: ProgressIndex;
  series: IndexPoint[];
  domains: Domain[];
  events: ProgressEvent[];
  coverage: Coverage;
  scan_compare: ScanCompare | null;
  weights: Record<string, number>;
};

export type ProgressSummary = {
  formula_version: string;
  index: ProgressIndex;
  spark: { week_start: string; level: number | null }[];
  coverage: Coverage;
};

export async function getProgressHub(weeks = 12): Promise<ProgressHub> {
  const res = await apiClient.get("/api/progress/hub", { params: { weeks } });
  return res.data;
}

export async function getProgressProjection(weeks = 8): Promise<ForwardProjection> {
  // The engine walks every planned lift forward, so this is far slower than
  // the hub itself and is fetched separately, after the hub has rendered.
  const res = await apiClient.get("/api/progress/projection", {
    params: { weeks },
    timeout: 60000,
  });
  return res.data;
}

export async function getProgressSummary(weeks = 8): Promise<ProgressSummary> {
  const res = await apiClient.get("/api/progress/summary", { params: { weeks } });
  return res.data;
}
