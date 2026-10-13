import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanRosterEmails, healStoredEmails, healTeamEmails } from '../server/services/emailMigration.js';

/**
 * The heal pass over stored email addresses (`server/services/emailMigration.js`).
 *
 * The write paths now refuse an address that is not one deliverable address,
 * but the records written before that still hold what the old paths accepted —
 * the incident's `elisabeth.trolliet@etat.ge.ch;` among them. This pass cleans
 * every stored value that cleans to a valid address, leaves the others alone,
 * and never makes two members the same person. It runs at boot and after a
 * restore, so like the password migration it must never throw.
 */

type Team = Record<string, unknown> & { id: string };

const INCIDENT_VALUE = 'elisabeth.trolliet@etat.ge.ch;';
const INCIDENT_ADDRESS = 'elisabeth.trolliet@etat.ge.ch';

const createDataStore = (teams: Team[], settings: Record<string, unknown> = {}) => {
  const stored = new Map(teams.map((team) => [team.id, structuredClone(team)]));
  const state = { settings: structuredClone(settings) };
  return {
    stored,
    state,
    loadAllTeams: vi.fn(async () => [...stored.values()].map((team) => structuredClone(team))),
    atomicTeamUpdate: vi.fn(async (id: string, updater: (team: Team) => Team | null) => {
      const current = stored.get(id);
      if (!current) return { success: false, error: 'team_not_found' };
      const next = updater(structuredClone(current));
      if (next) stored.set(id, next);
      return { success: true, team: next ?? current };
    }),
    loadGlobalSettings: vi.fn(async () => structuredClone(state.settings)),
    saveGlobalSettings: vi.fn(async (next: Record<string, unknown>) => {
      state.settings = structuredClone(next);
    })
  };
};

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  info.mockRestore();
  warn.mockRestore();
});

describe('healTeamEmails (pure)', () => {
  it('cleans the incident recovery address', () => {
    const team = { id: 't1', facilitatorEmail: INCIDENT_VALUE };

    const result = healTeamEmails(team);

    expect(result.changed).toBe(true);
    expect(result.team.facilitatorEmail).toBe(INCIDENT_ADDRESS);
    // The input is never mutated: the heal runs inside an updater that may be
    // retried on a conflict.
    expect(team.facilitatorEmail).toBe(INCIDENT_VALUE);
  });

  it('removes a blank recovery address instead of storing whitespace', () => {
    const result = healTeamEmails({ id: 't1', facilitatorEmail: '   ' });

    expect(result.changed).toBe(true);
    expect('facilitatorEmail' in result.team).toBe(false);
  });

  it('leaves an address that is not one valid address as it was, and counts it', () => {
    const result = healTeamEmails({ id: 't1', facilitatorEmail: 'a@x.ch; b@y.ch' });

    expect(result.changed).toBe(false);
    expect(result.unparseable).toBe(1);
    expect(result.team.facilitatorEmail).toBe('a@x.ch; b@y.ch');
  });

  it('reports nothing to do for a clean record', () => {
    const result = healTeamEmails({
      id: 't1',
      facilitatorEmail: 'lead@example.ch',
      members: [{ id: 'm1', name: 'Ann', email: 'ann@example.ch' }, { id: 'm2', name: 'Bob' }],
      archivedMembers: []
    });

    expect(result.changed).toBe(false);
    expect(result.unparseable).toBe(0);
  });

  it('cleans active and archived member addresses', () => {
    const result = healTeamEmails({
      id: 't1',
      members: [{ id: 'm1', name: 'Ann', email: 'Ann <Ann@Example.ch>;' }],
      archivedMembers: [{ id: 'm2', name: 'Bob', email: ' bob@example.ch ' }, { id: 'm3', name: 'Cy', email: ' ' }]
    });

    expect(result.changed).toBe(true);
    expect(result.team.members).toEqual([{ id: 'm1', name: 'Ann', email: 'ann@example.ch' }]);
    expect(result.team.archivedMembers).toEqual([
      { id: 'm2', name: 'Bob', email: 'bob@example.ch' },
      { id: 'm3', name: 'Cy' }
    ]);
  });

  it('never cleans one member into the address another member holds', () => {
    // The client treats a member's email as an identity: merging two spellings
    // would make two people one, and `updateMember` would refuse every edit.
    const result = healTeamEmails({
      id: 't1',
      members: [
        { id: 'm1', name: 'Ann', email: 'ann@example.ch;' },
        { id: 'm2', name: 'Ann (laptop)', email: 'ann@example.ch' }
      ],
      archivedMembers: [{ id: 'm3', name: 'Bob', email: 'bob@example.ch;' }]
    });

    expect(result.conflicts).toBe(1);
    expect((result.team.members as { email: string }[])[0].email).toBe('ann@example.ch;');
    // The rest of the roster is still cleaned.
    expect((result.team.archivedMembers as { email: string }[])[0].email).toBe('bob@example.ch');
  });

  it('leaves rosters of the wrong shape alone', () => {
    const result = healTeamEmails({ id: 't1', members: 'not-a-list', archivedMembers: [null, 'x', { id: 'm1' }] });

    expect(result.changed).toBe(false);
    expect(result.team.members).toBe('not-a-list');
  });
});

describe('cleanRosterEmails', () => {
  it('cleans what parses, keeps what does not, and counts both', () => {
    const result = cleanRosterEmails(
      [{ id: 'm1', email: 'A@B.CH' }, { id: 'm2', email: 'a@b' }],
      undefined
    );

    expect(result.members).toEqual([{ id: 'm1', email: 'a@b.ch' }, { id: 'm2', email: 'a@b' }]);
    expect(result.archivedMembers).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(result.unparseable).toBe(1);
  });
});

describe('healStoredEmails', () => {
  it('rewrites a dirty team record through the atomic update', async () => {
    const dataStore = createDataStore([
      { id: 't1', name: 'Dirty', facilitatorEmail: INCIDENT_VALUE },
      { id: 't2', name: 'Clean', facilitatorEmail: 'lead@example.ch' }
    ]);

    const result = await healStoredEmails({ dataStore });

    expect(result).toMatchObject({ scanned: 2, healed: 1, failed: 0, error: false });
    expect(dataStore.stored.get('t1')!.facilitatorEmail).toBe(INCIDENT_ADDRESS);
    // A clean team is never written: a boot must not rewrite every record.
    expect(dataStore.atomicTeamUpdate).toHaveBeenCalledTimes(1);
    expect(dataStore.atomicTeamUpdate.mock.calls[0][0]).toBe('t1');
  });

  it('decides again on the record under the lock, so a newer edit is never overwritten', async () => {
    const dataStore = createDataStore([{ id: 't1', name: 'Team', facilitatorEmail: INCIDENT_VALUE }]);
    // Between the scan and the write the facilitator saved a new address.
    dataStore.loadAllTeams.mockImplementationOnce(async () => {
      const scanned = [structuredClone(dataStore.stored.get('t1')!)];
      dataStore.stored.set('t1', { id: 't1', name: 'Team', facilitatorEmail: 'new@example.ch' });
      return scanned;
    });

    const result = await healStoredEmails({ dataStore });

    expect(dataStore.stored.get('t1')!.facilitatorEmail).toBe('new@example.ch');
    expect(result.healed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('cleans the admin address, re-reading it just before the write', async () => {
    const dataStore = createDataStore([], { adminEmail: ' Admin@Example.ch;', notifyNewTeam: true });

    const result = await healStoredEmails({ dataStore });

    expect(result.adminEmailHealed).toBe(true);
    expect(dataStore.state.settings).toEqual({ adminEmail: 'admin@example.ch', notifyNewTeam: true });
    expect(dataStore.loadGlobalSettings).toHaveBeenCalledTimes(2);
  });

  it('does not write the admin address when a super admin changed it meanwhile', async () => {
    const dataStore = createDataStore([], { adminEmail: 'admin@example.ch;' });
    dataStore.loadGlobalSettings
      .mockImplementationOnce(async () => ({ adminEmail: 'admin@example.ch;' }))
      .mockImplementationOnce(async () => ({ adminEmail: 'someone@example.ch' }));

    const result = await healStoredEmails({ dataStore });

    expect(result.adminEmailHealed).toBe(false);
    expect(dataStore.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty admin address', { adminEmail: '' }],
    ['no admin address at all', {}],
    ['an admin address that is not one valid address', { adminEmail: 'a@x.ch, b@y.ch' }]
  ])('leaves %s alone', async (_label, settings) => {
    const dataStore = createDataStore([], settings);

    await healStoredEmails({ dataStore });

    expect(dataStore.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it('reports a value it cannot clean by team id, never by address', async () => {
    const dataStore = createDataStore([{ id: 'team-x', name: 'Two', facilitatorEmail: 'secret-a@x.ch; secret-b@y.ch' }]);

    const result = await healStoredEmails({ dataStore });

    expect(result.unparseable).toBe(1);
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0].join(' ');
    expect(line).toContain('team-x');
    expect(line).not.toContain('secret-a');
  });

  it('prints one summary line on a clean run too, so silence is never the signal', async () => {
    const dataStore = createDataStore([{ id: 't1', name: 'Clean', facilitatorEmail: 'lead@example.ch' }]);

    await healStoredEmails({ dataStore });

    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0].join(' ');
    expect(line).toContain('0 team record(s) cleaned');
    expect(line).toContain('1 team(s) scanned');
  });

  it('keeps going when one team fails, and reports it', async () => {
    const dataStore = createDataStore([
      { id: 'bad', name: 'Bad', facilitatorEmail: 'bad@example.ch;' },
      { id: 'good', name: 'Good', facilitatorEmail: 'good@example.ch;' }
    ]);
    const realUpdate = dataStore.atomicTeamUpdate.getMockImplementation()!;
    dataStore.atomicTeamUpdate.mockImplementation(async (id, updater) => {
      if (id === 'bad') throw new Error('write lost');
      return realUpdate(id, updater);
    });

    const result = await healStoredEmails({ dataStore });

    expect(result).toMatchObject({ healed: 1, failed: 1 });
    expect(dataStore.stored.get('good')!.facilitatorEmail).toBe('good@example.ch');
  });

  it('counts an update that reports no success as a failure', async () => {
    const dataStore = createDataStore([{ id: 't1', name: 'Team', facilitatorEmail: 'lead@example.ch;' }]);
    dataStore.atomicTeamUpdate.mockImplementation(async () => ({ success: false, error: 'max_retries_exceeded' }));

    const result = await healStoredEmails({ dataStore });

    expect(result).toMatchObject({ healed: 0, failed: 1 });
  });

  it('never throws when the store is unavailable', async () => {
    const dataStore = {
      loadAllTeams: vi.fn(async () => { throw new Error('database down'); }),
      atomicTeamUpdate: vi.fn(),
      loadGlobalSettings: vi.fn(),
      saveGlobalSettings: vi.fn()
    };

    await expect(healStoredEmails({ dataStore })).resolves.toMatchObject({ scanned: 0, healed: 0, error: true });
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws when the settings store fails', async () => {
    const dataStore = createDataStore([]);
    dataStore.loadGlobalSettings.mockImplementation(async () => { throw new Error('settings down'); });

    await expect(healStoredEmails({ dataStore })).resolves.toMatchObject({ failed: 1, error: false });
  });
});

describe('wiring', () => {
  it('runs at startup after the password migration and before the startup backup', () => {
    // A source assertion, like the audit-trail wiring check: every suite builds
    // its own app, so a pass missing from `server.js` would leave them all green
    // while production kept its dirty values. It proves the call is written in
    // the right place, not that it runs — the pass's own tests cover that.
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

    const passwords = source.indexOf('await migrateLegacyPasswords({ dataStore });');
    const emails = source.indexOf('await healStoredEmails({ dataStore });');
    const backup = source.indexOf('await backupService.createStartupBackup();');
    expect(passwords).toBeGreaterThan(-1);
    expect(emails).toBeGreaterThan(passwords);
    expect(backup).toBeGreaterThan(emails);
  });
});
