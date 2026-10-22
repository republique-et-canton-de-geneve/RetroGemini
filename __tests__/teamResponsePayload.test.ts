import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * What a team answer carries (synthesis item 8).
 *
 * `teamFeedbacks` is stored on the team record, images included, and used to
 * ride along with every team answer: about 300 KB of the 1 MB the largest team
 * sent on each login, restore and Dashboard refresh. No client version read it
 * (the Feedback Hub loads `/api/feedbacks/all`), so the answers leave it out.
 *
 * `/members` answered with the whole team after every roster write, and every
 * join writes the roster: each new participant downloaded the history a
 * second time for an answer its client never read. It answers
 * `{ success: true }`.
 */

type Team = Record<string, unknown> & { id: string; name: string };

const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const meta = { resetTokens: [] as unknown[], orphanedFeedbacks: [] as unknown[] };

  return {
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    teamExists: async (teamId: string) => teams.has(teamId),
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, structuredClone(teamData));
    },
    loadAllTeams: async () => Array.from(teams.values()),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
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
    loadMetaData: async () => meta,
    atomicMetaUpdate: async (updater: (m: typeof meta) => typeof meta | null) => {
      updater(meta);
      return meta;
    },
    loadGlobalSettings: async () => ({}),
    _teams: teams
  };
};

const listen = async (app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });

describe('team answers', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let teamService: ReturnType<typeof createTeamService>;
  let teamId: string;
  let sessionToken: string;

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    dataStore = createMockDataStore();
    const tokenService = createTokenService({
      secureCompare: (a: string, b: string) => a === b,
      superAdminPassword: null,
      tokenSecret: 'team-response-payload-test-secret'
    });
    teamService = createTeamService({ dataStore, tokenService });
    registerTeamRoutes({
      app,
      dataStore,
      teamService,
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s
    });
    const server = await listen(app);
    baseUrl = server.baseUrl;
    close = server.close;

    const created = await post('/api/team/create', {
      name: 'Alpha',
      password: 'secret-passphrase',
      facilitatorEmail: 'fac@example.com'
    });
    expect(created.status).toBe(201);
    teamId = created.body.team.id;
    sessionToken = created.body.sessionToken;

    // A feedback with an image, as the Feedback Hub stores it on the record.
    const team = dataStore._teams.get(teamId)!;
    team.teamFeedbacks = [{ id: 'fb-1', teamId, title: 'Broken button', images: [IMAGE], comments: [] }];
  });

  afterEach(async () => {
    await close();
  });

  it('creation answers the team without teamFeedbacks, and with its own fields', async () => {
    const created = await post('/api/team/create', {
      name: 'Bravo',
      password: 'secret-passphrase',
      facilitatorEmail: 'bravo@example.com'
    });

    expect(created.status).toBe(201);
    expect(created.body.team).not.toHaveProperty('teamFeedbacks');
    expect(created.body.team.name).toBe('Bravo');
    expect(created.body.team.facilitatorEmail).toBe('bravo@example.com');
    expect(Array.isArray(created.body.team.members)).toBe(true);
    expect(created.body.team).not.toHaveProperty('passwordHash');
  });

  it('login, restore-session, a team read and /update answer the team without teamFeedbacks', async () => {
    const responses = [
      await post('/api/team/login', { teamName: 'Alpha', password: 'secret-passphrase' }),
      await post('/api/team/restore-session', { sessionToken }),
      await post(`/api/team/${teamId}`, { sessionToken }),
      await post(`/api/team/${teamId}/update`, { sessionToken, updates: { actionImpactRatingEnabled: true } })
    ];

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.team).toBeTruthy();
      expect(res.body.team.id).toBe(teamId);
      expect(res.body.team).not.toHaveProperty('teamFeedbacks');
      expect(JSON.stringify(res.body)).not.toContain('Broken button');
    }
    // The record keeps them: the answers leave them out, nothing deletes them.
    expect(dataStore._teams.get(teamId)!.teamFeedbacks).toHaveLength(1);
  });

  it('/members answers exactly { success: true } and stores the roster', async () => {
    const res = await post(`/api/team/${teamId}/members`, {
      sessionToken,
      members: [{ id: 'm1', name: 'Ada', color: 'bg-rose-500', role: 'participant' }]
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const names = (dataStore._teams.get(teamId)!.members as { name: string }[]).map((m) => m.name);
    expect(names).toEqual(['Ada']);
  });

  it('sanitizeTeamForClient leaves teamFeedbacks out', () => {
    const sanitized = teamService.sanitizeTeamForClient({
      id: 't',
      name: 'T',
      passwordHash: 'x',
      teamFeedbacks: [{ id: 'fb', images: [IMAGE] }]
    });
    expect(sanitized).toEqual({ id: 't', name: 'T' });
  });
});
