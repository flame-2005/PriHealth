import type { DayValue, Point } from './types';
import { dayKey, endOfDay } from './time';

export interface DaySlice {
  day: string;
  startMs: number;
  endMs: number;
  value: number;
}

/**
 * Split a quantity accumulated over [startMs, endMs] across the local days it
 * spans, proportionally to time. Used to attribute phone step deltas that were
 * counted while the app was closed.
 */
export function splitAcrossDays(startMs: number, endMs: number, total: number): DaySlice[] {
  if (total <= 0) return [];
  if (endMs <= startMs) return [{ day: dayKey(endMs), startMs: endMs, endMs, value: total }];
  const span = endMs - startMs;
  const out: DaySlice[] = [];
  let cursor = startMs;
  let assigned = 0;
  while (cursor < endMs) {
    const sliceEnd = Math.min(endOfDay(cursor), endMs);
    const share = ((sliceEnd - cursor) / span) * total;
    // Rounding up on several days must not hand out more than the total.
    const value = sliceEnd === endMs ? total - assigned : Math.min(Math.round(share), total - assigned);
    assigned += value;
    if (value > 0) out.push({ day: dayKey(cursor), startMs: cursor, endMs: sliceEnd, value });
    cursor = sliceEnd;
  }
  return out;
}

export function movingAverage(values: DayValue[], window: number): DayValue[] {
  const out: DayValue[] = [];
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - window + 1);
    let sum = 0;
    let n = 0;
    for (let j = from; j <= i; j++) {
      if (Number.isFinite(values[j].value)) {
        sum += values[j].value;
        n++;
      }
    }
    out.push({ day: values[i].day, value: n ? sum / n : NaN });
  }
  return out;
}

/** Bucket-mean downsampling to at most `max` points. */
export function downsample(points: Point[], max: number): Point[] {
  if (points.length <= max || max < 2) return points;
  const size = points.length / max;
  const out: Point[] = [];
  for (let i = 0; i < max; i++) {
    const from = Math.floor(i * size);
    const to = Math.min(points.length, Math.floor((i + 1) * size));
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = from; j < to; j++) {
      sx += points[j].x;
      sy += points[j].y;
      n++;
    }
    if (n) out.push({ x: sx / n, y: sy / n });
  }
  return out;
}

export function stats(values: number[]): { min: number; avg: number; max: number } {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { min: 0, avg: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  return { min, avg: sum / v.length, max };
}

/** Five-zone model as a percentage of max HR (default max 190). */
export function hrZone(bpm: number, maxHr = 190): 1 | 2 | 3 | 4 | 5 {
  const p = bpm / maxHr;
  if (p < 0.6) return 1;
  if (p < 0.7) return 2;
  if (p < 0.8) return 3;
  if (p < 0.9) return 4;
  return 5;
}

export function fillDays(days: string[], rows: DayValue[]): DayValue[] {
  const map = new Map(rows.map(r => [r.day, r.value]));
  return days.map(day => ({ day, value: map.get(day) ?? 0 }));
}

/** Consecutive days (ending with the last entry) meeting the goal. */
export function currentStreak(values: DayValue[], goal: number): number {
  let streak = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i].value >= goal) streak++;
    else break;
  }
  return streak;
}
