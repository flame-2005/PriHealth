export type Metric =
  | 'steps'
  | 'heart_rate'
  | 'resting_hr'
  | 'active_kcal'
  | 'active_minutes'
  | 'distance'
  | 'spo2'
  | 'stress'
  | 'hrv'
  | 'skin_temp'
  | 'resp_rate';

export interface Sample {
  id?: number;
  metric: Metric;
  value: number;
  unit: string;
  startMs: number;
  endMs: number;
  day: string; // local YYYY-MM-DD
  sourceId: string; // 'phone' | 'manual' | 'demo' | 'ble:<deviceId>'
  externalId?: string | null;
  device?: string | null; // display name of the device that produced it
}

export type WorkoutType =
  | 'walk'
  | 'run'
  | 'cycle'
  | 'strength'
  | 'hiit'
  | 'yoga'
  | 'swim'
  | 'other';

export const WORKOUT_TYPES: WorkoutType[] = [
  'walk',
  'run',
  'cycle',
  'strength',
  'hiit',
  'yoga',
  'swim',
  'other',
];

export const WORKOUT_LABEL: Record<WorkoutType, string> = {
  walk: 'Walk',
  run: 'Run',
  cycle: 'Cycle',
  strength: 'Strength',
  hiit: 'HIIT',
  yoga: 'Yoga',
  swim: 'Swim',
  other: 'Other',
};

export interface Workout {
  id?: number;
  type: WorkoutType;
  title?: string | null;
  startMs: number;
  endMs: number;
  day: string;
  durationS: number;
  distanceM?: number | null;
  kcal?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  effort?: number | null; // 1..10 RPE
  notes?: string | null;
  sourceId: string;
  externalId?: string | null;
  device?: string | null;
}

export type SleepStageKind = 'awake' | 'light' | 'deep' | 'rem';

export const SLEEP_STAGE_LABEL: Record<SleepStageKind, string> = {
  awake: 'Awake',
  light: 'Light',
  deep: 'Deep',
  rem: 'REM',
};

export interface SleepStage {
  id?: number;
  sessionId?: number;
  stage: SleepStageKind;
  startMs: number;
  endMs: number;
}

export interface SleepSession {
  id?: number;
  startMs: number;
  endMs: number;
  day: string; // the wake-up day
  quality?: number | null; // 1..5
  notes?: string | null;
  sourceId: string;
  externalId?: string | null;
  device?: string | null;
}

export type BodyKind = 'weight' | 'body_fat' | 'muscle' | 'water' | 'bone' | 'bmi';

export interface BodyMeasurement {
  id?: number;
  kind: BodyKind;
  value: number;
  unit: string;
  atMs: number;
  day: string;
  sourceId: string;
  externalId?: string | null;
}

export interface Goals {
  steps: number;
  activeMinutes: number;
  sleepMinutes: number;
  weightKg: number | null;
}

export const DEFAULT_GOALS: Goals = {
  steps: 8000,
  activeMinutes: 30,
  sleepMinutes: 8 * 60,
  weightKg: null,
};

export type UnitSystem = 'metric' | 'imperial';

export interface DayValue {
  day: string;
  value: number;
}

export interface Point {
  x: number;
  y: number;
}
