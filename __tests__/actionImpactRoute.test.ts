import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * The concurrency contract for impact ratings.
 *
 * `impactRatings` is the first per-user data stored on the team record, and the
 * record's main write path (`POST /api/team/:teamId/action`) replaces the whole
 * action. With one writer that was harmless; with one writer per participant it
 * means the last request wins and everybody else's vote disappears.
 *
 * Two defences, both pinned here:
 *  - `POST /api/team/:teamId/action/impact` writes a single
 *    `impactRatings[userId]` key inside `atomicTeamUpdate`, so two voters never
 *    contend for the same key;
 *  - every other write path merges rather than replaces, so a client holding a
 *    stale copy cannot drop a vote it never read.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();

  const atomicTeamUpdate = async (
    teamId: string,
    updater: (team: Team) => Team | null
  ): Promise<{ success: boolean; team?: Team; error?: string }> => {
    const existing = teams.get(teamId);
    if (!existing) return { success: false, error: 'team_not_found' };
    // structuredClone on the way in and out is what makes this a real
    // serialisation point: an updater cannot accidentally share a reference
    // with the store, so a lost write shows up as a lost write.
    const updated = updater(structuredClone(existing));
    if (!updated) return { success: true, team: existing };
    teams.set(teamId, structuredClone(updated));
    return { success: true, team: updated };
  };

  return {
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    loadTeamRaw: async (teamId: string) => teams.get(teamId) || null,
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
    atomicTeamIndexUpdate: async (updater: (index: Map<string, string>) => Map<string, string> | null) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
    },
    loadMetaData: async () => ({ resetTokens: [], orphanedFeedbacks: [] }),
    atomicMetaUpdate: async (
      updater: (meta: { resetTokens: unknown[]; orphanedFeedbacks: unknown[] }) => unknown
    ) => {
      const meta = { resetTokens: [], orphanedFeedbacks: [] };
      updater(meta);
      return meta;
    },
    loadGlobalSettings: async () => ({}),
    _teams: teams
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

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dataStore = createMockDataStore();
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

describe('/api/team/:teamId/action/impact', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const closedAction = (id: string) => ({
    id,
    text: 'Ship it',
    assigneeId: null,
    done: true,
    type: 'new',
    proposalVotes: {},
    closedAt: '2026-05-01T00:00:00.000Z'
  });

  const setup = async () => {
    const res = await post('/api/team/create', {
      name: 'Impact Team',
      password: 'password123456',
      facilitatorEmail: 'fac@example.com'
    });
    const created = await res.json();
    expect(res.status, JSON.stringify(created)).toBe(201);
    const { team, sessionToken } = created;

    // A dashboard action, a retro action and a health-check action: the route
    // must find all three, since any of them can end up in a rating round.
    await post(`/api/team/${team.id}/action`, { sessionToken, action: closedAction('global-1') });
    await post(`/api/team/${team.id}/retrospective/r1`, {
      sessionToken,
      retrospective: {
        id: 'r1', teamId: team.id, name: 'Sprint 1', date: '5/1/2026',
        status: 'CLOSED', phase: 'CLOSE', columns: [], tickets: [], groups: [],
        actions: [closedAction('retro-1')], happiness: {}, roti: {}, finishedUsers: [], _rev: 1
      }
    });
    await post(`/api/team/${team.id}/healthcheck/hc1`, {
      sessionToken,
      healthCheck: {
        id: 'hc1', teamId: team.id, name: 'HC', date: '5/2/2026', status: 'CLOSED',
        phase: 'CLOSE', templateId: 't', dimensions: [], ratings: {}, actions: [closedAction('hc-1')],
        roti: {}, finishedUsers: [], _rev: 1
      }
    });

    return { teamId: team.id, sessionToken };
  };

  const stored = (teamId: string, actionId: string) => {
    const team = dataStore._teams.get(teamId) as never as {
      globalActions: { id: string }[];
      retrospectives: { actions: { id: string }[] }[];
      healthChecks?: { actions: { id: string }[] }[];
    };
    const all = [
      ...(team.globalActions ?? []),
      ...(team.retrospectives ?? []).flatMap((r) => r.actions ?? []),
      ...(team.healthChecks ?? []).flatMap((h) => h.actions ?? [])
    ];
    return all.find((a) => a.id === actionId) as never as {
      impactRatings?: Record<string, unknown>;
      closedAt?: string;
      impactDeferredBy?: string;
      done: boolean;
    };
  };

  it('stores one participant vote under their own key', async () => {
    const { teamId, sessionToken } = await setup();

    const res = await post(`/api/team/${teamId}/action/impact`, {
      sessionToken, actionId: 'global-1', userId: 'alice', vote: 3
    });

    expect(res.status).toBe(200);
    expect(stored(teamId, 'global-1').impactRatings).toEqual({ alice: 3 });
    await close();
  });

  // The reason this route exists at all.
  it('keeps both votes when two participants rate the same action at once', async () => {
    const { teamId, sessionToken } = await setup();

    await Promise.all([
      post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'global-1', userId: 'alice', vote: 3 }),
      post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'global-1', userId: 'bob', vote: 1 })
    ]);

    expect(stored(teamId, 'global-1').impactRatings).toEqual({ alice: 3, bob: 1 });
    await close();
  });

  it('records an abstention as a cast vote', async () => {
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/action/impact`, {
      sessionToken, actionId: 'global-1', userId: 'alice', vote: 'abstain'
    });

    expect(stored(teamId, 'global-1').impactRatings).toEqual({ alice: 'abstain' });
    await close();
  });

  it('clears only the caller vote when the vote is null', async () => {
    const { teamId, sessionToken } = await setup();
    await post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'global-1', userId: 'alice', vote: 2 });
    await post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'global-1', userId: 'bob', vote: 2 });

    await post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'global-1', userId: 'alice', vote: null });

    expect(stored(teamId, 'global-1').impactRatings).toEqual({ bob: 2 });
    await close();
  });

  it('finds the action in a retrospective and in a health check', async () => {
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'retro-1', userId: 'alice', vote: 2 });
    await post(`/api/team/${teamId}/action/impact`, { sessionToken, actionId: 'hc-1', userId: 'alice', vote: 1 });

    expect(stored(teamId, 'retro-1').impactRatings).toEqual({ alice: 2 });
    expect(stored(teamId, 'hc-1').impactRatings).toEqual({ alice: 1 });
    await close();
  });

  it('answers 404 for an action that does not exist', async () => {
    const { teamId, sessionToken } = await setup();

    const res = await post(`/api/team/${teamId}/action/impact`, {
      sessionToken, actionId: 'nope', userId: 'alice', vote: 1
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('action_not_found');
    await close();
  });

  it('refuses a vote off the scale rather than coercing it', async () => {
    const { teamId, sessionToken } = await setup();

    for (const vote of [0, 4, '2', 2.5, true]) {
      const res = await post(`/api/team/${teamId}/action/impact`, {
        sessionToken, actionId: 'global-1', userId: 'alice', vote
      });
      expect(res.status, `vote ${JSON.stringify(vote)}`).toBe(400);
      expect((await res.json()).error).toBe('invalid_vote');
    }

    expect(stored(teamId, 'global-1').impactRatings).toBeUndefined();
    await close();
  });

  it('refuses a request with no user to attribute the vote to', async () => {
    const { teamId, sessionToken } = await setup();

    const res = await post(`/api/team/${teamId}/action/impact`, {
      sessionToken, actionId: 'global-1', vote: 1
    });

    expect(res.status).toBe(400);
    await close();
  });

  it('refuses an unauthenticated caller', async () => {
    const { teamId } = await setup();

    const res = await post(`/api/team/${teamId}/action/impact`, {
      actionId: 'global-1', userId: 'alice', vote: 1
    });

    expect(res.status).toBe(401);
    await close();
  });
});

describe('/api/team/:teamId/action additive write', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const setup = async () => {
    const res = await post('/api/team/create', {
      name: 'Additive Team', password: 'password123456', facilitatorEmail: 'f@example.com'
    });
    const { team, sessionToken } = await res.json();
    await post(`/api/team/${team.id}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Ship it', assigneeId: null, done: true,
        type: 'new', proposalVotes: {}, closedAt: '2026-05-01T00:00:00.000Z'
      }
    });
    await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', userId: 'alice', vote: 3
    });
    return { teamId: team.id, sessionToken };
  };

  const storedAction = (teamId: string) =>
    (dataStore._teams.get(teamId) as never as { globalActions: Record<string, unknown>[] }).globalActions[0];

  // A facilitator renaming an action from a client that loaded the board before
  // anyone voted would otherwise wipe the round.
  it('keeps existing votes when a client writes the whole action without them', async () => {
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Ship it, renamed', assigneeId: null, done: true,
        type: 'new', proposalVotes: {}, closedAt: '2026-05-01T00:00:00.000Z'
      }
    });

    expect(storedAction(teamId).text).toBe('Ship it, renamed');
    expect(storedAction(teamId).impactRatings).toEqual({ alice: 3 });
    await close();
  });

  it('keeps closedAt when a whole-action write omits it', async () => {
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      action: { id: 'a1', text: 'Ship it', assigneeId: 'bob', done: true, type: 'new', proposalVotes: {} }
    });

    expect(storedAction(teamId).closedAt).toBe('2026-05-01T00:00:00.000Z');
    await close();
  });

  it('stamps closedAt when the whole-action write is what closes it', async () => {
    const res = await post('/api/team/create', {
      name: 'Stamp Team', password: 'password123456', facilitatorEmail: 'f@example.com'
    });
    const { team, sessionToken } = await res.json();
    await post(`/api/team/${team.id}/action`, {
      sessionToken,
      action: { id: 'b1', text: 'Open', assigneeId: null, done: false, type: 'new', proposalVotes: {} }
    });

    await post(`/api/team/${team.id}/action`, {
      sessionToken,
      action: { id: 'b1', text: 'Open', assigneeId: null, done: true, type: 'new', proposalVotes: {} }
    });

    const action = (dataStore._teams.get(team.id) as never as { globalActions: Record<string, unknown>[] })
      .globalActions[0];
    expect(action.closedAt).toBeTruthy();
    await close();
  });

  it('drops closedAt when the action is genuinely re-opened', async () => {
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      action: { id: 'a1', text: 'Ship it', assigneeId: null, done: false, type: 'new', proposalVotes: {} }
    });

    expect(storedAction(teamId).closedAt).toBeUndefined();
    expect(storedAction(teamId).impactRatings).toEqual({ alice: 3 });
    await close();
  });

  it('preserves the deferral marker a whole-action write omits', async () => {
    const { teamId, sessionToken } = await setup();
    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Ship it', assigneeId: null, done: true, type: 'new',
        proposalVotes: {}, closedAt: '2026-05-01T00:00:00.000Z', impactDeferredBy: 'r7'
      }
    });

    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Ship it', assigneeId: null, done: true, type: 'new',
        proposalVotes: {}, closedAt: '2026-05-01T00:00:00.000Z'
      }
    });

    expect(storedAction(teamId).impactDeferredBy).toBe('r7');
    await close();
  });
});

// CodeQL js/remote-property-injection (alerts 236/237 on PR #460): the vote is
// stored under an id the caller supplies, so a request naming `__proto__` would
// have changed the map's prototype instead of recording a vote.
describe('/api/team/:teamId/action/impact - key safety', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const setup = async () => {
    const res = await post('/api/team/create', {
      name: 'Key Safety Team', password: 'password123456', facilitatorEmail: 'f@example.com'
    });
    const { team, sessionToken } = await res.json();
    await post(`/api/team/${team.id}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Ship it', assigneeId: null, done: true,
        type: 'new', proposalVotes: {}, closedAt: '2026-05-01T00:00:00.000Z'
      }
    });
    return { teamId: team.id, sessionToken };
  };

  it('refuses a prototype-shaped user id instead of writing it', async () => {
    const { teamId, sessionToken } = await setup();

    for (const userId of ['__proto__', 'constructor', 'prototype']) {
      const res = await post(`/api/team/${teamId}/action/impact`, {
        sessionToken, actionId: 'a1', userId, vote: 3
      });
      expect(res.status, userId).toBe(400);
      expect((await res.json()).error).toBe('invalid_user');
    }

    const stored = (dataStore._teams.get(teamId) as never as {
      globalActions: Record<string, unknown>[];
    }).globalActions[0];
    expect(stored.impactRatings).toBeUndefined();
    // Nothing reached Object.prototype either.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await close();
  });

  it('refuses an unbounded or malformed user id', async () => {
    const { teamId, sessionToken } = await setup();

    for (const userId of ['', 'a'.repeat(65), 'has space', 'x/../y']) {
      const res = await post(`/api/team/${teamId}/action/impact`, {
        sessionToken, actionId: 'a1', userId, vote: 1
      });
      expect(res.status, JSON.stringify(userId)).toBe(400);
    }

    await close();
  });
});

// Codex review finding: the row can still be on a participant's screen after
// the facilitator re-opens the action. Storing the vote then would publish an
// impact score for unfinished work.
describe('/api/team/:teamId/action/impact - target must still be rateable', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  it('refuses a vote on an action that was re-opened', async () => {
    const created = await (await post('/api/team/create', {
      name: 'Reopen Team', password: 'password123456', facilitatorEmail: 'f@example.com'
    })).json();
    const { team, sessionToken } = created;

    await post(`/api/team/${team.id}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Ship it', assigneeId: null, done: false,
        type: 'new', proposalVotes: {}
      }
    });

    const res = await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', userId: 'alice', vote: 3
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('action_not_rateable');

    const stored = (dataStore._teams.get(team.id) as never as {
      globalActions: Record<string, unknown>[];
    }).globalActions[0];
    expect(stored.impactRatings).toBeUndefined();
    await close();
  });
});

// The reset a *later* retrospective performs when it puts a postponed action
// back to the team. It lives on this route because `impactRatings` is owned
// here and nowhere else: the whole-action route deliberately cannot touch the
// field, so a clear written anywhere else would be a second owner.
describe('/api/team/:teamId/action/impact - reset for a re-presented action', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const seedClosedAction = async () => {
    const created = await (await post('/api/team/create', {
      name: `Reset Team ${Math.random().toString(36).slice(2, 8)}`,
      password: 'password123456',
      facilitatorEmail: 'f@example.com'
    })).json();
    const { team, sessionToken } = created;

    await post(`/api/team/${team.id}/action`, {
      sessionToken,
      action: {
        id: 'a1', text: 'Pair on deploys', assigneeId: null, done: true,
        type: 'new', proposalVotes: {}
      }
    });
    return { team, sessionToken };
  };

  const storedAction = (teamId: string) =>
    (dataStore._teams.get(teamId) as never as {
      globalActions: Record<string, unknown>[];
    }).globalActions[0];

  it('drops every vote on the action, not just the caller own', async () => {
    const { team, sessionToken } = await seedClosedAction();
    await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', userId: 'alice', vote: 3
    });
    await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', userId: 'bob', vote: 1
    });
    expect(storedAction(team.id).impactRatings).toEqual({ alice: 3, bob: 1 });

    const res = await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', reset: true
    });

    expect(res.status).toBe(200);
    expect(storedAction(team.id).impactRatings).toBeUndefined();
    await close();
  });

  // Re-presenting an action nobody rated is the ordinary case, not a failure.
  it('succeeds on an action that carries no votes', async () => {
    const { team, sessionToken } = await seedClosedAction();

    const res = await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', reset: true
    });

    expect(res.status).toBe(200);
    expect(storedAction(team.id).impactRatings).toBeUndefined();
    await close();
  });

  // A reset carries no rater and no vote, so the two guards that exist to keep
  // a caller-supplied id out of an object key must not fire on it.
  it('needs neither a user id nor a vote', async () => {
    const { team, sessionToken } = await seedClosedAction();
    await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', userId: 'alice', vote: 2
    });

    const res = await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', reset: true
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    await close();
  });

  it('still answers 404 for an action that matches nothing', async () => {
    const { team, sessionToken } = await seedClosedAction();

    const res = await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'nope', reset: true
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('action_not_found');
    await close();
  });

  it('refuses an anonymous reset, like every other write on this route', async () => {
    const { team } = await seedClosedAction();

    const res = await post(`/api/team/${team.id}/action/impact`, {
      actionId: 'a1', reset: true
    });

    expect(res.status).toBe(401);
    await close();
  });

  // `reset` is a flag, not a truthy value: a client that sends the string "no"
  // must not clear the round.
  it('only resets on a literal true', async () => {
    const { team, sessionToken } = await seedClosedAction();
    await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', userId: 'alice', vote: 3
    });

    const res = await post(`/api/team/${team.id}/action/impact`, {
      sessionToken, actionId: 'a1', reset: 'no'
    });

    expect(res.status).toBe(400);
    expect(storedAction(team.id).impactRatings).toEqual({ alice: 3 });
    await close();
  });
});
