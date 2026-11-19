import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import {
  MEMBER_AVATARS_MAX,
  nextMemberAvatars,
  stampParticipantAvatar
} from '../server/routes/teamAvatarRoutes.js';
import { createTeamAuthStateDouble } from './helpers/teamAuthStateDouble';

// The release that adds a picture first only accepts its id (utils/avatars.js
// → ACCEPTED_ONLY_AVATAR_IDS, empty today). The route must read that list,
// not the families the picker offers: 'space-whale' stands for such an id.
const ACCEPTED_ONLY_FIXTURE = 'space-whale';
vi.mock('../utils/avatars.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/avatars.js')>();
  return {
    ...original,
    isAcceptedAvatarId: (value: unknown) => value === ACCEPTED_ONLY_FIXTURE || original.isAcceptedAvatarId(value)
  };
});

/**
 * One person's avatar, written by one narrow route (AGENTS.md, *Avatars*).
 *
 * The choice lives under `memberAvatars`, a top-level key of the team record,
 * and not on the member row: `/members` replaces the rows wholesale with
 * whatever roster a client cached, so a value on a row is lost to any stale
 * tab or overlapping join. The route writes `{ id, at }` with the server's
 * clock under the team's row lock, and the newer `at` wins everywhere — a
 * session participant copy included, which the route stamps when told which
 * session the pick came from.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };
type Entry = { id: string | null; at: number };
type PatchArgs = { teamId: string; sessionId: string; purpose?: string; mutate: (session: any) => any };
const makePatch = () => vi.fn(async (_args: PatchArgs): Promise<string> => 'patched');

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const control = { writes: 0 };

  return {
    control,
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    teamExists: async (teamId: string) => teams.has(teamId),
    loadTeamAuthState: createTeamAuthStateDouble((teamId) => teams.has(teamId)).loadTeamAuthState,
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, structuredClone(teamData));
    },
    loadTeamSummaries: async () => Array.from(teams.values()).map((team) => ({ ...structuredClone(team) })),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate: async (teamId: string, updater: (team: Team) => Team | null) => {
      const existing = teams.get(teamId);
      if (!existing) return { success: false, error: 'team_not_found' };
      const updated = updater(structuredClone(existing));
      if (!updated) return { success: true, team: existing };
      control.writes += 1;
      teams.set(teamId, structuredClone(updated));
      return { success: true, team: updated };
    },
    loadTeamIndex: async () => new Map(indexMap),
    atomicTeamIndexUpdate: async (updater: (index: Map<string, string>) => Map<string, string> | null) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
    },
    loadGlobalSettings: async () => ({}),
    _teams: teams
  };
};

const createMockTokenService = () => ({
  createSessionToken: (teamId: string) => `session-${teamId}`,
  validateSessionToken: (token: string) => {
    if (typeof token !== 'string' || !token.startsWith('session-')) return null;
    return { teamId: token.slice('session-'.length), visitorId: null };
  },
  invalidateSessionToken: () => {},
  createInviteCredential: (teamId: string, epoch: number) => `invite-${teamId}-${epoch}`,
  validateInviteCredential: () => null,
  validateSuperAdminAuth: () => false
});

const listen = async (app: express.Express) =>
  new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });

describe('POST /api/team/:teamId/member/avatar', () => {
  let baseUrl: string;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let liveSessionPatch: ReturnType<typeof makePatch>;
  let teamId: string;
  let otherTeamId: string;
  let sessionToken: string;
  let facilitatorId: string;

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  const pick = (body: Record<string, unknown>) => post(`/api/team/${teamId}/member/avatar`, { sessionToken, ...body });
  const stored = () => dataStore._teams.get(teamId) as Team & { memberAvatars?: Record<string, Entry>; members: { id: string }[] };

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    dataStore = createMockDataStore();
    liveSessionPatch = makePatch();
    const tokenService = createMockTokenService();
    registerTeamRoutes({
      app,
      dataStore,
      teamService: createTeamService({ dataStore, tokenService }),
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s,
      // The registrar's default is typed from its no-op, which takes nothing.
      liveSessionPatch: liveSessionPatch as never
    });
    const server = await listen(app);
    baseUrl = server.baseUrl;

    const created = await (await post('/api/team/create', {
      name: 'Avatars', password: 'password123456', facilitatorEmail: 'fac@example.com'
    })).json();
    teamId = created.team.id;
    sessionToken = created.sessionToken;
    facilitatorId = created.team.members[0].id;
    stored().members.push({ id: 'p1', name: 'Ada', color: 'bg-rose-500', role: 'participant' } as never);

    const other = await (await post('/api/team/create', {
      name: 'Others', password: 'password123456', facilitatorEmail: 'other@example.com'
    })).json();
    otherTeamId = other.team.id;

    return async () => {
      await server.close();
    };
  });

  it('sets one member\'s avatar, dated by the server, and answers the stored map after the write', async () => {
    const before = Date.now();
    const res = await pick({ memberId: 'p1', avatar: 'fox' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stored().memberAvatars).toEqual({ p1: { id: 'fox', at: expect.any(Number) } });
    expect(stored().memberAvatars!.p1.at).toBeGreaterThanOrEqual(before);
    expect(body).toEqual({ success: true, memberAvatars: stored().memberAvatars });
  });

  it('accepts the team password as the credential, like its siblings', async () => {
    const res = await post(`/api/team/${teamId}/member/avatar`, { password: 'password123456', memberId: 'p1', avatar: 'owl' });
    expect(res.status).toBe(200);
    expect(stored().memberAvatars!.p1.id).toBe('owl');
  });

  it('clears a choice as a dated entry, so the clear is newer than any copy of the old choice', async () => {
    await pick({ memberId: 'p1', avatar: 'fox' });
    const first = stored().memberAvatars!.p1.at;

    const res = await pick({ memberId: 'p1', avatar: null });

    expect(res.status).toBe(200);
    expect(stored().memberAvatars!.p1).toEqual({ id: null, at: expect.any(Number) });
    expect(stored().memberAvatars!.p1.at).toBeGreaterThan(first);
  });

  it('writes nothing when the choice is the stored one, or a clear of nothing', async () => {
    await pick({ memberId: 'p1', avatar: 'fox' });
    const writes = dataStore.control.writes;
    const map = structuredClone(stored().memberAvatars);

    const same = await pick({ memberId: 'p1', avatar: 'fox' });
    const clearNothing = await pick({ memberId: facilitatorId, avatar: null });

    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ success: true, memberAvatars: map });
    expect(clearNothing.status).toBe(200);
    expect(dataStore.control.writes).toBe(writes);
    expect(stored().memberAvatars).toEqual(map);
  });

  it.each([
    ['no credential', {}],
    ['a forged token', { sessionToken: 'forged' }],
    ['another team\'s token', { sessionToken: 'session-OTHER' }],
    ['a wrong password', { sessionToken: undefined, password: 'wrong-password' }]
  ])('refuses %s with 401 and writes nothing', async (_label, credential) => {
    const body: Record<string, unknown> = { memberId: 'p1', avatar: 'fox', ...credential };
    if (body.sessionToken === 'session-OTHER') body.sessionToken = `session-${otherTeamId}`;
    const writes = dataStore.control.writes;

    const res = await post(`/api/team/${teamId}/member/avatar`, body);

    expect(res.status).toBe(401);
    expect(dataStore.control.writes).toBe(writes);
    expect(stored().memberAvatars).toBeUndefined();
    expect(liveSessionPatch).not.toHaveBeenCalled();
  });

  it('checks the credential before the request: an anonymous caller learns nothing about the ids', async () => {
    const res = await post(`/api/team/${teamId}/member/avatar`, { memberId: '__proto__', avatar: 'nope' });
    expect(res.status).toBe(401);
  });

  it.each([
    ['no member id', undefined],
    ['a member id that is not a string', 7],
    ['an empty member id', ''],
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['a member id with spaces', 'p 1'],
    ['a member id far too long', 'p'.repeat(65)]
  ])('refuses %s with 400 invalid_member and writes nothing', async (_label, memberId) => {
    const res = await pick({ memberId, avatar: 'fox' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_member' });
    expect(stored().memberAvatars).toBeUndefined();
  });

  it.each([
    ['no avatar at all', undefined],
    ['an id this release does not have', 'dragon'],
    ['another case', 'Fox'],
    ['surrounding spaces', ' fox '],
    ['__proto__', '__proto__'],
    ['a class string', 'fixed inset-0 z-50'],
    ['markup', '<svg onload=alert(1)>'],
    ['a number', 3],
    ['an object', { id: 'fox' }],
    ['an empty string', '']
  ])('refuses %s with 400 invalid_avatar, never coerced, and writes nothing', async (_label, avatar) => {
    const body: Record<string, unknown> = { memberId: 'p1' };
    if (avatar !== undefined) body.avatar = avatar;
    const res = await pick(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_avatar' });
    expect(stored().memberAvatars).toBeUndefined();
  });

  it('stores an id this release accepts but does not offer yet, as sent', async () => {
    const res = await pick({ memberId: 'p1', avatar: ACCEPTED_ONLY_FIXTURE });
    expect(res.status).toBe(200);
    expect(stored().memberAvatars).toEqual({ p1: { id: ACCEPTED_ONLY_FIXTURE, at: expect.any(Number) } });
  });

  it('lets two members choose at once, and both choices land', async () => {
    const [a, b] = await Promise.all([
      pick({ memberId: 'p1', avatar: 'fox' }),
      pick({ memberId: facilitatorId, avatar: 'rocket' })
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(stored().memberAvatars).toEqual({
      p1: { id: 'fox', at: expect.any(Number) },
      [facilitatorId]: { id: 'rocket', at: expect.any(Number) }
    });
  });

  it('heals junk any path left in the map on the next write, and keeps an id a later release stored', async () => {
    const team = stored();
    team.memberAvatars = {
      p1: 'fox',
      ['__proto__' as string]: { id: 'fox', at: 1 },
      'with space': { id: 'owl', at: 1 },
      later: { id: 'dragon', at: 5 },
      broken: { id: 'owl' }
    } as never;

    const res = await pick({ memberId: facilitatorId, avatar: 'cat' });

    expect(res.status).toBe(200);
    expect(stored().memberAvatars).toEqual({
      later: { id: 'dragon', at: 5 },
      [facilitatorId]: { id: 'cat', at: expect.any(Number) }
    });
  });

  it('never dates a choice before the one it replaces, whatever this pod\'s clock says', async () => {
    stored().memberAvatars = { p1: { id: 'owl', at: Date.now() + 60_000 } };
    await pick({ memberId: 'p1', avatar: 'fox' });
    const entry = stored().memberAvatars!.p1;
    expect(entry.id).toBe('fox');
    expect(entry.at).toBeGreaterThan(Date.now() + 59_000);
  });

  it('stays bounded: past the cap, off-roster entries go first, the oldest first', async () => {
    const map: Record<string, Entry> = {};
    for (let i = 0; i < MEMBER_AVATARS_MAX; i += 1) map[`gone-${i}`] = { id: 'owl', at: 1000 + i };
    map.p1 = { id: 'fox', at: 1 };
    stored().memberAvatars = map;

    const res = await pick({ memberId: facilitatorId, avatar: 'cat' });

    expect(res.status).toBe(200);
    const after = stored().memberAvatars!;
    expect(Object.keys(after)).toHaveLength(MEMBER_AVATARS_MAX);
    // The roster member is kept although its entry is the oldest of all.
    expect(after.p1).toEqual({ id: 'fox', at: 1 });
    expect(after[facilitatorId].id).toBe('cat');
    expect(after['gone-0']).toBeUndefined();
    expect(after['gone-1']).toBeUndefined();
    expect(after[`gone-${MEMBER_AVATARS_MAX - 1}`]).toBeDefined();
  });

  describe('the stale writers the map is out of reach of', () => {
    it('a /members post from a roster loaded before the pick leaves the map, even one that drops and then rebuilds the row', async () => {
      const staleRoster = structuredClone(stored().members);
      await pick({ memberId: 'p1', avatar: 'fox' });
      const map = structuredClone(stored().memberAvatars);

      const dropped = staleRoster.filter((member) => member.id !== 'p1');
      expect((await post(`/api/team/${teamId}/members`, { sessionToken, members: dropped })).status).toBe(200);
      expect(stored().memberAvatars).toEqual(map);

      expect((await post(`/api/team/${teamId}/members`, { sessionToken, members: staleRoster })).status).toBe(200);
      expect(stored().memberAvatars).toEqual(map);
      expect(stored().members.every((member) => !('avatar' in member))).toBe(true);
    });

    it('/update ignores memberAvatars, like the Jira keys', async () => {
      await pick({ memberId: 'p1', avatar: 'fox' });
      const map = structuredClone(stored().memberAvatars);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await post(`/api/team/${teamId}/update`, {
        sessionToken,
        updates: { memberAvatars: { p1: { id: 'owl', at: Date.now() + 1e9 } }, actionImpactRatingEnabled: false }
      });

      expect(res.status).toBe(200);
      expect(stored().memberAvatars).toEqual(map);
      expect(stored().actionImpactRatingEnabled).toBe(false);
      expect(warn.mock.calls.some(([line]) => String(line).includes('memberAvatars'))).toBe(true);
      warn.mockRestore();
    });
  });

  describe('what reaches the clients', () => {
    it('login, restore-session and the team read carry the map', async () => {
      await pick({ memberId: 'p1', avatar: 'fox' });
      const map = stored().memberAvatars;

      const login = await (await post('/api/team/login', { teamName: 'Avatars', password: 'password123456' })).json();
      const restored = await (await post('/api/team/restore-session', { sessionToken })).json();
      const read = await (await post(`/api/team/${teamId}`, { sessionToken })).json();

      expect(login.team.memberAvatars).toEqual(map);
      expect(restored.team.memberAvatars).toEqual(map);
      expect(read.memberAvatars ?? read.team?.memberAvatars).toEqual(map);
    });

    it('/api/team/list still answers its four fields, never the map', async () => {
      await pick({ memberId: 'p1', avatar: 'fox' });
      const { teams } = await (await fetch(`${baseUrl}/api/team/list`)).json();
      for (const team of teams) {
        // A team that never connected has no `lastConnectionDate`, which JSON drops.
        expect(['id', 'lastConnectionDate', 'memberCount', 'name']).toEqual(expect.arrayContaining(Object.keys(team)));
        expect(team).not.toHaveProperty('memberAvatars');
      }
    });
  });

  describe('the live session the pick came from', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('is patched after the answer with the stored entry, when a session id is given', async () => {
      const res = await pick({ memberId: 'p1', avatar: 'fox', sessionId: 'retro-1' });
      expect(res.status).toBe(200);
      await flush();

      expect(liveSessionPatch).toHaveBeenCalledTimes(1);
      const [{ teamId: patchedTeam, sessionId, mutate }] = liveSessionPatch.mock.calls[0];
      expect(patchedTeam).toBe(teamId);
      expect(sessionId).toBe('retro-1');
      const session = { id: 'retro-1', teamId, participants: [{ id: 'p1', name: 'Ada', color: 'bg-rose-500', role: 'participant' }] };
      expect(mutate(session).participants[0]).toEqual({
        id: 'p1', name: 'Ada', color: 'bg-rose-500', role: 'participant',
        avatar: 'fox', avatarAt: stored().memberAvatars!.p1.at
      });
    });

    it('is patched also when the choice was already stored, which heals a session a failed patch left behind', async () => {
      await pick({ memberId: 'p1', avatar: 'fox' });
      await pick({ memberId: 'p1', avatar: 'fox', sessionId: 'retro-1' });
      await flush();
      expect(liveSessionPatch).toHaveBeenCalledTimes(1);
    });

    it('is not touched without a session id, or with one that is not a non-empty string', async () => {
      await pick({ memberId: 'p1', avatar: 'fox' });
      await pick({ memberId: 'p1', avatar: 'owl', sessionId: '' });
      await pick({ memberId: 'p1', avatar: 'cat', sessionId: 42 });
      await pick({ memberId: 'p1', avatar: 'bee', sessionId: 's'.repeat(300) });
      await flush();
      expect(liveSessionPatch).not.toHaveBeenCalled();
    });

    it('never turns the answer into an error, whatever the patch does', async () => {
      liveSessionPatch.mockImplementation(async () => {
        throw new Error('session store down');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await pick({ memberId: 'p1', avatar: 'fox', sessionId: 'retro-1' });
      await flush();
      expect(res.status).toBe(200);
      expect(stored().memberAvatars!.p1.id).toBe('fox');
      warn.mockRestore();
    });

    it('is not patched after a refusal', async () => {
      await pick({ memberId: 'p1', avatar: 'dragon', sessionId: 'retro-1' });
      await flush();
      expect(liveSessionPatch).not.toHaveBeenCalled();
    });

    // The entry the patch would carry is decided inside the team's update. A
    // write the store then refuses stored nothing, and stamps no session: a
    // room shown a picture the team does not hold would lose it at the next
    // state from anyone whose copy of the team is the stored one.
    it('answers a write the store refused as a 500 with its code, and stamps no session', async () => {
      const update = dataStore.atomicTeamUpdate;
      dataStore.atomicTeamUpdate = async (id: string, updater: (team: Team) => Team | null) => {
        updater(structuredClone(stored()));
        return { success: false, error: 'max_retries_exceeded' };
      };
      try {
        const res = await pick({ memberId: 'p1', avatar: 'fox', sessionId: 'retro-1' });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'max_retries_exceeded' });
        await flush();
        expect(liveSessionPatch).not.toHaveBeenCalled();
        expect(stored().memberAvatars).toBeUndefined();
      } finally {
        dataStore.atomicTeamUpdate = update;
      }
    });

    it("answers a store that throws as a 500 with the route's own code, never the error's words", async () => {
      const update = dataStore.atomicTeamUpdate;
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      dataStore.atomicTeamUpdate = async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
      };
      try {
        const res = await pick({ memberId: 'p1', avatar: 'fox', sessionId: 'retro-1' });
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body).toEqual({ error: 'failed_to_update' });
        await flush();
        expect(liveSessionPatch).not.toHaveBeenCalled();
        // The detail goes to the log, not to the caller.
        expect(logged).toHaveBeenCalled();
      } finally {
        dataStore.atomicTeamUpdate = update;
        logged.mockRestore();
      }
    });
  });
});

describe('stampParticipantAvatar', () => {
  const session = (participants: unknown) => ({ id: 's1', teamId: 't1', participants });
  const ada = { id: 'p1', name: 'Ada', color: 'bg-rose-500', role: 'participant' };

  it('stamps the participant entry as a new object, leaving the others and the input as they were', () => {
    const bob = { id: 'p2', name: 'Bob', color: 'bg-sky-500', role: 'participant' };
    const input = session([ada, bob]);
    const next = stampParticipantAvatar(input, 'p1', { id: 'fox', at: 5000 });

    expect(next.participants).toEqual([{ ...ada, avatar: 'fox', avatarAt: 5000 }, bob]);
    expect(next.participants[1]).toBe(bob);
    expect(input.participants[0]).toBe(ada);
    expect(ada).not.toHaveProperty('avatar');
  });

  it('stamps a clear as an explicit none', () => {
    const next = stampParticipantAvatar(session([{ ...ada, avatar: 'fox', avatarAt: 10 }]), 'p1', { id: null, at: 20 });
    expect(next.participants[0]).toEqual({ ...ada, avatar: null, avatarAt: 20 });
  });

  it('never replaces a newer stamp, nor an equal one', () => {
    const newer = session([{ ...ada, avatar: 'owl', avatarAt: 9000 }]);
    expect(stampParticipantAvatar(newer, 'p1', { id: 'fox', at: 5000 })).toBeNull();
    expect(stampParticipantAvatar(newer, 'p1', { id: 'fox', at: 9000 })).toBeNull();
  });

  // A participant entry is data any client of the session writes, its
  // avatar's time included. The route dates its stamps with this server's
  // clock (and never before the choice they replace), so a stamp far ahead of
  // both the clock and the choice being stamped is not one the route wrote.
  // Left to outrank every real one, it kept each later pick of that person
  // out of the session for as long as the session lived.
  it("replaces a stamp dated far ahead of the server's clock, which no pick can have written", () => {
    const now = 1_000_000_000;
    const planted = session([{ ...ada, avatar: 'owl', avatarAt: now + 60 * 60_000 }]);
    expect(stampParticipantAvatar(planted, 'p1', { id: 'fox', at: now }, now).participants[0]).toEqual({ ...ada, avatar: 'fox', avatarAt: now });
    expect(stampParticipantAvatar(session([{ ...ada, avatar: 'owl', avatarAt: Number.MAX_SAFE_INTEGER }]), 'p1', { id: null, at: now }, now).participants[0])
      .toEqual({ ...ada, avatar: null, avatarAt: now });
  });

  it('keeps a stamp a little ahead of this clock: another pod wrote it, for a newer pick', () => {
    const now = 1_000_000_000;
    const ahead = session([{ ...ada, avatar: 'owl', avatarAt: now + 60_000 }]);
    expect(stampParticipantAvatar(ahead, 'p1', { id: 'fox', at: now }, now)).toBeNull();
  });

  // Choices dated ahead of the clock themselves (a record brought from a
  // deployment whose clock ran ahead): two picks stamped out of order still
  // end on the newer one.
  it('still orders two stamps that are both ahead of the clock', () => {
    const now = 1_000_000_000;
    const far = now + 24 * 60 * 60_000;
    const newer = session([{ ...ada, avatar: 'owl', avatarAt: far + 2 }]);
    expect(stampParticipantAvatar(newer, 'p1', { id: 'fox', at: far + 1 }, now)).toBeNull();
  });

  it('reads a stamp that is not a finite number as older than any choice', () => {
    const odd = session([{ ...ada, avatar: 'owl', avatarAt: 'tomorrow' }]);
    expect(stampParticipantAvatar(odd, 'p1', { id: 'fox', at: 5 }).participants[0].avatarAt).toBe(5);
  });

  it('adds nobody: a session that does not hold the participant is left alone', () => {
    expect(stampParticipantAvatar(session([ada]), 'p9', { id: 'fox', at: 5 })).toBeNull();
    expect(stampParticipantAvatar(session(undefined), 'p1', { id: 'fox', at: 5 })).toBeNull();
    expect(stampParticipantAvatar(session('p1'), 'p1', { id: 'fox', at: 5 })).toBeNull();
  });
});

describe('nextMemberAvatars', () => {
  it('answers null when nothing changes', () => {
    expect(nextMemberAvatars({ memberAvatars: { p1: { id: 'fox', at: 1 } } }, 'p1', 'fox', 10)).toBeNull();
    expect(nextMemberAvatars({}, 'p1', null, 10)).toBeNull();
    expect(nextMemberAvatars({ memberAvatars: { p1: { id: null, at: 1 } } }, 'p1', null, 10)).toBeNull();
  });

  it('answers a new map, never the stored object', () => {
    const team = { memberAvatars: { p2: { id: 'owl', at: 1 } } };
    const next = nextMemberAvatars(team, 'p1', 'fox', 10)!;
    expect(next).not.toBe(team.memberAvatars);
    expect(team.memberAvatars).toEqual({ p2: { id: 'owl', at: 1 } });
    expect(next).toEqual({ p2: { id: 'owl', at: 1 }, p1: { id: 'fox', at: 10 } });
  });

  it('past the cap drops the oldest of the roster too once no off-roster entry is left, never the one written', () => {
    const team = {
      members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      memberAvatars: { a: { id: 'fox', at: 3 }, b: { id: 'fox', at: 1 }, c: { id: 'fox', at: 2 } }
    };
    expect(nextMemberAvatars(team, 'b', 'owl', 10, { max: 2 })).toEqual({ a: { id: 'fox', at: 3 }, b: { id: 'owl', at: 10 } });
  });

  it('counts the archived roster as roster', () => {
    const team = {
      members: [{ id: 'a' }],
      archivedMembers: [{ id: 'old' }],
      memberAvatars: { old: { id: 'fox', at: 1 }, gone: { id: 'fox', at: 2 } }
    };
    expect(nextMemberAvatars(team, 'a', 'owl', 10, { max: 2 })).toEqual({ old: { id: 'fox', at: 1 }, a: { id: 'owl', at: 10 } });
  });
});

describe('the pick carried into a live session through the session compare-and-swap', () => {
  const setup = async (sessions: Record<string, Record<string, unknown>>) => {
    const { createLiveSessionPatch } = await import('../server/services/liveSessionRename.js');
    const rows = new Map(Object.entries(structuredClone(sessions)));
    const sessionStore = {
      loadSessionState: async (id: string) => structuredClone(rows.get(id) ?? null),
      saveSessionState: async (id: string, state: Record<string, unknown>) => {
        const current = rows.get(id);
        if (current && current._rev !== state._rev) return { success: false };
        const saved = { ...state, _rev: Number(state._rev ?? 0) + 1 };
        rows.set(id, saved);
        return { success: true, data: saved };
      }
    };
    const emitted: unknown[] = [];
    const io = { to: () => ({ emit: (_event: string, data: unknown) => emitted.push(data) }) };
    const patch = createLiveSessionPatch({ dataStore: sessionStore, sessionCache: new Map(), io });
    return { patch, rows, emitted };
  };
  const ada = { id: 'p1', name: 'Ada', color: 'bg-rose-500', role: 'participant' };

  it('stamps the participant of a session the team owns, and the room receives it', async () => {
    const { patch, rows, emitted } = await setup({ s1: { id: 's1', teamId: 't1', _rev: 3, participants: [ada] } });
    const outcome = await patch({ teamId: 't1', sessionId: 's1', mutate: (s: never) => stampParticipantAvatar(s, 'p1', { id: 'fox', at: 50 }) });
    expect(outcome).toBe('patched');
    expect((rows.get('s1')!.participants as unknown[])[0]).toEqual({ ...ada, avatar: 'fox', avatarAt: 50 });
    expect(emitted).toHaveLength(1);
  });

  it('writes nothing into another team\'s session', async () => {
    const { patch, rows, emitted } = await setup({ s1: { id: 's1', teamId: 'other', _rev: 3, participants: [ada] } });
    const outcome = await patch({ teamId: 't1', sessionId: 's1', mutate: (s: never) => stampParticipantAvatar(s, 'p1', { id: 'fox', at: 50 }) });
    expect(outcome).toBe('other-team');
    expect((rows.get('s1')!.participants as unknown[])[0]).toEqual(ada);
    expect(emitted).toHaveLength(0);
  });

  it('never replaces a newer stamp with an older one', async () => {
    const stamped = { ...ada, avatar: 'owl', avatarAt: 90 };
    const { patch, rows } = await setup({ s1: { id: 's1', teamId: 't1', _rev: 3, participants: [stamped] } });
    const outcome = await patch({ teamId: 't1', sessionId: 's1', mutate: (s: never) => stampParticipantAvatar(s, 'p1', { id: 'fox', at: 50 }) });
    expect(outcome).toBe('unchanged');
    expect(rows.get('s1')!._rev).toBe(3);
    expect((rows.get('s1')!.participants as unknown[])[0]).toEqual(stamped);
  });
});
