import { query, run } from '..';
import type { SourceRow } from '../../domain/sources';
import type { BodyKind, BodyMeasurement, DayValue } from '../../domain/types';

function fromRow(r: Record<string, unknown>): BodyMeasurement {
  return {
    id: r.id as number,
    kind: r.kind as BodyKind,
    value: Number(r.value),
    unit: String(r.unit),
    atMs: Number(r.at_ms),
    day: String(r.day),
    sourceId: String(r.source_id),
    externalId: (r.external_id as string | null) ?? null,
  };
}

const INSERT = 'INSERT INTO body_measurements (kind, value, unit, at_ms, day, source_id, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)';

/** Same key as `ux_body_external`: a reading synced twice is stored once. */
const INSERT_EXTERNAL = `${INSERT} ON CONFLICT(source_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`;

const params = (m: BodyMeasurement) => [m.kind, m.value, m.unit, m.atMs, m.day, m.sourceId, m.externalId ?? null];

export const bodyRepo = {
  async insert(m: BodyMeasurement): Promise<number | undefined> {
    return run(INSERT, params(m));
  },

  /** A reading from a device; needs an external id, and is a no-op when it is already stored. */
  async upsertExternal(m: BodyMeasurement): Promise<void> {
    if (!m.externalId) throw new Error('A device reading needs an external id to find itself by.');
    await run(INSERT_EXTERNAL, params(m));
  },

  async latest(kind: BodyKind): Promise<BodyMeasurement | null> {
    const rows = await query('SELECT * FROM body_measurements WHERE kind = ? ORDER BY at_ms DESC LIMIT 1', [kind]);
    return rows.length ? fromRow(rows[0]) : null;
  },

  async list(kind: BodyKind, limit = 100): Promise<BodyMeasurement[]> {
    return (
      await query('SELECT * FROM body_measurements WHERE kind = ? ORDER BY at_ms DESC LIMIT ?', [kind, limit])
    ).map(fromRow);
  },

  /** Last value recorded on each day in the range, any source (days without entries are omitted). */
  async lastByDay(kind: BodyKind, fromDay: string, toDay: string): Promise<DayValue[]> {
    const rows = await query(
      `SELECT b.day AS day, b.value AS value FROM body_measurements b
       JOIN (SELECT day, MAX(at_ms) AS at_ms FROM body_measurements WHERE kind = ? AND day BETWEEN ? AND ? GROUP BY day) last
       ON last.day = b.day AND last.at_ms = b.at_ms
       WHERE b.kind = ? ORDER BY b.day`,
      [kind, fromDay, toDay, kind],
    );
    return rows.map(r => ({ day: String(r.day), value: Number(r.value) }));
  },

  /** Last value per day and source, for the source policy. */
  async lastBySourceByDay(kind: BodyKind, fromDay: string, toDay: string): Promise<SourceRow[]> {
    const rows = await query(
      `SELECT b.day AS day, b.source_id AS source_id, b.value AS value, b.at_ms AS at_ms FROM body_measurements b
       JOIN (SELECT day, source_id, MAX(at_ms) AS at_ms FROM body_measurements WHERE kind = ? AND day BETWEEN ? AND ? GROUP BY day, source_id) last
       ON last.day = b.day AND last.source_id = b.source_id AND last.at_ms = b.at_ms
       WHERE b.kind = ? ORDER BY b.day, b.source_id`,
      [kind, fromDay, toDay, kind],
    );
    return rows.map(r => ({
      day: String(r.day),
      sourceId: String(r.source_id),
      value: Number(r.value),
      firstMs: Number(r.at_ms),
      lastMs: Number(r.at_ms),
    }));
  },

  async remove(id: number): Promise<void> {
    await run('DELETE FROM body_measurements WHERE id = ?', [id]);
  },

  async all(): Promise<BodyMeasurement[]> {
    return (await query('SELECT * FROM body_measurements ORDER BY at_ms')).map(fromRow);
  },
};
