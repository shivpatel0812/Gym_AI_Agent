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
  days: SplitDay[];
}

export interface WorkoutSet {
  set_number: number;
  reps: number;
  weight?: number;
}

export interface SessionExercise {
  exercise_id: string;
  exercise_name: string;
  sets: number | WorkoutSet[];
  reps?: number;
  weight?: number;
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

// Dashboard stats
export interface DashboardStats {
  workouts: number;
  activities: number;
  macros: number;
  stress: number;
}
