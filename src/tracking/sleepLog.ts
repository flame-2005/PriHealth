import { sleepRepo } from '../db/repositories/sleepRepo';
import type { SleepSession } from '../domain/types';
import { dayKey } from '../domain/time';
import { KEYS, prefs } from '../store/prefs';

export { sessionFromClock } from '../domain/sleep';

export async function getPendingBedtime(): Promise<number | null> {
  const v = await prefs.getJson<{ atMs: number }>(KEYS.pendingBedtime);
  return v?.atMs ?? null;
}

export async function markBedtime(now = Date.now()): Promise<void> {
  await prefs.setJson(KEYS.pendingBedtime, { atMs: now });
}

export async function clearBedtime(): Promise<void> {
  await prefs.remove(KEYS.pendingBedtime);
}

/** Close the pending night: creates a session from the stored bedtime to now. */
export async function markWakeUp(now = Date.now()): Promise<SleepSession | null> {
  const bed = await getPendingBedtime();
  if (bed == null || now - bed < 5 * 60 * 1000) {
    await clearBedtime();
    return null;
  }
  const session: SleepSession = { startMs: bed, endMs: now, day: dayKey(now), sourceId: 'manual' };
  session.id = await sleepRepo.insert(session);
  await clearBedtime();
  return session;
}
