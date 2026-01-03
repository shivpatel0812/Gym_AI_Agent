import { WorkoutSession, MacroEntry, StressEntry, BodyFeeling, WellnessSurvey, PhysicalActivity, SleepEntry } from './index';

export interface CalendarDay {
  date: string;
  logs: {
    workouts?: WorkoutSession[];
    nutrition?: MacroEntry[];
    wellness?: (StressEntry | BodyFeeling | WellnessSurvey)[];
    activity?: PhysicalActivity[];
    sleep?: SleepEntry[];
  };
}

export type LogCategory = 'workouts' | 'nutrition' | 'wellness' | 'activity' | 'sleep' | 'all';

