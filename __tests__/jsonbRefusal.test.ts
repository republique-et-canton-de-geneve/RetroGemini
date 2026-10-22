import { describe, it, expect } from 'vitest';
import { isJsonbRefusal, readRowsOneByOne } from '../server/services/jsonbRefusal.js';

/**
 * PostgreSQL's `::jsonb` refuses JSON text that Node's `JSON.parse` accepts —
 * a lone UTF-16 surrogate escape (`22P02`), a `\u0000` (`22P05`) — and one
 * such row fails a projection that casts every team row in one statement.
 * The fallback reads the rows one at a time and parses them in Node. These
 * pin its rules without a PostgreSQL (CI has none); the PostgreSQL run of
 * `passwordMigrationProjection.test.ts` drives it on real rows.
 */

type Rows = { rows: Array<Record<string, unknown>> };

const fakeStore = (rows: Record<string, string | null>) => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const query = async (sql: string, params: unknown[]): Promise<Rows> => {
    statements.push({ sql, params });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    if (sql.startsWith('SELECT key FROM')) {
      const prefix = String(params[0]).replace(/%$/, '');
      return { rows: Object.keys(rows).filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })) };
    }
    const value = rows[String(params[0])];
    // `null` here stands for a row deleted between the key scan and its read.
    return { rows: value === null ? [] : [{ value }] };
  };
  return { query, statements, maxInFlight: () => maxInFlight };
};

describe('isJsonbRefusal', () => {
  it('names the two refusals of a text JSON.parse accepts, and nothing else', () => {
    expect(isJsonbRefusal({ code: '22P02' })).toBe(true);
    expect(isJsonbRefusal({ code: '22P05' })).toBe(true);
    expect(isJsonbRefusal({ code: '57P01' })).toBe(false);
    expect(isJsonbRefusal(new Error('connection terminated'))).toBe(false);
    expect(isJsonbRefusal(null)).toBe(false);
  });
});

describe('readRowsOneByOne', () => {
  it('parses each row in Node, one at a time, and skips a row deleted meanwhile', async () => {
    const store = fakeStore({
      'team:a': JSON.stringify({ id: 'a', note: 'Re: aaa\ud83d...' }),
      'team:b': null,
      'team:c': JSON.stringify({ id: 'c', note: 'nul\u0000byte' }),
      'other:x': JSON.stringify({ id: 'x' })
    });
    const picked = await readRowsOneByOne({
      query: store.query,
      prefix: 'team:',
      pick: (value: { id: string; note: string }) => ({ id: value.id, note: value.note })
    });
    expect(picked).toEqual([
      { id: 'a', note: 'Re: aaa\ud83d...' },
      { id: 'c', note: 'nul\u0000byte' }
    ]);
    // A key scan, then one read per row, never two at once: one parsed record
    // is held at a time.
    expect(store.statements[0]).toEqual({ sql: 'SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key', params: ['team:%'] });
    expect(store.statements.slice(1).map((s) => s.params[0])).toEqual(['team:a', 'team:b', 'team:c']);
    expect(store.maxInFlight()).toBe(1);
  });

  it('throws on a row Node cannot parse either, naming the key and never the content', async () => {
    const store = fakeStore({
      'team:a': JSON.stringify({ id: 'a' }),
      'team:z': '{"id":"z","secret":"hunter2"'
    });
    const failure = readRowsOneByOne({ query: store.query, prefix: 'team:', pick: (value: unknown) => value });
    await expect(failure).rejects.toMatchObject({ code: 'ROW_UNPARSABLE', key: 'team:z' });
    await expect(failure).rejects.toThrow(/"team:z"/);
    await expect(failure).rejects.not.toThrow(/hunter2/);
  });
});
