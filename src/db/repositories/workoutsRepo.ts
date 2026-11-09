import { batch, query, run } from '..';
import type { DayValue, Workout, WorkoutType } from '../../domain/types';

function fromRow(r: Record<string, unknown>): Workout {
  return {
    id: r.id as number,
    type: r.type as WorkoutType,
    title: (r.title as string | null) ?? null,
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    day: String(r.day),
    durationS: Number(r.duration_s),
    distanceM: r.distance_m == null ? null : Number(r.distance_m),
    kcal: r.kcal == null ? null : Number(r.kcal),
    avgHr: r.avg_hr == null ? null : Number(r.avg_hr),
    maxHr: r.max_hr == null ? null : Number(r.max_hr),
    effort: r.effort == null ? null : Number(r.effort),
    notes: (r.notes as string | null) ?? null,
    sourceId: String(r.source_id),
    externalId: (r.external_id as string | null) ?? null,
    device: (r.device as string | null) ?? null,
  };
}

const INSERT = `INSERT INTO workouts
  (type, title, start_ms, end_ms, day, duration_s, distance_m, kcal, avg_hr, max_hr, effort, notes, source_id, external_id, device)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Same key as `ux_workouts_external`: a device's workout replaces itself on every sync. */
const UPSERT = `${INSERT}
  ON CONFLICT(source_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET type = excluded.type, end_ms = excluded.end_ms, day = excluded.day, duration_s = excluded.duration_s,
    distance_m = excluded.distance_m, kcal = excluded.kcal, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr,
    device = excluded.device`;

const params = (w: Workout) => [
  w.type,
  w.title ?? null,
  w.startMs,
  w.endMs,
  w.day,
  w.durationS,
  w.distanceM ?? null,
  w.kcal ?? null,
  w.avgHr ?? null,
  w.maxHr ?? null,
  w.effort ?? null,
  w.notes ?? null,
  w.sourceId,
  w.externalId ?? null,
  w.device ?? null,
];

export const workoutsRepo = {
  async insert(w: Workout): Promise<number | undefined> {
    return run(INSERT, params(w));
  },

  /** A workout from a device. Resolves the row id, whether it was created or refreshed. */
  async upsertExternal(w: Workout): Promise<number> {
    if (!w.externalId) throw new Error('A device workout needs an external id to find itself by.');
    await run(UPSERT, params(w));
    const rows = await query('SELECT id FROM workouts WHERE source_id = ? AND external_id = ?', [w.sourceId, w.externalId]);
    return Number(rows[0]?.id);
  },

  async byId(id: number): Promise<Workout | null> {
    const rows = await query('SELECT * FROM workouts WHERE id = ?', [id]);
    return rows.length ? fromRow(rows[0]) : null;
  },

  async list(limit = 200): Promise<Workout[]> {
    return (await query('SELECT * FROM workouts ORDER BY start_ms DESC LIMIT ?', [limit])).map(fromRow);
  },

  async forDay(day: string): Promise<Workout[]> {
    return (await query('SELECT * FROM workouts WHERE day = ? ORDER BY start_ms DESC', [day])).map(fromRow);
  },

  async minutesByDay(fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      'SELECT day, SUM(duration_s) / 60.0 AS m FROM workouts WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [fromDay, toDay],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.m) }));
  },

  async kcalByDay(fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      'SELECT day, COALESCE(SUM(kcal), 0) AS k FROM workouts WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [fromDay, toDay],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.k) }));
  },

  /**
   * Removes a workout and its heart-rate trace: `workout:<id>:<n>` rows for one recorded here,
   * `wk:<external id>:<n>` rows under the device's source for one that came off a device.
   */
  async remove(id: number): Promise<void> {
    const w = await this.byId(id);
    const statements: Array<[string, unknown[]]> = [
      ['DELETE FROM workouts WHERE id = ?', [id]],
      ["DELETE FROM samples WHERE metric = 'heart_rate' AND external_id LIKE ?", [`workout:${id}:%`]],
    ];
    if (w?.externalId) {
      statements.push([
        "DELETE FROM samples WHERE metric = 'heart_rate' AND source_id = ? AND external_id LIKE ?",
        [w.sourceId, `wk:${w.externalId}:%`],
      ]);
    }
    await batch(statements);
  },

  async all(): Promise<Workout[]> {
    return (await query('SELECT * FROM workouts ORDER BY start_ms')).map(fromRow);
  },
};
