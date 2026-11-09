import type { UnitSystem, WorkoutType } from './types';

export const KG_PER_LB = 0.45359237;
export const M_PER_MI = 1609.344;

export function kgToDisplay(kg: number, unit: UnitSystem): number {
  return unit === 'metric' ? kg : kg / KG_PER_LB;
}
export function displayToKg(value: number, unit: UnitSystem): number {
  return unit === 'metric' ? value : value * KG_PER_LB;
}
export function weightUnitLabel(unit: UnitSystem): string {
  return unit === 'metric' ? 'kg' : 'lb';
}
export function metersToDisplay(m: number, unit: UnitSystem): number {
  return unit === 'metric' ? m / 1000 : m / M_PER_MI;
}
export function displayToMeters(value: number, unit: UnitSystem): number {
  return unit === 'metric' ? value * 1000 : value * M_PER_MI;
}
export function distanceUnitLabel(unit: UnitSystem): string {
  return unit === 'metric' ? 'km' : 'mi';
}

/** Metabolic equivalents per workout type (Compendium of Physical Activities, rounded). */
export const MET: Record<WorkoutType, number> = {
  walk: 3.5,
  run: 9.0,
  cycle: 7.0,
  strength: 5.0,
  hiit: 8.0,
  yoga: 2.5,
  swim: 7.0,
  other: 4.0,
};

/** kcal = MET x kg x hours */
export function estimateKcal(type: WorkoutType, durationS: number, weightKg: number | null): number {
  const kg = weightKg ?? 70;
  return Math.round(MET[type] * kg * (durationS / 3600));
}

/** Rough distance from step count using an average stride of 0.74 m. */
export function estimateDistanceFromSteps(steps: number): number {
  return Math.round(steps * 0.74);
}

export function round(n: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** A decimal typed into a field (weight, distance, hours). Accepts the comma many keyboards offer instead of a point. */
export function parseDecimal(text: string): number {
  return Number(text.trim().replace(',', '.'));
}
