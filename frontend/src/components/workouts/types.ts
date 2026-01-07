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

