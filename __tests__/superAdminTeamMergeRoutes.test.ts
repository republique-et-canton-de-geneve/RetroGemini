// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createBackupService } from '../server/services/backupService.js';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { createSecurityEventLog } from '../server/services/securityEvents.js';
import { fingerprintMergePlanInput } from '../server/services/teamMerge.js';

/**
 * The super-admin team merge and deletion, end to end on a real SQLite store.
 *
 * What the maintainer was promised, and what this suite holds the routes to:
 * the merge builds a third team and writes nothing else; the merged team opens
 * with the chosen password and its sessions belong to it; deleting a source
 * afterwards loses nothing — its feedbacks move into the merged team, and a
 * source that changed since the merge is not deleted without being asked twice.
 */

const PG_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_HOST',
  'POSTGRESQL_SERVICE_HOST',
  'POSTGRES_USER',
  'POSTGRESQL_USER',
  'POSTGRES_PASSWORD',
  'POSTGRESQL_PASSWORD',
  'POSTGRES_DB',
  'POSTGRESQL_DATABASE',
  'DATA_STORE_PATH'
];

const SUPER_ADMIN_PASSWORD = 'super-admin-merge-test';
const PASSWORD_A = 'password-team-a';
const PASSWORD_B = 'password-team-b';

type Json = Record<string, any>;

let dir: string;
let dataStore: ReturnType<typeof createDataStore>;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of PG_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'retro-team-merge-'));
  process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
  dataStore = createDataStore({ rootDir: dir });
  await dataStore.initDatabase();
});

afterAll(async () => {
  await dataStore.closeDatabase?.();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

let suffix = 0;

/** Two teams that are really one: the incident this feature exists for. */
const seedPair = async () => {
  suffix += 1;
  const a = {
    id: `ta${suffix}`,
    name: `Pratique analyse produit ${suffix}`,
    passwordHash: await hashPassword(PASSWORD_A),
    facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch',
    members: [
      { id: `admin-a${suffix}`, name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' },
      { id: `a-jean${suffix}`, name: 'Jean', color: 'bg-red-500', role: 'participant' }
    ],
    archivedMembers: [],
    customTemplates: [],
    retrospectives: [{
      id: `ra${suffix}`,
      teamId: `ta${suffix}`,
      name: 'Sprint 1',
      status: 'CLOSED',
      phase: 'CLOSE',
      tickets: [],
      actions: [{ id: `act-a${suffix}`, text: 'Pair more', assigneeId: `a-jean${suffix}`, done: false, type: 'new', proposalVotes: {} }],
      _rev: 3
    }],
    healthChecks: [],
    globalActions: [],
    teamFeedbacks: [{
      id: `feedback_a${suffix}`,
      teamId: `ta${suffix}`,
      teamName: `Pratique analyse produit ${suffix}`,
      type: 'bug',
      title: 'Bug from A',
      comments: []
    }]
  };
  const b = {
    id: `tb${suffix}`,
    name: `Pratique analyse produit bis ${suffix}`,
    passwordHash: await hashPassword(PASSWORD_B),
    facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch;',
    members: [
      { id: `admin-b${suffix}`, name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' },
      { id: `b-jean${suffix}`, name: 'Jean', color: 'bg-blue-500', role: 'participant' },
      { id: `b-luc${suffix}`, name: 'Luc', color: 'bg-green-500', role: 'participant' }
    ],
    archivedMembers: [],
    customTemplates: [],
    retrospectives: [{
      id: `rb${suffix}`,
      teamId: `tb${suffix}`,
      name: 'Sprint 2',
      status: 'CLOSED',
      phase: 'CLOSE',
      tickets: [{ id: 't1', colId: '1', text: 'Slow CI', authorId: `b-jean${suffix}`, groupId: null, votes: [`b-luc${suffix}`] }],
      actions: [],
      happiness: { [`b-jean${suffix}`]: 4 },
      _rev: 5
    }],
    healthChecks: [],
    globalActions: [],
    teamFeedbacks: [{
      id: `feedback_b${suffix}`,
      teamId: `tb${suffix}`,
      teamName: `Pratique analyse produit bis ${suffix}`,
      type: 'feature',
      title: 'Idea from B',
      comments: [
        { id: 'c-team', feedbackId: `feedback_b${suffix}`, teamId: `tb${suffix}`, teamName: 'B', authorId: `b-jean${suffix}`, content: 'Please' },
        { id: 'c-admin', feedbackId: `feedback_b${suffix}`, teamId: 'super-admin', teamName: 'Super Admin', authorId: 'super-admin', content: 'Planned', isAdmin: true }
      ]
    }]
  };
  for (const team of [a, b]) {
    await dataStore.saveTeam(team.id, team);
    await dataStore.atomicTeamIndexUpdate((index: Map<string, string>) => {
      index.set(team.name.toLowerCase(), team.id);
      return index;
    });
  }
  return { a, b };
};

type FakeSocket = { id: string; data: Json; rooms: Set<string> };

type BuildOptions = {
  serverRuntime?: { multiPodAdapter: boolean; socketAdapter?: Json };
  fetchSockets?: () => Promise<unknown[]>;
  realAuditLog?: boolean;
};

const buildApp = (options: BuildOptions = {}) => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const tokenService = createTokenService({
    secureCompare: (x: string, y: string) => x === y,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    tokenSecret: 'team-merge-route-test-secret'
  });
  const logService = { addServerLog: () => {}, getServerLogs: () => [], clearServerLogs: () => {} };
  const backupService = createBackupService({ dataStore, logService });
  const sockets: FakeSocket[] = [];
  const recorded: Json[] = [];
  // The real recorder when asked: what a row finally stores goes through the
  // shared redactor, which a spy never runs.
  const securityEvents = options.realAuditLog
    ? createSecurityEventLog({ dataStore: { appendSecurityEvent: async (row: Json) => { recorded.push(row); } } })
    : { record: async (_req: unknown, event: Json) => { recorded.push(event); } };

  registerTeamRoutes({
    app,
    dataStore,
    teamService: createTeamService({ dataStore, tokenService }),
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService,
    escapeHtml: (s: string) => s,
    securityEvents
  });
  registerSuperAdminRoutes({
    app,
    io: { emit: () => {}, serverSideEmit: () => {}, fetchSockets: options.fetchSockets ?? (async () => sockets) },
    dataStore,
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService,
    escapeHtml: (s: string) => s,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    sessionCache: { get: () => undefined, clear: () => {} },
    backupService,
    aiService: {},
    serverRuntime: options.serverRuntime ?? { multiPodAdapter: false },
    securityEvents
  });

  return new Promise<{
    post: (path: string, body: Json) => Promise<{ status: number; body: Json }>;
    close: () => Promise<void>;
    sockets: FakeSocket[];
    recorded: Json[];
    backupService: ReturnType<typeof createBackupService>;
    tokenService: ReturnType<typeof createTokenService>;
  }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        post: async (path, body) => {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const text = await response.text();
          return { status: response.status, body: text ? JSON.parse(text) : {} };
        },
        close: () => new Promise((done) => server.close(() => done())),
        sockets,
        recorded,
        backupService,
        tokenService
      });
    });
  });
};

const admin = (body: Json) => ({ password: SUPER_ADMIN_PASSWORD, ...body });

type Server = Awaited<ReturnType<typeof buildApp>>;

/**
 * A merge as the console sends it: with the fingerprints of the preview the
 * admin saw. When no preview can be had (a refusal the test is about), the
 * fingerprints of the records as they stand are what the admin would have seen.
 */
const mergeAsConsole = async (server: Server, a: Json, b: Json, extra: Json = {}) => {
  let expectedFingerprints = extra.expectedFingerprints;
  if (!('expectedFingerprints' in extra)) {
    const preview = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: a.id, secondaryTeamId: b.id }));
    expectedFingerprints = preview.status === 200
      ? preview.body.fingerprints
      : {
        primary: fingerprintMergePlanInput(await dataStore.loadTeam(a.id) ?? a),
        secondary: fingerprintMergePlanInput(await dataStore.loadTeam(b.id) ?? b)
      };
  }
  return server.post('/api/super-admin/merge-teams', admin({
    primaryTeamId: a.id,
    secondaryTeamId: b.id,
    name: `${a.name} (fusion)`,
    passwordSource: 'primary',
    facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch',
    ...extra,
    expectedFingerprints
  }));
};

describe('super-admin team merge', () => {
  let server: Awaited<ReturnType<typeof buildApp>>;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(async () => {
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ];
    server = await buildApp();
  });

  afterEach(async () => {
    await server.close();
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  const merge = (a: Json, b: Json, extra: Json = {}) => mergeAsConsole(server, a, b, extra);

  it('projects archived members for the email heal, and merge provenance for the console, only when asked', async () => {
    const { a, b } = await seedPair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({
      ...team,
      archivedMembers: [{ id: 'gone', name: 'Gone', color: 'bg-red-500', role: 'participant', email: 'gone@example.ch;' }]
    }));
    const summaries = await dataStore.loadTeamSummaries({ withArchivedMembers: true });
    expect(summaries.find((t: Json) => t.id === a.id).archivedMembers).toEqual([expect.objectContaining({ email: 'gone@example.ch;' })]);
    expect(summaries.find((t: Json) => t.id === b.id)).not.toHaveProperty('mergedFrom');
    expect((await dataStore.loadTeamSummaries()).find((t: Json) => t.id === a.id)).not.toHaveProperty('archivedMembers');
  });

  it('previews the merge without writing anything', async () => {
    const { a, b } = await seedPair();
    const before = JSON.stringify([await dataStore.loadTeamRaw(a.id), await dataStore.loadTeamRaw(b.id)]);
    const teamCount = (await dataStore.loadTeamSummaries()).length;

    const response = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: a.id, secondaryTeamId: b.id }));

    expect(response.status).toBe(200);
    expect(response.body.report.merged).toMatchObject({ retrospectives: 2, members: 3 });
    expect(response.body.report.members.unified.map((u: Json) => u.reason).sort()).toEqual(['facilitator', 'name']);
    expect(response.body.report.feedbacksToMoveOnDelete).toEqual({ primary: 1, secondary: 1 });
    expect(response.body.defaults).toEqual({
      name: `${a.name} + ${b.name}`,
      // The dirty address the incident left behind is offered cleaned.
      emails: { primary: 'elisabeth.trolliet@etat.ge.ch', secondary: 'elisabeth.trolliet@etat.ge.ch' },
      passwordSources: { primary: true, secondary: true }
    });
    expect(response.body.liveSessions).toEqual([]);
    expect(JSON.stringify([await dataStore.loadTeamRaw(a.id), await dataStore.loadTeamRaw(b.id)])).toBe(before);
    expect((await dataStore.loadTeamSummaries()).length).toBe(teamCount);
  });

  it('creates a third team and leaves both sources exactly as they were', async () => {
    const { a, b } = await seedPair();
    const before = JSON.stringify([await dataStore.loadTeamRaw(a.id), await dataStore.loadTeamRaw(b.id)]);

    const response = await merge(a, b);

    expect(response.status).toBe(201);
    const mergedId = response.body.team.id;
    expect([a.id, b.id]).not.toContain(mergedId);
    expect(JSON.stringify([await dataStore.loadTeamRaw(a.id), await dataStore.loadTeamRaw(b.id)])).toBe(before);

    const merged = await dataStore.loadTeam(mergedId) as Json;
    expect(merged.name).toBe(`${a.name} (fusion)`);
    expect(merged.facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
    expect(merged.retrospectives.map((r: Json) => r.name).sort()).toEqual(['Sprint 1', 'Sprint 2']);
    for (const entry of merged.retrospectives) {
      expect(entry.teamId).toBe(mergedId);
      expect([`ra${suffix}`, `rb${suffix}`]).not.toContain(entry.id);
    }
    // Jean of team B is Jean of team A: their ticket and mood follow.
    const sprint2 = merged.retrospectives.find((r: Json) => r.name === 'Sprint 2');
    expect(sprint2.tickets[0].authorId).toBe(`a-jean${suffix}`);
    expect(sprint2.happiness).toEqual({ [`a-jean${suffix}`]: 4 });
    expect(merged.members.map((m: Json) => m.name)).toEqual(['Facilitator', 'Jean', 'Luc']);
    expect(merged.teamFeedbacks).toEqual([]);

    const index = await dataStore.loadTeamIndex();
    expect(index.get(`${a.name} (fusion)`.toLowerCase())).toBe(mergedId);
    expect(index.get(a.name.toLowerCase())).toBe(a.id);
    expect(index.get(b.name.toLowerCase())).toBe(b.id);
  });

  it('opens the merged team with the password the admin chose', async () => {
    const { a, b } = await seedPair();
    const fromB = await merge(a, b, { name: `From B ${suffix}`, passwordSource: 'secondary' });
    expect(fromB.status).toBe(201);
    const login = (teamName: string, password: string) => server.post('/api/team/login', { teamName, password });
    expect((await login(`From B ${suffix}`, PASSWORD_B)).status).toBe(200);
    expect((await login(`From B ${suffix}`, PASSWORD_A)).status).toBe(401);

    const fresh = await merge(a, b, { name: `New pw ${suffix}`, passwordSource: 'new', newPassword: 'a-brand-new-password' });
    expect(fresh.status).toBe(201);
    expect((await login(`New pw ${suffix}`, 'a-brand-new-password')).status).toBe(200);
  });

  it('copies a live session that is ahead of the team record', async () => {
    const { a, b } = await seedPair();
    await dataStore.saveSessionState(`rb${suffix}`, {
      ...b.retrospectives[0],
      tickets: [...b.retrospectives[0].tickets, { id: 't2', colId: '1', text: 'Written after the last persist', authorId: `b-luc${suffix}`, groupId: null, votes: [] }],
      _rev: 5
    });

    const response = await merge(a, b);

    expect(response.status).toBe(201);
    expect(response.body.report.sessions.freshened).toEqual([
      expect.objectContaining({ source: 'secondary', name: 'Sprint 2' })
    ]);
    const merged = await dataStore.loadTeam(response.body.team.id) as Json;
    const sprint2 = merged.retrospectives.find((r: Json) => r.name === 'Sprint 2');
    expect(sprint2.tickets.map((t: Json) => t.text)).toEqual(['Slow CI', 'Written after the last persist']);
  });

  it('refuses what it cannot do safely, with a reason the console can show', async () => {
    const { a, b } = await seedPair();
    expect((await merge(a, a)).body).toEqual({ error: 'same_team' });
    expect((await merge(a, { id: 'missing' })).status).toBe(404);
    expect((await merge(a, b, { name: '   ' })).body).toEqual({ error: 'team_name_empty' });
    expect((await merge(a, b, { name: 'x'.repeat(201) })).body).toEqual({ error: 'team_name_too_long' });
    expect((await merge(a, b, { passwordSource: 'mine' })).body).toEqual({ error: 'invalid_password_source' });
    expect((await merge(a, b, { passwordSource: 'new', newPassword: 'short' })).body).toEqual({ error: 'password_too_short' });
    expect((await merge(a, b, { facilitatorEmail: 'a@x.ch; b@y.ch' })).body).toEqual({ error: 'invalid_email' });
    // A name another team holds, whatever its case and spacing.
    expect((await merge(a, b, { name: `  ${b.name.toUpperCase()} ` })).status).toBe(409);
    // A legacy password value never authenticates, so it is never copied.
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({ ...team, passwordHash: 'plaintext' }));
    expect((await merge(a, b, { passwordSource: 'secondary' })).body).toEqual({ error: 'password_unavailable' });
    // None of those refusals left a merged team behind.
    expect((await dataStore.loadTeamSummaries()).filter((t: Json) => t.name === `${a.name} (fusion)`)).toEqual([]);
  });

  it('refuses to run a plan the admin did not see: a team changed after the preview', async () => {
    const { a, b } = await seedPair();
    const preview = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: a.id, secondaryTeamId: b.id }));
    const { fingerprints } = preview.body;
    expect(fingerprints).toEqual({ primary: expect.any(String), secondary: expect.any(String) });

    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({
      ...team,
      members: [...team.members, { id: 'late-joiner', name: 'Late', color: 'bg-red-500', role: 'participant' }]
    }));
    const refused = await merge(a, b, { expectedFingerprints: fingerprints });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: 'sources_changed_since_preview' });

    const again = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: a.id, secondaryTeamId: b.id }));
    expect((await merge(a, b, { expectedFingerprints: again.body.fingerprints })).status).toBe(201);
  });

  it('refuses a team it could not carry without dropping something, and writes nothing', async () => {
    const { a, b } = await seedPair();
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({ ...team, healthChecks: { corrupted: true } }));
    const response = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: a.id, secondaryTeamId: b.id }));
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'source_needs_repair', anomalies: [{ source: 'secondary', field: 'healthChecks' }] });
    expect((await merge(a, b)).status).toBe(422);
  });

  it('refuses rather than ignore a live session it could not read', async () => {
    const { a, b } = await seedPair();
    const original = dataStore.loadSessionState.bind(dataStore);
    const read = vi.spyOn(dataStore, 'loadSessionState').mockImplementation(async (id: string, options?: { strict?: boolean }) => {
      if (options?.strict) throw new Error('connection reset');
      return original(id, options);
    });
    const response = await merge(a, b);
    read.mockRestore();
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'session_read_failed' });
    expect((await dataStore.loadTeamIndex()).has(`${a.name} (fusion)`.toLowerCase())).toBe(false);
  });

  it('stores in the audit row which password opens the merged team — past the redactor', async () => {
    await server.close();
    server = await buildApp({ realAuditLog: true });
    const { a, b } = await seedPair();
    const response = await merge(a, b, { passwordSource: 'secondary', name: `${'Long '.repeat(38)}${suffix}` });
    expect(response.status).toBe(201);
    const row = server.recorded.find((entry) => entry.action === 'team.merge');
    expect(row.detail).toContain('"passwordSource":"secondary"');
    expect(row.detail).toContain(b.id);
    expect(row.detail).not.toContain('scrypt$');
  });

  it('records the merge in the audit trail', async () => {
    const { a, b } = await seedPair();
    const response = await merge(a, b);
    expect(server.recorded).toContainEqual(expect.objectContaining({
      action: 'team.merge', actor: 'super-admin', target: response.body.team.id
    }));
  });

  it('refuses a merge sent without the fingerprints of the preview the admin saw', async () => {
    const { a, b } = await seedPair();
    const response = await merge(a, b, { expectedFingerprints: undefined });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'missing_fingerprints' });
    expect((await dataStore.loadTeamSummaries()).filter((t: Json) => t.name === `${a.name} (fusion)`)).toEqual([]);
  });

  it('refuses to merge a merged team with one of its own sources, even once the team in between is gone', async () => {
    const { a, b } = await seedPair();
    const first = await merge(a, b);
    expect(first.status).toBe(201);
    const merged = { id: first.body.team.id, name: `${a.name} (fusion)` };

    // Merging it with A again would copy every retro of A a second time.
    const direct = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: merged.id, secondaryTeamId: a.id }));
    expect(direct.status).toBe(409);
    expect(direct.body).toEqual({ error: 'related_teams' });

    // A merge of the merged team carries A in its chain; deleting the team in
    // between does not break it.
    const { a: other } = await seedPair();
    const second = await merge(merged, other, { name: `Chain ${suffix}` });
    expect(second.status).toBe(201);
    await dataStore.deleteTeamRecord(merged.id);
    const chained = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: second.body.team.id, secondaryTeamId: b.id }));
    expect(chained.body).toEqual({ error: 'related_teams' });
  });

  it('refuses to merge two merges that share a source: its work would be copied twice', async () => {
    const { a, b } = await seedPair();
    const first = await merge(a, b, { name: `Share 1 ${suffix}` });
    const second = await merge(a, b, { name: `Share 2 ${suffix}` });
    const preview = await server.post('/api/super-admin/merge-teams/preview', admin({
      primaryTeamId: first.body.team.id, secondaryTeamId: second.body.team.id
    }));
    expect(preview.body).toEqual({ error: 'related_teams' });
  });

  it('never offers a default name cut through an emoji', async () => {
    const { a, b } = await seedPair();
    // The cap falls between the two halves of the final emoji.
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, name: `${'x'.repeat(199)}🚀` }));
    const preview = await server.post('/api/super-admin/merge-teams/preview', admin({ primaryTeamId: a.id, secondaryTeamId: b.id }));
    expect(preview.status).toBe(200);
    expect(preview.body.defaults.name.isWellFormed()).toBe(true);
  });

  it('frees the merged name when the record write is lost or throws, but not when a throwing write landed', async () => {
    const { a, b } = await seedPair();
    const key = `${a.name} (fusion)`.toLowerCase();
    const realSave = dataStore.atomicTeamSave.bind(dataStore);

    const lost = vi.spyOn(dataStore, 'atomicTeamSave').mockResolvedValueOnce({ success: false } as never);
    expect((await merge(a, b)).status).toBe(503);
    lost.mockRestore();
    expect((await dataStore.loadTeamIndex()).has(key)).toBe(false);

    const thrown = vi.spyOn(dataStore, 'atomicTeamSave').mockRejectedValueOnce(new Error('disk full'));
    expect((await merge(a, b)).status).toBe(500);
    thrown.mockRestore();
    expect((await dataStore.loadTeamIndex()).has(key)).toBe(false);

    // The connection dropped after the commit: the team exists, so its name
    // stays — releasing it would leave a team nobody can log in to.
    const landed = vi.spyOn(dataStore, 'atomicTeamSave').mockImplementationOnce(async (...args: unknown[]) => {
      await (realSave as (...a: unknown[]) => Promise<unknown>)(...args);
      throw new Error('connection reset after commit');
    });
    expect((await merge(a, b)).status).toBe(500);
    landed.mockRestore();
    const mergedId = (await dataStore.loadTeamIndex()).get(key);
    expect(mergedId).toBeTruthy();
    expect(await dataStore.loadTeam(mergedId)).not.toBeNull();
  });

  it('refuses a name only the record check can see, and one only the index claim can see', async () => {
    const { a, b } = await seedPair();
    // A record whose index entry was lost (a deletion that stopped half-way).
    await dataStore.atomicTeamIndexUpdate((index: Map<string, string>) => { index.delete(b.name.toLowerCase()); return index; });
    expect((await merge(a, b, { name: b.name })).body).toEqual({ error: 'team_name_exists' });
    // An index key held by a team displaying another name (a rename in flight).
    await dataStore.atomicTeamIndexUpdate((index: Map<string, string>) => { index.set(`raced ${suffix}`, a.id); return index; });
    expect((await merge(a, b, { name: `Raced ${suffix}` })).body).toEqual({ error: 'team_name_exists' });
    expect((await dataStore.loadTeamSummaries()).filter((t: Json) => t.name === `Raced ${suffix}`)).toEqual([]);
  });

  it('records where the recovery address of the merged team came from, never the address', async () => {
    const { a, b } = await seedPair();
    await merge(a, b, { name: `From A ${suffix}` });
    await merge(a, b, { name: `Other ${suffix}`, facilitatorEmail: 'someone.else@etat.ge.ch' });
    await merge(a, b, { name: `None ${suffix}`, facilitatorEmail: '' });
    const rows = server.recorded.filter((entry) => entry.action === 'team.merge');
    expect(rows.map((row) => row.detail.recoveryEmailSource)).toEqual(['primary', 'other', 'none']);
    expect(JSON.stringify(rows)).not.toContain('someone.else');
  });

  it('keeps merge provenance out of team-side writes and team-side reads', async () => {
    const { a, b } = await seedPair();
    const mergedId = (await merge(a, b)).body.team.id;
    const login = await server.post('/api/team/login', { teamName: `${a.name} (fusion)`, password: PASSWORD_A });
    expect(login.body.team).not.toHaveProperty('mergedFrom');

    // A team member pointing mergedFrom at another team would receive that
    // team's feedbacks the day it is deleted.
    const update = await server.post(`/api/team/${a.id}/update`, {
      password: PASSWORD_A,
      updates: { mergedFrom: [{ teamId: 'victim', fingerprint: 'x' }] }
    });
    expect(update.status).toBe(200);
    expect((await dataStore.loadTeam(a.id) as Json).mergedFrom).toBeUndefined();

    const teams = await server.post('/api/super-admin/teams', admin({}));
    const listed = teams.body.teams.find((t: Json) => t.id === mergedId);
    expect(listed.mergedFrom).toEqual([
      { teamId: a.id, name: a.name, mergedAt: expect.any(String), verified: true },
      { teamId: b.id, name: b.name, mergedAt: expect.any(String), verified: true }
    ]);
  });
});

describe('super-admin team deletion', () => {
  let server: Awaited<ReturnType<typeof buildApp>>;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(async () => {
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ];
    server = await buildApp();
  });

  afterEach(async () => {
    await server.close();
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  const mergePair = async () => {
    const { a, b } = await seedPair();
    const response = await mergeAsConsole(server, a, b, { facilitatorEmail: undefined });
    expect(response.status).toBe(201);
    return { a, b, mergedId: response.body.team.id as string };
  };

  const post = (team: Json, extra: Json = {}) =>
    server.post('/api/super-admin/delete-team', admin({ teamId: team.id, confirmName: team.name, ...extra }));

  /**
   * A deletion as the console sends it. An acknowledgement goes back with the
   * digest of the facts the refusal showed, so a test that acknowledges first
   * reads that refusal, as the admin does.
   */
  const remove = async (team: Json, extra: Json = {}) => {
    if (!extra.acknowledge || 'confirmation' in extra) return post(team, extra);
    const { acknowledge: _acknowledge, ...first } = extra;
    const refusal = await post(team, first);
    if (refusal.status !== 409 || refusal.body.error !== 'confirmation_required') return refusal;
    return post(team, { ...extra, confirmation: refusal.body.confirmation });
  };

  it('needs the team name typed back', async () => {
    const { a } = await seedPair();
    expect((await remove(a, { confirmName: 'Pratique' })).body).toEqual({ error: 'confirm_name_mismatch' });
    expect(await dataStore.loadTeam(a.id)).not.toBeNull();
  });

  it('moves a merge source’s feedbacks into the merged team the admin confirmed, then removes the source and frees its name', async () => {
    const { b, mergedId } = await mergePair();

    const response = await remove(b, { mergedInto: mergedId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, movedFeedbacks: 1, orphanedFeedbacks: 0, mergedInto: mergedId });
    expect(await dataStore.loadTeam(b.id)).toBeNull();
    expect((await dataStore.loadTeamIndex()).has(b.name.toLowerCase())).toBe(false);

    const merged = await dataStore.loadTeam(mergedId) as Json;
    const moved = merged.teamFeedbacks.find((f: Json) => f.title === 'Idea from B');
    expect(moved).toMatchObject({ teamId: mergedId, teamName: merged.name });
    // The source's own comment now belongs to the merged team, so it may delete
    // it; the administrator's reply keeps its author.
    expect(moved.comments.find((c: Json) => c.id === 'c-team')).toMatchObject({ teamId: mergedId });
    expect(moved.comments.find((c: Json) => c.id === 'c-admin')).toMatchObject({ teamId: 'super-admin' });
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).not.toContain(`feedback_b${suffix}`);
  });

  it('orphans the feedbacks when the admin did not confirm a merged team', async () => {
    const { b } = await mergePair();
    expect((await remove(b)).body).toMatchObject({ movedFeedbacks: 0, orphanedFeedbacks: 1, mergedInto: null });
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).toContain(`feedback_b${suffix}`);
  });

  it('takes a protected snapshot holding the team before deleting it', async () => {
    const { b } = await mergePair();
    await remove(b);
    const backups = await server.backupService.listBackups();
    expect(backups).toContainEqual(expect.objectContaining({ label: 'Pre-delete snapshot', protected: true }));
    expect(server.recorded).toContainEqual(expect.objectContaining({ action: 'team.delete', actor: 'super-admin', target: b.id }));
  });

  it('says what changed in a source since the merge, and deletes it only once that is acknowledged', async () => {
    const { a, mergedId } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({
      ...team,
      globalActions: [{ id: 'late', text: 'Written after the merge', assigneeId: null, done: false, type: 'new', proposalVotes: {} }],
      retrospectives: [{ id: 'late-retro', teamId: a.id, name: 'Run on an old invite link', status: 'CLOSED', phase: 'CLOSE', actions: [], _rev: 1 }, ...team.retrospectives]
    }));

    const refused = await remove(a);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: 'confirmation_required',
      reasons: ['source_changed'],
      changes: [
        { kind: 'retrospective', name: 'Run on an old invite link', added: true },
        { kind: 'backlog', added: false }
      ],
      mergedInto: [`${a.name} (fusion)`],
      confirmation: expect.any(String)
    });
    expect(await dataStore.loadTeam(a.id)).not.toBeNull();

    expect((await remove(a, { acknowledge: ['source_changed'], mergedInto: mergedId })).status).toBe(200);
    expect(await dataStore.loadTeam(a.id)).toBeNull();
  });

  it('never lets one acknowledged reason wave another through', async () => {
    const { a } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, customTemplates: [{ name: 'Late', cols: [] }] }));
    server.sockets.push({ id: 'socket-1', data: { userId: 'u1', userName: 'Jean' }, rooms: new Set(['socket-1', `ra${suffix}`]) });

    const onlySessions = await remove(a, { acknowledge: ['sessions_open'] });
    expect(onlySessions.status).toBe(409);
    expect(onlySessions.body.reasons).toEqual(['source_changed', 'sessions_open']);
    expect(await dataStore.loadTeam(a.id)).not.toBeNull();

    expect((await remove(a, { acknowledge: ['sessions_open', 'source_changed'] })).status).toBe(200);
  });

  it('does not count opening or browsing an old retro as a change', async () => {
    const { a } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({
      ...team,
      members: [...team.members, { id: 'late', name: 'Late joiner', color: 'bg-red-500', role: 'participant' }],
      retrospectives: team.retrospectives.map((r: Json) => ({
        ...r,
        _rev: r._rev + 4,
        _updatedAt: new Date().toISOString(),
        phase: 'REVIEW',
        participants: [{ id: `a-jean${suffix}`, name: 'Jean' }],
        name: 'Renamed later'
      }))
    }));
    expect((await remove(a)).status).toBe(200);
  });

  it('does not read an unchanged source as changed after a restore wiped the live sessions', async () => {
    const { a, b } = await seedPair();
    // A live copy ahead of the record: the merge takes it.
    await dataStore.saveSessionState(`rb${suffix}`, {
      ...b.retrospectives[0],
      tickets: [...b.retrospectives[0].tickets, { id: 't-live', colId: '1', text: 'Only in the live copy', authorId: `b-luc${suffix}`, groupId: null, votes: [] }],
      _rev: 5
    });
    const merged = await mergeAsConsole(server, a, b, { facilitatorEmail: undefined });
    expect(merged.status).toBe(201);

    // A restore is a faithful replace: every live session row goes.
    await dataStore.savePersistedData(await dataStore.loadPersistedData(), { mode: 'replace' });
    expect(await dataStore.loadSessionState(`rb${suffix}`)).toBeNull();

    expect((await remove(b)).status).toBe(200);
  });

  it('asks before deleting a team someone is in a session of', async () => {
    const { a } = await seedPair();
    server.sockets.push({ id: 'socket-1', data: { userId: 'u1', userName: 'Jean' }, rooms: new Set(['socket-1', `ra${suffix}`]) });

    const refused = await remove(a);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: 'confirmation_required', reasons: ['sessions_open'], sessions: ['Sprint 1'], confirmation: expect.any(String)
    });

    expect((await remove(a, { acknowledge: ['sessions_open'] })).status).toBe(200);
  });

  it('does not take "could not check" for "nobody is in a session"', async () => {
    await server.close();
    server = await buildApp({ fetchSockets: async () => { throw new Error('adapter down'); } });
    const { a } = await seedPair();
    const refused = await remove(a);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: 'confirmation_required', reasons: ['sessions_unknown'], confirmation: expect.any(String) });
    expect((await remove(a, { acknowledge: ['sessions_unknown'] })).status).toBe(200);
  });

  it('cannot see other pods while the cross-pod adapter is down, and says so', async () => {
    await server.close();
    server = await buildApp({ serverRuntime: { multiPodAdapter: false, socketAdapter: { expected: true, active: false } } });
    const { a } = await seedPair();
    expect((await remove(a)).body).toEqual({ error: 'confirmation_required', reasons: ['sessions_unknown'], confirmation: expect.any(String) });
  });

  it('orphans the feedbacks of a team that is not a merge source, as a team deleting itself does', async () => {
    const { a } = await seedPair();
    const response = await remove(a);
    expect(response.body).toMatchObject({ movedFeedbacks: 0, orphanedFeedbacks: 1, mergedInto: null });
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).toContain(`feedback_a${suffix}`);
  });

  it('leaves a team deleting itself from its Dashboard as it always was: deleted, feedbacks orphaned', async () => {
    const { a, mergedId } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, customTemplates: [{ name: 'Late', cols: [] }] }));

    const response = await server.post(`/api/team/${a.id}/delete`, { password: PASSWORD_A });

    expect(response.status).toBe(200);
    expect(await dataStore.loadTeam(a.id)).toBeNull();
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).toContain(`feedback_a${suffix}`);
    expect((await dataStore.loadTeam(mergedId) as Json).teamFeedbacks).toEqual([]);
  });

  it('never overwrites the merged team’s copy of a feedback when a failed deletion is retried', async () => {
    const { b, mergedId } = await mergePair();
    const deleteRecord = vi.spyOn(dataStore, 'deleteTeamRecord').mockRejectedValueOnce(new Error('disk full'));
    expect((await remove(b, { mergedInto: mergedId })).status).toBe(500);
    deleteRecord.mockRestore();

    // Between the attempts, people write to both copies.
    const addComment = (teamId: string, id: string) => dataStore.atomicTeamUpdate(teamId, (team: Json) => ({
      ...team,
      teamFeedbacks: team.teamFeedbacks.map((f: Json) =>
        f.title === 'Idea from B' ? { ...f, status: teamId === mergedId ? 'resolved' : f.status, comments: [...f.comments, { id, teamId, content: id }] } : f
      )
    }));
    await addComment(mergedId, 'c-on-merged');
    await addComment(b.id, 'c-on-source');

    expect((await remove(b, { mergedInto: mergedId })).status).toBe(200);
    const moved = (await dataStore.loadTeam(mergedId) as Json).teamFeedbacks.filter((f: Json) => f.title === 'Idea from B');
    expect(moved).toHaveLength(1);
    expect(moved[0].status).toBe('resolved');
    expect(moved[0].comments.map((c: Json) => c.id)).toEqual(['c-team', 'c-admin', 'c-on-merged', 'c-on-source']);
    // The source's own comments now belong to the merged team.
    expect(moved[0].comments.find((c: Json) => c.id === 'c-on-source').teamId).toBe(mergedId);
  });

  it('stops before deleting anything when the feedbacks cannot be moved, so a retry still can', async () => {
    const { b, mergedId } = await mergePair();
    const original = dataStore.atomicTeamUpdate.bind(dataStore);
    const update = vi.spyOn(dataStore, 'atomicTeamUpdate').mockImplementation(async (teamId: string, updater: any) =>
      teamId === mergedId ? { success: false, error: 'max_retries_exceeded' } : original(teamId, updater)
    );
    const response = await remove(b, { mergedInto: mergedId });
    update.mockRestore();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'failed_to_move_feedbacks' });
    expect(await dataStore.loadTeam(b.id)).not.toBeNull();
    expect((await dataStore.loadTeamIndex()).get(b.name.toLowerCase())).toBe(b.id);
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).not.toContain(`feedback_b${suffix}`);
  });

  it('asks before deleting a merged team whose sources are already gone — it is their only copy', async () => {
    const { a, b, mergedId } = await mergePair();
    expect((await remove(b)).status).toBe(200);
    const merged = { id: mergedId, name: `${a.name} (fusion)` };

    const refused = await remove(merged);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: 'confirmation_required', reasons: ['sources_deleted'], sources: [b.name], confirmation: expect.any(String)
    });
    expect((await remove(merged, { acknowledge: ['sources_deleted'] })).status).toBe(200);
  });

  it('lets the merged team be deleted while both sources still exist: that is undoing the merge', async () => {
    const { a, mergedId } = await mergePair();
    expect((await remove({ id: mergedId, name: `${a.name} (fusion)` })).status).toBe(200);
  });

  it('never moves feedbacks into a team on the strength of a merge record it wrote itself', async () => {
    const { a, b } = await seedPair();
    // What `/update` stored for anyone before this release, and an old pod
    // still does during a rolling update.
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({
      ...team,
      mergedFrom: [{ teamId: a.id, name: a.name, mergedAt: '9999-12-31T00:00:00.000Z', fingerprint: 'forged' }]
    }));

    const listed = (await server.post('/api/super-admin/teams', admin({}))).body.teams.find((t: Json) => t.id === b.id);
    expect(listed.mergedFrom).toEqual([{ teamId: a.id, name: a.name, mergedAt: '9999-12-31T00:00:00.000Z', verified: false }]);

    // Unsigned, it cannot vouch that the work is anywhere else: the admin is
    // told, and nothing it claims is trusted.
    const refused = await remove(a, { mergedInto: b.id });
    expect(refused.body).toMatchObject({ reasons: ['merge_unverified'], mergedInto: [b.name] });

    // Even confirmed by an admin who trusted the console's hint.
    const response = await remove(a, { mergedInto: b.id, acknowledge: ['merge_unverified'] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ movedFeedbacks: 0, orphanedFeedbacks: 1, mergedInto: null });
    expect((await dataStore.loadTeam(b.id) as Json).teamFeedbacks.map((f: Json) => f.title)).toEqual(['Idea from B']);
  });

  it('moves the feedbacks of a source merged twice only into the merged team the admin names', async () => {
    const { a, b } = await seedPair();
    const ids: string[] = [];
    for (const name of [`Twice one ${suffix}`, `Twice two ${suffix}`]) {
      const merged = await mergeAsConsole(server, a, b, { name, facilitatorEmail: undefined });
      expect(merged.status).toBe(201);
      ids.push(merged.body.team.id);
    }

    expect((await remove(a, { mergedInto: ids[1] })).body).toMatchObject({ movedFeedbacks: 1, mergedInto: ids[1] });
    expect((await dataStore.loadTeam(ids[0]) as Json).teamFeedbacks).toEqual([]);
  });

  it('keeps both feedbacks when a moved one shares its id with one the merged team already holds', async () => {
    const { b, mergedId } = await mergePair();
    await dataStore.atomicTeamUpdate(mergedId, (team: Json) => ({
      ...team,
      teamFeedbacks: [{ id: `feedback_b${suffix}`, teamId: mergedId, title: 'Written in the merged team', comments: [] }]
    }));

    expect((await remove(b, { mergedInto: mergedId })).status).toBe(200);

    const feedbacks = (await dataStore.loadTeam(mergedId) as Json).teamFeedbacks;
    expect(feedbacks.map((f: Json) => f.title)).toEqual(['Written in the merged team', 'Idea from B']);
    const moved = feedbacks[1];
    expect(moved.id).not.toBe(`feedback_b${suffix}`);
    expect(moved.comments.every((c: Json) => c.feedbackId === moved.id)).toBe(true);
  });

  it('deletes nothing when it cannot tell whether the team was merged', async () => {
    // An empty answer would read as "merged into nothing" and skip the check
    // that the source changed since its merge.
    const { b } = await mergePair();
    const spy = vi.spyOn(dataStore, 'loadTeamSummaries').mockRejectedValueOnce(new Error('store down'));
    try {
      expect((await remove(b)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await dataStore.loadTeam(b.id)).not.toBeNull();
  });

  it('deletes nothing when a write lands while the checks and the snapshot run', async () => {
    const { b, mergedId } = await mergePair();
    const realBackup = server.backupService.createBackup.bind(server.backupService);
    const spy = vi.spyOn(server.backupService, 'createBackup').mockImplementationOnce((async (...args: unknown[]) => {
      const snapshot = await (realBackup as (...a: unknown[]) => Promise<unknown>)(...args);
      // A participant files a feedback in the source meanwhile.
      await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({
        ...team,
        teamFeedbacks: [...team.teamFeedbacks, { id: 'feedback_late', teamId: b.id, title: 'Written during the deletion', comments: [] }]
      }));
      return snapshot;
    }) as never);
    const response = await remove(b, { mergedInto: mergedId });
    spy.mockRestore();

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'team_changed' });
    expect((await dataStore.loadTeam(b.id) as Json).teamFeedbacks.map((f: Json) => f.id)).toContain('feedback_late');
  });

  it('never lets an acknowledgement wave through a change made after the admin read the reasons', async () => {
    const { a, mergedId } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, customTemplates: [{ name: 'Late', cols: [] }] }));
    const refusal = await post(a);
    expect(refusal.body.reasons).toEqual(['source_changed']);

    // While the dialog is open, the team keeps working.
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({
      ...team,
      retrospectives: [{ id: 'later-still', teamId: a.id, name: 'Sprint 3', status: 'CLOSED', phase: 'CLOSE', actions: [], _rev: 1 }, ...team.retrospectives]
    }));
    const stale = await post(a, { mergedInto: mergedId, acknowledge: ['source_changed'], confirmation: refusal.body.confirmation });
    expect(stale.status).toBe(409);
    expect(stale.body.changes).toContainEqual({ kind: 'retrospective', name: 'Sprint 3', added: true });
    expect(stale.body.confirmation).not.toBe(refusal.body.confirmation);
    expect(await dataStore.loadTeam(a.id)).not.toBeNull();
  });

  it('deletes nothing when the pre-delete snapshot cannot be taken', async () => {
    const { b, mergedId } = await mergePair();
    const empty = vi.spyOn(server.backupService, 'createBackup').mockResolvedValueOnce({ id: 'empty', teamCount: 0 } as never);
    const refused = await remove(b, { mergedInto: mergedId });
    empty.mockRestore();
    expect(refused.status).toBe(503);
    expect(refused.body).toEqual({ error: 'pre_delete_snapshot_failed' });

    const thrown = vi.spyOn(server.backupService, 'createBackup').mockRejectedValueOnce(new Error('disk full'));
    expect((await remove(b, { mergedInto: mergedId })).status).toBe(500);
    thrown.mockRestore();

    expect(await dataStore.loadTeam(b.id)).not.toBeNull();
    expect((await dataStore.loadTeamIndex()).get(b.name.toLowerCase())).toBe(b.id);
    expect((await dataStore.loadTeam(mergedId) as Json).teamFeedbacks).toEqual([]);
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).not.toContain(`feedback_b${suffix}`);
  });

  it('sees work a live session wrote after the merge, and never decides on a session it could not read', async () => {
    const { b, mergedId } = await mergePair();
    // The room kept going on an old invite link: only the live row has the card.
    await dataStore.saveSessionState(`rb${suffix}`, {
      ...b.retrospectives[0],
      tickets: [...b.retrospectives[0].tickets, { id: 't-after', colId: '1', text: 'Written after the merge', authorId: `b-luc${suffix}`, groupId: null, votes: [] }],
      _rev: 9
    });
    const refused = await remove(b, { mergedInto: mergedId });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reasons: ['source_changed'], changes: [{ kind: 'retrospective', name: 'Sprint 2', added: false }] });

    const read = vi.spyOn(dataStore, 'loadSessionState').mockRejectedValue(new Error('connection reset'));
    const blind = await post(b, { mergedInto: mergedId, acknowledge: ['source_changed'], confirmation: refused.body.confirmation });
    read.mockRestore();
    expect(blind.body).toEqual({ error: 'session_read_failed' });
    expect(await dataStore.loadTeam(b.id)).not.toBeNull();
  });

  it('counts a session that closed in a source after the merge as a change', async () => {
    const { a, b } = await seedPair();
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({
      ...team,
      healthChecks: [{ id: `hb${suffix}`, teamId: b.id, name: 'Health', status: 'IN_PROGRESS', phase: 'REVIEW', ratings: {}, actions: [], _rev: 1 }]
    }));
    const merged = await mergeAsConsole(server, a, b, { facilitatorEmail: undefined });
    expect(merged.status).toBe(201);
    // Reaching Close writes only the phase and status.
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({
      ...team,
      healthChecks: team.healthChecks.map((check: Json) => ({ ...check, status: 'CLOSED', phase: 'CLOSE' }))
    }));
    expect((await remove({ id: b.id, name: b.name })).body).toMatchObject({
      reasons: ['source_changed'],
      changes: [{ kind: 'healthCheck', name: 'Health', added: false }]
    });
  });

  it('reads a source that only lost a retro since its merge as unchanged: the merged team holds it', async () => {
    const { a } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, retrospectives: [] }));
    expect((await remove(a)).status).toBe(200);
  });

  it('asks before deleting a merged team that was used after the merge', async () => {
    const { a, mergedId } = await mergePair();
    await dataStore.atomicTeamUpdate(mergedId, (team: Json) => ({
      ...team,
      retrospectives: [{ id: 'after-merge', teamId: mergedId, name: 'First retro together', status: 'CLOSED', phase: 'CLOSE', actions: [], _rev: 1 }, ...team.retrospectives]
    }));
    const merged = { id: mergedId, name: `${a.name} (fusion)` };
    const refused = await remove(merged);
    expect(refused.body).toMatchObject({
      reasons: ['merged_team_changed'],
      mergedChanges: [{ kind: 'retrospective', name: 'First retro together', added: true }]
    });
    expect((await remove(merged, { acknowledge: ['merged_team_changed'] })).status).toBe(200);
  });

  it('trusts no provenance field edited after the merge signed it', async () => {
    const { a, mergedId } = await mergePair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, customTemplates: [{ name: 'Late', cols: [] }] }));
    // Someone points the recorded digest at the source's current content, so
    // the change would read as none.
    const { fingerprintTeamContent } = await import('../server/services/teamMerge.js');
    const current = fingerprintTeamContent(await dataStore.loadTeam(a.id));
    await dataStore.atomicTeamUpdate(mergedId, (team: Json) => ({
      ...team,
      mergedFrom: team.mergedFrom.map((entry: Json) => (entry.teamId === a.id ? { ...entry, recordFingerprint: current, fingerprint: current } : entry))
    }));
    expect((await remove(a)).body.reasons).toEqual(['merge_unverified']);
  });

  it('never re-owns the comments of the other source, which still exists', async () => {
    const { a, b, mergedId } = await mergePair();
    expect((await remove(b, { mergedInto: mergedId })).status).toBe(200);
    // A replies, as itself, on the feedback that moved from B.
    await dataStore.atomicTeamUpdate(mergedId, (team: Json) => ({
      ...team,
      teamFeedbacks: team.teamFeedbacks.map((f: Json) => ({
        ...f,
        comments: [...f.comments, { id: 'c-from-a', feedbackId: f.id, teamId: a.id, teamName: a.name, authorId: `a-jean${suffix}`, content: 'Agreed' }]
      }))
    }));
    // Deleting nothing of A yet: A's comment is still A's to delete.
    const before = (await dataStore.loadTeam(mergedId) as Json).teamFeedbacks[0].comments.find((c: Json) => c.id === 'c-from-a');
    expect(before.teamId).toBe(a.id);
    // Once A goes, its comments become the merged team's.
    expect((await remove(a, { mergedInto: mergedId })).status).toBe(200);
    const after = (await dataStore.loadTeam(mergedId) as Json).teamFeedbacks
      .flatMap((f: Json) => f.comments)
      .find((c: Json) => c.id === 'c-from-a');
    expect(after.teamId).toBe(mergedId);
  });

  it('never reports a merged team the merge did not sign, even with no feedbacks to move', async () => {
    const { a, b } = await seedPair();
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({ ...team, teamFeedbacks: [] }));
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({
      ...team,
      mergedFrom: [{ teamId: a.id, name: a.name, mergedAt: '9999-12-31T00:00:00.000Z', fingerprint: 'forged' }]
    }));
    const response = await remove(a, { mergedInto: b.id, acknowledge: ['merge_unverified'] });
    expect(response.status).toBe(200);
    expect(response.body.mergedInto).toBeNull();
    const row = server.recorded.find((e) => e.action === 'team.delete' && e.target === a.id);
    expect(row.detail).not.toHaveProperty('mergedInto');
  });

  it('adopts the comments a source wrote in its merged teams, even with no feedback to move', async () => {
    const { a, b } = await seedPair();
    await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({ ...team, teamFeedbacks: [] }));
    // Merged twice: the console offers no single move target, yet B commented in both.
    const ids: string[] = [];
    for (const name of [`Twice A ${suffix}`, `Twice B ${suffix}`]) {
      const merged = await mergeAsConsole(server, a, b, { name, facilitatorEmail: undefined });
      ids.push(merged.body.team.id);
      await dataStore.atomicTeamUpdate(merged.body.team.id, (team: Json) => ({
        ...team,
        teamFeedbacks: [{ id: `fb-${name}`, teamId: team.id, title: 'Shared', comments: [{ id: `c-${name}`, teamId: b.id, teamName: b.name, content: 'From B' }] }]
      }));
    }

    expect((await remove(b)).status).toBe(200);
    for (const id of ids) {
      const comment = (await dataStore.loadTeam(id) as Json).teamFeedbacks[0].comments[0];
      expect(comment).toMatchObject({ teamId: id });
    }
  });

  it('asks nothing about a merged team that is itself whole in a later merge', async () => {
    const { a, b, mergedId } = await mergePair();
    // Used after its merge — then merged again, so the later team holds that work.
    await dataStore.atomicTeamUpdate(mergedId, (team: Json) => ({
      ...team,
      retrospectives: [{ id: 'after-merge', teamId: mergedId, name: 'Used after the merge', status: 'CLOSED', phase: 'CLOSE', actions: [], _rev: 1 }, ...team.retrospectives]
    }));
    const merged = { id: mergedId, name: `${a.name} (fusion)` };
    const { a: other } = await seedPair();
    const later = await mergeAsConsole(server, merged, other, { name: `Later ${suffix}`, facilitatorEmail: undefined });
    expect(later.status).toBe(201);
    expect((await remove(b)).status).toBe(200);

    // Neither "used since its merge" nor "its sources are gone" loses anything now.
    expect((await remove(merged)).status).toBe(200);
  });

  it('removes the unused protected snapshot when it refuses after taking it', async () => {
    const { b, mergedId } = await mergePair();
    const protectedCount = async () =>
      (await server.backupService.listBackups()).filter((backup: Json) => backup.protected).length;
    const before = await protectedCount();
    const realBackup = server.backupService.createBackup.bind(server.backupService);
    const spy = vi.spyOn(server.backupService, 'createBackup').mockImplementationOnce((async (...args: unknown[]) => {
      const snapshot = await (realBackup as (...a: unknown[]) => Promise<unknown>)(...args);
      await dataStore.atomicTeamUpdate(b.id, (team: Json) => ({ ...team, teamFeedbacks: [...team.teamFeedbacks, { id: 'late-2', title: 'Late', comments: [] }] }));
      return snapshot;
    }) as never);
    expect((await remove(b, { mergedInto: mergedId })).body).toEqual({ error: 'team_changed' });
    spy.mockRestore();
    expect(await protectedCount()).toBe(before);
  });

  it('can still be confirmed while a live session keeps writing the team record', async () => {
    const { a } = await seedPair();
    server.sockets.push({ id: 'socket-busy', data: { userId: 'u1', userName: 'Jean' }, rooms: new Set(['socket-busy', `ra${suffix}`]) });
    const refusal = await post(a);
    expect(refusal.body.reasons).toEqual(['sessions_open']);
    // The room persists its retro, and someone joins: the record's revision moves.
    await dataStore.atomicTeamUpdate(a.id, (team: Json) => ({
      ...team,
      members: [...team.members, { id: 'joined', name: 'Joined', color: 'bg-red-500', role: 'participant' }]
    }));
    const confirmed = await post(a, { acknowledge: ['sessions_open'], confirmation: refusal.body.confirmation });
    expect(confirmed.status).toBe(200);
  });

  it('answers 404 for a team that is already gone, so a retry is harmless', async () => {
    const { b } = await mergePair();
    expect((await remove(b)).status).toBe(200);
    expect((await remove(b)).status).toBe(404);
  });
});
