import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * The team write paths enforce the shared email rule (`utils/emailAddress.js`).
 *
 * A recovery address stored as `elisabeth.trolliet@etat.ge.ch;` made password
 * reset impossible for its team, and nothing on the way in had refused it:
 * `/api/team/create` stored `facilitatorEmail || undefined`, `/update` spread
 * any JSON value into the record, and `/members` stored rosters as sent. The
 * server is the authority here — the screens validate too, but only to show a
 * sentence instead of a code — so these cases pin each route on its own.
 */

type Team = Record<string, unknown> & { id: string; name: string };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();

  return {
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    teamExists: async (teamId: string) => teams.has(teamId),
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, structuredClone(teamData));
    },
    atomicTeamUpdate: async (teamId: string, updater: (team: Team) => Team | null) => {
      const existing = teams.get(teamId);
      if (!existing) return { success: false, error: 'team_not_found' };
      const updated = updater(structuredClone(existing));
      if (!updated) return { success: true, team: existing };
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
    _teams: teams,
    _index: indexMap
  };
};

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

describe('team routes validate and clean email addresses', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const createTeam = async (body: Record<string, unknown>) => {
    const response = await post('/api/team/create', {
      name: 'Platform',
      password: 'password123456',
      facilitatorEmail: 'fac@example.com',
      ...body
    });
    return { response, body: await response.json() };
  };

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    dataStore = createMockDataStore();
    const tokenService = createTokenService({
      secureCompare: (a: string, b: string) => a === b,
      superAdminPassword: null,
      tokenSecret: 'email-address-routes-test-secret'
    });
    registerTeamRoutes({
      app,
      dataStore,
      teamService: createTeamService({ dataStore, tokenService }),
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s
    });
    ({ baseUrl, close } = await listen(app));
  });

  afterEach(async () => {
    await close();
  });

  describe('POST /api/team/create', () => {
    it('stores the cleaned form of a pasted Outlook address', async () => {
      const { response, body } = await createTeam({
        facilitatorEmail: 'Trolliet Elisabeth (DIN) <Elisabeth.Trolliet@etat.ge.ch>;'
      });

      expect(response.status).toBe(201);
      expect(body.team.facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
      expect(dataStore._teams.get(body.team.id)!.facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
    });

    it.each([
      ['two addresses', 'a@x.ch; b@y.ch'],
      ['an address without a top-level domain', 'lead@corp'],
      ['a value that cleans to nothing', ';'],
      ['a non-string value', { address: 'lead@example.ch' }]
    ])('refuses %s before claiming the team name', async (_label, facilitatorEmail) => {
      const { response, body } = await createTeam({ facilitatorEmail });

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'invalid_email' });
      // Nothing was written: the name is still free and no record exists.
      expect(dataStore._index.size).toBe(0);
      expect(dataStore._teams.size).toBe(0);
    });

    // The address is mandatory at creation: a team without one has no way
    // back from a forgotten password. Refused before the name is claimed, so
    // the facilitator can correct the form and keep the name.
    it.each([undefined, null, '', '   '])('refuses to create a team without a recovery address for %j', async (facilitatorEmail) => {
      const { response, body } = await createTeam({ facilitatorEmail });

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'recovery_email_required' });
      expect(dataStore._index.size).toBe(0);
      expect(dataStore._teams.size).toBe(0);
    });
  });

  describe('POST /api/team/:teamId/update', () => {
    let teamId: string;
    let sessionToken: string;

    const update = (updates: Record<string, unknown>) =>
      post(`/api/team/${teamId}/update`, { sessionToken, updates });
    const stored = () => dataStore._teams.get(teamId)!;

    beforeEach(async () => {
      const { body } = await createTeam({ facilitatorEmail: 'lead@example.ch' });
      teamId = body.team.id;
      sessionToken = body.sessionToken;
    });

    it('stores the cleaned form of the incident value', async () => {
      const response = await update({ facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch;' });

      expect(response.status).toBe(200);
      expect((await response.json()).team.facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
      expect(stored().facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
    });

    it.each([
      ['two addresses', 'a@x.ch; b@y.ch'],
      ['an address without a top-level domain', 'lead@corp'],
      ['a number', 42],
      ['an object', { address: 'lead@example.ch' }]
    ])('refuses %s and writes nothing', async (_label, facilitatorEmail) => {
      const response = await update({ facilitatorEmail, impactNote: 'kept out' });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_email' });
      expect(stored().facilitatorEmail).toBe('lead@example.ch');
      expect(stored().impactNote).toBeUndefined();
    });

    it('refuses an invalid address before a rename in the same request claims the name', async () => {
      // The claim is a separate write; refusing after it would leave the new
      // name held by a team that never took it.
      const response = await update({ name: 'Renamed', facilitatorEmail: 'lead@corp' });

      expect(response.status).toBe(400);
      expect(dataStore._index.has('renamed')).toBe(false);
      expect(stored().name).toBe('Platform');
    });

    it.each([
      ['an explicit null', null],
      ['an empty string', ''],
      ['whitespace', '  ']
    ])('clears the recovery address on %s', async (_label, facilitatorEmail) => {
      // The Dashboard sends `null` to clear: `undefined` vanished in
      // JSON.stringify, so the field could never be emptied.
      const response = await update({ facilitatorEmail });

      expect(response.status).toBe(200);
      expect('facilitatorEmail' in stored()).toBe(false);
      expect((await response.json()).team.facilitatorEmail).toBeUndefined();
    });

    it('leaves the recovery address alone when an update does not mention it', async () => {
      const response = await update({ actionImpactRatingEnabled: false });

      expect(response.status).toBe(200);
      expect(stored().facilitatorEmail).toBe('lead@example.ch');
    });
  });

  describe('POST /api/team/:teamId/members', () => {
    let teamId: string;
    let sessionToken: string;

    beforeEach(async () => {
      const { body } = await createTeam({});
      teamId = body.team.id;
      sessionToken = body.sessionToken;
    });

    it('cleans member addresses that parse, and never refuses the roster', async () => {
      // A roster write carries joins: refusing it over one member's address
      // would drop the people joining with it.
      const response = await post(`/api/team/${teamId}/members`, {
        sessionToken,
        members: [
          { id: 'f1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' },
          { id: 'm1', name: 'Ann', color: 'bg-rose-500', role: 'participant', email: 'Ann Martin <Ann.Martin@Example.ch>;' },
          { id: 'm2', name: 'Bob', color: 'bg-sky-500', role: 'participant', email: 'bob@corp' },
          { id: 'm3', name: 'Cy', color: 'bg-lime-500', role: 'participant', email: '  ' }
        ],
        archivedMembers: [{ id: 'm4', name: 'Dee', color: 'bg-amber-500', role: 'participant', email: ' DEE@example.ch ' }]
      });

      expect(response.status).toBe(200);
      const team = dataStore._teams.get(teamId)! as unknown as { members: Record<string, unknown>[]; archivedMembers: Record<string, unknown>[] };
      expect(team.members.map((member) => member.email)).toEqual([undefined, 'ann.martin@example.ch', 'bob@corp', undefined]);
      expect('email' in team.members[3]).toBe(false);
      expect(team.archivedMembers[0].email).toBe('dee@example.ch');
    });

    it('never cleans one member into the address another member holds', async () => {
      const response = await post(`/api/team/${teamId}/members`, {
        sessionToken,
        members: [
          { id: 'm1', name: 'Ann', color: 'bg-rose-500', role: 'participant', email: 'ann@example.ch;' },
          { id: 'm2', name: 'Ann (phone)', color: 'bg-sky-500', role: 'participant', email: 'ann@example.ch' }
        ]
      });

      expect(response.status).toBe(200);
      const team = dataStore._teams.get(teamId)! as unknown as { members: Record<string, unknown>[] };
      expect(team.members.map((member) => member.email)).toEqual(['ann@example.ch;', 'ann@example.ch']);
    });

    it('never cleans an incoming member into the address an archived member already holds', async () => {
      // A write that sends only `members` is checked against the archived
      // members already stored, not only against the list it carries.
      await post(`/api/team/${teamId}/members`, {
        sessionToken,
        archivedMembers: [{ id: 'm9', name: 'Ann (old)', color: 'bg-rose-500', role: 'participant', email: 'ann@example.ch' }]
      });
      const response = await post(`/api/team/${teamId}/members`, {
        sessionToken,
        members: [
          { id: 'f1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' },
          { id: 'm1', name: 'Ann', color: 'bg-rose-500', role: 'participant', email: 'ann@example.ch;' }
        ]
      });

      expect(response.status).toBe(200);
      const team = dataStore._teams.get(teamId)! as unknown as { members: Record<string, unknown>[] };
      expect(team.members[1].email).toBe('ann@example.ch;');
    });
  });
});
