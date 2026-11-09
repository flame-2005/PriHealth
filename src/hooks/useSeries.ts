import { samplesRepo } from '../db/repositories/samplesRepo';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { fillDays } from '../domain/aggregate';
import { lastDays } from '../domain/time';
import type { DayValue } from '../domain/types';
import { sleepMinutesByDay, stepsByDay, weightByDay } from '../tracking/sourcePolicy';

export type SeriesKey =
  | 'steps'
  | 'active_minutes'
  | 'active_kcal'
  | 'heart_rate'
  | 'resting_hr'
  | 'sleep'
  | 'weight'
  | 'spo2'
  | 'stress';

export const SERIES_LABEL: Record<SeriesKey, string> = {
  steps: 'Steps',
  active_minutes: 'Active minutes',
  active_kcal: 'Active calories',
  heart_rate: 'Heart rate',
  resting_hr: 'Resting HR',
  sleep: 'Sleep',
  weight: 'Weight',
  spo2: 'SpO2',
  stress: 'Stress',
};

export const SERIES_UNIT: Record<SeriesKey, string> = {
  steps: 'steps',
  active_minutes: 'min',
  active_kcal: 'kcal',
  heart_rate: 'bpm',
  resting_hr: 'bpm',
  sleep: 'min',
  weight: 'kg',
  spo2: '%',
  stress: '',
};

/** Series where a day without a reading is a gap (NaN), not a zero. */
export const MEASUREMENT_SERIES: readonly SeriesKey[] = ['heart_rate', 'resting_hr', 'weight', 'spo2', 'stress'];

/**
 * Daily series for the last `days` days, oldest first. Missing days are 0 for totals (steps,
 * minutes, kcal, sleep) and NaN for measurements (heart rate, weight, SpO2, stress), where a day
 * without a reading is a gap rather than a zero. Steps, sleep and weight go through the source
 * policy, so a day shows one device's number, never a sum across devices.
 */
export async function loadSeries(key: SeriesKey, days: number): Promise<DayValue[]> {
  const keys = lastDays(days);
  const from = keys[0];
  const to = keys[keys.length - 1];
  let rows: DayValue[];
  switch (key) {
    case 'steps':
      rows = await stepsByDay(from, to);
      break;
    case 'active_minutes':
      rows = await workoutsRepo.minutesByDay(from, to);
      break;
    case 'active_kcal':
      rows = await workoutsRepo.kcalByDay(from, to);
      break;
    case 'heart_rate':
      rows = await samplesRepo.avgByDay('heart_rate', from, to);
      break;
    case 'resting_hr':
      rows = await samplesRepo.minByDay('heart_rate', from, to);
      break;
    case 'sleep':
      rows = await sleepMinutesByDay(from, to);
      break;
    case 'weight':
      rows = await weightByDay(from, to);
      break;
    case 'spo2':
      rows = await samplesRepo.avgByDay('spo2', from, to);
      break;
    case 'stress':
      rows = await samplesRepo.avgByDay('stress', from, to);
      break;
  }
  if (MEASUREMENT_SERIES.includes(key)) {
    const map = new Map(rows.map(x => [x.day, x.value]));
    return keys.map(day => ({ day, value: map.get(day) ?? NaN }));
  }
  return fillDays(keys, rows);
}
