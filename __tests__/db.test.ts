import { batch, run } from '../src/db';

/**
 * Stand-in for the single SQLite connection. It answers on a later tick, like the native thread
 * does, and keeps SQLite's transaction rules, so writes that are allowed to overlap really collide.
 */
const mockDb = { inTx: false, pending: [] as string[], committed: [] as string[] };

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    execute: (sql: string, params?: unknown[]) =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          const ok = (rows: object[] = []) => resolve({ rows, rowsAffected: 1, insertId: 7 });
          // Already at the latest schema: this test is about write ordering, not migrations.
          if (sql.startsWith('PRAGMA user_version')) return ok([{ user_version: 99 }]);
          if (sql === 'BEGIN') {
            if (mockDb.inTx) return reject(new Error('cannot start a transaction within a transaction'));
            mockDb.inTx = true;
            return ok();
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (!mockDb.inTx) return reject(new Error(`cannot ${sql.toLowerCase()} - no transaction is active`));
            if (sql === 'COMMIT') mockDb.committed.push(...mockDb.pending);
            mockDb.pending = [];
            mockDb.inTx = false;
            return ok();
          }
          if (sql === 'FAIL') return reject(new Error('boom'));
          (mockDb.inTx ? mockDb.pending : mockDb.committed).push(String(params?.[0]));
          return ok();
        }, 0);
      }),
  }),
}));

describe('db writes', () => {
  beforeEach(() => {
    mockDb.inTx = false;
    mockDb.pending = [];
    mockDb.committed = [];
  });

  it('keeps two batches started together from colliding', async () => {
    await Promise.all([
      batch([
        ['INSERT', ['a1']],
        ['INSERT', ['a2']],
      ]),
      batch([
        ['INSERT', ['b1']],
        ['INSERT', ['b2']],
      ]),
    ]);
    expect(mockDb.committed).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('keeps a single write out of a batch that is still open', async () => {
    const open = batch([
      ['INSERT', ['a1']],
      ['INSERT', ['a2']],
    ]);
    const solo = run('INSERT', ['solo']);
    await Promise.all([open, solo]);
    expect(mockDb.committed).toEqual(['a1', 'a2', 'solo']);
    expect(await solo).toBe(7);
  });

  it('rolls a failed batch back, reports the real error and lets later writes through', async () => {
    await expect(
      batch([
        ['INSERT', ['x1']],
        ['FAIL', []],
      ]),
    ).rejects.toThrow('boom');
    await batch([['INSERT', ['y1']]]);
    expect(mockDb.committed).toEqual(['y1']);
  });
});
