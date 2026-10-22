import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two whole-store restore routes must let go of the parsed archive before
 * the post-restore passes run.
 *
 * Right after a faithful replace, the password pass loads and parses every
 * team record again (`migrateLegacyPasswords` → `loadAllTeams`), and those
 * records are the archive's data. A route that keeps the parsed archive in
 * scope across that pass — a `let archive` in the same block as the
 * `await rehashRestoredPasswords()` is enough, since an async function's
 * suspended frame keeps every local — holds two whole-store copies at once.
 * On a 384 Mi pod restoring a large row, that is an OOM kill after the replace
 * succeeded: the console reports a failed restore, and the audit row is never
 * written.
 *
 * Reachability can only be observed with `gc()`, which a vitest worker does
 * not have, so the routes are driven in a child `node --expose-gc`
 * (`helpers/restoreArchiveRetention.mjs`). Its `control` case keeps the
 * archive on purpose: if that ever reads as collected, the detector is blind
 * on this V8 and the other two results mean nothing.
 */

const FIXTURE = join(__dirname, 'helpers', 'restoreArchiveRetention.mjs');

type CaseResult = { status: number; passwords: boolean | null; emails: boolean | null };

const runFixture = (): Record<'control' | 'stored' | 'uploaded', CaseResult> => {
  const output = execFileSync(process.execPath, ['--expose-gc', FIXTURE], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60_000
  });
  const lines = output.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
};

describe('a whole-store restore and the post-restore passes', () => {
  it('lets go of the parsed archive before the password and email passes read the store again', () => {
    const results = runFixture();

    // The detector sees an archive that is kept.
    expect(results.control).toEqual({ status: 200, passwords: true, emails: true });
    // The stored-backup restore (`/api/super-admin/backups/restore`).
    expect(results.stored).toEqual({ status: 200, passwords: false, emails: false });
    // The uploaded restore (`/api/super-admin/restore`).
    expect(results.uploaded).toEqual({ status: 200, passwords: false, emails: false });
  }, 60_000);
});
