import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * The feedback routes cut what they store — a title at 100 characters, a
 * description at 2000, a comment at 1000 — and the cut was `slice`, which
 * counts UTF-16 code units: an emoji whose first half sat at the last place
 * kept was stored as that half alone. The feedback lives in the team record,
 * where Node writes a lone surrogate as the escape `\ud83d`, which
 * PostgreSQL's `::jsonb` refuses — and one such row fails every read that
 * projects the record there (the login picker for every team, the feedback
 * board, the summary a socket join reads the joiner's role from). The cuts now
 * go through `cutCodeUnits` (utils/textCut.js): same limits, never half a pair.
 */

const VALID_TOKEN = 'super-admin-token';
// A lone surrogate: in `u` mode a paired one is one code point, not `Cs`.
const LONE_SURROGATE = /\p{Cs}/u;

type Json = Record<string, any>;

const createStore = () => {
  const teams = new Map<string, Json>([
    ['team-1', { id: 'team-1', name: 'Team One', facilitatorEmail: 'one@example.org', teamFeedbacks: [] }]
  ]);
  return {
    teams,
    loadTeam: vi.fn(async (teamId: string) => structuredClone(teams.get(teamId) ?? null)),
    loadGlobalSettings: vi.fn(async () => ({})),
    atomicMetaUpdate: vi.fn(async () => ({ success: true })),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (team: Json) => Json | null) => {
      const stored = teams.get(teamId);
      if (!stored) return { success: false, error: 'team_not_found' };
      const next = updater(structuredClone(stored));
      if (next) teams.set(teamId, structuredClone(next));
      return { success: true, team: next ?? stored };
    })
  };
};

const buildApp = () => {
  const dataStore = createStore();
  const app = express();
  app.use(express.json());
  registerFeedbackRoutes({
    app,
    dataStore,
    teamService: {
      authenticateTeam: vi.fn(async (teamId: string) => ({ team: dataStore.teams.get(teamId) ?? null, error: null }))
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => String(value ?? '')
  });
  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: async () => [], serverSideEmit: vi.fn() },
    dataStore,
    tokenService: {
      validateSuperAdminAuth: vi.fn((body?: { sessionToken?: string }) => body?.sessionToken === VALID_TOKEN),
      createSuperAdminToken: vi.fn(() => VALID_TOKEN),
      validateSuperAdminToken: vi.fn((token: string) => token === VALID_TOKEN)
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: 'super-secret',
    sessionCache: { clear: vi.fn(), delete: vi.fn(), get: vi.fn(), set: vi.fn() },
    backupService: {},
    aiService: {},
    serverRuntime: { multiPodAdapter: false }
  });
  return { app, dataStore };
};

const storedFeedbacks = (dataStore: ReturnType<typeof createStore>) => dataStore.teams.get('team-1')!.teamFeedbacks as Json[];

const seedFeedback = (dataStore: ReturnType<typeof createStore>) => {
  dataStore.teams.get('team-1')!.teamFeedbacks = [
    { id: 'fb-1', teamId: 'team-1', teamName: 'Team One', type: 'bug', title: 'Broken', description: 'It breaks.', status: 'pending', comments: [] }
  ];
};

describe('stored text is cut without halving an emoji', () => {
  it('cuts a feedback title at 100 and its description at 2000', async () => {
    const { app, dataStore } = buildApp();
    const res = await request(app, '/api/feedbacks/create', postJson({
      teamId: 'team-1',
      sessionToken: 'token',
      feedback: {
        type: 'bug',
        title: `${'a'.repeat(99)}😀 and more`,
        description: `${'b'.repeat(1999)}😀 and more`,
        submittedBy: 'u1',
        submittedByName: 'Ann'
      }
    }));

    expect(res.status).toBe(200);
    const [stored] = storedFeedbacks(dataStore);
    expect(stored.title).toBe('a'.repeat(99));
    expect(stored.description).toBe('b'.repeat(1999));
    expect(LONE_SURROGATE.test(`${stored.title}${stored.description}`)).toBe(false);
  });

  it('keeps an emoji a cut does not split', async () => {
    const { app, dataStore } = buildApp();
    await request(app, '/api/feedbacks/create', postJson({
      teamId: 'team-1',
      sessionToken: 'token',
      feedback: { type: 'idea', title: `${'a'.repeat(98)}😀 and more`, description: 'Fine.', submittedBy: 'u1', submittedByName: 'Ann' }
    }));
    expect(storedFeedbacks(dataStore)[0].title).toBe(`${'a'.repeat(98)}😀`);
  });

  it('cuts a team comment at 1000', async () => {
    const { app, dataStore } = buildApp();
    seedFeedback(dataStore);
    const res = await request(app, '/api/feedbacks/comment', postJson({
      teamId: 'team-1',
      sessionToken: 'token',
      feedbackTeamId: 'team-1',
      feedbackId: 'fb-1',
      authorId: 'u1',
      authorName: 'Ann',
      content: `${'c'.repeat(999)}😀 and more`
    }));

    expect(res.status).toBe(200);
    expect(storedFeedbacks(dataStore)[0].comments[0].content).toBe('c'.repeat(999));
  });

  it('cuts a super-admin comment at 1000', async () => {
    const { app, dataStore } = buildApp();
    seedFeedback(dataStore);
    const res = await request(app, '/api/super-admin/feedbacks/comment', postJson({
      sessionToken: VALID_TOKEN,
      teamId: 'team-1',
      feedbackId: 'fb-1',
      content: `${'e'.repeat(999)}😀 and more`
    }));

    expect(res.status).toBe(200);
    expect(storedFeedbacks(dataStore)[0].comments[0].content).toBe('e'.repeat(999));
  });
});
