import { batch, query } from '../db';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { sleepRepo } from '../db/repositories/sleepRepo';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { DEMO_SOURCE, generateDemoData } from '../domain/demoData';
import type { Sample } from '../domain/types';
import { KEYS, prefs } from '../store/prefs';

/** Bump when the generator changes so an existing demo install replaces its rows on next launch. */
export const DEMO_SEED_VERSION = 2;

/** Delete every demo row and nothing else (heart-rate traces carry the demo source too). */
export async function removeDemoData(): Promise<void> {
  await batch([
    ['DELETE FROM samples WHERE source_id = ?', [DEMO_SOURCE]],
    ['DELETE FROM workouts WHERE source_id = ?', [DEMO_SOURCE]],
    ['DELETE FROM sleep_sessions WHERE source_id = ?', [DEMO_SOURCE]],
    ['DELETE FROM body_measurements WHERE source_id = ?', [DEMO_SOURCE]],
  ]);
}

/**
 * For a real build on an install that a demo build seeded earlier: drops the demo rows once and
 * forgets the seed marker. Returns true when rows were removed, so the caller can refresh screens.
 */
export async function clearDemoData(): Promise<boolean> {
  const seeded = (await prefs.getJson<number | boolean>(KEYS.demoSeeded)) != null;
  const leftover = await query(
    `SELECT 1 FROM samples WHERE source_id = ?
     UNION ALL SELECT 1 FROM workouts WHERE source_id = ?
     UNION ALL SELECT 1 FROM sleep_sessions WHERE source_id = ?
     UNION ALL SELECT 1 FROM body_measurements WHERE source_id = ? LIMIT 1`,
    [DEMO_SOURCE, DEMO_SOURCE, DEMO_SOURCE, DEMO_SOURCE],
  );
  if (!seeded && !leftover.length) return false;
  await removeDemoData();
  await prefs.remove(KEYS.demoSeeded);
  return leftover.length > 0;
}

/**
 * Fills the database with sample history once per install and generator version. Only called when
 * DEMO_SEED is on. Rows the user entered themselves are never touched, and the weight history is
 * anchored to their latest manual weigh-in so the chart has no cliff. Heart-rate traces are keyed
 * `workout:<id>:<n>` like real ones, so deleting a workout removes them. Returns true when rows
 * were written.
 */
export async function seedDemoData(now: number = Date.now()): Promise<boolean> {
  const stored = await prefs.getJson<number | boolean>(KEYS.demoSeeded);
  if (stored === DEMO_SEED_VERSION) return false;
  await removeDemoData();

  const own = await query(
    'SELECT value FROM body_measurements WHERE kind = ? AND source_id != ? ORDER BY at_ms DESC LIMIT 1',
    ['weight', DEMO_SOURCE],
  );
  const weightKg = own.length ? Number(own[0].value) : undefined;
  const data = generateDemoData(now, { weightKg });

  await samplesRepo.insertMany(data.samples);
  for (const { workout, heartRate } of data.workouts) {
    const id = await workoutsRepo.insert(workout);
    if (id == null || !heartRate.length) continue;
    const samples: Sample[] = heartRate.map((p, n) => ({
      metric: 'heart_rate',
      value: p.bpm,
      unit: 'bpm',
      startMs: p.atMs,
      endMs: p.atMs,
      day: workout.day,
      sourceId: DEMO_SOURCE,
      externalId: `workout:${id}:${n}`,
      device: null,
    }));
    await samplesRepo.insertMany(samples);
  }
  for (const s of data.sleep) await sleepRepo.insert(s);
  for (const m of data.body) await bodyRepo.insert(m);
  await prefs.setJson(KEYS.demoSeeded, DEMO_SEED_VERSION);
  return true;
}
