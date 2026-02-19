export interface Exercise {
  id: string;
  name: string;
  type: string;
  muscle_group?: string;
  is_custom: boolean;
}

export interface Split {
  id: string;
  name: string;
  days: string[];
}

export interface WorkoutSession {
  id?: string;
  date: string;
  workout_name?: string;
  split_name?: string;
  split_day?: string;
  exercises: any[];
  notes?: string;
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
