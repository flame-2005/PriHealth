import { samplesRepo } from '../db/repositories/samplesRepo';
import { dayKey } from '../domain/time';
import type { Sample } from '../domain/types';

/**
 * A watch reports its running total for the day, not increments, so it is kept as one row per
 * device and day that replaces itself. `startMs` is when the device first reported for the day
 * (the upsert keeps the earliest), which the source policy uses to tell a watch worn all day from
 * one put on at lunch. Step readers prefer such a row over the phone's own count for that day
 * (see `tracking/daySteps.ts`).
 */
export function watchStepsSample(deviceId: string, deviceName: string | null, steps: number, atMs: number): Sample {
  const day = dayKey(atMs);
  return {
    metric: 'steps',
    value: steps,
    unit: 'count',
    startMs: atMs,
    endMs: atMs,
    day,
    sourceId: `ble:${deviceId}`,
    externalId: `day:${day}`,
    device: deviceName,
  };
}

export async function recordWatchSteps(deviceId: string, deviceName: string | null, steps: number, atMs: number): Promise<void> {
  await samplesRepo.upsertTotal(watchStepsSample(deviceId, deviceName, steps, atMs));
}
