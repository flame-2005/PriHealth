import { open, type DB } from '@op-engineering/op-sqlite';
import { DB_KEY_ALIAS, DB_NAME, ENCRYPTED_DB } from '../config';
import { SecureKey } from '../bridge/secureKey';
import { MIGRATIONS, TABLES } from './schema';

let dbPromise: Promise<DB> | null = null;

export type Row = Record<string, any>;

/** Normalise op-sqlite result rows across versions. */
export function rowsOf(result: any): Row[] {
  const r = result?.rows;
  if (Array.isArray(r)) return r as Row[];
  if (r && Array.isArray(r._array)) return r._array as Row[];
  return [];
}

async function openDatabase(): Promise<DB> {
  const encryptionKey = ENCRYPTED_DB ? await SecureKey.getOrCreateKey(DB_KEY_ALIAS) : undefined;
  const db = open(encryptionKey ? { name: DB_NAME, encryptionKey } : { name: DB_NAME });
  await migrate(db);
  return db;
}

async function migrate(db: DB): Promise<void> {
  const versionRes = await db.execute('PRAGMA user_version');
  const current = Number(rowsOf(versionRes)[0]?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.execute('BEGIN');
    try {
      for (const sql of MIGRATIONS[v]) await db.execute(sql);
      await db.execute(`PRAGMA user_version = ${v + 1}`);
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }
}

export function getDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDatabase().catch(e => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function query(sql: string, params: any[] = []): Promise<Row[]> {
  const db = await getDb();
  return rowsOf(await db.execute(sql, params));
}

/**
 * Writes run one at a time. Everything shares a single connection, so a write issued while another
 * caller's transaction is open would join it, and a second BEGIN would fail and its ROLLBACK would
 * undo the first caller's work (e.g. a step sync landing while a workout's heart-rate samples save).
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: (db: DB) => Promise<T>): Promise<T> {
  const result = writeQueue.then(async () => task(await getDb()));
  writeQueue = result.catch(() => {});
  return result;
}

export async function run(sql: string, params: any[] = []): Promise<number | undefined> {
  const res = await enqueueWrite(db => db.execute(sql, params));
  return (res as any)?.insertId as number | undefined;
}

/** Run several statements atomically. */
export async function batch(statements: Array<[string, any[]]>): Promise<void> {
  if (!statements.length) return;
  await enqueueWrite(async db => {
    await db.execute('BEGIN');
    try {
      for (const [sql, params] of statements) await db.execute(sql, params);
      await db.execute('COMMIT');
    } catch (e) {
      // Keep the original error even if there is nothing left to roll back.
      await db.execute('ROLLBACK').catch(() => {});
      throw e;
    }
  });
}

/** Delete every row in every table (used by "Delete all data"). */
export async function wipeAll(): Promise<void> {
  await batch(TABLES.map(t => [`DELETE FROM ${t}`, []] as [string, unknown[]]));
  // Queued like any other write: VACUUM is refused while a transaction is open.
  await enqueueWrite(db => db.execute('VACUUM'));
}
