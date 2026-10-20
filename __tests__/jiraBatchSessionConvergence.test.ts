// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { createTeamService } from '../server/services/teamService.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { request as outboundRequest } from '../server/services/outboundHttp.js';
import { createLiveSessionPatch } from '../server/services/liveSessionRename.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import {
  mergeRemoteRetroSession,
  registerOwnRetroChanges,
  type OwnChangeLedger,
  type PendingCreation
} from '../components/session/mergeRemoteSession';
import type { RetroSession } from '../types';
import { JIRA_MOCK_PAT, startJiraMock, type JiraMock } from './helpers/jiraMock';

// The facilitator types the review summary while a Jira batch runs (A-4).
//
// The batch stamps the created keys into the live session so every
// participant sees them, and every such write moves the session's revision.
// The facilitator's keystrokes are writes too, each stamped with the revision
// the facilitator's screen was built on: one that left the browser just
// before the batch's write arrived is refused as stale and healed with the
// server's state — and the review summary is facilitator content the merge
// does not re-apply, so that character is gone. One patch per created issue
// meant one such window per issue, spread over the whole time Jira worked;
// the batch now patches each session once, after its last call.
//
// Once is not never, and this test pins what happens rather than leave it
// out: the keystroke that leaves just after the single patch was built on the
// revision before it, is refused as stale and is healed away, since the merge
// re-applies none of the facilitator's own `reviewSummary`. One character per
// touched session per request is still lost, where it used to be one per
// issue. That falls short of A-4 ("a summary typed during a batch loses no
// character"), and the server cannot close it alone: the remedy is on the
// client, where the facilitator would claim `reviewSummary` in the own-change
// ledger and re-assert it over a heal, as `columnOrder` does. Until that
// lands, the assertion below is the observed outcome, so the day it does this
// test fails and becomes `toBe(SUMMARY)`.
//
// This drives the real loop with the real pieces: the route and its claims,
// the Jira mock, the session compare-and-swap of the data store, the live
// session patch, and the client's own merge and own-change ledger
// (`components/session/mergeRemoteSession.ts`). Like
// `twoBrowserSessionConvergence.test.ts`, the network is modelled rather than
// timed, so the run is deterministic: a keystroke goes to the server as soon
// as it is typed, and anything the server broadcasts reaches the facilitator
// only after their next keystroke has left — the worst case for every write
// the batch makes while they type, the last one included. The facilitator's
// write goes straight to `saveSessionState`, which is what `update-session`
// does with it once the guard has let a facilitator's summary through.

const TEAM_ID = 'jira-convergence-team';
const RETRO_ID = 'retro-converging';
const FACILITATOR = 'm1';
const ACTION_IDS = ['a1', 'a2', 'a3', 'a4', 'a5'];
const SUMMARY = 'We ship smaller, twice a week.';

const PG_ENV_KEYS = [
  'DATABASE_URL', 'POSTGRES_HOST', 'POSTGRESQL_SERVICE_HOST', 'POSTGRES_USER', 'POSTGRESQL_USER',
  'POSTGRES_PASSWORD', 'POSTGRESQL_PASSWORD', 'POSTGRES_DB', 'POSTGRESQL_DATABASE', 'DATA_STORE_PATH',
  'SESSION_TOKEN_SECRET'
];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const action = (id: string) => ({ id, text: `Action ${id}`, assigneeId: null, done: false, type: 'new' as const, proposalVotes: {} });

const retroSession = (): RetroSession => ({
  id: RETRO_ID,
  teamId: TEAM_ID,
  name: 'Sprint 13',
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  participants: [{ id: FACILITATOR, name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
  icebreakerQuestion: 'q',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 3,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: ACTION_IDS.map(action),
  happiness: {},
  roti: {},
  finishedUsers: [],
  reviewSummary: ''
} as RetroSession);

describe('a Jira batch while the facilitator types the review summary', () => {
  let dir: string;
  let store: ReturnType<typeof createDataStore>;
  let jira: JiraMock;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-jira-convergence-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    store = createDataStore({ rootDir: dir });
    await store.initDatabase();
    jira = await startJiraMock({ contextPath: '/jira', deployment: 'Server' });
  });

  afterAll(async () => {
    await jira.close();
    await store.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loses no character typed while Jira works, and only the one racing the single patch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initial = retroSession();
    await store.saveTeam(TEAM_ID, {
      id: TEAM_ID,
      name: 'Converging Team',
      passwordHash: await hashPassword('team-password-converging'),
      members: initial.participants,
      globalActions: [],
      retrospectives: [{ ...clone(initial), actions: ACTION_IDS.map(action) }],
      healthChecks: []
    });
    await store.saveJiraSettings({ enabled: true, baseUrl: jira.url, allowSelfSignedCerts: false });
    const seeded = await store.saveSessionState(RETRO_ID, { ...clone(initial), _rev: 0 });
    expect(seeded.success).toBe(true);

    // --- The facilitator's browser: syncService + the session component. ---
    const ownChanges: OwnChangeLedger = new Map();
    const pendingCreations = new Map<string, PendingCreation>();
    let screen: RetroSession = clone(seeded.data) as RetroSession;
    // Broadcasts on their way to this browser.
    const inbox: RetroSession[] = [];

    const receive = async (incoming: RetroSession) => {
      const { merged, divergent } = mergeRemoteRetroSession(
        clone(incoming),
        screen,
        { currentUserId: FACILITATOR, preserveIcebreaker: false, editingTicketId: null, editingGroupId: null, ownChanges },
        pendingCreations
      );
      screen = merged;
      if (divergent) await send(merged);
    };
    // update-session: stamped with the revision the blob was built on. An
    // accepted write is acked and the acked blob is synthesized back; a stale
    // one is healed with the server's state.
    const send = async (blob: RetroSession): Promise<void> => {
      const stamped = clone(blob);
      const result = await store.saveSessionState(RETRO_ID, stamped);
      if (result.success) await receive({ ...stamped, _rev: result.data._rev } as RetroSession);
      else await receive(result.data as RetroSession);
    };
    const type = async (character: string) => {
      const before = screen;
      const after = clone(before);
      after.reviewSummary = `${after.reviewSummary ?? ''}${character}`;
      registerOwnRetroChanges(ownChanges, before, after, FACILITATOR);
      screen = after;
      await send(after);
    };
    const deliver = async () => {
      while (inbox.length > 0) await receive(inbox.shift()!);
    };

    // --- The server. ---
    const patchWrites = vi.fn(store.saveSessionState);
    const patchStore = { ...store, saveSessionState: patchWrites };
    const io = { to: () => ({ emit: (_event: string, data: RetroSession) => { inbox.push(clone(data)); } }) };
    const tokenService = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: undefined, tokenSecret: 'jira-convergence-secret' });
    const teamService = createTeamService({ dataStore: store, tokenService });

    const characters = [...SUMMARY];
    let typed = 0;
    // A keystroke as each issue is sent to Jira: the batch is running, and
    // anything it broadcast so far is still on its way to the facilitator.
    const transport = async (options: { url: string; method: string }) => {
      if (options.method === 'POST' && options.url.endsWith('/rest/api/2/issue')) {
        for (let i = 0; i < 3; i += 1) await type(characters[typed++]);
        await deliver();
      }
      return outboundRequest(options);
    };

    const app = express();
    app.use(express.json());
    registerTeamRoutes({
      app,
      dataStore: store,
      teamService,
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: vi.fn() },
      escapeHtml: (value: string) => value,
      liveSessionPatch: createLiveSessionPatch({ dataStore: patchStore, sessionCache: new Map(), io }),
      jiraClientOptions: { request: transport, timeoutMs: 1000, deadlineMs: 2000 }
    });
    const listening = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listening.once('listening', resolve));
    const base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    const post = async (path: string, body: object) => (await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: tokenService.createSessionToken(TEAM_ID, null), ...body })
    })).json();

    try {
      await post(`/api/team/${TEAM_ID}/jira/token`, { token: JIRA_MOCK_PAT });
      await post(`/api/team/${TEAM_ID}/jira/target`, { target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: [] } });

      const answer = await post(`/api/team/${TEAM_ID}/jira/issues`, { actionIds: ACTION_IDS, sessionId: RETRO_ID });
      expect(answer.results.map((result: { status: string }) => result.status)).toEqual(ACTION_IDS.map(() => 'created'));
      // Fifteen characters were typed while Jira worked.
      expect(typed).toBe(15);

      // The batch's one write is on its way when the next keystroke leaves:
      // that keystroke was built on the revision before the patch.
      const racing = typed;
      while (typed < characters.length) {
        await type(characters[typed++]);
        await deliver();
      }

      const server = (await store.loadSessionState(RETRO_ID)) as RetroSession;
      // Everything typed while Jira worked is there; of what followed, the
      // keystroke that raced the patch is missing (the A-4 residual above).
      expect(server.reviewSummary).toBe(SUMMARY.slice(0, racing) + SUMMARY.slice(racing + 1));
      expect(screen.reviewSummary).toBe(server.reviewSummary);
      expect(patchWrites).toHaveBeenCalledTimes(1);
      // And every key is on the facilitator's screen.
      expect(screen.actions.map((entry) => entry.jira && 'key' in entry.jira ? entry.jira.key : null))
        .toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3', 'PROJ-4', 'PROJ-5']);
      expect(server.actions.map((entry) => entry.jira && 'key' in entry.jira ? entry.jira.key : null))
        .toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3', 'PROJ-4', 'PROJ-5']);
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      vi.restoreAllMocks();
    }
  });
});
