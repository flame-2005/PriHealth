import type { StepReading } from '../bridge/stepCounterTypes';
import { splitAcrossDays } from '../domain/aggregate';
import type { Sample } from '../domain/types';

export interface StepState {
  lastCount: number;
  lastAtMs: number;
  lastBootMs: number;
  lastBootCount?: number;
}

/** Tolerance when comparing boot timestamps between readings (clock drift, sensor batching). */
export const BOOT_TOLERANCE_MS = 60_000;

/**
 * Pure: did the phone restart (and the counter reset) between the previous state and this reading?
 * The boot timestamp is derived from the wall clock, so it also moves when the clock is changed;
 * where the OS reports a boot counter, both must agree before a full count is treated as new steps.
 */
export function isReboot(prev: StepState, r: StepReading): boolean {
  if (r.count < prev.lastCount) return true;
  const bootMoved = Math.abs(r.bootTimeMs - prev.lastBootMs) > BOOT_TOLERANCE_MS;
  if (prev.lastBootCount != null && r.bootCount != null) return bootMoved && r.bootCount !== prev.lastBootCount;
  return bootMoved;
}

/**
 * Pure: given the previous state and a new reading, decide how many steps were
 * taken since, and produce the next state. Handles reboots (counter resets).
 */
export function computeDelta(prev: StepState | null, r: StepReading): { delta: number; next: StepState } {
  const next: StepState = { lastCount: r.count, lastAtMs: r.atMs, lastBootMs: r.bootTimeMs };
  if (r.bootCount != null) next.lastBootCount = r.bootCount;
  if (!prev) return { delta: 0, next };
  const delta = isReboot(prev, r) ? r.count : r.count - prev.lastCount;
  return { delta: Math.max(0, Math.round(delta)), next };
}

/** Attribute a step delta to the days between the previous reading and this one. */
export function samplesForDelta(prev: StepState | null, r: StepReading, delta: number): Sample[] {
  if (delta <= 0) return [];
  let from = prev ? Math.min(prev.lastAtMs, r.atMs) : r.atMs;
  // After a reboot the counter restarted at boot, so none of these steps were taken before it.
  if (prev && isReboot(prev, r)) from = Math.min(Math.max(from, r.bootTimeMs), r.atMs);
  return splitAcrossDays(from, r.atMs, delta).map(slice => ({
    metric: 'steps',
    value: slice.value,
    unit: 'count',
    startMs: slice.startMs,
    endMs: slice.endMs,
    day: slice.day,
    sourceId: 'phone',
    externalId: null,
    device: 'phone',
  }));
}
