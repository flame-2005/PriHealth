import { computeDelta, samplesForDelta } from '../src/tracking/stepMath';
import {
  addHeartRate,
  elapsedSeconds,
  finishSession,
  hrSummary,
  pauseSession,
  resumeSession,
  startSession,
} from '../src/tracking/workoutSession';

const BOOT = new Date(2026, 8, 27, 6).getTime();

describe('step counter maths', () => {
  it('first reading stores state with zero delta', () => {
    const r = { count: 5000, bootTimeMs: BOOT, atMs: BOOT + 3600_000 };
    const { delta, next } = computeDelta(null, r);
    expect(delta).toBe(0);
    expect(next).toEqual({ lastCount: 5000, lastAtMs: r.atMs, lastBootMs: BOOT });
    expect(samplesForDelta(null, r, delta)).toEqual([]);
  });

  it('diffs successive readings', () => {
    const prev = { lastCount: 5000, lastAtMs: BOOT + 3600_000, lastBootMs: BOOT };
    const r = { count: 5350, bootTimeMs: BOOT + 10, atMs: BOOT + 7200_000 };
    const { delta } = computeDelta(prev, r);
    expect(delta).toBe(350);
    const samples = samplesForDelta(prev, r, delta);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ metric: 'steps', value: 350, sourceId: 'phone', day: '2026-09-27' });
  });

  it('detects a reboot and counts steps since boot', () => {
    const prev = { lastCount: 5000, lastAtMs: BOOT + 3600_000, lastBootMs: BOOT };
    const r = { count: 120, bootTimeMs: BOOT + 5 * 3600_000, atMs: BOOT + 6 * 3600_000 };
    expect(computeDelta(prev, r).delta).toBe(120);
  });

  it('attributes overnight deltas across days', () => {
    const prev = { lastCount: 100, lastAtMs: new Date(2026, 8, 27, 22).getTime(), lastBootMs: BOOT };
    const r = { count: 700, bootTimeMs: BOOT, atMs: new Date(2026, 8, 28, 4).getTime() };
    const { delta } = computeDelta(prev, r);
    const samples = samplesForDelta(prev, r, delta);
    expect(samples.map(s => s.day)).toEqual(['2026-09-27', '2026-09-28']);
    expect(samples.reduce((a, s) => a + s.value, 0)).toBe(600);
  });

  it('attributes steps counted since a reboot to the time after it', () => {
    // Last read two days before the phone restarted this morning.
    const prev = { lastCount: 5000, lastAtMs: new Date(2026, 8, 25, 20).getTime(), lastBootMs: BOOT - 5 * 86_400_000 };
    const r = { count: 900, bootTimeMs: BOOT, atMs: BOOT + 4 * 3600_000 };
    const { delta } = computeDelta(prev, r);
    expect(delta).toBe(900);
    const samples = samplesForDelta(prev, r, delta);
    expect(samples.map(s => s.day)).toEqual(['2026-09-27']);
    expect(samples[0].startMs).toBe(BOOT);
  });

  it('does not take a clock change for a reboot when the boot counter is unchanged', () => {
    const prev = { lastCount: 5000, lastAtMs: BOOT + 3600_000, lastBootMs: BOOT, lastBootCount: 41 };
    // The wall clock jumped two hours, which moves the derived boot time with it.
    const r = { count: 5200, bootTimeMs: BOOT + 2 * 3600_000, atMs: BOOT + 3 * 3600_000 + 60_000, bootCount: 41 };
    expect(computeDelta(prev, r).delta).toBe(200);
  });

  it('does not recount after a framework restart that leaves the counter running', () => {
    const prev = { lastCount: 5000, lastAtMs: BOOT + 3600_000, lastBootMs: BOOT, lastBootCount: 41 };
    const r = { count: 5200, bootTimeMs: BOOT + 20, atMs: BOOT + 7200_000, bootCount: 42 };
    expect(computeDelta(prev, r).delta).toBe(200);
  });

  it('detects a reboot with the boot counter and carries it into the next state', () => {
    const prev = { lastCount: 100, lastAtMs: BOOT + 3600_000, lastBootMs: BOOT, lastBootCount: 41 };
    const r = { count: 2500, bootTimeMs: BOOT + 5 * 3600_000, atMs: BOOT + 9 * 3600_000, bootCount: 42 };
    const { delta, next } = computeDelta(prev, r);
    expect(delta).toBe(2500);
    expect(next.lastBootCount).toBe(42);
  });
});

describe('workout session', () => {
  it('tracks elapsed time excluding pauses', () => {
    const t0 = 1_000_000;
    let s = startSession('run', t0);
    expect(elapsedSeconds(s, t0 + 60_000)).toBe(60);
    s = pauseSession(s, t0 + 60_000);
    expect(elapsedSeconds(s, t0 + 90_000)).toBe(60);
    s = resumeSession(s, t0 + 90_000);
    expect(elapsedSeconds(s, t0 + 120_000)).toBe(90);
  });

  it('keeps at most one HR sample per second and only while running', () => {
    const t0 = 1_000_000;
    let s = startSession('run', t0);
    s = addHeartRate(s, 120, t0 + 1000);
    s = addHeartRate(s, 121, t0 + 1500);
    s = addHeartRate(s, 130, t0 + 2500);
    expect(s.hr.map(p => p.bpm)).toEqual([120, 130]);
    s = pauseSession(s, t0 + 3000);
    s = addHeartRate(s, 140, t0 + 4000);
    expect(s.hr).toHaveLength(2);
    expect(hrSummary(s.hr)).toEqual({ avg: 125, max: 130 });
  });

  it('produces a workout row and HR samples on finish', () => {
    const t0 = new Date(2026, 8, 27, 18).getTime();
    let s = startSession('cycle', t0);
    s = addHeartRate(s, 110, t0 + 1000);
    s = addHeartRate(s, 150, t0 + 2000);
    const { workout, samples } = finishSession(s, { weightKg: 70, deviceId: 'AA:BB', now: t0 + 1800_000 });
    expect(workout.durationS).toBe(1800);
    expect(workout.kcal).toBe(Math.round(7 * 70 * 0.5));
    expect(workout.avgHr).toBe(130);
    expect(workout.maxHr).toBe(150);
    expect(workout.day).toBe('2026-09-27');
    expect(samples).toHaveLength(2);
    expect(samples[0].sourceId).toBe('ble:AA:BB');
  });
});
