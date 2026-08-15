export interface Exercise {
  id?: string;
  name: string;
  type: string;
  muscle_group?: string;
  description?: string;
  is_custom?: boolean;
}

export interface Split {
  id?: string;
  name: string;
  days: string[];
}

export interface WorkoutSet {
  set_number: number;
  reps: number;
  weight?: number;
  rpe?: number;
  completed?: boolean;
}

export interface ExerciseAiRecommendation {
  sets?: { set_number?: number; reps?: number; weight?: number }[];
  reasoning?: string;
  progression_type?: string;
  confidence?: string;
  needs_starting_weight?: boolean;
  estimated_from_stale_history?: boolean;
  estimated_from_top_lifts?: boolean;
  suggested_sets?: number;
  suggested_reps?: number;
  has_implausible_data?: boolean;
  time?: number;
  speed?: number;
  generated_at?: string;
}

export interface SessionExercise {
  exercise_id: string;
  exercise_name: string;
  sets?: number | WorkoutSet[];
  reps?: number;
  weight?: number;
  time?: number;
  speed?: number;
  intensity?: number;
  fatigue?: number;
  notes?: string;
  is_custom?: boolean;
  ai_recommendation?: ExerciseAiRecommendation;
}

export interface WorkoutSession {
  id?: string;
  date: string;
  workout_name?: string;
  split_id?: string;
  split_name?: string;
  split_day?: string;
  exercises: SessionExercise[];
  notes?: string;
  cardio_sport?: string;
  cardio_minutes?: number;
  cardio_intensity?: number;
  cardio_fatigue?: number;
  timer_accumulated_ms?: number;
  timer_running_since?: string;
  timer_started_at?: string;
  created_at?: string;
}

export interface TodaysWorkout {
  status: string;
  day_name?: string;
  plan_name?: string;
  split_id?: string;
  already_logged?: boolean;
  exercises?: {
    exercise_id: string;
    exercise_name: string;
    sets?: number;
    reps?: number;
    notes?: string;
  }[];
}

export type SessionFormData = {
  date: string;
  split_id: string;
  split_name: string;
  split_day: string;
  exercises: SessionExercise[];
  notes: string;
};
