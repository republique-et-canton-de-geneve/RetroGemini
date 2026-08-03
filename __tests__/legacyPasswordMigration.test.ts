import { describe, expect, it, vi } from 'vitest';
import { migrateLegacyPasswords } from '../server/services/passwordMigration.js';
import { hashPassword, isHashedPassword, verifyPassword } from '../server/services/passwordHashing.js';

/**
 * Decision D1 / hardening stage 7d — retire the plaintext-compare fallback.
 *
 * Records created before hashing shipped still hold the password in clear text.
 * They keep authenticating through a constant-time plaintext compare and are
 * hashed on their next successful login (rehash-on-auth) — but a team that does
 * not log in keeps its password readable in the database indefinitely, and the
 * fallback cannot be removed while any such record can exist.
 *
 * The unblocking observation is that a legacy record *contains the plaintext*,
 * so it can be hashed with no user interaction and no deprecation window at all.
 * This is that eager migration: a startup pass that leaves no legacy record for
 * the fallback to serve. It deliberately never throws — a boot that fails
 * because of a password-format upgrade would be a far worse outage than the
 * plaintext it is cleaning up.
 */

const legacyTeam = (id: string, password: string) => ({ id, name: id, passwordHash: password });

// A real record rather than a hand-written literal: the stored grammar rejects
// base64 padding and short salts, so a plausible-looking fake reads as *legacy*
// and would make these tests assert the opposite of what they claim.
const realHash = await hashPassword('already-hashed');

describe('legacy password migration (decision D1)', () => {
  it('hashes a legacy plaintext record in place', async () => {
    const stored = new Map([['team-1', legacyTeam('team-1', 'open-sesame')]]);
    const dataStore = {
      loadAllTeams: vi.fn(async () => [...stored.values()]),
      atomicTeamUpdate: vi.fn(async (id: string, updater: (team: unknown) => unknown) => {
        const next = updater(stored.get(id));
        if (next) stored.set(id, next as ReturnType<typeof legacyTeam>);
        return { success: true };
      }),
    };

    const result = await migrateLegacyPasswords({ dataStore });

    expect(result).toMatchObject({ scanned: 1, upgraded: 1, failed: 0 });
    const upgraded = stored.get('team-1')!;
    expect(isHashedPassword(upgraded.passwordHash)).toBe(true);
    // The upgrade must preserve the credential, not just the shape.
    expect(await verifyPassword('open-sesame', upgraded.passwordHash)).toBe(true);
    expect(await verifyPassword('wrong', upgraded.passwordHash)).toBe(false);
  });

  it('leaves an already-hashed record alone and writes nothing', async () => {
    const dataStore = {
      loadAllTeams: vi.fn(async () => [{ id: 'team-1', name: 'Team', passwordHash: realHash }]),
      atomicTeamUpdate: vi.fn(),
    };

    const result = await migrateLegacyPasswords({ dataStore });

    expect(result).toMatchObject({ scanned: 1, upgraded: 0, failed: 0 });
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('skips a record with no password at all', async () => {
    const dataStore = {
      loadAllTeams: vi.fn(async () => [{ id: 'team-1', name: 'Team' }]),
      atomicTeamUpdate: vi.fn(),
    };

    const result = await migrateLegacyPasswords({ dataStore });

    expect(result).toMatchObject({ scanned: 1, upgraded: 0, failed: 0 });
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('keeps going when one team fails, and reports it', async () => {
    // A lost write must not abort the pass: the remaining teams still need
    // upgrading, and the failed one is simply retried on the next boot.
    const dataStore = {
      loadAllTeams: vi.fn(async () => [legacyTeam('bad', 'p1'), legacyTeam('good', 'p2')]),
      atomicTeamUpdate: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('write lost');
        return { success: true };
      }),
    };

    const result = await migrateLegacyPasswords({ dataStore });

    expect(result).toMatchObject({ scanned: 2, upgraded: 1, failed: 1 });
  });

  it('treats an updater that reports no success as a failure, not an upgrade', async () => {
    const dataStore = {
      loadAllTeams: vi.fn(async () => [legacyTeam('team-1', 'p1')]),
      atomicTeamUpdate: vi.fn(async () => ({ success: false })),
    };

    const result = await migrateLegacyPasswords({ dataStore });

    expect(result).toMatchObject({ scanned: 1, upgraded: 0, failed: 1 });
  });

  it('never throws when the store itself is unavailable', async () => {
    // Boot must not depend on this pass succeeding.
    const dataStore = {
      loadAllTeams: vi.fn(async () => {
        throw new Error('database down');
      }),
      atomicTeamUpdate: vi.fn(),
    };

    await expect(migrateLegacyPasswords({ dataStore })).resolves.toMatchObject({
      scanned: 0,
      upgraded: 0,
      failed: 0,
      error: true,
    });
  });

  it('does not re-hash a record another pod upgraded first', async () => {
    // Two pods boot together; the updater re-reads under the lock, so the loser
    // must abort rather than overwrite a fresh hash with its own.
    const alreadyUpgraded = { id: 'team-1', name: 'Team', passwordHash: realHash };
    const dataStore = {
      loadAllTeams: vi.fn(async () => [legacyTeam('team-1', 'open-sesame')]),
      atomicTeamUpdate: vi.fn(async (_id: string, updater: (team: unknown) => unknown) =>
        ({ success: true, applied: updater(alreadyUpgraded) !== null })),
    };

    await migrateLegacyPasswords({ dataStore });

    const updater = dataStore.atomicTeamUpdate.mock.calls[0][1] as (team: unknown) => unknown;
    expect(updater(alreadyUpgraded)).toBeNull();
  });
});
