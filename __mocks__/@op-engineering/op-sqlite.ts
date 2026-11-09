/**
 * Jest stand-in for op-sqlite, backed by the SQLite engine built into Node, so tests run the app's
 * real schema and SQL. Used automatically; a test that needs to control the connection itself
 * (see __tests__/db.test.ts) declares its own mock instead.
 *
 * Node only ships SQLite from 22.5, and before 22.13 it sits behind a flag. Suites that rely on this
 * mock check for it and skip when it is missing.
 */
export function open() {
  const { DatabaseSync } = (globalThis as any).process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return {
    execute: async (sql: string, params: unknown[] = []) => {
      const stmt = db.prepare(sql);
      const returnsRows =
        typeof stmt.columns === 'function' ? stmt.columns().length > 0 : /^\s*(SELECT|WITH|PRAGMA\s+\w+\s*$)/i.test(sql);
      if (returnsRows) return { rows: stmt.all(...params), rowsAffected: 0 };
      const res = stmt.run(...params);
      return { rows: [], rowsAffected: Number(res.changes), insertId: Number(res.lastInsertRowid) };
    },
  };
}
