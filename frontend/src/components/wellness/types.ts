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

