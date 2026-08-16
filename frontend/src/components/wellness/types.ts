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
