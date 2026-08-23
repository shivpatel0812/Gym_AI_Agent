export interface StressEntry {
  id?: string;
  date: string;
  level: number;
  description?: string;
}

export interface BodyFeeling {
  id?: string;
  date: string;
  description: string;
}

export interface WellnessSurvey {
  id?: string;
  date: string;
  fatigue: number;
  body_aches: number;
  energy?: number;
  sleep_quality?: number;
  mood?: number;
}

export interface SleepEntry {
  id?: string;
  date: string;
  hours_slept: number;
  quality?: number;
  bedtime?: string;
  wake_time?: string;
  notes?: string;
}

/**
 * The user's personal sleep target, computed on the backend.
 *
 * `status` is "ok" only when enough nights have been logged to infer a target.
 * Anything else means the metric is cancelled: show no target rather than a
 * default, since a made-up number reads as something the app knows about you.
 */
export interface SleepBaseline {
  metric: string;
  target: number | null;
  samples: number;
  confidence: number;
  status: "ok" | "insufficient_data" | "no_data";
  source: "declared" | "inferred" | "none";
  window_days: number;
  min_samples: number;
}

export interface ActivityEntry {
  id?: string;
  date: string;
  steps?: number;
  activity_type?: string;
  description?: string;
  duration_minutes?: number;
  is_whole_day?: boolean;
  intensity_level?: number;
}

export function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
