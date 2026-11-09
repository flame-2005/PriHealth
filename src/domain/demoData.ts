/**
 * Deterministic sample history for demo builds (see DEMO_SEED in src/config.ts). Pure: it only
 * produces rows, so the shape of a demo install can be checked without a device.
 */
import { addDays, dayKey, parseDay } from './time';
import type {
  BodyMeasurement,
  Sample,
  SleepSession,
  Workout,
  WorkoutType,
} from './types';

export const DEMO_SOURCE = 'demo';
export const DEMO_DAYS = 90;

export interface DemoWorkout {
  workout: Workout;
  /** Heart-rate trace, saved against the workout once its row id is known. */
  heartRate: Array<{ atMs: number; bpm: number }>;
}

export interface DemoDataset {
  samples: Sample[];
  workouts: DemoWorkout[];
  sleep: SleepSession[];
  body: BodyMeasurement[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Rand = () => number;

/** Park-Miller generator, so the same install always gets the same history. */
function makeRandom(seed: number): Rand {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Share of a day's steps falling in each hour from 06:00 to 22:00. */
const HOUR_WEIGHTS: Array<[number, number]> = [
  [6, 0.5],
  [7, 1.2],
  [8, 1.4],
  [9, 0.8],
  [10, 0.6],
  [11, 0.6],
  [12, 1.0],
  [13, 1.1],
  [14, 0.6],
  [15, 0.6],
  [16, 0.6],
  [17, 0.9],
  [18, 1.3],
  [19, 1.2],
  [20, 0.8],
  [21, 0.5],
  [22, 0.3],
];

/** Typical step totals by weekday (Sunday first); weekends are walk-heavy. */
const STEP_BASE = [9500, 7800, 8600, 8200, 7400, 6900, 11200];

/** Weekly plan by weekday (Sunday first). Friday is a rest day. */
const PLAN: Array<{
  type: WorkoutType;
  startMin: [number, number];
  minutes: [number, number];
} | null> = [
  { type: 'run', startMin: [7 * 60 + 10, 7 * 60 + 50], minutes: [35, 50] },
  { type: 'strength', startMin: [18 * 60, 19 * 60], minutes: [45, 55] },
  { type: 'run', startMin: [6 * 60 + 25, 7 * 60], minutes: [28, 40] },
  { type: 'cycle', startMin: [6 * 60 + 20, 6 * 60 + 50], minutes: [50, 75] },
  { type: 'yoga', startMin: [20 * 60 + 15, 20 * 60 + 45], minutes: [30, 40] },
  null,
  { type: 'cycle', startMin: [7 * 60, 7 * 60 + 40], minutes: [80, 120] },
];

/** A heart-rate trace every 15 s: warm-up, gentle surges, one push towards the maximum. */
function trace(
  r: Rand,
  startMs: number,
  durationS: number,
  avgHr: number,
  maxHr: number,
  hill: boolean,
) {
  const out: Array<{ atMs: number; bpm: number }> = [];
  const peakAt = durationS * (hill ? 0.6 : 0.85);
  const width = durationS * (hill ? 0.12 : 0.08);
  for (let t = 0; t <= durationS; t += 15) {
    const warm = Math.min(1, t / 240);
    let bpm = 92 + (avgHr - 92) * warm + Math.sin(t / 180) * 6;
    const d = Math.abs(t - peakAt) / width;
    if (d < 1) bpm += (maxHr - avgHr) * (1 - d);
    bpm += between(r, -3, 3);
    out.push({
      atMs: startMs + t * 1000,
      bpm: Math.round(Math.min(maxHr + 2, Math.max(80, bpm))),
    });
  }
  return out;
}

function buildWorkout(
  r: Rand,
  type: WorkoutType,
  startMs: number,
  minutes: number,
  withTrace: boolean,
): DemoWorkout {
  const durationS = minutes * 60;
  let distanceM: number | null = null;
  let kcalPerMin = 0;
  let avgHr = 0;
  let maxHr = 0;
  let effort = 0;
  switch (type) {
    case 'cycle':
      distanceM = Math.round((durationS / 3600) * between(r, 24, 29) * 1000);
      kcalPerMin = between(r, 9.5, 11.5);
      avgHr = between(r, 132, 148);
      maxHr = avgHr + between(r, 22, 35);
      effort = Math.round(between(r, 6, 8));
      break;
    case 'run':
      distanceM = Math.round((minutes / between(r, 5.1, 5.8)) * 1000);
      kcalPerMin = between(r, 11, 13);
      avgHr = between(r, 148, 160);
      maxHr = avgHr + between(r, 15, 25);
      effort = Math.round(between(r, 6, 8));
      break;
    case 'strength':
      kcalPerMin = between(r, 5.5, 7);
      avgHr = between(r, 105, 120);
      maxHr = avgHr + between(r, 30, 45);
      effort = Math.round(between(r, 6, 8));
      break;
    default:
      kcalPerMin = between(r, 3, 4);
      avgHr = between(r, 78, 90);
      maxHr = avgHr + between(r, 15, 25);
      effort = Math.round(between(r, 3, 4));
  }
  const heartRate = withTrace
    ? trace(r, startMs, durationS, avgHr, maxHr, type === 'cycle')
    : [];
  if (heartRate.length) {
    avgHr = heartRate.reduce((a, p) => a + p.bpm, 0) / heartRate.length;
    maxHr = Math.max(...heartRate.map(p => p.bpm));
  }
  return {
    workout: {
      type,
      title: null,
      startMs,
      endMs: startMs + durationS * 1000,
      day: dayKey(startMs),
      durationS,
      distanceM,
      kcal: Math.round(minutes * kcalPerMin),
      avgHr: Math.round(avgHr),
      maxHr: Math.round(maxHr),
      effort,
      notes: null,
      sourceId: DEMO_SOURCE,
      externalId: null,
    },
    heartRate,
  };
}

/**
 * History for the `days` days up to and including the day of `now`. Nothing is dated after `now`,
 * so today's steps stop at the current hour and the live counter adds on top. The six days before
 * today meet the default step goal, so the streak tile has something to show. Weight drifts down
 * to `opts.weightKg` (or 80.9 kg) so a manual weigh-in by the user sits naturally at the end.
 */
export interface DemoOptions {
  days?: number;
  /** Latest weight the user entered themselves; the history ends just above it. */
  weightKg?: number;
}

export function generateDemoData(
  now: number,
  opts: DemoOptions = {},
): DemoDataset {
  const days = opts.days ?? DEMO_DAYS;
  const endKg = opts.weightKg ?? 80.9;
  const r = makeRandom(20261007);
  const today = dayKey(now);
  const samples: Sample[] = [];
  const workouts: DemoWorkout[] = [];
  const sleep: SleepSession[] = [];
  const body: BodyMeasurement[] = [];

  for (let i = days; i >= 0; i--) {
    const day = addDays(today, -i);
    const dayStart = parseDay(day);
    const weekday = new Date(dayStart).getDay();
    const progress = (days - i) / days; // 0 on the oldest day, 1 today
    const isToday = i === 0;

    // Steps in hourly buckets, the way the phone counter builds a day up.
    let target = Math.round(STEP_BASE[weekday] * between(r, 0.8, 1.2));
    if (i <= 6)
      target = Math.max(target, 8600 + Math.round(between(r, 0, 1500)));
    const hours = HOUR_WEIGHTS.filter(
      ([h]) => dayStart + (h + 1) * HOUR <= now,
    );
    const totalWeight = hours.reduce((a, [, w]) => a + w, 0);
    for (const [h, w] of hours) {
      const startMs = dayStart + h * HOUR;
      samples.push({
        metric: 'steps',
        value: Math.round(
          ((target * w) / totalWeight) * between(r, 0.85, 1.15),
        ),
        unit: 'count',
        startMs,
        endMs: startMs + HOUR,
        day,
        sourceId: DEMO_SOURCE,
        externalId: `demo:steps:${day}:${h}`,
        device: 'phone',
      });
    }

    // One resting reading each morning, drifting down as fitness improves.
    const rhrAt = dayStart + 6 * HOUR + 40 * MINUTE;
    if (rhrAt <= now) {
      samples.push({
        metric: 'heart_rate',
        value: Math.round(63 - 4 * progress + between(r, -2, 2)),
        unit: 'bpm',
        startMs: rhrAt,
        endMs: rhrAt,
        day,
        sourceId: DEMO_SOURCE,
        externalId: `demo:rhr:${day}`,
        device: null,
      });
    }

    // The night that ended this morning (a session's day is its wake-up day).
    const bedMs = Math.round(dayStart + between(r, -95, 15) * MINUTE);
    const lieIn = weekday === 0 || weekday === 6 ? 30 : 0;
    const wakeMs = Math.round(
      dayStart + (between(r, 6 * 60 + 5, 7 * 60 + 35) + lieIn) * MINUTE,
    );
    if (wakeMs <= now) {
      const slept = (wakeMs - bedMs) / HOUR;
      const quality =
        slept >= 7.5
          ? Math.round(between(r, 4, 5))
          : slept >= 6.5
          ? Math.round(between(r, 3, 4))
          : Math.round(between(r, 2, 3));
      sleep.push({
        startMs: bedMs,
        endMs: wakeMs,
        day,
        quality,
        notes: null,
        sourceId: DEMO_SOURCE,
      });
    }

    // A weigh-in most mornings, body fat once a week.
    const weighAt =
      dayStart + 7 * HOUR + Math.round(between(r, 5, 20)) * MINUTE;
    const weighs = isToday || r() < 0.7;
    if (weighAt <= now && weighs) {
      body.push({
        kind: 'weight',
        value: round1(endKg + 1.7 * (1 - progress) + between(r, -0.35, 0.35)),
        unit: 'kg',
        atMs: weighAt,
        day,
        sourceId: DEMO_SOURCE,
        externalId: null,
      });
      if (i % 7 === 0) {
        body.push({
          kind: 'body_fat',
          value: round1(20.8 - 1.5 * progress + between(r, -0.3, 0.3)),
          unit: '%',
          atMs: weighAt + MINUTE,
          day,
          sourceId: DEMO_SOURCE,
          externalId: null,
        });
      }
    }

    // The weekly plan, with the odd skipped session. Only recent runs and rides carry a trace.
    const plan = PLAN[weekday];
    const trains = plan != null && (isToday || r() > 0.12);
    if (plan && trains) {
      const startMs =
        dayStart +
        Math.round(between(r, plan.startMin[0], plan.startMin[1])) * MINUTE;
      const minutes = Math.round(between(r, plan.minutes[0], plan.minutes[1]));
      if (startMs + minutes * MINUTE <= now) {
        const withTrace =
          i <= 30 && (plan.type === 'cycle' || plan.type === 'run');
        workouts.push(buildWorkout(r, plan.type, startMs, minutes, withTrace));
      }
    }
  }

  return { samples, workouts, sleep, body };
}
