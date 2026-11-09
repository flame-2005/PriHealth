import { batch, query, run } from '..';
import type { SourceRow } from '../../domain/sources';
import type { DayValue, SleepSession, SleepStage, SleepStageKind } from '../../domain/types';

function fromRow(r: Record<string, unknown>): SleepSession {
  return {
    id: r.id as number,
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    day: String(r.day),
    quality: r.quality == null ? null : Number(r.quality),
    notes: (r.notes as string | null) ?? null,
    sourceId: String(r.source_id),
    externalId: (r.external_id as string | null) ?? null,
    device: (r.device as string | null) ?? null,
  };
}

function stageFromRow(r: Record<string, unknown>): SleepStage {
  return {
    id: r.id as number,
    sessionId: Number(r.session_id),
    stage: r.stage as SleepStageKind,
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
  };
}

const INSERT = `INSERT INTO sleep_sessions (start_ms, end_ms, day, quality, notes, source_id, external_id, device)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** Same key as `ux_sleep_external`: a device's night replaces itself on every sync. */
const UPSERT = `${INSERT}
  ON CONFLICT(source_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET start_ms = excluded.start_ms, end_ms = excluded.end_ms, day = excluded.day, device = excluded.device`;

const BY_KEY = 'SELECT id FROM sleep_sessions WHERE source_id = ? AND external_id = ?';

const params = (s: SleepSession) => [
  s.startMs,
  s.endMs,
  s.day,
  s.quality ?? null,
  s.notes ?? null,
  s.sourceId,
  s.externalId ?? null,
  s.device ?? null,
];

export const sleepRepo = {
  async insert(s: SleepSession): Promise<number | undefined> {
    return run(INSERT, params(s));
  },

  /**
   * A night from a device, with its stages. Keyed by (source, external id), so syncing the same
   * night again updates it in place and rewrites its stages. No foreign keys: op-sqlite does not
   * turn them on, so the stages are deleted here.
   */
  async upsertExternal(s: SleepSession, stages: readonly Omit<SleepStage, 'id' | 'sessionId'>[]): Promise<void> {
    if (!s.externalId) throw new Error('A device night needs an external id to find itself by.');
    const key = [s.sourceId, s.externalId];
    await batch([
      [UPSERT, params(s)],
      [`DELETE FROM sleep_stages WHERE session_id = (${BY_KEY})`, key],
      ...stages.map(
        st =>
          [`INSERT INTO sleep_stages (session_id, stage, start_ms, end_ms) VALUES ((${BY_KEY}), ?, ?, ?)`, [...key, st.stage, st.startMs, st.endMs]] as [
            string,
            unknown[],
          ],
      ),
    ]);
  },

  async latest(): Promise<SleepSession | null> {
    const rows = await query('SELECT * FROM sleep_sessions ORDER BY end_ms DESC LIMIT 1');
    return rows.length ? fromRow(rows[0]) : null;
  },

  async list(limit = 60): Promise<SleepSession[]> {
    return (await query('SELECT * FROM sleep_sessions ORDER BY end_ms DESC LIMIT ?', [limit])).map(fromRow);
  },

  /** Stages of the given sessions, oldest first, keyed by session id. */
  async stagesFor(sessionIds: readonly number[]): Promise<Map<number, SleepStage[]>> {
    const out = new Map<number, SleepStage[]>();
    if (!sessionIds.length) return out;
    const rows = await query(
      `SELECT * FROM sleep_stages WHERE session_id IN (${sessionIds.map(() => '?').join(',')}) ORDER BY start_ms`,
      [...sessionIds],
    );
    for (const r of rows) {
      const st = stageFromRow(r);
      const arr = out.get(st.sessionId!);
      if (arr) arr.push(st);
      else out.set(st.sessionId!, [st]);
    }
    return out;
  },

  /** Total minutes slept per wake-up day, every source added together. Prefer `tracking/sourcePolicy`. */
  async minutesByDay(fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      'SELECT day, SUM(end_ms - start_ms) / 60000.0 AS m FROM sleep_sessions WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [fromDay, toDay],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.m) }));
  },

  /** Minutes per wake-up day and source, for the source policy. */
  async minutesBySourceByDay(fromDay: string, toDay: string): Promise<SourceRow[]> {
    const rows = await query(
      `SELECT day, source_id, SUM(end_ms - start_ms) / 60000.0 AS m, MIN(start_ms) AS first_ms, MAX(end_ms) AS last_ms
       FROM sleep_sessions WHERE day BETWEEN ? AND ? GROUP BY day, source_id ORDER BY day, source_id`,
      [fromDay, toDay],
    );
    return rows.map(r => ({
      day: String(r.day),
      sourceId: String(r.source_id),
      value: Number(r.m),
      firstMs: Number(r.first_ms),
      lastMs: Number(r.last_ms),
    }));
  },

  async remove(id: number): Promise<void> {
    await batch([
      ['DELETE FROM sleep_stages WHERE session_id = ?', [id]],
      ['DELETE FROM sleep_sessions WHERE id = ?', [id]],
    ]);
  },

  async all(): Promise<SleepSession[]> {
    return (await query('SELECT * FROM sleep_sessions ORDER BY start_ms')).map(fromRow);
  },

  async allStages(): Promise<SleepStage[]> {
    return (await query('SELECT * FROM sleep_stages ORDER BY session_id, start_ms')).map(stageFromRow);
  },
};
