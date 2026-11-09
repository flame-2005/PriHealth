import { bodyRepo } from '../db/repositories/bodyRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { sleepRepo } from '../db/repositories/sleepRepo';
import type { DeviceForm } from '../domain/devices';
import { mergeRanking, pickDaily, pickSeries, type DayPick, type Ranking } from '../domain/sources';
import type { DayValue } from '../domain/types';
import { useAppStore } from '../store/useAppStore';

/**
 * The daily numbers screens show, with the source policy applied: one source per day for steps,
 * sleep and weight, never a sum across devices. The policy is pure (`domain/sources.ts`); this
 * module supplies what it needs, the user's ranking and what each saved device is.
 */
export interface PolicyContext {
  ranking?: Ranking;
  devices?: ReadonlyMap<string, DeviceForm>;
}

export function currentRanking(): Ranking {
  return mergeRanking(useAppStore.getState().sourcePolicy);
}

export async function deviceForms(): Promise<Map<string, DeviceForm>> {
  return new Map((await devicesRepo.list()).map(d => [d.id, d.kind]));
}

async function resolve(c?: PolicyContext): Promise<Required<PolicyContext>> {
  return { ranking: c?.ranking ?? currentRanking(), devices: c?.devices ?? (await deviceForms()) };
}

export async function stepsByDay(fromDay: string, toDay: string, c?: PolicyContext): Promise<DayValue[]> {
  const [rows, ctx] = await Promise.all([samplesRepo.totalsBySourceByDay('steps', fromDay, toDay), resolve(c)]);
  return pickSeries(rows, 'steps', ctx.ranking, ctx.devices);
}

export async function stepsForDay(day: string, c?: PolicyContext): Promise<number> {
  return (await stepsByDay(day, day, c))[0]?.value ?? 0;
}

/** Today's steps with where they came from, for the "from Icon Plus since 13:02" hint. */
export async function stepsPickForDay(day: string, c?: PolicyContext): Promise<DayPick | null> {
  const [rows, ctx] = await Promise.all([samplesRepo.totalsBySourceByDay('steps', day, day), resolve(c)]);
  return pickDaily(rows, 'steps', ctx.ranking, ctx.devices).get(day) ?? null;
}

export async function sleepMinutesByDay(fromDay: string, toDay: string, c?: PolicyContext): Promise<DayValue[]> {
  const [rows, ctx] = await Promise.all([sleepRepo.minutesBySourceByDay(fromDay, toDay), resolve(c)]);
  return pickSeries(rows, 'sleep', ctx.ranking, ctx.devices);
}

export async function weightByDay(fromDay: string, toDay: string, c?: PolicyContext): Promise<DayValue[]> {
  const [rows, ctx] = await Promise.all([bodyRepo.lastBySourceByDay('weight', fromDay, toDay), resolve(c)]);
  return pickSeries(rows, 'weight', ctx.ranking, ctx.devices);
}
