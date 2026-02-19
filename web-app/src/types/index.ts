// Workout types
export interface Exercise {
  id?: string;
  name: string;
  type: string;
  muscle_group?: string;
  description?: string;
  is_custom?: boolean;
}

export interface SplitDay {
  day_name: string;
  exercise_ids: string[];
}

export interface Split {
  id?: string;
  name: string;
  days: string[]; // Backend returns List[str], so days are just strings
}

export interface WorkoutSet {
  set_number: number;
  reps: number;
  weight?: number;
}

export interface SessionExercise {
  exercise_id: string;
  exercise_name: string;
  sets?: number | WorkoutSet[];
  reps?: number;
  weight?: number;
  time?: number;
  speed?: number;
  notes?: string;
  is_custom?: boolean;
}

export interface WorkoutSession {
  id?: string;
  date: string;
  workout_name?: string;
  split_id?: string;
  split_name?: string;
  exercises: SessionExercise[];
  notes?: string;
}

// Physical Activity types
export interface PhysicalActivity {
  id?: string;
  date: string;
  steps?: number;
  activity_type?: string;
  description?: string;
  duration_minutes?: number;
  is_whole_day?: boolean;
  intensity_level?: number;
}

// Nutrition types
export interface FoodItem {
  name: string;
  calories: number;
  protein: number;
  carbs?: number;
  fats?: number;
  sodium?: number;
}

export interface MacroEntry {
  id?: string;
  date: string;
  food_items?: FoodItem[];
  total_calories?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fats?: number;
  total_sodium?: number;
}

// Wellness types
export interface StressEntry {
  id?: string;
  date: string;
  stress_level: number;
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
  fatigue_level: number;
  aches_level: number;
  energy_level?: number;
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

export interface HydrationEntry {
  id?: string;
  date: string;
  amount_cups: number;
  notes?: string;
}

// Dashboard stats
export interface DashboardStats {
  workouts: number;
  activities: number;
  macros: number;
  stress: number;
}

// AI Recommendation types
export interface AIRecommendationSet {
  set_number: number;
  reps: number;
  weight?: number;
}

export interface AIExerciseRecommendation {
  sets?: AIRecommendationSet[];
  time?: number;
  speed?: number;
  reasoning?: string;
  progression_type?: 'increase_weight' | 'increase_reps' | 'maintain' | 'deload';
  confidence?: 'high' | 'medium' | 'low';
}

export interface AISummaryStatus {
  has_summary: boolean;
  needs_initial_setup: boolean;
  last_updated?: string;
  next_refresh?: string;
  needs_refresh?: boolean;
  sessions_logged?: number;
  sessions_needed?: number;
  total_sessions_analyzed?: number;
  message?: string;
}
