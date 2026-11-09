import { MIGRATIONS, TABLES } from '../src/db/schema';

/**
 * Runs the migration list on Node's own SQLite, from scratch and as an upgrade of a populated v1
 * database, so a migration that only works on an empty file fails here rather than on a phone.
 */
const sqlite = (globalThis as any).process.getBuiltinModule?.('node:sqlite');
const suite = sqlite ? describe : describe.skip;

type Db = { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): any[]; get(...p: unknown[]): any; run(...p: unknown[]): unknown } };

suite('migrations', () => {
  const open = (): Db => new sqlite.DatabaseSync(':memory:');
  const apply = (db: Db, versions: string[][]) => {
    for (const v of versions) for (const sql of v) db.exec(sql);
  };
  const columns = (db: Db, table: string): string[] => db.prepare(`PRAGMA table_info(${table})`).all().map(r => String(r.name));
  const indexes = (db: Db, table: string): string[] => db.prepare(`PRAGMA index_list(${table})`).all().map(r => String(r.name));

  it('upgrades a populated v1 database in place', () => {
    const db = open();
    apply(db, [MIGRATIONS[0]]);
    const device = db.prepare('INSERT INTO devices (id, name, kind, last_seen_ms) VALUES (?, ?, ?, ?)');
    device.run('AA:BB', 'Polar H10', 'heart_rate', 1);
    device.run('FC:75', 'Icon Plus', 'watch', 2);
    db.prepare('INSERT INTO sleep_sessions (start_ms, end_ms, day, source_id) VALUES (?, ?, ?, ?)').run(1, 2, '2026-09-27', 'manual');
    db.prepare('INSERT INTO workouts (type, start_ms, end_ms, day, duration_s, source_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      'run',
      1,
      2,
      '2026-09-27',
      1,
      'manual',
    );

    apply(db, MIGRATIONS.slice(1));

    const devices = db
      .prepare('SELECT id, kind, platform, capabilities, auto_connect, last_sync_ms, settings FROM devices ORDER BY id')
      .all()
      .map(r => ({ ...r }));
    expect(devices).toEqual([
      { id: 'AA:BB', kind: 'strap', platform: 'gatt', capabilities: '[]', auto_connect: 0, last_sync_ms: null, settings: '{}' },
      { id: 'FC:75', kind: 'watch', platform: 'gatt', capabilities: '[]', auto_connect: 0, last_sync_ms: null, settings: '{}' },
    ]);
    expect(columns(db, 'sleep_sessions')).toEqual(expect.arrayContaining(['external_id', 'device']));
    expect(columns(db, 'workouts')).toContain('device');
    expect(columns(db, 'sleep_stages')).toEqual(['id', 'session_id', 'stage', 'start_ms', 'end_ms']);
    expect(indexes(db, 'sleep_sessions')).toContain('ux_sleep_external');
    expect(indexes(db, 'workouts')).toContain('ux_workouts_external');
    expect(indexes(db, 'body_measurements')).toContain('ux_body_external');
    expect(db.prepare('SELECT COUNT(*) AS n FROM sleep_sessions').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM workouts').get().n).toBe(1);
  });

  it('reaches the same schema from scratch as by upgrading', () => {
    const fresh = open();
    apply(fresh, MIGRATIONS);
    const upgraded = open();
    apply(upgraded, [MIGRATIONS[0]]);
    apply(upgraded, MIGRATIONS.slice(1));
    for (const t of TABLES) {
      expect(columns(fresh, t)).toEqual(columns(upgraded, t));
      expect(indexes(fresh, t).sort()).toEqual(indexes(upgraded, t).sort());
    }
  });

  it('lists every table, so wipe and export cover all of them', () => {
    const db = open();
    apply(db, MIGRATIONS);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => String(r.name))
      .sort();
    expect(tables).toEqual([...TABLES].sort());
  });
});
