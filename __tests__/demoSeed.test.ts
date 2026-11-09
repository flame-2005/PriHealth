import { wipeAll } from '../src/db';
import { bodyRepo } from '../src/db/repositories/bodyRepo';
import { samplesRepo } from '../src/db/repositories/samplesRepo';
import { sleepRepo } from '../src/db/repositories/sleepRepo';
import { workoutsRepo } from '../src/db/repositories/workoutsRepo';
import {
  DEMO_DAYS,
  DEMO_SOURCE,
  generateDemoData,
} from '../src/domain/demoData';
import { addDays, dayKey } from '../src/domain/time';
import { loadSeries } from '../src/hooks/useSeries';
import { KEYS, prefs } from '../src/store/prefs';
import { DEMO_SEED_VERSION, clearDemoData, seedDemoData } from '../src/tracking/demoSeed';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

const suite = (globalThis as any).process.getBuiltinModule?.('node:sqlite')
  ? describe
  : describe.skip;

// Wednesday 7 October 2026, mid-afternoon: the ride planned for that morning has finished.
const NOW = new Date(2026, 9, 7, 15, 30).getTime();
const TODAY = dayKey(NOW);
const FIRST = addDays(TODAY, -DEMO_DAYS);

describe('demo data generator', () => {
  const data = generateDemoData(NOW);

  it('is deterministic', () => {
    expect(generateDemoData(NOW)).toEqual(data);
  });

  it('never dates anything after now or before the window', () => {
    const rows = [
      ...data.samples.map(s => ({ day: s.day, endMs: s.endMs })),
      ...data.workouts.map(w => ({
        day: w.workout.day,
        endMs: w.workout.endMs,
      })),
      ...data.sleep.map(s => ({ day: s.day, endMs: s.endMs })),
      ...data.body.map(m => ({ day: m.day, endMs: m.atMs })),
    ];
    expect(rows.length).toBeGreaterThan(1500);
    for (const row of rows) {
      expect(row.endMs).toBeLessThanOrEqual(NOW);
      expect(row.day >= FIRST && row.day <= TODAY).toBe(true);
    }
  });

  it('gives every day steps, a resting heart rate and a night of sleep', () => {
    const stepDays = new Set(
      data.samples.filter(s => s.metric === 'steps').map(s => s.day),
    );
    const rhrDays = new Set(
      data.samples
        .filter(s => s.externalId?.startsWith('demo:rhr:'))
        .map(s => s.day),
    );
    const sleepDays = new Set(data.sleep.map(s => s.day));
    expect(stepDays.size).toBe(DEMO_DAYS + 1);
    expect(rhrDays.size).toBe(DEMO_DAYS + 1);
    expect(sleepDays.size).toBe(DEMO_DAYS + 1);
    for (const s of data.sleep) {
      expect(s.endMs - s.startMs).toBeGreaterThan(5 * 3600_000);
      expect(s.endMs - s.startMs).toBeLessThan(10 * 3600_000);
      expect(dayKey(s.endMs)).toBe(s.day);
    }
  });

  it("ends with this morning's ride, carrying a heart-rate trace and today's weigh-in", () => {
    const last = data.workouts[data.workouts.length - 1];
    expect(last.workout.day).toBe(TODAY);
    expect(last.workout.type).toBe('cycle');
    expect(last.heartRate.length).toBeGreaterThan(100);
    expect(last.workout.maxHr).toBe(
      Math.max(...last.heartRate.map(p => p.bpm)),
    );
    expect(data.body.some(m => m.kind === 'weight' && m.day === TODAY)).toBe(
      true,
    );
    expect(data.workouts.every(w => w.workout.sourceId === DEMO_SOURCE)).toBe(
      true,
    );
  });

  it('anchors the weight history to the weight it is given', () => {
    const weights = generateDemoData(NOW, { weightKg: 70 }).body.filter(
      m => m.kind === 'weight',
    );
    const latest = weights[weights.length - 1].value;
    const earliest = weights[0].value;
    expect(Math.abs(latest - 70)).toBeLessThan(0.5);
    expect(earliest).toBeGreaterThan(latest + 0.8);
  });
});

suite('demo seed on a real SQLite engine', () => {
  beforeAll(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });
  beforeEach(async () => {
    await wipeAll();
    await prefs.remove(KEYS.demoSeeded);
  });

  it('a real build sweeps out what a demo build seeded, and nothing else', async () => {
    expect(await clearDemoData()).toBe(false);
    await seedDemoData(NOW);
    await bodyRepo.insert({ kind: 'weight', value: 70, unit: 'kg', atMs: NOW, day: TODAY, sourceId: 'manual' });
    await samplesRepo.insert({ metric: 'steps', value: 12, unit: 'count', startMs: NOW - 1000, endMs: NOW, day: TODAY, sourceId: 'phone' });

    expect(await clearDemoData()).toBe(true);
    expect(await workoutsRepo.all()).toHaveLength(0);
    expect(await sleepRepo.latest()).toBeNull();
    expect(await samplesRepo.sumForDay('steps', TODAY)).toBe(12);
    expect((await bodyRepo.latest('weight'))?.sourceId).toBe('manual');
    expect(await prefs.getJson(KEYS.demoSeeded)).toBeNull();
    expect(await clearDemoData()).toBe(false);
  });

  it('fills the screens once and is a no-op afterwards', async () => {
    expect(await seedDemoData(NOW)).toBe(true);

    const workouts = await workoutsRepo.all();
    expect(workouts.length).toBeGreaterThan(30);
    const steps = await loadSeries('steps', 90);
    expect(steps.every(d => d.value > 2000)).toBe(true);
    expect(await samplesRepo.sumForDay('steps', TODAY)).toBeGreaterThanOrEqual(
      8000,
    );
    expect((await sleepRepo.latest())?.day).toBe(TODAY);
    const weight = await loadSeries('weight', 7);
    expect(Number.isFinite(weight[weight.length - 1].value)).toBe(true);

    // Heart-rate traces are keyed like real ones, so removing the workout removes them.
    const ride = workouts[workouts.length - 1];
    const trace = await samplesRepo.range(
      'heart_rate',
      ride.startMs,
      ride.endMs + 1,
    );
    expect(trace.length).toBeGreaterThan(100);
    expect(trace[0].externalId).toBe(`workout:${ride.id}:0`);
    await workoutsRepo.remove(ride.id!);
    expect(
      await samplesRepo.range('heart_rate', ride.startMs, ride.endMs + 1),
    ).toHaveLength(0);

    expect(await seedDemoData(NOW)).toBe(false);
    expect((await workoutsRepo.all()).length).toBe(workouts.length - 1);
  });

  it("re-seeds on a new version, replacing demo rows and keeping the user's own", async () => {
    await bodyRepo.insert({
      kind: 'weight',
      value: 70,
      unit: 'kg',
      atMs: NOW - 3600_000,
      day: TODAY,
      sourceId: 'manual',
    });
    await workoutsRepo.insert({
      type: 'walk',
      startMs: NOW - 7200_000,
      endMs: NOW - 5400_000,
      day: TODAY,
      durationS: 1800,
      sourceId: 'manual',
    });
    await prefs.setJson(KEYS.demoSeeded, true); // marker from an older build
    expect(await seedDemoData(NOW)).toBe(true);
    const first = await workoutsRepo.all();

    // Same version again: nothing happens. A lost marker: demo rows are replaced, not duplicated.
    expect(await seedDemoData(NOW)).toBe(false);
    await prefs.remove(KEYS.demoSeeded);
    expect(await seedDemoData(NOW)).toBe(true);
    const second = await workoutsRepo.all();
    expect(second.length).toBe(first.length);
    expect(second.filter(w => w.sourceId === 'manual')).toHaveLength(1);
    expect(await prefs.getJson<number>(KEYS.demoSeeded)).toBe(
      DEMO_SEED_VERSION,
    );

    // The demo weights lead up to the user's own 70 kg instead of ending 10 kg above it.
    const demoWeights = (await bodyRepo.all()).filter(
      m => m.kind === 'weight' && m.sourceId === DEMO_SOURCE,
    );
    expect(
      Math.abs(demoWeights[demoWeights.length - 1].value - 70),
    ).toBeLessThan(0.5);
    expect((await bodyRepo.latest('weight'))?.sourceId).toBe('manual');
  });
});
