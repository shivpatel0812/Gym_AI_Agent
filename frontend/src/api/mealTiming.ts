import apiClient from "./client";

/** Clock habits for one meal slot. Fields are null until there is evidence. */
export interface SlotTiming {
  slot: string;
  days_logged: number;
  typical_minutes: number | null;
  /** Null under three logged days — a median of two is not a habit. */
  typical_time: string | null;
  earliest_time: string | null;
  latest_time: string | null;
  spread_minutes: number;
  consistency: "consistent" | "variable" | "scattered" | "unknown";
}

export interface DayWindow {
  date: string;
  first_meal: string | null;
  last_meal: string | null;
  window_minutes: number;
  meals_timed: number;
}

/** A move the user makes by hand, repeatedly — the app filing a food wrong. */
export interface SlotCorrection {
  from_slot: string;
  to_slot: string;
  count: number;
  foods: string[];
}

export interface MealTimingSummary {
  days_with_timing: number;
  slots: SlotTiming[];
  days: DayWindow[];
  average_window_minutes: number | null;
  corrections: SlotCorrection[];
}

export async function getMealTiming(days = 30): Promise<MealTimingSummary> {
  const res = await apiClient.get("/api/macros/meal-timing", { params: { days } });
  return res.data;
}
