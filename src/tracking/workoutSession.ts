import type { Sample, Workout, WorkoutType } from '../domain/types';
import { dayKey } from '../domain/time';
import { estimateKcal } from '../domain/units';

export interface HrPoint {
  atMs: number;
  bpm: number;
}

export interface SessionState {
  status: 'idle' | 'running' | 'paused';
  type: WorkoutType;
  startedAt: number;
  pausedAt: number | null;
  pausedTotalMs: number;
  hr: HrPoint[];
}

export const IDLE_SESSION: SessionState = {
  status: 'idle',
  type: 'walk',
  startedAt: 0,
  pausedAt: null,
  pausedTotalMs: 0,
  hr: [],
};

export function startSession(type: WorkoutType, now = Date.now()): SessionState {
  return { status: 'running', type, startedAt: now, pausedAt: null, pausedTotalMs: 0, hr: [] };
}

export function pauseSession(s: SessionState, now = Date.now()): SessionState {
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', pausedAt: now };
}

export function resumeSession(s: SessionState, now = Date.now()): SessionState {
  if (s.status !== 'paused' || s.pausedAt == null) return s;
  return { ...s, status: 'running', pausedAt: null, pausedTotalMs: s.pausedTotalMs + (now - s.pausedAt) };
}

export function addHeartRate(s: SessionState, bpm: number, now = Date.now()): SessionState {
  if (s.status !== 'running') return s;
  // Keep at most one sample per second.
  const last = s.hr[s.hr.length - 1];
  if (last && now - last.atMs < 1000) return s;
  return { ...s, hr: [...s.hr, { atMs: now, bpm }] };
}

/** Active seconds, excluding paused time. */
export function elapsedSeconds(s: SessionState, now = Date.now()): number {
  if (s.status === 'idle') return 0;
  const pausedNow = s.status === 'paused' && s.pausedAt != null ? now - s.pausedAt : 0;
  return Math.max(0, Math.floor((now - s.startedAt - s.pausedTotalMs - pausedNow) / 1000));
}

export function hrSummary(points: HrPoint[]): { avg: number | null; max: number | null } {
  if (!points.length) return { avg: null, max: null };
  let sum = 0;
  let max = 0;
  for (const p of points) {
    sum += p.bpm;
    if (p.bpm > max) max = p.bpm;
  }
  return { avg: Math.round(sum / points.length), max };
}

/** Build the workout row (and HR samples) from a finished session. */
export function finishSession(
  s: SessionState,
  opts: { weightKg: number | null; deviceId?: string | null; now?: number },
): { workout: Workout; samples: Sample[] } {
  const now = opts.now ?? Date.now();
  const resumed = s.status === 'paused' ? resumeSession(s, now) : s;
  const durationS = elapsedSeconds({ ...resumed, status: 'running' }, now);
  const { avg, max } = hrSummary(s.hr);
  const workout: Workout = {
    type: s.type,
    title: null,
    startMs: s.startedAt,
    endMs: now,
    day: dayKey(s.startedAt),
    durationS,
    distanceM: null,
    kcal: estimateKcal(s.type, durationS, opts.weightKg),
    avgHr: avg,
    maxHr: max,
    effort: null,
    notes: null,
    sourceId: 'manual',
    externalId: null,
  };
  const sourceId = opts.deviceId ? `ble:${opts.deviceId}` : 'ble';
  const samples: Sample[] = s.hr.map(p => ({
    metric: 'heart_rate',
    value: p.bpm,
    unit: 'bpm',
    startMs: p.atMs,
    endMs: p.atMs,
    day: dayKey(p.atMs),
    sourceId,
    externalId: null,
    device: opts.deviceId ?? null,
  }));
  return { workout, samples };
}
