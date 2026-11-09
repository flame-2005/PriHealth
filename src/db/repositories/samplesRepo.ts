import { batch, query, run } from '..';
import type { SourceRow } from '../../domain/sources';
import type { DayValue, Metric, Sample } from '../../domain/types';

function fromRow(r: Record<string, unknown>): Sample {
  return {
    id: r.id as number,
    metric: r.metric as Metric,
    value: Number(r.value),
    unit: String(r.unit),
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    day: String(r.day),
    sourceId: String(r.source_id),
    externalId: (r.external_id as string | null) ?? null,
    device: (r.device as string | null) ?? null,
  };
}

function toSourceRow(r: Record<string, unknown>): SourceRow {
  return {
    day: String(r.day),
    sourceId: String(r.source_id),
    value: Number(r.total),
    firstMs: Number(r.first_ms),
    lastMs: Number(r.last_ms),
  };
}

const INSERT = `INSERT OR IGNORE INTO samples
  (metric, value, unit, start_ms, end_ms, day, source_id, external_id, device)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Same key as `ux_samples_external`. A device's running total for a day only ever grows: a watch
 * resets at its own midnight, which can be a minute off the phone's, and that first small reading
 * must not wipe the day it is still filed under. `start_ms` keeps the first time the source
 * reported for the day, which is how the source policy tells a watch worn all day from one put on
 * at lunch.
 */
const UPSERT_TOTAL = `INSERT INTO samples
  (metric, value, unit, start_ms, end_ms, day, source_id, external_id, device)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_id, external_id, metric) WHERE external_id IS NOT NULL
  DO UPDATE SET value = MAX(samples.value, excluded.value), end_ms = MAX(samples.end_ms, excluded.end_ms),
    start_ms = MIN(samples.start_ms, excluded.start_ms), device = excluded.device`;

const params = (s: Sample) => [
  s.metric,
  s.value,
  s.unit,
  s.startMs,
  s.endMs,
  s.day,
  s.sourceId,
  s.externalId ?? null,
  s.device ?? null,
];

export const samplesRepo = {
  async insert(s: Sample): Promise<number | undefined> {
    return run(INSERT, params(s));
  },

  async insertMany(samples: Sample[]): Promise<void> {
    await batch(samples.map(s => [INSERT, params(s)]));
  },

  /** Inserts a running total, or raises the stored one to it. */
  async upsertTotal(s: Sample): Promise<void> {
    if (!s.externalId) throw new Error('A running total needs an external id to find itself by.');
    await run(UPSERT_TOTAL, params(s));
  },

  /**
   * A day's total per source, with the span the source reported over. Screens never add these
   * across sources: `domain/sources.ts` picks the one that counts (see `tracking/sourcePolicy.ts`).
   */
  async totalsBySourceByDay(metric: Metric, fromDay: string, toDay: string): Promise<SourceRow[]> {
    const rows = await query(
      `SELECT day, source_id, SUM(value) AS total, MIN(start_ms) AS first_ms, MAX(end_ms) AS last_ms
       FROM samples WHERE metric = ? AND day BETWEEN ? AND ? GROUP BY day, source_id ORDER BY day, source_id`,
      [metric, fromDay, toDay],
    );
    return rows.map(toSourceRow);
  },

  async sumForDay(metric: Metric, day: string): Promise<number> {
    const rows = await query('SELECT COALESCE(SUM(value), 0) AS total FROM samples WHERE metric = ? AND day = ?', [
      metric,
      day,
    ]);
    return Number(rows[0]?.total ?? 0);
  },

  async sumByDay(metric: Metric, fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      'SELECT day, SUM(value) AS total FROM samples WHERE metric = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [metric, fromDay, toDay],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.total) }));
  },

  async avgByDay(metric: Metric, fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      'SELECT day, AVG(value) AS avg FROM samples WHERE metric = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [metric, fromDay, toDay],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.avg) }));
  },

  async minByDay(metric: Metric, fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      'SELECT day, MIN(value) AS m FROM samples WHERE metric = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [metric, fromDay, toDay],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.m) }));
  },

  /** Newest reading of a metric, from one source or from any. */
  async latest(metric: Metric, sourceId?: string): Promise<Sample | null> {
    const rows = sourceId
      ? await query('SELECT * FROM samples WHERE metric = ? AND source_id = ? ORDER BY end_ms DESC LIMIT 1', [metric, sourceId])
      : await query('SELECT * FROM samples WHERE metric = ? ORDER BY end_ms DESC LIMIT 1', [metric]);
    return rows.length ? fromRow(rows[0]) : null;
  },

  async range(metric: Metric, fromMs: number, toMs: number): Promise<Sample[]> {
    const rows = await query(
      'SELECT * FROM samples WHERE metric = ? AND start_ms >= ? AND start_ms < ? ORDER BY start_ms',
      [metric, fromMs, toMs],
    );
    return rows.map(fromRow);
  },

  async all(): Promise<Sample[]> {
    return (await query('SELECT * FROM samples ORDER BY start_ms')).map(fromRow);
  },
};
