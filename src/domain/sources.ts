import type { DeviceForm } from './devices';
import type { DayValue } from './types';

/**
 * Which device's number counts for a day. Several devices can report the same thing (a watch and
 * a ring both count steps and sleep; a strap and a watch both measure heart rate) and their
 * numbers must never be added together. Each metric has a best-first ranking of source classes;
 * for a day, the best-ranked class that has data wins.
 */
export type SourceClass = DeviceForm | 'phone' | 'manual' | 'demo';
export type PolicyMetric = 'steps' | 'sleep' | 'hr' | 'weight' | 'spo2' | 'stress';

/** Best first. Entries are source classes, or exact source ids (`ble:<id>`), which outrank classes. */
export type Ranking = Record<PolicyMetric, string[]>;
export type RankingOverride = Partial<Ranking>;

export const DEFAULT_RANKING: Ranking = {
  steps: ['watch', 'band', 'ring', 'unknown', 'phone', 'manual', 'demo'],
  sleep: ['ring', 'watch', 'band', 'unknown', 'manual', 'demo'],
  hr: ['strap', 'watch', 'band', 'ring', 'unknown', 'phone', 'manual', 'demo'],
  weight: ['scale', 'unknown', 'manual', 'demo'],
  spo2: ['ring', 'watch', 'band', 'unknown', 'demo'],
  stress: ['watch', 'band', 'ring', 'unknown', 'demo'],
};

export const POLICY_METRICS: PolicyMetric[] = ['steps', 'sleep', 'hr', 'weight', 'spo2', 'stress'];

export const POLICY_LABEL: Record<PolicyMetric, string> = {
  steps: 'Steps',
  sleep: 'Sleep',
  hr: 'Heart rate',
  weight: 'Weight',
  spo2: 'SpO2',
  stress: 'Stress',
};

/** Totals add up across non-overlapping sources of the same class; measurements never add. */
const MODE: Record<PolicyMetric, 'sum' | 'latest'> = {
  steps: 'sum',
  sleep: 'sum',
  hr: 'latest',
  weight: 'latest',
  spo2: 'latest',
  stress: 'latest',
};

export function mergeRanking(override: RankingOverride | null | undefined): Ranking {
  const out: Ranking = { ...DEFAULT_RANKING };
  for (const m of POLICY_METRICS) {
    const list = override?.[m];
    if (list && list.length) out[m] = list;
  }
  return out;
}

export function classify(sourceId: string, devices: ReadonlyMap<string, DeviceForm>): SourceClass {
  if (sourceId === 'phone' || sourceId === 'manual' || sourceId === 'demo') return sourceId;
  if (sourceId.startsWith('ble:')) return devices.get(sourceId.slice(4)) ?? 'unknown';
  return 'unknown';
}

/** Position in the ranking; an exact source id wins over its class; anything unlisted ranks last. */
export function rankOf(sourceId: string, list: readonly string[], devices: ReadonlyMap<string, DeviceForm>): number {
  const exact = list.indexOf(sourceId);
  if (exact >= 0) return exact;
  const cls = list.indexOf(classify(sourceId, devices));
  return cls >= 0 ? cls : list.length;
}

export interface SourceRow {
  day: string;
  sourceId: string;
  value: number;
  /** When this source's data for the day starts and ends; tells "worn in turn" from "worn together". */
  firstMs: number;
  lastMs: number;
}

export interface DayPick {
  value: number;
  sourceIds: string[];
  firstMs: number;
}

function combine(rows: SourceRow[], mode: 'sum' | 'latest'): DayPick {
  if (rows.length === 1) return { value: rows[0].value, sourceIds: [rows[0].sourceId], firstMs: rows[0].firstMs };
  const latest = rows.reduce((a, b) => (b.lastMs > a.lastMs ? b : a));
  if (mode === 'latest') return { value: latest.value, sourceIds: [latest.sourceId], firstMs: latest.firstMs };
  // Same class, worn one after the other (two watches, a watch swapped mid-day): the totals add up.
  // Worn at the same time they would double count, so the one that reported last stands alone.
  const sorted = [...rows].sort((a, b) => a.firstMs - b.firstMs);
  let end = -Infinity;
  for (const r of sorted) {
    if (r.firstMs < end) return { value: latest.value, sourceIds: [latest.sourceId], firstMs: latest.firstMs };
    end = Math.max(end, r.lastMs);
  }
  return {
    value: sorted.reduce((a, r) => a + r.value, 0),
    sourceIds: sorted.map(r => r.sourceId),
    firstMs: sorted[0].firstMs,
  };
}

/** One value per day: the best-ranked source class that has data for it. Days without rows are absent. */
export function pickDaily(
  rows: readonly SourceRow[],
  metric: PolicyMetric,
  ranking: Ranking,
  devices: ReadonlyMap<string, DeviceForm>,
): Map<string, DayPick> {
  const list = ranking[metric];
  const byDay = new Map<string, SourceRow[]>();
  for (const r of rows) {
    // A watch left on the desk reports 0 for the day; that is not a count that should beat the phone's.
    if (!(r.value > 0)) continue;
    const arr = byDay.get(r.day);
    if (arr) arr.push(r);
    else byDay.set(r.day, [r]);
  }
  const out = new Map<string, DayPick>();
  for (const [day, dayRows] of byDay) {
    let best = Infinity;
    let bestRows: SourceRow[] = [];
    for (const r of dayRows) {
      const k = rankOf(r.sourceId, list, devices);
      if (k < best) {
        best = k;
        bestRows = [r];
      } else if (k === best) bestRows.push(r);
    }
    out.set(day, combine(bestRows, MODE[metric]));
  }
  return out;
}

/** `pickDaily` as a day-ordered series. */
export function pickSeries(
  rows: readonly SourceRow[],
  metric: PolicyMetric,
  ranking: Ranking,
  devices: ReadonlyMap<string, DeviceForm>,
): DayValue[] {
  return [...pickDaily(rows, metric, ranking, devices)]
    .map(([day, p]) => ({ day, value: p.value }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
