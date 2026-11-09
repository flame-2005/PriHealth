import { samplesRepo } from '../db/repositories/samplesRepo';
import { dayKey } from '../domain/time';

export const HR_LOG_INTERVAL_MS = 5000;

/**
 * Keeps a device's heart-rate stream as samples, one every `intervalMs`, so the last reading
 * survives a reconnect and the trends see it. A running workout stores its own trace, so readings
 * are skipped while one records. Resolves true when a sample was written.
 */
export function heartRateLogger(deviceId: string, deviceName: string | null, intervalMs: number = HR_LOG_INTERVAL_MS) {
  let lastMs = -Infinity;
  return async (bpm: number, atMs: number, inWorkout: boolean): Promise<boolean> => {
    if (inWorkout || atMs - lastMs < intervalMs) return false;
    lastMs = atMs;
    await samplesRepo.insert({
      metric: 'heart_rate',
      value: bpm,
      unit: 'bpm',
      startMs: atMs,
      endMs: atMs,
      day: dayKey(atMs),
      sourceId: `ble:${deviceId}`,
      device: deviceName,
    });
    return true;
  };
}
