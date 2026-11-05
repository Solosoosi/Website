// A small stand-in for Cloudflare D1, on node:sqlite with the real migrations (migrations/).
// Used by the Worker's tests; D1's own behaviour is checked with `wrangler dev`.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dir = new URL('../../migrations/', import.meta.url);

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(new URL(file, dir), 'utf8'));
  }
  const check = (params) => {
    if (params.some((p) => p === undefined)) throw new TypeError('D1_TYPE_ERROR: Type undefined is not supported');
  };
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    async first(column) {
      check(params);
      const row = db.prepare(sql).get(...params);
      if (!row) return null;
      return column ? row[column] : { ...row };
    },
    allNow() {
      check(params);
      return { success: true, results: db.prepare(sql).all(...params).map((r) => ({ ...r })), meta: {} };
    },
    async all() {
      return this.allNow();
    },
    async run() {
      check(params);
      const r = db.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      // All at once, like D1: nothing else runs in between.
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.allNow());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
