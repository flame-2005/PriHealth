import { wipeAll } from '../src/db';
import { bodyRepo } from '../src/db/repositories/bodyRepo';
import { devicesRepo } from '../src/db/repositories/devicesRepo';
import { samplesRepo } from '../src/db/repositories/samplesRepo';
import { sleepRepo } from '../src/db/repositories/sleepRepo';
import { workoutsRepo } from '../src/db/repositories/workoutsRepo';
import type { DeviceForm } from '../src/domain/devices';
import { addDays, dayKey } from '../src/domain/time';
import { collectAll, toCsv } from '../src/export';
import { loadSeries } from '../src/hooks/useSeries';
import { stepsByDay, stepsForDay } from '../src/tracking/daySteps';
import { heartRateLogger } from '../src/tracking/heartRateLog';
import { sleepMinutesByDay, weightByDay } from '../src/tracking/sourcePolicy';
import { recordWatchSteps } from '../src/tracking/watchSteps';

/**
 * Runs the real schema and every repository query against an actual SQLite engine (see
 * __mocks__/@op-engineering/op-sqlite.ts), so a mistake in an SQL string fails here rather than on a phone.
 */
const suite = (globalThis as any).process.getBuiltinModule?.('node:sqlite') ? describe : describe.skip;

const NOW = new Date(2026, 8, 27, 12).getTime();
const TODAY = dayKey(NOW);
const YESTERDAY = addDays(TODAY, -1);
const HOUR = 3600_000;

suite('repositories on a real SQLite engine', () => {
  beforeAll(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });
  beforeEach(() => wipeAll());

  const steps = (value: number, atMs: number, day: string) =>
    ({ metric: 'steps', value, unit: 'count', startMs: atMs, endMs: atMs, day, sourceId: 'phone', device: 'phone' } as const);
  const heartRate = (value: number, atMs: number, externalId: string | null = null, sourceId = 'ble:AA') =>
    ({ metric: 'heart_rate', value, unit: 'bpm', startMs: atMs, endMs: atMs, day: TODAY, sourceId, externalId } as const);
  const forms = new Map<string, DeviceForm>([
    ['FC:75', 'watch'],
    ['W2', 'watch'],
    ['R1', 'ring'],
    ['SC', 'scale'],
  ]);

  it('aggregates samples by day and keeps one row per external id', async () => {
    await samplesRepo.insertMany([steps(1200, NOW - 2000, TODAY), steps(800, NOW - 1000, TODAY), steps(500, NOW - 24 * HOUR, YESTERDAY)]);
    expect(await samplesRepo.sumForDay('steps', TODAY)).toBe(2000);
    expect(await samplesRepo.sumByDay('steps', YESTERDAY, TODAY)).toEqual([
      { day: YESTERDAY, value: 500 },
      { day: TODAY, value: 2000 },
    ]);

    await samplesRepo.insertMany([
      heartRate(120, NOW - 500, 'workout:1:0'),
      heartRate(140, NOW - 400, 'workout:1:1'),
      heartRate(999, NOW - 400, 'workout:1:1'),
    ]);
    expect(await samplesRepo.avgByDay('heart_rate', TODAY, TODAY)).toEqual([{ day: TODAY, value: 130 }]);
    expect(await samplesRepo.minByDay('heart_rate', TODAY, TODAY)).toEqual([{ day: TODAY, value: 120 }]);
    expect((await samplesRepo.latest('heart_rate'))?.value).toBe(140);
    expect(await samplesRepo.latest('heart_rate', 'ble:ZZ')).toBeNull();
    expect((await samplesRepo.latest('heart_rate', 'ble:AA'))?.value).toBe(140);
    expect(await samplesRepo.range('heart_rate', NOW - 450, NOW)).toHaveLength(1);
  });

  it("shows a watch's daily total instead of the phone count, and lets it replace itself", async () => {
    await samplesRepo.insertMany([steps(1200, NOW - 2000, TODAY), steps(800, NOW - 1000, TODAY), steps(500, NOW - 24 * HOUR, YESTERDAY)]);
    expect(await stepsForDay(TODAY, { devices: forms })).toBe(2000);

    await recordWatchSteps('FC:75', 'Icon Plus', 1002, NOW - 60_000);
    await recordWatchSteps('FC:75', 'Icon Plus', 1067, NOW);
    expect(await stepsForDay(TODAY, { devices: forms })).toBe(1067);
    // Yesterday had no watch reading, so the phone's count stands.
    expect(await stepsByDay(YESTERDAY, TODAY, { devices: forms })).toEqual([
      { day: YESTERDAY, value: 500 },
      { day: TODAY, value: 1067 },
    ]);
    // The saved device row is what tells the policy the source is a watch.
    await devicesRepo.upsert({ id: 'FC:75', name: 'Icon Plus', kind: 'watch', lastSeenMs: NOW });
    expect(await loadSeries('steps', 2)).toEqual([
      { day: YESTERDAY, value: 500 },
      { day: TODAY, value: 1067 },
    ]);
    const rows = (await samplesRepo.all()).filter(r => r.sourceId === 'ble:FC:75');
    expect(rows).toHaveLength(1);
    // The row keeps the first time the watch reported and the last.
    expect(rows[0]).toMatchObject({ value: 1067, startMs: NOW - 60_000, endMs: NOW, externalId: `day:${TODAY}`, device: 'Icon Plus' });
    // The watch reset at its own midnight a little before the phone's: the day's total must not drop.
    await recordWatchSteps('FC:75', 'Icon Plus', 3, NOW + 30_000);
    expect(await stepsForDay(TODAY, { devices: forms })).toBe(1067);
    // Plain sums still add every source, which is why step screens go through tracking/daySteps.
    expect(await samplesRepo.sumForDay('steps', TODAY)).toBe(3067);
    expect(await samplesRepo.totalsBySourceByDay('steps', TODAY, TODAY)).toEqual([
      { day: TODAY, sourceId: 'ble:FC:75', value: 1067, firstMs: NOW - 60_000, lastMs: NOW + 30_000 },
      { day: TODAY, sourceId: 'phone', value: 2000, firstMs: NOW - 2000, lastMs: NOW - 1000 },
    ]);
  });

  it('never adds two devices together: watches worn in turn add up, a ring wins the night, a scale wins the day', async () => {
    await samplesRepo.insert(steps(9000, NOW - 5 * HOUR, TODAY));
    await recordWatchSteps('FC:75', 'Icon Plus', 4000, NOW - 6 * HOUR);
    await recordWatchSteps('FC:75', 'Icon Plus', 4100, NOW - 3 * HOUR);
    await recordWatchSteps('W2', 'Other watch', 3500, NOW - 2 * HOUR);
    expect(await stepsForDay(TODAY, { devices: forms })).toBe(7600);

    await sleepRepo.upsertExternal(
      { startMs: NOW - 10 * HOUR, endMs: NOW - 3 * HOUR, day: TODAY, sourceId: 'ble:R1', externalId: 'sleep:1', device: 'Ring' },
      [],
    );
    await sleepRepo.upsertExternal(
      { startMs: NOW - 10 * HOUR, endMs: NOW - 2 * HOUR, day: TODAY, sourceId: 'ble:FC:75', externalId: 'sleep:1', device: 'Icon Plus' },
      [],
    );
    await sleepRepo.insert({ startMs: NOW - 9 * HOUR, endMs: NOW - 1 * HOUR, day: TODAY, sourceId: 'manual' });
    expect(await sleepMinutesByDay(TODAY, TODAY, { devices: forms })).toEqual([{ day: TODAY, value: 420 }]);

    await bodyRepo.insert({ kind: 'weight', value: 71, unit: 'kg', atMs: NOW - 2000, day: TODAY, sourceId: 'manual' });
    await bodyRepo.upsertExternal({ kind: 'weight', value: 72.4, unit: 'kg', atMs: NOW - 5000, day: TODAY, sourceId: 'ble:SC', externalId: 'w:1' });
    expect(await weightByDay(TODAY, TODAY, { devices: forms })).toEqual([{ day: TODAY, value: 72.4 }]);
  });

  it('logs a heart-rate stream one reading every few seconds, except while a workout records it', async () => {
    const log = heartRateLogger('FC:75', 'Icon Plus', 5000);
    expect(await log(75, NOW, false)).toBe(true);
    expect(await log(74, NOW + 1000, false)).toBe(false);
    expect(await log(73, NOW + 5000, false)).toBe(true);
    expect(await log(72, NOW + 10_000, true)).toBe(false);
    const rows = await samplesRepo.range('heart_rate', NOW, NOW + 60_000);
    expect(rows.map(r => r.value)).toEqual([75, 73]);
    expect(rows[0]).toMatchObject({ sourceId: 'ble:FC:75', device: 'Icon Plus', unit: 'bpm', day: TODAY });
    expect((await samplesRepo.latest('heart_rate'))?.value).toBe(73);
  });

  it('saves workouts and removes one together with its heart-rate samples only', async () => {
    const run = await workoutsRepo.insert({
      type: 'run',
      startMs: NOW - HOUR,
      endMs: NOW - HOUR / 2,
      day: TODAY,
      durationS: 1800,
      kcal: 315,
      avgHr: 150,
      maxHr: 171,
      sourceId: 'manual',
    });
    const walk = await workoutsRepo.insert({
      type: 'walk',
      startMs: NOW - 600_000,
      endMs: NOW,
      day: TODAY,
      durationS: 600,
      kcal: 40,
      sourceId: 'manual',
    });
    expect(run).toBeGreaterThan(0);
    expect(walk).not.toBe(run);
    await samplesRepo.insertMany([
      heartRate(150, NOW - HOUR, `workout:${run}:0`),
      heartRate(171, NOW - HOUR + 1000, `workout:${run}:1`),
      heartRate(98, NOW - 1000, `workout:${walk}:0`),
    ]);

    expect((await workoutsRepo.byId(run!))?.avgHr).toBe(150);
    expect((await workoutsRepo.forDay(TODAY)).map(w => w.type)).toEqual(['walk', 'run']);
    expect((await workoutsRepo.list()).map(w => w.type)).toEqual(['walk', 'run']);
    expect(await workoutsRepo.minutesByDay(TODAY, TODAY)).toEqual([{ day: TODAY, value: 40 }]);
    expect(await workoutsRepo.kcalByDay(TODAY, TODAY)).toEqual([{ day: TODAY, value: 355 }]);

    await workoutsRepo.remove(run!);
    expect(await workoutsRepo.byId(run!)).toBeNull();
    expect((await samplesRepo.all()).map(s => s.externalId)).toEqual([`workout:${walk}:0`]);
  });

  it('keeps one copy of a device workout and takes its trace with it when removed', async () => {
    const w = {
      type: 'run' as const,
      startMs: NOW - 2 * HOUR,
      endMs: NOW - HOUR,
      day: TODAY,
      durationS: 3600,
      kcal: 400,
      avgHr: 140,
      maxHr: 160,
      sourceId: 'ble:FC:75',
      externalId: `workout:${NOW - 2 * HOUR}`,
      device: 'Icon Plus',
    };
    const first = await workoutsRepo.upsertExternal(w);
    const again = await workoutsRepo.upsertExternal({ ...w, kcal: 410 });
    expect(again).toBe(first);
    expect(await workoutsRepo.list()).toHaveLength(1);
    expect((await workoutsRepo.byId(first))?.kcal).toBe(410);
    await samplesRepo.insertMany([
      heartRate(130, NOW - 2 * HOUR, `wk:${w.externalId}:0`, 'ble:FC:75'),
      heartRate(135, NOW - 2 * HOUR + 60_000, `wk:${w.externalId}:1`, 'ble:FC:75'),
      heartRate(70, NOW, null, 'ble:FC:75'),
    ]);
    await workoutsRepo.remove(first);
    expect((await samplesRepo.all()).map(s => s.value)).toEqual([70]);
  });

  it('keeps one night per device and rewrites its stages on a re-sync', async () => {
    const night = { startMs: NOW - 9 * HOUR, endMs: NOW - HOUR, day: TODAY, sourceId: 'ble:FC:75', externalId: 'sleep:1', device: 'Icon Plus' };
    await sleepRepo.upsertExternal(night, [
      { stage: 'light', startMs: NOW - 9 * HOUR, endMs: NOW - 8 * HOUR },
      { stage: 'deep', startMs: NOW - 8 * HOUR, endMs: NOW - 7 * HOUR },
    ]);
    await sleepRepo.upsertExternal(
      { ...night, endMs: NOW - HOUR / 2 },
      [
        { stage: 'light', startMs: NOW - 9 * HOUR, endMs: NOW - 8 * HOUR },
        { stage: 'rem', startMs: NOW - 8 * HOUR, endMs: NOW - 6 * HOUR },
        { stage: 'awake', startMs: NOW - 6 * HOUR, endMs: NOW - HOUR / 2 },
      ],
    );
    const sessions = await sleepRepo.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ endMs: NOW - HOUR / 2, externalId: 'sleep:1', device: 'Icon Plus' });
    const stages = await sleepRepo.stagesFor([sessions[0].id!]);
    expect(stages.get(sessions[0].id!)?.map(s => s.stage)).toEqual(['light', 'rem', 'awake']);
    expect(await sleepRepo.allStages()).toHaveLength(3);
    expect(await sleepRepo.stagesFor([])).toEqual(new Map());

    await sleepRepo.remove(sessions[0].id!);
    expect(await sleepRepo.list()).toEqual([]);
    expect(await sleepRepo.allStages()).toEqual([]);
  });

  it('totals sleep per wake-up day', async () => {
    await sleepRepo.insert({ startMs: NOW - 8 * HOUR, endMs: NOW - HOUR, day: TODAY, sourceId: 'manual' });
    await sleepRepo.insert({ startMs: NOW - HOUR / 2, endMs: NOW, day: TODAY, quality: 4, sourceId: 'manual' });
    expect(await sleepRepo.minutesByDay(TODAY, TODAY)).toEqual([{ day: TODAY, value: 450 }]);
    expect(await sleepMinutesByDay(TODAY, TODAY, { devices: forms })).toEqual([{ day: TODAY, value: 450 }]);

    const latest = await sleepRepo.latest();
    expect(latest?.quality).toBe(4);
    await sleepRepo.remove(latest!.id!);
    expect(await sleepRepo.list()).toHaveLength(1);
  });

  it('keeps the last weight of each day for the trend, and a device reading only once', async () => {
    await bodyRepo.insert({ kind: 'weight', value: 72.4, unit: 'kg', atMs: NOW - 5000, day: TODAY, sourceId: 'manual' });
    await bodyRepo.insert({ kind: 'weight', value: 72.1, unit: 'kg', atMs: NOW - 1000, day: TODAY, sourceId: 'manual' });
    await bodyRepo.insert({ kind: 'body_fat', value: 18.5, unit: '%', atMs: NOW - 1000, day: TODAY, sourceId: 'manual' });

    expect(await bodyRepo.lastByDay('weight', TODAY, TODAY)).toEqual([{ day: TODAY, value: 72.1 }]);
    expect((await bodyRepo.latest('weight'))?.value).toBe(72.1);
    expect((await bodyRepo.list('weight')).map(m => m.value)).toEqual([72.1, 72.4]);

    const reading = { kind: 'weight' as const, value: 73, unit: 'kg', atMs: NOW, day: TODAY, sourceId: 'ble:SC', externalId: `w:${NOW}` };
    await bodyRepo.upsertExternal(reading);
    await bodyRepo.upsertExternal(reading);
    expect((await bodyRepo.list('weight')).map(m => m.value)).toEqual([73, 72.1, 72.4]);
    expect(await bodyRepo.lastBySourceByDay('weight', TODAY, TODAY)).toEqual([
      { day: TODAY, sourceId: 'ble:SC', value: 73, firstMs: NOW, lastMs: NOW },
      { day: TODAY, sourceId: 'manual', value: 72.1, firstMs: NOW - 1000, lastMs: NOW - 1000 },
    ]);

    const fat = await bodyRepo.latest('body_fat');
    await bodyRepo.remove(fat!.id!);
    expect(await bodyRepo.latest('body_fat')).toBeNull();
  });

  it('updates a saved device in place, keeping what a later connect does not mention', async () => {
    await devicesRepo.upsert({ id: 'AA:BB', name: null, kind: 'unknown', lastSeenMs: 1 });
    await devicesRepo.upsert({
      id: 'AA:BB',
      name: 'Polar H10',
      kind: 'strap',
      lastSeenMs: 2,
      platform: 'gatt',
      capabilities: ['live_hr', 'battery'],
      manufacturer: 'Polar',
      firmware: '3.0',
    });
    expect(await devicesRepo.list()).toEqual([
      {
        id: 'AA:BB',
        name: 'Polar H10',
        kind: 'strap',
        lastSeenMs: 2,
        platform: 'gatt',
        capabilities: ['live_hr', 'battery'],
        manufacturer: 'Polar',
        model: null,
        firmware: '3.0',
        autoConnect: false,
        lastSyncMs: null,
        settings: {},
      },
    ]);
    // A connect from a scan without a name, or without device information, keeps what is stored.
    await devicesRepo.upsert({ id: 'AA:BB', name: null, kind: 'strap', lastSeenMs: 3 });
    await devicesRepo.setAutoConnect('AA:BB', true);
    await devicesRepo.markSynced('AA:BB', 99);
    await devicesRepo.setSettings('AA:BB', { hrIntervalMin: 10 });
    expect(await devicesRepo.get('AA:BB')).toMatchObject({
      name: 'Polar H10',
      lastSeenMs: 3,
      manufacturer: 'Polar',
      autoConnect: true,
      lastSyncMs: 99,
      settings: { hrIntervalMin: 10 },
    });

    await devicesRepo.remove('AA:BB');
    expect(await devicesRepo.list()).toEqual([]);
    expect(await devicesRepo.get('AA:BB')).toBeNull();
  });

  it('loads trend series with zeros for totals and gaps for measurements', async () => {
    await samplesRepo.insertMany([steps(4000, NOW, TODAY), heartRate(64, NOW), heartRate(151, NOW - 1000)]);
    await samplesRepo.insert({ metric: 'spo2', value: 97, unit: '%', startMs: NOW, endMs: NOW, day: TODAY, sourceId: 'ble:FC:75', externalId: 'spo2:1' });

    expect((await loadSeries('steps', 3)).map(d => d.value)).toEqual([0, 0, 4000]);
    expect((await loadSeries('heart_rate', 3)).map(d => d.value)).toEqual([NaN, NaN, 107.5]);
    expect((await loadSeries('resting_hr', 3)).map(d => d.value)).toEqual([NaN, NaN, 64]);
    expect((await loadSeries('weight', 3)).map(d => d.value)).toEqual([NaN, NaN, NaN]);
    expect((await loadSeries('spo2', 3)).map(d => d.value)).toEqual([NaN, NaN, 97]);
    expect((await loadSeries('stress', 3)).map(d => d.value)).toEqual([NaN, NaN, NaN]);
    for (const key of ['active_minutes', 'active_kcal', 'sleep'] as const) {
      expect((await loadSeries(key, 3)).map(d => d.value)).toEqual([0, 0, 0]);
    }
  });

  it('exports every table and quotes CSV fields that need it', async () => {
    await workoutsRepo.insert({
      type: 'yoga',
      startMs: NOW - HOUR,
      endMs: NOW,
      day: TODAY,
      durationS: 3600,
      notes: 'slow, "easy"\nflow',
      sourceId: 'manual',
    });
    await samplesRepo.insert(steps(10, NOW, TODAY));
    await devicesRepo.upsert({ id: 'AA:BB', name: 'Polar H10', kind: 'strap', lastSeenMs: 1, capabilities: ['live_hr'] });

    const data = await collectAll();
    expect(data.samples).toHaveLength(1);
    expect(data.sleepStages).toEqual([]);
    expect(data.devices).toHaveLength(1);
    const csv = toCsv(data.workouts as unknown as Record<string, unknown>[]);
    expect(csv.split('\n')[0]).toBe(
      'id,type,title,startMs,endMs,day,durationS,distanceM,kcal,avgHr,maxHr,effort,notes,sourceId,externalId,device',
    );
    expect(csv).toContain('"slow, ""easy""\nflow"');
    // Nested values (a device's capability list) are written as JSON inside the cell.
    expect(toCsv(data.devices as unknown as Record<string, unknown>[])).toContain('"[""live_hr""]"');
  });

  it('wipes every table', async () => {
    await samplesRepo.insert(steps(10, NOW, TODAY));
    await sleepRepo.upsertExternal({ startMs: NOW - HOUR, endMs: NOW, day: TODAY, sourceId: 'ble:R1', externalId: 's' }, [
      { stage: 'deep', startMs: NOW - HOUR, endMs: NOW },
    ]);
    await devicesRepo.upsert({ id: 'AA:BB', name: null, kind: 'scale', lastSeenMs: 1 });

    await wipeAll();
    expect(await collectAll()).toMatchObject({ samples: [], workouts: [], sleep: [], sleepStages: [], body: [], devices: [] });
  });
});
