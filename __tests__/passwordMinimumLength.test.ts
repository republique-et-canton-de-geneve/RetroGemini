import express from 'express';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { createPublicOriginResolver } from '../server/services/publicOrigin.js';
import { hashResetToken, pruneResetTokens } from '../server/services/security.js';
import { hashPassword, verifyPassword } from '../server/services/passwordHashing.js';
import { PASSWORD_MIN_LENGTH } from '../utils/passwordPolicy.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * Audit H39 — one password minimum, enforced on every path that *writes* a
 * password and on none that *verifies* one.
 *
 * The finding was that the rule was `length < 4`, which no published baseline
 * admits (OWASP ASVS 2.1.1 asks for 12) and which a reviewer finds with a
 * single grep. Raising it is easy; the two ways of getting it wrong are what
 * these tests pin:
 *
 *  1. **Missing a write path.** The rule is repeated at four server sites, and
 *     an enumeration is a claim like any other (the H34 lesson). Every one of
 *     them gets a boundary pair here — `MIN-1` refused, `MIN` accepted — so a
 *     fifth path added later without the check is the odd one out.
 *  2. **Binding it on verify.** A minimum that applies to authentication locks
 *     out every team whose password predates the rule. That is not a hardening
 *     win, it is an outage for the whole existing user base — an availability
 *     cost is a security property too (the H20 lesson). The last block below is
 *     the guard: a team whose stored hash came from a 6-character password must
 *     keep logging in, and must keep being able to *read* its own data.
 *
 * The boundary is expressed as `PASSWORD_MIN_LENGTH ± 1` rather than as the
 * literals 11 and 12 so the suite follows the rule if it is ever raised again;
 * the number itself is pinned once, in `passwordPolicy.test.ts`.
 */

const TOO_SHORT = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
const LONG_ENOUGH = 'a'.repeat(PASSWORD_MIN_LENGTH);

/** What a team created before H39 has in the store: a hash of a short secret. */
const LEGACY_SHORT_PASSWORD = 'secret';

// --------------------------------------------------------------------------
// Team routes: /api/team/create and /api/team/:teamId/password
// --------------------------------------------------------------------------

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };

const createMockDataStore = (seed: Team[] = []) => {
  const teams = new Map<string, Team>(seed.map((team) => [team.id, { ...team }]));
  const indexMap = new Map<string, string>(seed.map((team) => [team.name.toLowerCase(), team.id]));
  const meta: { resetTokens: unknown[]; orphanedFeedbacks: unknown[] } = {
    resetTokens: [],
    orphanedFeedbacks: []
  };

  const loadTeam = async (teamId: string) => teams.get(teamId) || null;

  const atomicTeamUpdate = async (teamId: string, updater: (team: Team) => Team | null) => {
    const existing = teams.get(teamId);
    if (!existing) return { success: false, error: 'team_not_found' };
    const updated = updater({ ...existing });
    if (!updated) return { success: true, team: existing };
    teams.set(teamId, { ...updated });
    return { success: true, team: updated };
  };

  return {
    teams,
    loadTeam,
    loadTeamRaw: loadTeam,
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
    },
    loadAllTeams: async () => Array.from(teams.values()),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamSave: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
      return { success: true };
    },
    atomicTeamUpdate,
    loadTeamIndex: async () => new Map(indexMap),
    saveTeamIndex: async (map: Map<string, string>) => {
      indexMap.clear();
      for (const [k, v] of map) indexMap.set(k, v);
    },
    // The updater is handed a `Map`, not a plain object — `teamNameIndex.js`
    // calls `index.get/set/delete/entries` on it. Getting this wrong is the
    // H30 trap in miniature: a harness that does not match production makes a
    // passing test meaningless, and here it made a free name look taken.
    atomicTeamIndexUpdate: async (
      updater: (index: Map<string, string>) => Map<string, string> | null
    ) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
    },
    loadTeamSummaries: async () =>
      Array.from(teams.values()).map((t) => ({ id: t.id, name: t.name, members: [] })),
    loadGlobalSettings: async () => ({}),
    loadMetaData: async () => JSON.parse(JSON.stringify(meta)),
    atomicMetaUpdate: async (updater: (m: typeof meta) => typeof meta | null) => {
      const updated = updater(JSON.parse(JSON.stringify(meta)));
      if (!updated) return { success: true };
      Object.assign(meta, updated);
      return { success: true };
    }
  };
};

const createMockTokenService = () => ({
  createSessionToken: (teamId: string) => `session-${teamId}`,
  validateSessionToken: (token: string) => {
    if (!token?.startsWith('session-')) return null;
    return { teamId: token.slice('session-'.length), visitorId: null };
  },
  invalidateSessionToken: () => {},
  createInviteCredential: (teamId: string, epoch: number) => `invite-${teamId}-${epoch}`,
  validateInviteCredential: () => null,
  validateSuperAdminAuth: () => false
});

const buildTeamApp = (seed: Team[] = []) => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dataStore = createMockDataStore(seed);
  const tokenService = createMockTokenService();
  const teamService = createTeamService({ dataStore, tokenService });

  registerTeamRoutes({
    app,
    dataStore,
    teamService,
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: () => {} },
    escapeHtml: (s: string) => s
  });

  return { app, dataStore };
};

describe('H39 — POST /api/team/create enforces the minimum', () => {
  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password and writes nothing`, async () => {
    const { app, dataStore } = buildTeamApp();

    const response = await request(app, '/api/team/create', postJson({
      name: 'Platform Team',
      password: TOO_SHORT
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'password_too_short' });
    // The refusal must land before the store is touched: a team half-created
    // by a rejected request is the H24 ghost-index state.
    expect(dataStore.teams.size).toBe(0);
  });

  it(`accepts a ${PASSWORD_MIN_LENGTH}-character password`, async () => {
    const { app, dataStore } = buildTeamApp();

    const response = await request(app, '/api/team/create', postJson({
      name: 'Platform Team',
      password: LONG_ENOUGH
    }));

    expect(response.status).toBe(201);
    expect(dataStore.teams.size).toBe(1);
  });
});

describe('H39 — POST /api/team/:teamId/password enforces the minimum', () => {
  const seedTeam = async (): Promise<Team> => ({
    id: 'team-1',
    name: 'Platform Team',
    passwordHash: await hashPassword(LEGACY_SHORT_PASSWORD)
  });

  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character new password and leaves the old one working`, async () => {
    const { app, dataStore } = buildTeamApp([await seedTeam()]);
    const before = dataStore.teams.get('team-1')!.passwordHash;

    const response = await request(app, '/api/team/team-1/password', postJson({
      password: LEGACY_SHORT_PASSWORD,
      newPassword: TOO_SHORT
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'password_too_short' });
    expect(dataStore.teams.get('team-1')!.passwordHash).toBe(before);
  });

  it(`accepts a ${PASSWORD_MIN_LENGTH}-character new password`, async () => {
    const { app, dataStore } = buildTeamApp([await seedTeam()]);

    const response = await request(app, '/api/team/team-1/password', postJson({
      password: LEGACY_SHORT_PASSWORD,
      newPassword: LONG_ENOUGH
    }));

    expect(response.status).toBe(200);
    await expect(
      verifyPassword(LONG_ENOUGH, dataStore.teams.get('team-1')!.passwordHash as string)
    ).resolves.toBe(true);
  });

  it('refuses the short password before checking the current credential is right', async () => {
    // Ordering matters for the same reason it does on the mail routes
    // (invariant 17): the 400 must not depend on the caller getting the
    // *current* password right, or the response distinguishes "your current
    // password is wrong" from "your new one is short" for an anonymous caller.
    // A wrong current credential is still a 401 — the policy check must not
    // turn an unauthenticated attempt into a 400 either.
    const { app } = buildTeamApp([await seedTeam()]);

    const response = await request(app, '/api/team/team-1/password', postJson({
      password: 'definitely-not-the-password',
      newPassword: TOO_SHORT
    }));

    expect(response.status).toBe(401);
  });
});

// --------------------------------------------------------------------------
// Password reset: /api/password-reset/confirm
// --------------------------------------------------------------------------

const resetToken = (seed: string): string =>
  Buffer.from(seed, 'utf8').toString('hex').padEnd(64, '0').slice(0, 64);

const LIVE_TOKEN = resetToken('live-token');
const HOUR = 60 * 60 * 1000;

const buildResetApp = () => {
  const app = express();
  app.use(express.json());

  const teamsById = new Map<string, Record<string, unknown>>([
    ['team-1', { id: 'team-1', name: 'Platform Team', passwordHash: 'old-hash', inviteEpoch: 1 }]
  ]);
  const meta = {
    resetTokens: [
      { tokenHash: hashResetToken(LIVE_TOKEN), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() + HOUR }
    ]
  };

  const dataStore = {
    teamsById,
    loadTeamIndex: vi.fn(async () => new Map([['platform team', 'team-1']])),
    loadTeam: vi.fn(async (teamId: string) => {
      const team = teamsById.get(teamId);
      return team ? { ...team } : null;
    }),
    loadMetaData: vi.fn(async () => ({ resetTokens: [...meta.resetTokens] })),
    atomicMetaUpdate: vi.fn(async (updater: (m: typeof meta) => typeof meta | null) => {
      const updated = updater(JSON.parse(JSON.stringify(meta)));
      if (updated) Object.assign(meta, updated);
      return { success: true };
    }),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (t: Record<string, unknown>) => unknown) => {
      const team = teamsById.get(teamId);
      if (!team) return { success: false, error: 'team_not_found' };
      const updated = updater({ ...team }) as Record<string, unknown> | null;
      if (updated) teamsById.set(teamId, updated);
      return { success: true, team: updated };
    })
  };

  registerPasswordResetRoutes({
    app,
    dataStore,
    mailerService: { smtpEnabled: true, mailer: { sendMail: vi.fn(async () => undefined) } },
    escapeHtml: (v: string) => v,
    sanitizeEmailLink: (v: string) => v,
    hashResetToken,
    pruneResetTokens,
    publicOrigin: createPublicOriginResolver({ env: { PUBLIC_BASE_URL: 'https://retro.example.test/' } })
  });

  return { app, dataStore, teamsById };
};

describe('H39 — POST /api/password-reset/confirm enforces the minimum', () => {
  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password without consuming the token`, async () => {
    const { app, dataStore } = buildResetApp();

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: LIVE_TOKEN,
      newPassword: TOO_SHORT
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'password_too_short' });
    // A refused password must leave the reset token usable — burning it would
    // make the user request a second mail to learn the rule.
    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
  });

  it(`accepts a ${PASSWORD_MIN_LENGTH}-character password`, async () => {
    const { app, teamsById } = buildResetApp();

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: LIVE_TOKEN,
      newPassword: LONG_ENOUGH
    }));

    expect(response.status).toBe(200);
    await expect(
      verifyPassword(LONG_ENOUGH, teamsById.get('team-1')!.passwordHash as string)
    ).resolves.toBe(true);
  });
});

// --------------------------------------------------------------------------
// Super admin: /api/super-admin/update-password
// --------------------------------------------------------------------------

const SUPER_ADMIN_TOKEN = 'super-admin-token';

const buildSuperAdminApp = () => {
  const app = express();
  app.use(express.json());

  const teamsById = new Map<string, Record<string, unknown>>([
    ['team-1', { id: 'team-1', name: 'Platform Team', passwordHash: 'old-hash', inviteEpoch: 1 }]
  ]);

  const dataStore = {
    teamsById,
    loadTeam: vi.fn(async (teamId: string) => teamsById.get(teamId) ?? null),
    loadAllTeams: vi.fn(async () => Array.from(teamsById.values())),
    loadTeamIndex: vi.fn(async () => new Map([['platform team', 'team-1']])),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (t: Record<string, unknown>) => unknown) => {
      const team = teamsById.get(teamId);
      if (!team) return { success: false, error: 'team_not_found' };
      const updated = updater({ ...team }) as Record<string, unknown> | null;
      if (updated) teamsById.set(teamId, updated);
      return { success: true, team: updated };
    })
  };

  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: vi.fn(async () => []), serverSideEmit: vi.fn() },
    dataStore,
    tokenService: {
      validateSuperAdminAuth: (body: Record<string, unknown>) =>
        body?.sessionToken === SUPER_ADMIN_TOKEN
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
    escapeHtml: (v: string) => String(v ?? ''),
    superAdminPassword: 'admin-password',
    sessionCache: new Map(),
    backupService: {},
    aiService: {},
    serverRuntime: { multiPodAdapter: false }
  });

  return { app, teamsById };
};

describe('H39 — POST /api/super-admin/update-password enforces the minimum', () => {
  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password`, async () => {
    const { app, teamsById } = buildSuperAdminApp();

    const response = await request(app, '/api/super-admin/update-password', postJson({
      sessionToken: SUPER_ADMIN_TOKEN,
      teamId: 'team-1',
      newPassword: TOO_SHORT
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'password_too_short' });
    expect(teamsById.get('team-1')!.passwordHash).toBe('old-hash');
  });

  it(`accepts a ${PASSWORD_MIN_LENGTH}-character password`, async () => {
    const { app, teamsById } = buildSuperAdminApp();

    const response = await request(app, '/api/super-admin/update-password', postJson({
      sessionToken: SUPER_ADMIN_TOKEN,
      teamId: 'team-1',
      newPassword: LONG_ENOUGH
    }));

    expect(response.status).toBe(200);
    await expect(
      verifyPassword(LONG_ENOUGH, teamsById.get('team-1')!.passwordHash as string)
    ).resolves.toBe(true);
  });

  it('refuses the short password only after the super-admin credential is checked', async () => {
    // Same ordering rule as everywhere else: an unauthenticated caller must not
    // be able to tell a short password from a long one, or the route becomes a
    // free oracle for the policy on an endpoint that needs no credential to
    // probe.
    const { app } = buildSuperAdminApp();

    const response = await request(app, '/api/super-admin/update-password', postJson({
      sessionToken: 'wrong-token',
      teamId: 'team-1',
      newPassword: TOO_SHORT
    }));

    expect(response.status).toBe(401);
  });
});

// --------------------------------------------------------------------------
// The guard that matters most: the rule binds on write, never on verify.
// --------------------------------------------------------------------------

describe('H39 — a password shorter than the minimum still authenticates', () => {
  let team: Team;

  beforeEach(async () => {
    team = {
      id: 'team-1',
      name: 'Platform Team',
      passwordHash: await hashPassword(LEGACY_SHORT_PASSWORD)
    };
  });

  it('lets a team created before the rule log in with its short password', async () => {
    const { app } = buildTeamApp([team]);

    const response = await request(app, '/api/team/login', postJson({
      teamName: 'Platform Team',
      password: LEGACY_SHORT_PASSWORD
    }));

    // If this ever fails, the minimum has been wired into the *verify* path and
    // every team whose password predates H39 is locked out of its own history.
    expect(response.status).toBe(200);
  });

  it('lets that team read its own record with the short password', async () => {
    const { app } = buildTeamApp([team]);

    const response = await request(app, '/api/team/team-1', postJson({
      password: LEGACY_SHORT_PASSWORD
    }));

    expect(response.status).toBe(200);
  });

  it('lets that team rotate its short password to a compliant one', async () => {
    // The escape hatch has to work, or "leave existing passwords alone"
    // (decision D18 option (a)) becomes "they can never comply".
    const { app, dataStore } = buildTeamApp([team]);

    const response = await request(app, '/api/team/team-1/password', postJson({
      password: LEGACY_SHORT_PASSWORD,
      newPassword: LONG_ENOUGH
    }));

    expect(response.status).toBe(200);
    await expect(
      verifyPassword(LONG_ENOUGH, dataStore.teams.get('team-1')!.passwordHash as string)
    ).resolves.toBe(true);
  });
});
