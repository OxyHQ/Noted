import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  run: null as
    | null
    | ((
        statements: readonly { sql: string; params?: unknown[]; expectedRowsAffected?: number }[],
      ) => Promise<number[]>),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'A',
  execute: vi.fn(),
  executeTransaction: (
    statements: readonly { sql: string; params?: unknown[]; expectedRowsAffected?: number }[],
  ) => state.run?.(statements),
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));
import { MIGRATIONS } from '@/lib/db/migrations';
import { createNote } from '@/lib/db/notes-repo';
import { runImport } from '@/lib/import/run';

const sqlite = await import('node:sqlite').catch(() => null);
describe('import retry after an uncertain local write', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite', () => {});
    return;
  }
  it('reimporting a file after a committed write loses its acknowledgement and creates another note', async () => {
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
      state.run = async (statements) => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const changes = statements.map(({ sql, params, expectedRowsAffected }) => {
            const result = db.prepare(sql).run(...((params ?? []) as (string | number | null)[]));
            const count = Number(result.changes);
            if (expectedRowsAffected !== undefined && count !== expectedRowsAffected)
              throw new Error('unexpected affected rows');
            return count;
          });
          db.exec('COMMIT');
          return changes;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
      let nextId = 0;
      let loseAck = true;
      const deps = {
        makeId: () => `synthetic-${++nextId}`,
        createNote: async (id: string, input: Parameters<typeof createNote>[1]) => {
          await createNote(id, input, 'A');
          if (loseAck) {
            loseAck = false;
            throw new Error('simulated lost acknowledgement after commit');
          }
        },
        labels: [],
        createLabel: async () => null,
      };
      const file = [{ name: 'example.md', text: '# Imported note\n\nSynthetic content' }];
      await expect(runImport(file, deps)).rejects.toThrow('simulated lost acknowledgement');
      expect(db.prepare('SELECT count(*) AS n FROM notes').get()?.n).toBe(1);
      expect(db.prepare('SELECT count(*) AS n FROM outbox').get()?.n).toBe(1);
      expect((await runImport(file, deps)).imported).toBe(1);
      expect(db.prepare('SELECT count(*) AS n FROM notes').get()?.n).toBe(2);
      expect(db.prepare('SELECT count(*) AS n FROM outbox').get()?.n).toBe(2);
    } finally {
      state.run = null;
      db.close();
    }
  });
});
