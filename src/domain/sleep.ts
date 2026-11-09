import type { SleepSession } from './types';
import { parseClock, parseDay } from './time';

/**
 * Build a session from a wake-up day plus "HH:MM" bed and wake clock times.
 * A bedtime later than the wake time is assumed to be the previous evening.
 */
export function sessionFromClock(wakeDay: string, bedText: string, wakeText: string): SleepSession | null {
  const bed = parseClock(bedText);
  const wake = parseClock(wakeText);
  // Identical times would otherwise read as a 24-hour night.
  if (bed == null || wake == null || bed === wake) return null;
  const dayStart = parseDay(wakeDay);
  const endMs = dayStart + wake * 60_000;
  let startMs = dayStart + bed * 60_000;
  if (startMs >= endMs) startMs -= 24 * 3600 * 1000;
  return { startMs, endMs, day: wakeDay, sourceId: 'manual' };
}
