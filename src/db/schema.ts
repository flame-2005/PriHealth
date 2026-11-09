/** Versioned migrations. Each entry runs once, in order, inside a transaction. */
export const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_id TEXT NOT NULL,
      external_id TEXT,
      device TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_samples_external
      ON samples(source_id, external_id, metric) WHERE external_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_samples_metric_day ON samples(metric, day)`,
    `CREATE INDEX IF NOT EXISTS idx_samples_metric_time ON samples(metric, start_ms)`,

    `CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      day TEXT NOT NULL,
      duration_s INTEGER NOT NULL,
      distance_m REAL,
      kcal REAL,
      avg_hr REAL,
      max_hr REAL,
      effort INTEGER,
      notes TEXT,
      source_id TEXT NOT NULL,
      external_id TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_workouts_day ON workouts(day)`,
    `CREATE INDEX IF NOT EXISTS idx_workouts_start ON workouts(start_ms)`,

    `CREATE TABLE IF NOT EXISTS sleep_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      day TEXT NOT NULL,
      quality INTEGER,
      notes TEXT,
      source_id TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sleep_day ON sleep_sessions(day)`,

    `CREATE TABLE IF NOT EXISTS body_measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_id TEXT NOT NULL,
      external_id TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_body_kind_time ON body_measurements(kind, at_ms)`,

    `CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      kind TEXT NOT NULL,
      last_seen_ms INTEGER NOT NULL
    )`,
  ],
  // v2: devices learn their platform and capabilities; device history (sleep with stages, workouts,
  // body readings) gets a (source, external id) key so a re-sync is a no-op; `kind` becomes the form
  // factor ('heart_rate' was the only value that was not one).
  [
    `ALTER TABLE devices ADD COLUMN platform TEXT NOT NULL DEFAULT 'gatt'`,
    `ALTER TABLE devices ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE devices ADD COLUMN manufacturer TEXT`,
    `ALTER TABLE devices ADD COLUMN model TEXT`,
    `ALTER TABLE devices ADD COLUMN firmware TEXT`,
    `ALTER TABLE devices ADD COLUMN auto_connect INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE devices ADD COLUMN last_sync_ms INTEGER`,
    `ALTER TABLE devices ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'`,
    `UPDATE devices SET kind = 'strap' WHERE kind = 'heart_rate'`,

    `ALTER TABLE sleep_sessions ADD COLUMN external_id TEXT`,
    `ALTER TABLE sleep_sessions ADD COLUMN device TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_sleep_external
      ON sleep_sessions(source_id, external_id) WHERE external_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS sleep_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sleep_stages_session ON sleep_stages(session_id, start_ms)`,

    `ALTER TABLE workouts ADD COLUMN device TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_workouts_external
      ON workouts(source_id, external_id) WHERE external_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_body_external
      ON body_measurements(source_id, external_id) WHERE external_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_samples_metric_day_source ON samples(metric, day, source_id)`,
  ],
];

export const TABLES = ['samples', 'workouts', 'sleep_sessions', 'sleep_stages', 'body_measurements', 'devices'] as const;
