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
  // Phase 1: Enhanced tracking fields (all optional for backward compatibility)
  rpe?: number; // Rate of Perceived Exertion (1-10 scale)
  rir?: number; // Reps In Reserve (0-5)
  completed?: boolean; // Whether the set was successfully completed
  form_quality?: string; // "excellent", "good", "fair", "poor"
  notes?: string; // Any additional notes about this specific set
  difficulty?: 'easy' | 'solid' | 'grind' | 'failed';
}

export interface ExerciseAiRecommendation {
  sets?: { set_number?: number; reps?: number; weight?: number }[];
  reasoning?: string;
  progression_type?: string;
  confidence?: string;
  needs_starting_weight?: boolean;
  estimated_from_stale_history?: boolean;
  estimated_from_top_lifts?: boolean;
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
  fiber?: number;
  sodium?: number;
  meal?: string;
  amount?: string;
}

export interface MacroEntry {
  id?: string;
  date: string;
  food_items?: FoodItem[];
  total_calories?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fats?: number;
  total_fiber?: number;
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
  progression_type?:
    | 'first_session'
    | 'needs_starting_weight'
    | 'increase_weight'
    | 'increase_reps'
    | 'maintain'
    | 'deload'
    | 'light_day'
    | 'cardio_progress'
    | 'bodyweight_progress';
  confidence?: 'high' | 'medium' | 'low';
  needs_starting_weight?: boolean;
  suggested_reps?: number;
  suggested_sets?: number;
  rep_range?: [number, number];
  has_implausible_data?: boolean;
  estimated_from_top_lifts?: boolean;
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

// Workout Plan types
export interface PlanExercise {
  exercise_id: string;
  exercise_name: string;
  sets: number;
  reps: number;
  rest_seconds?: number;
  notes?: string;
  order: number;
  intensity?: 'heavy' | 'light' | 'normal';
}

export interface WorkoutPlanDay {
  day_name: string;
  focus: string;
  exercises: PlanExercise[];
  estimated_duration_minutes?: number;
  intensity?: 'heavy' | 'light' | 'normal';
}

export interface WeeklySchedule {
  monday?: string;
  tuesday?: string;
  wednesday?: string;
  thursday?: string;
  friday?: string;
  saturday?: string;
  sunday?: string;
}

export interface WorkoutPlan {
  id?: string;
  plan_name: string;
  plan_description?: string;
  split_type: string;
  weekly_schedule: WeeklySchedule;
  days: WorkoutPlanDay[];
  progression_notes?: string;
  deload_schedule?: string;
  is_active: boolean;
  linked_split_id?: string;
  created_at?: string;
  updated_at?: string;
  generation_metadata?: Record<string, unknown>;
  creation_mode?: PlanCreationMode;
  source_split_id?: string;
  owns_linked_split?: boolean;
}

export interface TodaysWorkout {
  status: "workout_day" | "rest_day" | "no_plan";
  day_name?: string;
  focus?: string;
  exercises?: PlanExercise[];
  estimated_duration_minutes?: number;
  plan_id?: string;
  plan_name?: string;
  split_id?: string;
  already_logged?: boolean;
  existing_session_id?: string;
  rest_day_message?: string;
  next_workout_day?: string;
  next_workout_name?: string;
}

export interface PlanGenerationRequest {
  primary_goal: string;
  experience_level: string;
  preferred_workout_frequency: string;
  preferred_session_length: string;
  available_equipment: string[];
  preferred_workout_days?: string[];
  secondary_goals?: string[];
  coaching_style?: string;
  mode: PlanCreationMode;
  split_id?: string;
  top_lifts?: TopLifts;
  accepted_additions?: ExerciseSuggestion[];
  split_routine?: SplitRoutineDay[];
}

export type PlanCreationMode =
  | "generate"
  | "use_split"
  | "adopt_split"
  | "add_onto";

export interface TopLiftEntry {
  weight: number;
  reps?: number;
}

export interface TopLifts {
  bench_press?: TopLiftEntry;
  squat?: TopLiftEntry;
  deadlift?: TopLiftEntry;
  overhead_press?: TopLiftEntry;
  barbell_row?: TopLiftEntry;
}

export interface SplitRoutineSet {
  set_number: number;
  reps: number;
  weight?: number;
}

export interface SplitRoutineExercise {
  exercise_id: string;
  exercise_name: string;
  /** Convenience totals derived from set_details */
  sets?: number;
  reps?: number;
  weight?: number;
  set_details?: SplitRoutineSet[];
}

export interface SplitRoutineDay {
  day: string;
  exercises: SplitRoutineExercise[];
}

export interface ExerciseSuggestion {
  exercise_id: string;
  exercise_name: string;
  day: string;
  sets: number;
  reps: number;
  reason: string;
}

export interface ExerciseSuggestionGroup {
  day: string;
  exercises: Omit<ExerciseSuggestion, "day">[];
}
