// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { createTeamService } from '../server/services/teamService.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { request as outboundRequest } from '../server/services/outboundHttp.js';
import { createLiveSessionPatch } from '../server/services/liveSessionRename.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { issueFields, jiraParentScope, parentIssueFields } from '../utils/jiraIssueContent.js';
import { jiraIssuePreview, jiraParentPreviews } from '../components/jira/jiraIssuePreview';
import type { ActionItem } from '../types';
import { JIRA_CLAIM_TTL_MS } from '../utils/jira.js';
import { JIRA_MOCK_PAT, startJiraMock, type JiraMock } from './helpers/jiraMock';

/**
 * Creating issues from actions (`POST /api/team/:teamId/jira/issues`,
 * `server/services/jiraIssues.js`), against a real data store (SQLite in a
 * temporary directory, and PostgreSQL for the two-pod race when
 * `TEST_DATABASE_URL` is set), the real Jira client and `helpers/jiraMock`
 * mounted under `/jira`. What is at stake:
 *
 *  - **never twice.** An action is claimed under the team's row lock before
 *    Jira is called, so two pods racing on one action create one issue; an
 *    answer that was lost marks the action uncertain instead of letting the
 *    next click create it again; a claim whose request died does the same;
 *  - **Jira's refusal belongs to its action**, and a 401/403/404/429 or an
 *    unreachable Jira stops the batch with nothing created and the action
 *    back in `remaining`;
 *  - **a request is short**: no creation starts after the time budget (the
 *    first excepted), after the caller left, or while the pod drains;
 *  - **every participant sees the keys**: one patch per live session per
 *    request, the request's own session included, never another team's.
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
  'DATA_STORE_PATH',
  'SESSION_TOKEN_SECRET'
];

const SIGNING_SECRET = 'jira-issues-test-signing-secret';
const TEAM_PASSWORD = 'team-password-jira-issues';
const TARGET = { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: ['retrospective'] };
// One parent issue per session (F2): a Task per retro, health check or the
// dashboard, and each action as its sub-task.
const SESSION_TARGET = { mode: 'sessionParent', projectKey: 'PROJ', parentIssueTypeId: '10001', issueTypeId: '10005', labels: ['retrospective'] };
const RETRO_ID = 'retro-12';
const HC_ID = 'hc-q3';
const RETRO_SCOPE = `retro:${RETRO_ID}`;
const HC_SCOPE = `healthcheck:${HC_ID}`;
const CLOCK_START = Date.parse('2026-10-20T10:00:00.000Z');

type Json = Record<string, any>;
type Store = ReturnType<typeof createDataStore>;
type Answer = { status: number; body: Json };
type CreateCall = { url: string; method: string; body?: string };

const action = (id: string, overrides: Json = {}) => ({
  id,
  text: `Action ${id}`,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const retroActions = (count: number) => Array.from({ length: count }, (_, i) => action(`a${i + 1}`));

const teamRecord = (teamId: string, passwordHash: string, { retro = retroActions(5) as Json[], extra = {} as Json } = {}) => ({
  id: teamId,
  name: `Team ${teamId}`,
  passwordHash,
  members: [{ id: 'm1', name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
  globalActions: [
    action('b1', { text: 'Clean up the backlog' }),
    action('b-done', { done: true }),
    // Also in the retro below: one action, two homes.
    action('shared', { text: 'Pair on deploys' })
  ],
  retrospectives: [{
    id: RETRO_ID,
    teamId,
    name: 'Sprint 12',
    date: '2026-10-06',
    status: 'IN_PROGRESS',
    phase: 'REVIEW',
    templateLanguage: 'en',
    tickets: [{ id: 't1', colId: 'c1', text: 'Deploys are slow', votes: [] }],
    groups: [],
    actions: [
      ...retro,
      action('p1', { type: 'proposal', text: 'A proposal still being voted on' }),
      action('shared', { text: 'Pair on deploys' })
    ]
  }],
  healthChecks: [{
    id: HC_ID,
    teamId,
    name: 'Bilan T3',
    date: '2026-10-01',
    templateId: 'team_health_fr',
    actions: [action('h1', { text: 'Rendre les déploiements sûrs' })]
  }],
  ...extra
});

// Every copy of an action on a record, in every home.
const copiesOf = (team: Json, actionId: string): Json[] => [
  ...(team.globalActions ?? []),
  ...(team.retrospectives ?? []).flatMap((retro: Json) => retro.actions ?? []),
  ...(team.healthChecks ?? []).flatMap((check: Json) => check.actions ?? [])
].filter((entry: Json) => entry.id === actionId && entry.type !== 'proposal');

// A port nothing listens on: bound, then released.
const closedPortBase = async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}/jira`;
};

const isCreate = (options: CreateCall) => options.method === 'POST' && options.url.endsWith('/rest/api/2/issue');

/**
 * One pod: the team routes on `store`, with the batch's clock, budget and
 * shutdown state under the test's control, a live-session patch that records
 * every broadcast, and a Jira transport that lets a test act at the moment a
 * creation is sent.
 */
interface PodControls {
  clockMs: number;
  // Added to the clock as each creation is sent: how long Jira "took".
  msPerCreate: number;
  shuttingDown: boolean;
  // Runs as a creation is sent, before it reaches Jira.
  onCreate: ((call: CreateCall) => Promise<void> | void) | null;
  // Sends creations here instead of the mock (a closed port: nothing listens).
  createBaseUrl: string | null;
  // The same for every other call: the parent read, the token check.
  readBaseUrl: string | null;
  // Fails the n-th team write (1-based, counted from `resetCounts`) before it
  // reaches the store.
  failTeamWrite: (n: number) => boolean;
  // Lets the n-th team write land, then fails it: a COMMIT whose answer was
  // lost on the connection. It runs once the write has landed, so it can also
  // change the record before the retry.
  loseTeamWriteAnswer: (n: number) => boolean | Promise<boolean>;
  teamWrites: number;
  broadcasts: { room: string; event: string; data: Json }[];
}

// One `/jira/issues` request as the server saw it: its connection, and what
// its handler answered — the handler goes on after a caller has gone, so
// this is how a test knows it has finished.
interface IssuesRequest {
  socket: Socket;
  answered: Promise<Json>;
}

const startPod = async ({
  store,
  jira,
  tokenSecret = SIGNING_SECRET,
  jiraIssuesOptions = {} as Json,
  jiraSettings
}: {
  store: Store;
  jira: JiraMock;
  tokenSecret?: string;
  jiraIssuesOptions?: Json;
  // Where the pod keeps the connection settings instead of the store's one
  // global row: a holder pods share stands for that row without writing it.
  jiraSettings?: { value: Json | null };
}) => {
  const controls: PodControls = {
    clockMs: CLOCK_START,
    msPerCreate: 0,
    shuttingDown: false,
    onCreate: null,
    createBaseUrl: null,
    readBaseUrl: null,
    failTeamWrite: () => false,
    loseTeamWriteAnswer: () => false,
    teamWrites: 0,
    broadcasts: []
  };
  const issuesRequests: IssuesRequest[] = [];
  const proxied = {
    ...store,
    atomicTeamUpdate: async (teamId: string, updater: (team: Json) => Json | null) => {
      controls.teamWrites += 1;
      const n = controls.teamWrites;
      if (controls.failTeamWrite(n)) throw new Error('database unavailable');
      const result = await store.atomicTeamUpdate(teamId, updater);
      if (await controls.loseTeamWriteAnswer(n)) throw new Error('connection lost after COMMIT');
      return result;
    },
    saveSessionState: vi.fn(store.saveSessionState),
    ...(jiraSettings
      ? {
        loadJiraSettings: async () => jiraSettings.value,
        saveJiraSettings: async (settings: Json) => { jiraSettings.value = settings; }
      }
      : {})
  } as Store & { saveSessionState: ReturnType<typeof vi.fn> };

  const tokenService = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: undefined, tokenSecret });
  const teamService = createTeamService({ dataStore: proxied, tokenService });
  const io = {
    to: (room: string) => ({ emit: (event: string, data: Json) => { controls.broadcasts.push({ room, event, data }); } })
  };
  const liveSessionPatch = createLiveSessionPatch({ dataStore: proxied, sessionCache: new Map(), io });

  const transport = async (options: CreateCall & Json) => {
    if (!isCreate(options)) {
      const url = controls.readBaseUrl ? options.url.replace(jira.url, controls.readBaseUrl) : options.url;
      return outboundRequest({ ...options, url });
    }
    controls.clockMs += controls.msPerCreate;
    if (controls.onCreate) await controls.onCreate(options);
    const url = controls.createBaseUrl ? options.url.replace(jira.url, controls.createBaseUrl) : options.url;
    return outboundRequest({ ...options, url });
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.path.endsWith('/jira/issues')) {
      let resolve: (body: Json) => void = () => undefined;
      issuesRequests.push({ socket: req.socket, answered: new Promise<Json>((done) => { resolve = done; }) });
      const json = res.json.bind(res);
      res.json = (body: Json) => {
        try {
          return json(body);
        } finally {
          resolve(body);
        }
      };
    }
    next();
  });
  registerTeamRoutes({
    app,
    dataStore: proxied,
    teamService,
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value,
    liveSessionPatch,
    isShuttingDown: () => controls.shuttingDown,
    jiraClientOptions: { request: transport, timeoutMs: 1000, deadlineMs: 2000 },
    jiraIssuesOptions: { now: () => new Date(controls.clockMs), ...jiraIssuesOptions }
  });

  const listening = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listening.once('listening', resolve));
  const base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;

  const post = async (path: string, payload: Json, signal?: AbortSignal): Promise<Answer> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const text = await response.text();
    let body: Json = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, body };
  };

  return {
    controls,
    store: proxied,
    issuesRequests,
    post,
    asTeam: (teamId: string, body: Json = {}) => ({ sessionToken: tokenService.createSessionToken(teamId, null), ...body }),
    resetCounts: () => {
      controls.teamWrites = 0;
      controls.broadcasts = [];
      proxied.saveSessionState.mockClear();
    },
    close: () => new Promise<void>((resolve) => {
      listening.close(() => resolve());
      // The test is over. After an aborted request the HTTP client can leave
      // a connection the server does not count as idle, which would hold the
      // close for seconds.
      listening.closeAllConnections();
    })
  };
};

type Pod = Awaited<ReturnType<typeof startPod>>;

const issuesPath = (teamId: string) => `/api/team/${teamId}/jira/issues`;

// The connection, the team's token (through the route, so it is checked
// against the mock and sealed as in production) and its target.
const connectTeam = async (pod: Pod, store: Store, jira: JiraMock, teamId: string, target: Json | null = TARGET) => {
  await store.saveJiraSettings({ enabled: true, baseUrl: jira.url, allowSelfSignedCerts: false });
  expect((await pod.post(`/api/team/${teamId}/jira/token`, pod.asTeam(teamId, { token: JIRA_MOCK_PAT }))).status).toBe(200);
  if (target) expect((await pod.post(`/api/team/${teamId}/jira/target`, pod.asTeam(teamId, { target }))).status).toBe(200);
};

describe('POST /jira/issues (SQLite)', () => {
  const TEAM_ID = 'jira-issues-team';
  const OTHER_TEAM_ID = 'jira-issues-other';
  let dir: string;
  let store: Store;
  let jira: JiraMock;
  let pod: Pod;
  let passwordHash: string;
  const savedEnv: Record<string, string | undefined> = {};

  const create = (body: Json) => pod.post(issuesPath(TEAM_ID), pod.asTeam(TEAM_ID, body));
  const record = async () => (await store.loadTeam(TEAM_ID)) as Json;
  const seed = async (options: Parameters<typeof teamRecord>[2] = {}) => {
    await store.deleteTeamRecord(TEAM_ID);
    await store.saveTeam(TEAM_ID, teamRecord(TEAM_ID, passwordHash, options));
  };
  // Rewrites the stored record, keeping what the routes wrote (the target).
  const editRecord = async (edit: (team: Json) => void) => {
    const team = await record();
    edit(team);
    await store.saveTeam(TEAM_ID, team);
  };
  const createRequests = () => jira.requests().filter((entry) => entry.method === 'POST' && entry.path.endsWith('/rest/api/2/issue'));
  // The record's revision: it moves once per write that landed.
  const revision = async () => Number(((await store.loadTeamRaw(TEAM_ID)) as Json)._rev);

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-jira-issues-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    store = createDataStore({ rootDir: dir });
    await store.initDatabase();
    passwordHash = await hashPassword(TEAM_PASSWORD);
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

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await seed();
    await store.deleteTeamRecord(OTHER_TEAM_ID);
    await store.saveTeam(OTHER_TEAM_ID, teamRecord(OTHER_TEAM_ID, passwordHash));
    await store.atomicTeamIndexUpdate(() => new Map([[TEAM_ID, TEAM_ID], [OTHER_TEAM_ID, OTHER_TEAM_ID]]));
    jira.reset();
    pod = await startPod({ store, jira });
    await connectTeam(pod, store, jira, TEAM_ID);
    jira.reset();
    pod.resetCounts();
  });

  afterEach(async () => {
    await pod.close();
    vi.restoreAllMocks();
  });

  describe('creating', () => {
    it('creates one action, writes its key on the record and drops the claim', async () => {
      const before = await revision();
      const answer = await create({ actionIds: ['a1'], requestedBy: 'Ann' });

      expect(answer).toEqual({ status: 200, body: { results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }], remaining: [] } });
      expect(jira.issues()).toHaveLength(1);
      const team = await record();
      expect(copiesOf(team, 'a1')).toEqual([expect.objectContaining({ jira: { key: 'PROJ-1', createdAt: new Date(CLOCK_START).toISOString() } })]);
      expect(team.jiraClaims).toBeUndefined();
      // One write claimed it, one wrote the key.
      expect(await revision()).toBe(before + 2);
    });

    it('sends what the shared builder writes, in the session’s language, with the target’s fields', async () => {
      const before = await record();
      await create({ actionIds: ['h1', 'b1'], requestedBy: 'Ann', language: 'fr' });

      const [fromCheck, fromBacklog] = jira.issues();
      const expectedCheck = issueFields({
        action: copiesOf(before, 'h1')[0],
        session: before.healthChecks[0],
        kind: 'healthcheck',
        team: before,
        requestedBy: 'Ann',
        language: 'fr'
      });
      expect(expectedCheck.language).toBe('fr');
      expect(fromCheck.fields).toEqual({
        project: { key: 'PROJ' },
        issuetype: { id: '10001' },
        summary: expectedCheck.summary,
        description: expectedCheck.description,
        labels: ['retrospective']
      });
      const expectedBacklog = issueFields({ action: copiesOf(before, 'b1')[0], session: null, kind: 'backlog', team: before, requestedBy: 'Ann', language: 'fr' });
      expect(fromBacklog.description).toBe(expectedBacklog.description);
      expect(fromBacklog.summary).toBe('Clean up the backlog');
    });

    it('writes in the clicker’s language when neither the session nor a previous retro decides it', async () => {
      // No retro at all: a backlog action has nothing but the request to go by (U-6).
      await editRecord((team) => {
        team.retrospectives = [];
      });
      const before = await record();
      await create({ actionIds: ['b1'], requestedBy: 'Ann', language: 'fr' });
      await create({ actionIds: ['shared'], requestedBy: 'Ann', language: 'en' });

      const [french, english] = jira.issues();
      expect(french.description).toBe(issueFields({
        action: copiesOf(before, 'b1')[0],
        session: null,
        kind: 'backlog',
        team: before,
        requestedBy: 'Ann',
        language: 'fr'
      }).description);
      expect(french.description?.startsWith('Action du backlog de l’équipe')).toBe(true);
      expect(english.description?.startsWith('Action from the team backlog')).toBe(true);
    });

    it('takes the newest text from the backlog copy of an action in two homes, and the card it quotes from the retro', async () => {
      // The whole-action route edits the backlog copy first; the retro's copy
      // keeps the card it was written against.
      await editRecord((team) => {
        team.globalActions.find((entry: Json) => entry.id === 'shared').text = 'Pair on every deploy';
        team.retrospectives[0].actions.find((entry: Json) => entry.id === 'shared').linkedTicketId = 't1';
      });
      const before = await record();
      await create({ actionIds: ['shared'] });

      const [issue] = jira.issues();
      expect(issue.summary).toBe('Pair on every deploy');
      expect(issue.description).toBe(issueFields({
        action: { ...before.globalActions.find((entry: Json) => entry.id === 'shared'), linkedTicketId: 't1' },
        session: before.retrospectives[0],
        kind: 'retro',
        team: before,
        requestedBy: '',
        language: null
      }).description);
      expect(issue.description).toContain('Sprint 12');
      expect(issue.description).toContain('Deploys are slow');
      // The key is on both copies.
      expect(copiesOf(await record(), 'shared').map((entry) => entry.jira?.key)).toEqual(['PROJ-1', 'PROJ-1']);
    });

    // The Review step the facilitator pressed the button in is the action's
    // home when it holds the action: an action carried in two retros' lists is
    // described from the one on screen, as the dialog's preview showed it.
    it('describes an action from the request’s own session when that session holds it', async () => {
      await editRecord((team) => {
        team.retrospectives.push({
          id: 'retro-11', teamId: TEAM_ID, name: 'Sprint 11', date: '2026-09-22', templateLanguage: 'en',
          tickets: [], groups: [], actions: [action('a1')]
        });
      });
      await create({ actionIds: ['a1'], sessionId: 'retro-11' });
      await create({ actionIds: ['a2'] });
      expect(jira.issues()[0].description).toContain('Sprint 11');
      // Without a session named, the first retrospective holding it.
      expect(jira.issues()[1].description).toContain('Sprint 12');
    });

    it('omits labels when the target has none', async () => {
      await create({ actionIds: ['a1'], target: { ...TARGET, labels: [] } });
      expect(jira.issues()).toHaveLength(1);
      expect(Object.keys(jira.issues()[0].fields)).not.toContain('labels');
    });

    it('uses a one-time target over the stored one, and leaves the stored one as it was', async () => {
      await create({ actionIds: ['a1'], target: { mode: 'project', projectKey: 'OPS', issueTypeId: '10001', labels: ['sprint-12'] } });
      expect(jira.issues()[0]).toMatchObject({ projectKey: 'OPS', key: 'OPS-1', labels: ['sprint-12'] });
      expect((await record()).jiraTarget).toEqual(TARGET);
    });

    it('stops starting creations once the time budget is spent, and the rest follows in the next request', async () => {
      await editRecord((team) => {
        team.retrospectives[0].actions = retroActions(10);
      });
      // Each creation takes Jira four seconds: the fourth would start at 12 s.
      pod.controls.msPerCreate = 4000;
      const ids = Array.from({ length: 10 }, (_, i) => `a${i + 1}`);

      const first = await create({ actionIds: ids });
      expect(first.status).toBe(200);
      expect(first.body.results.map((result: Json) => result.status)).toEqual(['created', 'created', 'created']);
      expect(first.body.remaining).toEqual(ids.slice(3));
      expect(first.body.stopped).toBeUndefined();

      const second = await create({ actionIds: first.body.remaining });
      expect(second.body.results.map((result: Json) => result.actionId)).toEqual(['a4', 'a5', 'a6']);
      expect(jira.issues()).toHaveLength(6);
    });

    it('always attempts the first action, whatever the budget left', async () => {
      const exhausted = await startPod({ store, jira, jiraIssuesOptions: { timeBudgetMs: 0 } });
      try {
        const answer = await exhausted.post(issuesPath(TEAM_ID), exhausted.asTeam(TEAM_ID, { actionIds: ['a1', 'a2'] }));
        expect(answer.body).toEqual({ results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }], remaining: ['a2'] });
      } finally {
        await exhausted.close();
      }
    });
  });

  // The dialog previews each issue with `jiraIssuePreview`, from the client's
  // copy of the team record and the live session on screen; the server builds
  // it from its record and the request. Both go through `issueSource`, so for
  // the same state the facilitator previews exactly what Jira receives.
  describe('the preview and the server agree', () => {
    type Case = { label: string; actionId: string; sessionId?: string; kind: 'retro' | 'healthcheck' | 'backlog'; edit?: (team: Json) => void };
    const cases: Case[] = [
      {
        label: 'an action in two homes, the backlog copy edited, the retro copy written against a card',
        actionId: 'shared',
        sessionId: RETRO_ID,
        kind: 'retro',
        edit: (team) => {
          team.globalActions.find((entry: Json) => entry.id === 'shared').text = 'Pair on every deploy';
          team.retrospectives[0].actions.find((entry: Json) => entry.id === 'shared').linkedTicketId = 't1';
        }
      },
      { label: 'a backlog action from the Dashboard', actionId: 'b1', kind: 'backlog' },
      { label: 'a health check’s action from its Review step', actionId: 'h1', sessionId: HC_ID, kind: 'healthcheck' },
      {
        label: 'an action two retros hold, created from the second',
        actionId: 'a1',
        sessionId: 'retro-11',
        kind: 'retro',
        edit: (team) => {
          team.retrospectives.push({
            id: 'retro-11', teamId: TEAM_ID, name: 'Sprint 11', date: '2026-09-22', templateLanguage: 'fr',
            tickets: [{ id: 't11', colId: 'c1', text: 'Les revues traînent', votes: [] }], groups: [],
            actions: [action('a1', { linkedTicketId: 't11' })]
          });
        }
      },
      {
        label: 'an action listed on a Review step whose session does not hold it',
        actionId: 'h1',
        sessionId: RETRO_ID,
        kind: 'retro'
      }
    ];

    it.each(cases)('$label', async ({ actionId, sessionId, kind, edit }) => {
      if (edit) await editRecord(edit);
      const team = await record();
      const live = sessionId
        ? [...team.retrospectives, ...team.healthChecks].find((entry: Json) => entry.id === sessionId)
        : undefined;
      const preview = jiraIssuePreview({
        // What the screen shows: the copy the list renders.
        action: (live?.actions ?? []).find((entry: Json) => entry.id === actionId) as ActionItem ?? copiesOf(team, actionId)[0] as ActionItem,
        team,
        session: live,
        kind,
        sessionId,
        requestedBy: 'Ann',
        language: 'fr'
      });

      const answer = await create({ actionIds: [actionId], requestedBy: 'Ann', language: 'fr', ...(kind === 'backlog' ? {} : { sessionId }) });
      expect(answer.body.results).toEqual([expect.objectContaining({ actionId, status: 'created' })]);

      const [issue] = jira.issues();
      expect({ summary: issue.summary, description: issue.description }).toEqual({ summary: preview.summary, description: preview.description });
    });
  });

  // The dialog says which parent issue each session's actions go under and,
  // for a new one, with which title (`jiraParentPreviews`). The title the
  // server gives the parent it creates must be that one, in the same language.
  describe('the parent preview and the server agree', () => {
    const cases = [
      { label: 'a retrospective’s parent, from its Review step', actionId: 'a1', sessionId: RETRO_ID, kind: 'retro' as const },
      { label: 'a health check’s parent, in its French template', actionId: 'h1', sessionId: HC_ID, kind: 'healthcheck' as const },
      { label: 'the team dashboard’s parent', actionId: 'b1', sessionId: undefined, kind: 'backlog' as const }
    ];

    it.each(cases)('$label', async ({ actionId, sessionId, kind }) => {
      expect((await pod.post(`/api/team/${TEAM_ID}/jira/target`, pod.asTeam(TEAM_ID, { target: SESSION_TARGET }))).status).toBe(200);
      jira.reset();
      const team = await record();
      const live = sessionId
        ? [...team.retrospectives, ...team.healthChecks].find((entry: Json) => entry.id === sessionId)
        : undefined;
      const [row] = jiraParentPreviews({
        actions: [copiesOf(team, actionId)[0] as ActionItem],
        team,
        session: live,
        kind,
        sessionId,
        requestedBy: 'Ann',
        language: 'fr'
      });
      expect(row.parent.state).toBe('new');

      const answer = await create({ actionIds: [actionId], requestedBy: 'Ann', language: 'fr', ...(kind === 'backlog' ? {} : { sessionId }) });
      expect(answer.body.parents).toEqual([{ scope: row.scope, status: 'created', key: 'PROJ-1' }]);
      const [parent] = jira.issues({ parentKey: null });
      expect(parent.summary).toBe(row.parent.state === 'new' ? row.parent.summary : null);
    });
  });

  describe('never twice', () => {
    it('answers an action that has a key as already linked, without calling Jira', async () => {
      await editRecord((team) => {
        team.retrospectives[0].actions[0].jira = { key: 'PROJ-41', createdAt: '2026-10-01T00:00:00.000Z' };
      });
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'already_linked', key: 'PROJ-41' }],
        remaining: []
      });
      expect(createRequests()).toEqual([]);
    });

    // The whole-action route can add a backlog copy without `jira` to an
    // action a session holds, and the backlog copy is read first: the key or
    // the mark on any copy speaks for the action.
    const retroCopyOfShared = (team: Json) => team.retrospectives[0].actions.find((entry: Json) => entry.id === 'shared');

    it('answers an action as already linked when only one of its copies has the key', async () => {
      await editRecord((team) => {
        retroCopyOfShared(team).jira = { key: 'PROJ-41', createdAt: '2026-10-01T00:00:00.000Z' };
      });
      const before = await revision();
      expect((await create({ actionIds: ['shared'] })).body).toEqual({
        results: [{ actionId: 'shared', status: 'already_linked', key: 'PROJ-41' }],
        remaining: []
      });
      expect(createRequests()).toEqual([]);
      expect(await revision()).toBe(before);
    });

    it('skips an action marked uncertain on only one of its copies', async () => {
      await editRecord((team) => {
        retroCopyOfShared(team).jira = { uncertainSince: '2026-10-19T08:00:00.000Z' };
      });
      expect((await create({ actionIds: ['shared'] })).body.results).toEqual([{ actionId: 'shared', status: 'uncertain' }]);
      expect(createRequests()).toEqual([]);
    });

    it('refuses an action with no text, without claiming it or calling Jira', async () => {
      // Any socket write or `/action` call can store one; Jira would be sent an
      // empty summary with the team's token, and refuse it.
      await editRecord((team) => {
        team.retrospectives[0].actions[1].text = '  \n ';
      });
      const before = await revision();
      // `reason` tells this refusal from one Jira gave without words: the
      // screen says "this action has no text" for this one only.
      expect((await create({ actionIds: ['a2'] })).body).toEqual({
        results: [{ actionId: 'a2', status: 'refused', reason: 'no_text', jiraMessages: [] }],
        remaining: []
      });
      expect(createRequests()).toEqual([]);
      expect(await revision()).toBe(before);
    });

    it.each([
      ['refuses it', { refuseNthCreate: 1 }, 'refused'],
      ['creates it', {}, 'created']
    ])('leaves another request’s claim on the action in place when Jira %s', async (_label, behaviour, status) => {
      jira.setBehaviour(behaviour);
      // This request's claim expired while Jira worked, and another request
      // has claimed the action since: that claim is not this request's to drop.
      const takeover = { at: new Date(CLOCK_START).toISOString(), requestId: 'another-request' };
      pod.controls.onCreate = async () => {
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.jiraClaims = { a1: takeover };
          return team;
        });
      };
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([expect.objectContaining({ actionId: 'a1', status })]);
      expect((await record()).jiraClaims).toEqual({ a1: takeover });
    });

    it.each([
      // The issue may or may not exist: the action is answered with the key
      // it keeps, never as uncertain (see "saving the key" for the log line).
      ['answers a gateway error', { failStatus: 502, endpoints: ['create' as const] }],
      // The issue it created is a duplicate: answered with the key the action
      // keeps (see "saving the key" for the log line that names both).
      ['creates the issue', {}]
    ])('never replaces a key that landed on the action while Jira %s', async (_label, behaviour) => {
      jira.setBehaviour(behaviour);
      // Another request linked the action while this one waited on Jira (a
      // pod whose clock runs a minute ahead read this request's claim as
      // dead). The key on the record is the action's: neither a mark nor a
      // second key takes its place.
      const landed = { key: 'OPS-7', createdAt: '2026-10-20T09:00:00.000Z' };
      pod.controls.onCreate = async () => {
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.retrospectives[0].actions[0].jira = landed;
          return team;
        });
      };
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'already_linked', key: 'OPS-7' }]);
      const team = await record();
      expect(copiesOf(team, 'a1').map((entry) => entry.jira)).toEqual([landed]);
      expect(team.jiraClaims).toBeUndefined();
    });

    it.each([
      ['the backlog copy', (team: Json) => team.globalActions],
      ['the retro’s copy', (team: Json) => team.retrospectives[0].actions]
    ])('answers a closed action as closed when only %s is done, and a proposal or an unknown id as not found', async (_label, home) => {
      await editRecord((team) => {
        // Closed through the whole-action route, which writes one copy only.
        home(team).find((entry: Json) => entry.id === 'shared').done = true;
      });
      const before = await revision();
      expect((await create({ actionIds: ['b-done', 'shared', 'p1', 'nope'] })).body).toEqual({
        results: [
          { actionId: 'b-done', status: 'closed' },
          { actionId: 'shared', status: 'closed' },
          { actionId: 'p1', status: 'not_found' },
          { actionId: 'nope', status: 'not_found' }
        ],
        remaining: []
      });
      expect(createRequests()).toEqual([]);
      // Nothing to claim, nothing written.
      expect(await revision()).toBe(before);
      expect((await record()).jiraClaims).toBeUndefined();
    });

    it('answers in progress while another request’s claim is fresh', async () => {
      const at = new Date(CLOCK_START - JIRA_CLAIM_TTL_MS + 1000).toISOString();
      await editRecord((team) => {
        team.jiraClaims = { a1: { at, requestId: 'another-request' } };
      });
      expect((await create({ actionIds: ['a1'] })).body).toEqual({ results: [{ actionId: 'a1', status: 'in_progress' }], remaining: [] });
      expect(createRequests()).toEqual([]);
      expect((await record()).jiraClaims).toEqual({ a1: { at, requestId: 'another-request' } });
    });

    it('marks an action whose claim expired uncertain, and never creates it on a guess', async () => {
      const at = new Date(CLOCK_START - JIRA_CLAIM_TTL_MS - 1).toISOString();
      await editRecord((team) => {
        team.jiraClaims = { shared: { at, requestId: 'a-request-that-died' } };
      });

      expect((await create({ actionIds: ['shared'] })).body).toEqual({ results: [{ actionId: 'shared', status: 'uncertain' }], remaining: [] });
      expect(createRequests()).toEqual([]);
      const team = await record();
      expect(copiesOf(team, 'shared').map((entry) => entry.jira)).toEqual([{ uncertainSince: at }, { uncertainSince: at }]);
      expect(team.jiraClaims).toBeUndefined();

      // The next click without confirmation still creates nothing.
      expect((await create({ actionIds: ['shared'] })).body.results).toEqual([{ actionId: 'shared', status: 'uncertain' }]);
      expect(createRequests()).toEqual([]);
    });

    it('creates an uncertain action once the facilitator confirms, replacing the mark with the key, and only once', async () => {
      await editRecord((team) => {
        for (const entry of copiesOf(team, 'shared')) entry.jira = { uncertainSince: '2026-10-19T08:00:00.000Z' };
      });

      expect((await create({ actionIds: ['shared'], force: true })).body.results).toEqual([{ actionId: 'shared', status: 'created', key: 'PROJ-1' }]);
      expect(copiesOf(await record(), 'shared').map((entry) => entry.jira?.key)).toEqual(['PROJ-1', 'PROJ-1']);

      expect((await create({ actionIds: ['shared'], force: true })).body.results)
        .toEqual([{ actionId: 'shared', status: 'already_linked', key: 'PROJ-1' }]);
      expect(jira.issues()).toHaveLength(1);
    });

    it('does not let force pass a claim that is still being worked on', async () => {
      await editRecord((team) => {
        for (const entry of copiesOf(team, 'a1')) entry.jira = { uncertainSince: '2026-10-19T08:00:00.000Z' };
        team.jiraClaims = { a1: { at: new Date(CLOCK_START).toISOString(), requestId: 'another-request' } };
      });
      expect((await create({ actionIds: ['a1'], force: true })).body.results).toEqual([{ actionId: 'a1', status: 'in_progress' }]);
      expect(createRequests()).toEqual([]);
    });

    it('does not let force create over a claim whose request died', async () => {
      // `force` lifts the uncertain skip only: an expired claim is never
      // created on a guess, confirmed or not.
      const at = new Date(CLOCK_START - JIRA_CLAIM_TTL_MS - 1).toISOString();
      await editRecord((team) => {
        team.jiraClaims = { a1: { at, requestId: 'a-request-that-died' } };
      });
      expect((await create({ actionIds: ['a1'], force: true })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect(createRequests()).toEqual([]);
      const team = await record();
      expect(copiesOf(team, 'a1')[0].jira).toEqual({ uncertainSince: at });
      expect(team.jiraClaims).toBeUndefined();
    });

    it('trusts a claim dated a little ahead, and reads one dated far ahead as a request that died', async () => {
      // Another pod's clock running a few seconds ahead: still a live claim.
      const soon = new Date(CLOCK_START + JIRA_CLAIM_TTL_MS - 1000).toISOString();
      await editRecord((team) => {
        team.jiraClaims = { a1: { at: soon, requestId: 'a-pod-slightly-ahead' } };
      });
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'in_progress' }]);

      // A date further ahead than a claim lives would block the action until
      // then; it is read as a claim whose request died, and the mark it
      // leaves is never dated in the future.
      const far = new Date(CLOCK_START + 2 * JIRA_CLAIM_TTL_MS).toISOString();
      await editRecord((team) => {
        team.jiraClaims = { a1: { at: far, requestId: 'a-pod-far-ahead' } };
      });
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect(createRequests()).toEqual([]);
      const team = await record();
      expect(copiesOf(team, 'a1')[0].jira).toEqual({ uncertainSince: new Date(CLOCK_START).toISOString() });
      expect(team.jiraClaims).toBeUndefined();
    });
  });

  describe('when Jira says no', () => {
    it('reports a 400 on its action in Jira’s words and goes on with the batch', async () => {
      // The second creation is refused, as a project with a required field refuses it.
      jira.setBehaviour({ refuseNthCreate: 2 });
      const answer = await create({ actionIds: ['a1', 'a2', 'a3'] });

      expect(answer.body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'PROJ-1' },
          // The field Jira named, so a screen can tell what to fix.
          { actionId: 'a2', status: 'refused', jiraMessages: ['Team is required.'], jiraFields: ['customfield_10100'] },
          { actionId: 'a3', status: 'created', key: 'PROJ-2' }
        ],
        remaining: []
      });
      const team = await record();
      expect(copiesOf(team, 'a2')[0].jira).toBeUndefined();
      expect(team.jiraClaims).toBeUndefined();
    });

    // A summary is built from the action itself: its refusal is that action's
    // (a validator in Jira refusing a word, say).
    it('goes on with the batch after a refusal of an action’s own summary', async () => {
      jira.setBehaviour({ refuseNthCreate: 2, refuseNthCreateErrors: { summary: 'The summary may not name a customer.' } });
      const answer = await create({ actionIds: ['a1', 'a2', 'a3'] });

      expect(answer.body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'PROJ-1' },
          { actionId: 'a2', status: 'refused', jiraMessages: ['The summary may not name a customer.'], jiraFields: ['summary'] },
          { actionId: 'a3', status: 'created', key: 'PROJ-2' }
        ],
        remaining: []
      });
    });

    // A refusal of a field the target sets — the labels a project's create
    // screen lacks, the issue type, the project, the parent — is the same for
    // every action: going on would send each one to be refused the same way,
    // spending the team token's Jira budget on it (a Dashboard batch of 40
    // actions sent 40). One action is refused; the rest wait for the target to
    // be fixed, and nothing is claimed.
    it.each([
      ['labels the project does not accept', { refuseLabels: true }, null, ['labels'], ["Field 'labels' cannot be set. It is not on the appropriate screen, or unknown."]],
      ['an issue type the project does not have', {}, { ...TARGET, issueTypeId: '99999' }, ['issuetype'], ['The issue type selected is invalid.']]
    ])('stops the batch after one refusal of %s', async (_label, behaviour, target, jiraFields, jiraMessages) => {
      jira.setBehaviour(behaviour);
      const answer = await create({ actionIds: ['a1', 'a2', 'a3'], ...(target ? { target } : {}) });

      expect(answer.body).toEqual({
        results: [{ actionId: 'a1', status: 'refused', jiraMessages, jiraFields }],
        remaining: ['a2', 'a3'],
        stopped: 'jira_target_refused'
      });
      expect(createRequests()).toHaveLength(1);
      const team = await record();
      expect(team.jiraClaims).toBeUndefined();
      for (const id of ['a1', 'a2', 'a3']) expect(copiesOf(team, id)[0].jira).toBeUndefined();
    });

    // A gateway or a reverse proxy in front of Jira refuses with a page, not
    // JSON, and a Jira 4xx can carry an empty `errors` object: either way Jira
    // gave no words. The action has text, so the answer must not read as the
    // server's own "no text" refusal.
    it.each([400, 422])('reports a %s Jira refused without words as Jira’s refusal, never as an action with no text', async (status) => {
      jira.setBehaviour({ failStatus: status, endpoints: ['create'] });
      const answer = await create({ actionIds: ['a1', 'a2'] });

      expect(answer.body).toEqual({
        results: [
          { actionId: 'a1', status: 'refused', jiraMessages: [] },
          { actionId: 'a2', status: 'refused', jiraMessages: [] }
        ],
        remaining: []
      });
      expect(answer.body.results.some((result: Json) => 'reason' in result)).toBe(false);
      expect(createRequests()).toHaveLength(2);
      expect((await record()).jiraClaims).toBeUndefined();
    });

    it('stops on a 401, records the token as refused, and leaves the action to try again', async () => {
      jira.setAuth({ bearer: 'a-token-revoked-since' });
      const answer = await create({ actionIds: ['a1', 'a2'] });

      expect(answer.body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'token_refused' });
      expect(createRequests()).toHaveLength(1);
      expect((await record()).jiraClaims).toBeUndefined();
      const status = await pod.post(`/api/team/${TEAM_ID}/jira/status`, pod.asTeam(TEAM_ID));
      expect(status.body.token.refusedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    });

    it('never records a 401 against a token saved while the batch ran', async () => {
      // Someone replaces the revoked token while Jira answers the batch's
      // creation, which was sent with the old one.
      pod.controls.onCreate = async () => {
        jira.setAuth({ bearer: 'a-newer-token' });
        const saved = await pod.post(`/api/team/${TEAM_ID}/jira/token`, pod.asTeam(TEAM_ID, { token: 'a-newer-token' }));
        expect(saved.status).toBe(200);
      };
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'token_refused' });

      const status = await pod.post(`/api/team/${TEAM_ID}/jira/status`, pod.asTeam(TEAM_ID));
      expect(status.body.token).toMatchObject({ usable: true, refusedAt: null });
    });

    it.each([
      [403, 'jira_forbidden'],
      [404, 'jira_not_found']
    ])('stops on a %s with %s, nothing created and nothing claimed', async (status, stopped) => {
      jira.setBehaviour({ failStatus: status, endpoints: ['create'] });
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped });
      expect(createRequests()).toHaveLength(1);
      const team = await record();
      expect(team.jiraClaims).toBeUndefined();
      expect(copiesOf(team, 'a1')[0].jira).toBeUndefined();
      // A 403 is not the token being refused.
      const answer = await pod.post(`/api/team/${TEAM_ID}/jira/status`, pod.asTeam(TEAM_ID));
      expect(answer.body.token.refusedAt).toBeNull();
    });

    it('stops on a rate limit and passes on how long Jira asks to wait', async () => {
      jira.setBehaviour({ rateLimitNthCreate: 2, retryAfter: '30' });
      expect((await create({ actionIds: ['a1', 'a2', 'a3'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }],
        remaining: ['a2', 'a3'],
        stopped: 'jira_rate_limited',
        retryAfterSeconds: 30
      });
      const team = await record();
      expect(team.jiraClaims).toBeUndefined();
      expect(copiesOf(team, 'a1')[0].jira).toEqual({ key: 'PROJ-1', createdAt: expect.any(String) });
    });

    it('omits the wait when Jira names none', async () => {
      jira.setBehaviour({ rateLimitNthCreate: 1 });
      expect((await create({ actionIds: ['a1'] })).body).toEqual({ results: [], remaining: ['a1'], stopped: 'jira_rate_limited' });
    });

    it('stops when Jira cannot be reached, with nothing marked and the action still to send', async () => {
      const unreachable = await closedPortBase();
      pod.controls.createBaseUrl = unreachable;
      const answer = await create({ actionIds: ['a1', 'a2'] });
      expect(answer.body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'jira_unreachable' });
      const team = await record();
      expect(team.jiraClaims).toBeUndefined();
      expect(copiesOf(team, 'a1')[0].jira).toBeUndefined();
      // Why, for the log viewer, in codes only: the team learns that Jira
      // could not be reached, the administrator what stopped it.
      const lines = vi.mocked(console.warn).mock.calls.map((call) => call.join(' '));
      expect(lines.filter((line) => line.includes('Jira could not be reached'))).toEqual([
        `[Server] Jira could not be reached (creating an issue, team ${JSON.stringify(TEAM_ID)}): network ECONNREFUSED`
      ]);
      expect(lines.join('\n')).not.toContain(new URL(unreachable).port);
    });

    it('marks every copy uncertain when the issue was created and the answer lost', async () => {
      jira.setBehaviour({ dropAfterCreate: true });
      const answer = await create({ actionIds: ['shared', 'a1'] });

      expect(answer.body).toEqual({ results: [{ actionId: 'shared', status: 'uncertain' }], remaining: ['a1'], stopped: 'jira_unreachable' });
      // Jira did create it, which is why it is never created again on a guess.
      expect(jira.issues()).toHaveLength(1);
      const team = await record();
      expect(copiesOf(team, 'shared').map((entry) => entry.jira)).toEqual([
        { uncertainSince: new Date(CLOCK_START).toISOString() },
        { uncertainSince: new Date(CLOCK_START).toISOString() }
      ]);
      expect(team.jiraClaims).toBeUndefined();

      jira.setBehaviour({ dropAfterCreate: false });
      expect((await create({ actionIds: ['shared'] })).body.results).toEqual([{ actionId: 'shared', status: 'uncertain' }]);
      expect(jira.issues()).toHaveLength(1);
    });

    it('marks the action uncertain on a gateway error, which may have reached Jira', async () => {
      jira.setBehaviour({ failStatus: 502, endpoints: ['create'] });
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({ results: [{ actionId: 'a1', status: 'uncertain' }], remaining: ['a2'], stopped: 'jira_unavailable' });
      expect(copiesOf(await record(), 'a1')[0].jira).toEqual({ uncertainSince: new Date(CLOCK_START).toISOString() });
    });
  });

  describe('saving the key', () => {
    // Another request linked one copy of the action between this request's
    // claim and Jira's 201 (pods whose clocks disagree by more than the claim
    // lifetime). The action is in Jira twice by then; what the record must not
    // do is name two keys for one action. The key already there wins on every
    // copy, and the duplicate is logged for an administrator to delete.
    const OTHER_KEY = { key: 'OPS-7', createdAt: '2026-10-20T09:59:00.000Z' };
    const linkRetroCopyMeanwhile = () => {
      let linked = false;
      pod.controls.onCreate = async () => {
        if (linked) return;
        linked = true;
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.retrospectives[0].actions.find((entry: Json) => entry.id === 'shared').jira = { ...OTHER_KEY };
          return team;
        });
      };
    };
    const loggedDuplicate = (created: string) => vi.mocked(console.error).mock.calls.some(([line]) => {
      const text = String(line);
      return text.includes(created) && text.includes(OTHER_KEY.key) && text.includes('shared') && text.includes(TEAM_ID);
    });

    it('keeps a key another request wrote meanwhile on every copy, answers it, and logs the duplicate', async () => {
      linkRetroCopyMeanwhile();

      expect((await create({ actionIds: ['shared'] })).body).toEqual({
        results: [{ actionId: 'shared', status: 'already_linked', key: 'OPS-7' }],
        remaining: []
      });

      const team = await record();
      expect(copiesOf(team, 'shared').map((entry) => entry.jira)).toEqual([OTHER_KEY, OTHER_KEY]);
      expect(team.jiraClaims).toBeUndefined();
      expect(jira.issues()).toHaveLength(1);
      expect(loggedDuplicate('PROJ-1')).toBe(true);
    });

    // The same race, with Jira's answer lost instead of a 201: the issue may
    // exist, and the action already has one. The key wins on every copy, as
    // for a 201, and no copy is marked "may already be in Jira".
    it('keeps a key another request wrote meanwhile on every copy when Jira’s answer is lost, and logs the possible duplicate', async () => {
      jira.setBehaviour({ failStatus: 502, endpoints: ['create'] });
      linkRetroCopyMeanwhile();

      expect((await create({ actionIds: ['shared', 'a1'] })).body).toEqual({
        results: [{ actionId: 'shared', status: 'already_linked', key: 'OPS-7' }],
        remaining: ['a1'],
        stopped: 'jira_unavailable'
      });

      const team = await record();
      expect(copiesOf(team, 'shared').map((entry) => entry.jira)).toEqual([OTHER_KEY, OTHER_KEY]);
      expect(team.jiraClaims).toBeUndefined();
      expect(vi.mocked(console.error).mock.calls.some(([line]) => {
        const text = String(line);
        return text.includes(OTHER_KEY.key) && text.includes('shared') && text.includes(TEAM_ID) && text.includes('duplicate');
      })).toBe(true);
    });

    it('keeps the key already there when the conflict is found by the next action’s claim', async () => {
      linkRetroCopyMeanwhile();

      expect((await create({ actionIds: ['shared', 'a1'] })).body).toEqual({
        results: [
          { actionId: 'shared', status: 'already_linked', key: 'OPS-7' },
          { actionId: 'a1', status: 'created', key: 'PROJ-2' }
        ],
        remaining: []
      });

      expect(copiesOf(await record(), 'shared').map((entry) => entry.jira)).toEqual([OTHER_KEY, OTHER_KEY]);
      expect(loggedDuplicate('PROJ-1')).toBe(true);
    });

    it('retries a failed key write and succeeds on the third attempt', async () => {
      // Write 1 claims; writes 2 and 3 (the key) fail; write 4 lands.
      pod.controls.failTeamWrite = (n) => n === 2 || n === 3;
      expect((await create({ actionIds: ['a1'] })).body).toEqual({ results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }], remaining: [] });
      const team = await record();
      expect(copiesOf(team, 'a1')[0].jira?.key).toBe('PROJ-1');
      expect(team.jiraClaims).toBeUndefined();
    });

    it('answers created_not_saved with the key and stops when the key never lands, and never creates it again', async () => {
      pod.controls.failTeamWrite = (n) => n >= 2;
      const errors = vi.mocked(console.error);
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created_not_saved', key: 'PROJ-1' }],
        remaining: [],
        stopped: 'link_not_saved'
      });
      expect(errors.mock.calls.some(([line]) => String(line).includes('PROJ-1') && String(line).includes('a1') && String(line).includes(TEAM_ID))).toBe(true);

      // The claim stayed: the next click waits, then reads it as uncertain.
      pod.controls.failTeamWrite = () => false;
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'in_progress' }]);
      pod.controls.clockMs += JIRA_CLAIM_TTL_MS;
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect(jira.issues()).toHaveLength(1);
    });

    it('writes a key with the next claim, and stops before that action when the write fails', async () => {
      // Write 1 claims a1; write 2 would write a1's key and claim a2.
      pod.controls.failTeamWrite = (n) => n >= 2;
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created_not_saved', key: 'PROJ-1' }],
        remaining: ['a2'],
        stopped: 'link_not_saved'
      });
      expect(jira.issues()).toHaveLength(1);
      expect((await record()).jiraClaims).toEqual({ a1: expect.objectContaining({ at: expect.any(String) }) });
    });

    it.each([
      ['once', (n: number) => n === 2],
      ['twice', (n: number) => n === 2 || n === 3]
    ])('retries a key written with the next claim when that write fails %s, and goes on', async (_label, fails) => {
      // Write 2 writes a1's key and claims a2: one transient failure must not
      // cost the rest of the batch.
      pod.controls.failTeamWrite = fails;
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'PROJ-1' },
          { actionId: 'a2', status: 'created', key: 'PROJ-2' }
        ],
        remaining: []
      });
      const team = await record();
      expect(['a1', 'a2'].map((id) => copiesOf(team, id)[0].jira?.key)).toEqual(['PROJ-1', 'PROJ-2']);
      expect(team.jiraClaims).toBeUndefined();
    });

    it('goes on when a write landed but its answer was lost', async () => {
      // Write 2 writes a1's key and claims a2, then reports a failure: the
      // retry finds this request's own claim on a2, and proceeds with it.
      pod.controls.loseTeamWriteAnswer = (n) => n === 2;
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'PROJ-1' },
          { actionId: 'a2', status: 'created', key: 'PROJ-2' }
        ],
        remaining: []
      });
      expect(jira.issues()).toHaveLength(2);
      const team = await record();
      expect(['a1', 'a2'].map((id) => copiesOf(team, id)[0].jira?.key)).toEqual(['PROJ-1', 'PROJ-2']);
      expect(team.jiraClaims).toBeUndefined();
    });

    it('drops its own claim when the action’s text was cleared before the retry of a lost write', async () => {
      // Write 2 claims a2 and its answer is lost; meanwhile a2's text is cleared.
      pod.controls.loseTeamWriteAnswer = async (n) => {
        if (n !== 2) return false;
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.retrospectives[0].actions[1].text = '';
          return team;
        });
        return true;
      };
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'PROJ-1' },
          { actionId: 'a2', status: 'refused', reason: 'no_text', jiraMessages: [] }
        ],
        remaining: []
      });
      expect(jira.issues()).toHaveLength(1);
      expect((await record()).jiraClaims).toBeUndefined();
    });

    it('answers 500 when a claim cannot be written, before anything is sent to Jira', async () => {
      // No issue is at stake yet, so nothing is retried; the client reads a
      // 5xx as an unknown outcome and re-reads the team, and finds nothing
      // created and nothing claimed.
      pod.controls.failTeamWrite = (n) => n === 1;
      expect(await create({ actionIds: ['a1', 'a2'] })).toEqual({ status: 500, body: { error: 'failed_to_create' } });
      expect(createRequests()).toEqual([]);
      expect((await record()).jiraClaims).toBeUndefined();
    });

    it('answers created_not_saved when the team was deleted while Jira created the issue', async () => {
      pod.controls.onCreate = async () => {
        await store.deleteTeamRecord(TEAM_ID);
      };
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created_not_saved', key: 'PROJ-1' }],
        remaining: ['a2'],
        stopped: 'link_not_saved'
      });
      expect(jira.issues()).toHaveLength(1);
    });

    it.each([
      ['is closed', 'b-done', () => undefined, { status: 'closed' }],
      ['is a proposal', 'p1', () => undefined, { status: 'not_found' }],
      ['has a key', 'a2', (team: Json) => {
        team.retrospectives[0].actions[1].jira = { key: 'PROJ-41', createdAt: '2026-10-01T00:00:00.000Z' };
      }, { status: 'already_linked', key: 'PROJ-41' }],
      ['is marked uncertain', 'a2', (team: Json) => {
        team.retrospectives[0].actions[1].jira = { uncertainSince: '2026-10-19T08:00:00.000Z' };
      }, { status: 'uncertain' }],
      ['is claimed by another request', 'a2', (team: Json) => {
        team.jiraClaims = { a2: { at: new Date(CLOCK_START).toISOString(), requestId: 'another-request' } };
      }, { status: 'in_progress' }]
    ])('saves a created key when the next action %s and its claim writes nothing', async (_label, nextId, edit, result) => {
      // Write 2 carries a1's key, and decides the next action without
      // changing anything for it: the key must land all the same.
      await editRecord(edit);
      const before = await revision();
      expect((await create({ actionIds: ['a1', nextId] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }, { actionId: nextId, ...result }],
        remaining: []
      });
      const team = await record();
      expect(copiesOf(team, 'a1')[0].jira?.key).toBe('PROJ-1');
      expect(team.jiraClaims?.a1).toBeUndefined();
      expect(await revision()).toBe(before + 2);
    });

    it('keeps the claim when the call to Jira fails in a way nobody expected, and never creates the action on a guess', async () => {
      // Neither an answer nor a transport error the client knows: whether the
      // request left is unknown, so the claim stays and expires into an
      // uncertain mark, like the claim of a request that died.
      pod.controls.onCreate = () => {
        throw new Error('boom');
      };
      expect(await create({ actionIds: ['a1', 'a2'] })).toEqual({ status: 500, body: { error: 'failed_to_create' } });
      expect((await record()).jiraClaims).toEqual({ a1: expect.objectContaining({ at: new Date(CLOCK_START).toISOString() }) });

      pod.controls.onCreate = null;
      pod.controls.clockMs += JIRA_CLAIM_TTL_MS;
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect(createRequests()).toEqual([]);
    });

    it('costs one team write per action and one at the end', async () => {
      const before = await revision();
      await create({ actionIds: ['a1', 'a2', 'a3'] });
      expect(await revision()).toBe(before + 4);
    });
  });

  describe('a request is short', () => {
    it('starts no creation once the caller has gone', async () => {
      const controller = new AbortController();
      pod.controls.onCreate = async () => {
        if (controller.signal.aborted) return;
        // The caller leaves while Jira works on the first action, and the
        // server has seen the connection close before Jira answers.
        const { socket } = pod.issuesRequests[0];
        const closed = new Promise((resolve) => {
          if (socket.destroyed) resolve(undefined);
          else socket.once('close', resolve);
        });
        controller.abort();
        await closed;
      };
      await expect(pod.post(issuesPath(TEAM_ID), pod.asTeam(TEAM_ID, { actionIds: ['a1', 'a2', 'a3'] }), controller.signal)).rejects.toThrow();

      // The handler finishes on its own; what it answered reaches nobody.
      expect(await pod.issuesRequests[0].answered).toEqual({
        results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }],
        remaining: ['a2', 'a3'],
        stopped: 'client_gone'
      });
      // The issue already sent is linked; nothing else is attempted.
      expect(copiesOf(await record(), 'a1')[0].jira?.key).toBe('PROJ-1');
      expect(jira.issues()).toHaveLength(1);
      const team = await record();
      expect(copiesOf(team, 'a2')[0].jira).toBeUndefined();
      expect(team.jiraClaims).toBeUndefined();
    });

    it('starts no creation on a draining pod', async () => {
      pod.controls.shuttingDown = true;
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'server_restarting' });
      expect(jira.requests()).toEqual([]);
    });

    it('finishes the creation in flight when the pod starts draining, and stops there', async () => {
      pod.controls.onCreate = () => {
        pod.controls.shuttingDown = true;
      };
      expect((await create({ actionIds: ['a1', 'a2', 'a3'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created', key: 'PROJ-1' }],
        remaining: ['a2', 'a3'],
        stopped: 'server_restarting'
      });
      expect(copiesOf(await record(), 'a1')[0].jira?.key).toBe('PROJ-1');
    });
  });

  describe('sub-tasks of a parent issue', () => {
    it('creates in the parent’s project with its key, reading the parent once', async () => {
      const parentKey = jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001', summary: 'Sprint 12' });
      const answer = await create({ actionIds: ['a1', 'a2'], target: { mode: 'parent', parentKey, issueTypeId: '10005', labels: [] } });

      // Each result names the parent it went under (F2: both sub-task modes).
      expect(answer.body.results).toEqual([
        { actionId: 'a1', status: 'created', key: 'PROJ-2', parentKey },
        { actionId: 'a2', status: 'created', key: 'PROJ-3', parentKey }
      ]);
      // Nothing of a `parent`-mode send is stored about parents.
      expect(answer.body).not.toHaveProperty('parents');
      expect(await record()).not.toHaveProperty('jiraParents');
      const created = jira.issues().filter((issue) => issue.parentKey === parentKey);
      expect(created.map((issue) => issue.fields)).toEqual([
        expect.objectContaining({ project: { id: '10000' }, parent: { key: parentKey }, issuetype: { id: '10005' } }),
        expect.objectContaining({ project: { id: '10000' }, parent: { key: parentKey }, issuetype: { id: '10005' } })
      ]);
      expect(jira.requests().filter((entry) => entry.method === 'GET' && entry.path.includes(`/rest/api/2/issue/${parentKey}`))).toHaveLength(1);
    });

    it('refuses a parent that is itself a sub-task, once, before anything is claimed', async () => {
      const parentKey = jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
      const subtaskKey = jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10005', parentKey });
      const answer = await create({ actionIds: ['a1', 'a2'], target: { mode: 'parent', parentKey: subtaskKey, issueTypeId: '10005', labels: [] } });

      expect(answer.body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'jira_parent_invalid' });
      expect(jira.requests()).toHaveLength(1);
      expect(pod.controls.teamWrites).toBe(0);
    });

    it('refuses a parent Jira does not know', async () => {
      const answer = await create({ actionIds: ['a1'], target: { mode: 'parent', parentKey: 'PROJ-99', issueTypeId: '10005', labels: [] } });
      expect(answer.body).toEqual({ results: [], remaining: ['a1'], stopped: 'jira_parent_invalid' });
      expect(createRequests()).toEqual([]);
    });

    const parentTarget = () => ({ mode: 'parent', parentKey: jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' }), issueTypeId: '10005', labels: [] });

    it('stops on a token refused while reading the parent, and records it', async () => {
      const target = parentTarget();
      jira.setAuth({ bearer: 'a-token-revoked-since' });
      expect((await create({ actionIds: ['a1', 'a2'], target })).body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'token_refused' });
      expect(createRequests()).toEqual([]);
      expect(pod.controls.teamWrites).toBe(0);
      const status = await pod.post(`/api/team/${TEAM_ID}/jira/status`, pod.asTeam(TEAM_ID));
      expect(status.body.token.refusedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    });

    it('stops on a parent read Jira forbids or rate-limits, passing on how long to wait', async () => {
      const target = parentTarget();
      jira.setBehaviour({ failStatus: 403, endpoints: ['issue'] });
      expect((await create({ actionIds: ['a1'], target })).body).toEqual({ results: [], remaining: ['a1'], stopped: 'jira_forbidden' });

      jira.setBehaviour({ failStatus: 429, retryAfter: '30', endpoints: ['issue'] });
      expect((await create({ actionIds: ['a1'], target })).body)
        .toEqual({ results: [], remaining: ['a1'], stopped: 'jira_rate_limited', retryAfterSeconds: 30 });
      expect(createRequests()).toEqual([]);
      expect(pod.controls.teamWrites).toBe(0);
      // Neither is the token being refused.
      expect((await pod.post(`/api/team/${TEAM_ID}/jira/status`, pod.asTeam(TEAM_ID))).body.token.refusedAt).toBeNull();
    });

    // The parent read has its own mapping from Jira's answer to a stop; the
    // creation's is pinned in "when Jira says no".
    it.each([
      ['a gateway error', () => {
        jira.setBehaviour({ failStatus: 502, endpoints: ['issue'] });
      }, 'jira_unavailable'],
      ['a Jira nothing answers for', async () => {
        pod.controls.readBaseUrl = await closedPortBase();
      }, 'jira_unreachable'],
      ['a rate limit that names no wait', () => {
        jira.setBehaviour({ failStatus: 429, endpoints: ['issue'] });
      }, 'jira_rate_limited']
    ])('stops on %s while reading the parent, with nothing claimed', async (_label, fail, stopped) => {
      const target = parentTarget();
      await fail();
      // No `retryAfterSeconds` at all when Jira names no wait, not a null.
      expect((await create({ actionIds: ['a1', 'a2'], target })).body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped });
      expect(createRequests()).toEqual([]);
      expect(pod.controls.teamWrites).toBe(0);
    });
  });

  describe('one parent issue per session (sessionParent)', () => {
    const at = (offsetMs = 0) => new Date(CLOCK_START + offsetMs).toISOString();
    const parentIssues = () => jira.issues({ parentKey: null });
    const subtasksOf = (key: string) => jira.issues({ parentKey: key });

    beforeEach(async () => {
      expect((await pod.post(`/api/team/${TEAM_ID}/jira/target`, pod.asTeam(TEAM_ID, { target: SESSION_TARGET }))).status).toBe(200);
      jira.reset();
      pod.resetCounts();
    });

    // 1.
    it('creates the session’s parent first, then each action as its sub-task, reusing the parent within the request', async () => {
      const before = await record();
      const rev = await revision();
      const answer = await create({ actionIds: ['a1', 'a2'], requestedBy: 'Ann' });

      expect(answer.body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'PROJ-2', parentKey: 'PROJ-1' },
          { actionId: 'a2', status: 'created', key: 'PROJ-3', parentKey: 'PROJ-1' }
        ],
        remaining: [],
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      const [parent] = parentIssues();
      const expected = parentIssueFields({
        scope: jiraParentScope({ kind: 'retro', session: before.retrospectives[0] }),
        team: before,
        requestedBy: 'Ann',
        language: null
      });
      expect(parent.fields).toEqual({
        project: { key: 'PROJ' },
        issuetype: { id: '10001' },
        summary: 'Retrospective actions: Sprint 12 (2026-10-06)',
        description: expected.description,
        labels: ['retrospective']
      });
      expect(parent.summary).toBe(expected.summary);
      expect(subtasksOf('PROJ-1').map((issue) => issue.fields)).toEqual([
        expect.objectContaining({ project: { key: 'PROJ' }, parent: { key: 'PROJ-1' }, issuetype: { id: '10005' }, labels: ['retrospective'] }),
        expect.objectContaining({ project: { key: 'PROJ' }, parent: { key: 'PROJ-1' }, issuetype: { id: '10005' }, labels: ['retrospective'] })
      ]);
      expect(jira.issues()).toHaveLength(3);

      const team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { key: 'PROJ-1', createdAt: at(), subtaskTypeId: '10005' } });
      expect(team.jiraParentClaims).toBeUndefined();
      expect(team.jiraClaims).toBeUndefined();
      expect(copiesOf(team, 'a1')[0].jira).toEqual({ key: 'PROJ-2', createdAt: at() });
      // The parent's claim, its key with the first action's claim, each key
      // with the next claim, and the last key.
      expect(await revision()).toBe(rev + 4);
    });

    // 2.
    it('reuses the stored parent in a later request, with no parent creation', async () => {
      await create({ actionIds: ['a1'] });
      jira.reset();
      // The mock forgot its issues; the record still names PROJ-1.
      jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001', summary: 'The parent, as Jira still holds it' });

      const answer = await create({ actionIds: ['a3'] });
      expect(answer.body).toEqual({ results: [{ actionId: 'a3', status: 'created', key: 'PROJ-2', parentKey: 'PROJ-1' }], remaining: [] });
      expect(createRequests()).toHaveLength(1);
    });

    // 3.
    it('gives each session of a dashboard batch its own parent, and the dashboard’s actions one for the team', async () => {
      await editRecord((team) => {
        team.retrospectives.push(
          { id: 'retro-11', teamId: TEAM_ID, name: 'Sprint 11', date: '2026-09-22', templateLanguage: 'en', tickets: [], groups: [], actions: [action('r11')] },
          { id: 'retro-10', teamId: TEAM_ID, name: 'Sprint 10', date: '2026-09-08', templateLanguage: 'fr', tickets: [], groups: [], actions: [action('r10')] }
        );
        team.globalActions.push(action('b2', { text: 'Another dashboard action' }));
      });
      const answer = await create({ actionIds: ['a1', 'r11', 'r10', 'h1', 'b1', 'b2'] });

      expect(answer.body.results.map((result: Json) => result.status)).toEqual(Array(6).fill('created'));
      expect(answer.body.remaining).toEqual([]);
      const team = await record();
      expect(Object.keys(team.jiraParents).sort()).toEqual(['backlog', HC_SCOPE, 'retro:retro-10', 'retro:retro-11', RETRO_SCOPE].sort());
      expect(answer.body.parents.map((entry: Json) => [entry.scope, entry.status])).toEqual([
        [RETRO_SCOPE, 'created'], ['retro:retro-11', 'created'], ['retro:retro-10', 'created'], [HC_SCOPE, 'created'], ['backlog', 'created']
      ]);
      expect(parentIssues()).toHaveLength(5);
      // Each action under its own scope's parent.
      const scopeOfAction: Record<string, string> = { a1: RETRO_SCOPE, r11: 'retro:retro-11', r10: 'retro:retro-10', h1: HC_SCOPE, b1: 'backlog', b2: 'backlog' };
      for (const result of answer.body.results) {
        expect(result.parentKey).toBe(team.jiraParents[scopeOfAction[result.actionId]].key);
      }
      // Each parent in its session's language; the dashboard's in its latest retro's.
      const summaries = Object.fromEntries(parentIssues().map((issue) => [issue.key, issue.summary]));
      expect(summaries[team.jiraParents['retro:retro-10'].key]).toBe('Actions de la rétrospective\u00a0: Sprint 10 (2026-09-08)');
      expect(summaries[team.jiraParents[HC_SCOPE].key]).toBe('Actions du bilan de santé\u00a0: Bilan T3 (2026-10-01)');
      expect(summaries[team.jiraParents.backlog.key]).toBe(`Team actions: Team ${TEAM_ID}`);
    });

    // 4.
    it('creates one parent when two requests for one session race, the other answering in progress', async () => {
      jira.setBehaviour({ delayMs: 150, endpoints: ['create'] });
      const [first, second] = await Promise.all([create({ actionIds: ['a1'] }), create({ actionIds: ['a2'] })]);

      const statuses = [...first.body.results, ...second.body.results].map((result: Json) => result.status).sort();
      expect(statuses).toEqual(['created', 'parent_in_progress']);
      const loser = first.body.results[0].status === 'parent_in_progress' ? first : second;
      expect(loser.body.parents).toEqual([{ scope: RETRO_SCOPE, status: 'in_progress' }]);
      expect(parentIssues()).toHaveLength(1);
      expect(jira.issues()).toHaveLength(2);
      const team = await record();
      expect(team.jiraParentClaims).toBeUndefined();
      expect(team.jiraClaims).toBeUndefined();
    });

    // 5.
    it('marks the scope, never the action, when the parent’s answer is lost, and creates it again only when confirmed', async () => {
      jira.setBehaviour({ dropAfterNthCreate: 1 });
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'parent_uncertain' }],
        remaining: ['a2'],
        stopped: 'jira_unreachable',
        parents: [{ scope: RETRO_SCOPE, status: 'uncertain', uncertainSince: at() }]
      });
      // Jira did create it: that is why it is never created again on a guess.
      expect(parentIssues()).toHaveLength(1);
      let team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { uncertainSince: at() } });
      expect(copiesOf(team, 'a1')[0].jira).toBeUndefined();
      expect(team.jiraParentClaims).toBeUndefined();
      expect(team.jiraClaims).toBeUndefined();

      // The next click, `force` (which is about the action), and a
      // confirmation of another scope's parent create nothing.
      for (const extra of [{}, { force: true }, { forceParentScopes: [HC_SCOPE] }]) {
        expect((await create({ actionIds: ['a1'], ...extra })).body).toEqual({
          results: [{ actionId: 'a1', status: 'parent_uncertain' }],
          remaining: [],
          parents: [{ scope: RETRO_SCOPE, status: 'uncertain', uncertainSince: at() }]
        });
      }
      expect(jira.issues()).toHaveLength(1);

      // Confirmed, and lost again: the earlier date stays, it says when the doubt began.
      pod.controls.clockMs += 5000;
      jira.setBehaviour({ dropAfterNthCreate: 2 });
      expect((await create({ actionIds: ['a1'], forceParentScopes: [RETRO_SCOPE] })).body.parents)
        .toEqual([{ scope: RETRO_SCOPE, status: 'uncertain', uncertainSince: at() }]);
      expect((await record()).jiraParents).toEqual({ [RETRO_SCOPE]: { uncertainSince: at() } });

      // Confirmed and answered: the key replaces the mark.
      jira.setBehaviour({ dropAfterNthCreate: null });
      expect((await create({ actionIds: ['a1'], forceParentScopes: [RETRO_SCOPE] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created', key: 'PROJ-4', parentKey: 'PROJ-3' }],
        remaining: [],
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-3' }]
      });
      team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { key: 'PROJ-3', createdAt: at(5000), subtaskTypeId: '10005' } });
      expect(parentIssues()).toHaveLength(3);
    });

    // 6.
    it('reads an expired parent claim as a parent that may exist, dated by the claim, and one dated far ahead as dated now', async () => {
      const expired = at(-JIRA_CLAIM_TTL_MS - 1);
      await editRecord((team) => {
        team.jiraParentClaims = { [RETRO_SCOPE]: { at: expired, requestId: 'a-request-that-died' } };
      });
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'parent_uncertain' }],
        remaining: [],
        parents: [{ scope: RETRO_SCOPE, status: 'uncertain', uncertainSince: expired }]
      });
      let team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { uncertainSince: expired } });
      expect(team.jiraParentClaims).toBeUndefined();

      await editRecord((stored) => {
        delete stored.jiraParents;
        stored.jiraParentClaims = { [RETRO_SCOPE]: { at: at(2 * JIRA_CLAIM_TTL_MS), requestId: 'a-pod-far-ahead' } };
      });
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'parent_uncertain' }]);
      team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { uncertainSince: at() } });
      expect(createRequests()).toEqual([]);
    });

    // 6b. [review F2-1] A confirmation names the parents the facilitator saw
    // in doubt, never the whole request: a doubt the server finds during the
    // send — an expired claim, which no screen can see — is not lifted by it.
    describe('confirming a parent issue in doubt, scope by scope', () => {
      const SPRINT_11 = 'retro:retro-11';
      const expired = at(-JIRA_CLAIM_TTL_MS - 1);
      const shownMark = at(-3_600_000);
      // Sprint 12's parent is in doubt, which the dialog showed. Sprint 11
      // holds only a claim left by a request that died while creating its
      // parent: claims never reach a client, so its row read "new" — and
      // with `withMark`, a doubt shown too, with that claim on top of it.
      const seedDoubts = ({ withMark = false } = {}) => editRecord((team) => {
        team.retrospectives.push({
          id: 'retro-11', teamId: TEAM_ID, name: 'Sprint 11', date: '2026-09-22', templateLanguage: 'en', tickets: [], groups: [],
          actions: [action('y1'), action('y2'), action('y3')]
        });
        team.jiraParents = { [RETRO_SCOPE]: { uncertainSince: shownMark }, ...(withMark ? { [SPRINT_11]: { uncertainSince: at(-7_200_000) } } : {}) };
        team.jiraParentClaims = { [SPRINT_11]: { at: expired, requestId: 'a-request-that-died' } };
      });

      it('creates the confirmed parent, and none for a scope whose doubt it found during the same request', async () => {
        await seedDoubts();
        expect((await create({ actionIds: ['a1', 'y1', 'y2'], forceParentScopes: [RETRO_SCOPE] })).body).toEqual({
          results: [
            { actionId: 'a1', status: 'created', key: 'PROJ-2', parentKey: 'PROJ-1' },
            { actionId: 'y1', status: 'parent_uncertain' },
            { actionId: 'y2', status: 'parent_uncertain' }
          ],
          remaining: [],
          parents: [
            { scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' },
            { scope: SPRINT_11, status: 'uncertain', uncertainSince: expired }
          ]
        });
        expect(parentIssues()).toHaveLength(1);
        const team = await record();
        expect(team.jiraParents).toEqual({
          [RETRO_SCOPE]: { key: 'PROJ-1', createdAt: at(), subtaskTypeId: '10005' },
          [SPRINT_11]: { uncertainSince: expired }
        });
        expect(team.jiraParentClaims).toBeUndefined();
        expect(team.jiraClaims).toBeUndefined();
      });

      it('lifts nothing for that scope in the next request of the batch, which carries the same confirmation', async () => {
        await seedDoubts();
        expect((await create({ actionIds: ['a1', 'y1'], forceParentScopes: [RETRO_SCOPE] })).body.results.map((result: Json) => result.status))
          .toEqual(['created', 'parent_uncertain']);
        expect((await create({ actionIds: ['y2'], forceParentScopes: [RETRO_SCOPE] })).body).toEqual({
          results: [{ actionId: 'y2', status: 'parent_uncertain' }],
          remaining: [],
          parents: [{ scope: SPRINT_11, status: 'uncertain', uncertainSince: expired }]
        });
        expect(parentIssues()).toHaveLength(1);
      });

      it('lifts no confirmed doubt with a dead request’s claim on top of it within the request, the earlier mark kept', async () => {
        await seedDoubts({ withMark: true });
        expect((await create({ actionIds: ['y1', 'y2'], forceParentScopes: [SPRINT_11] })).body).toEqual({
          results: [{ actionId: 'y1', status: 'parent_uncertain' }, { actionId: 'y2', status: 'parent_uncertain' }],
          remaining: [],
          parents: [{ scope: SPRINT_11, status: 'uncertain', uncertainSince: at(-7_200_000) }]
        });
        expect(createRequests()).toEqual([]);
        expect((await record()).jiraParents[SPRINT_11]).toEqual({ uncertainSince: at(-7_200_000) });
      });

      it.each([
        ['in doubt', (team: Json) => { team.jiraParents = { [RETRO_SCOPE]: { uncertainSince: shownMark } }; }, 'uncertain'],
        ['being created by another request', (team: Json) => { team.jiraParentClaims = { [RETRO_SCOPE]: { at: at(), requestId: 'another-request' } }; }, 'in_progress']
      ])('names the parent the scope holds when one is stored during the request, after its parent was %s', async (_label, start, first) => {
        await editRecord(start);
        const rival = jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001', summary: 'The other browser’s parent', key: 'PROJ-50' });
        pod.controls.loseTeamWriteAnswer = async (n) => {
          // After the first action's decision: another browser, confirmed,
          // stores the parent it created.
          if (n === 1) {
            await editRecord((team) => {
              team.jiraParents = { [RETRO_SCOPE]: { key: rival, createdAt: at(), subtaskTypeId: '10005' } };
              delete team.jiraParentClaims;
            });
          }
          return false;
        };
        const answer = await create({ actionIds: ['a1', 'a2'] });
        const [subtask] = subtasksOf(rival);
        expect(answer.body.results).toEqual([
          { actionId: 'a1', status: `parent_${first}` },
          { actionId: 'a2', status: 'created', key: subtask.key, parentKey: rival }
        ]);
        // Not the doubt or the claim seen first: the screen caches what this says.
        expect(answer.body.parents).toEqual([{ scope: RETRO_SCOPE, status: 'created', key: rival }]);
        expect(parentIssues().map((issue) => issue.key)).toEqual([rival]);
      });
    });

    // 7.
    it.each([
      ['a required field the integration never sets', { refuseNthCreate: 1, refuseNthCreateErrors: { customfield_10011: 'Epic Name is required.' } },
        ['Epic Name is required.'], ['customfield_10011']],
      ['labels the project does not accept', { refuseLabels: true },
        ["Field 'labels' cannot be set. It is not on the appropriate screen, or unknown."], ['labels']]
    ])('stops the batch when Jira refuses the parent for %s, nothing marked', async (_label, behaviour, jiraMessages, jiraFields) => {
      jira.setBehaviour(behaviour);
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'parent_refused', jiraMessages, jiraFields }],
        remaining: ['a2'],
        stopped: 'jira_parent_refused',
        parents: [{ scope: RETRO_SCOPE, status: 'refused', jiraMessages, jiraFields }]
      });
      expect(createRequests()).toHaveLength(1);
      const team = await record();
      expect(team.jiraParents).toBeUndefined();
      expect(team.jiraParentClaims).toBeUndefined();
      expect(copiesOf(team, 'a1')[0].jira).toBeUndefined();
    });

    // 8.
    it('counts the parent as one creation: past the budget, its key is saved and the action waits for the next request', async () => {
      pod.controls.msPerCreate = 11000;
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [],
        remaining: ['a1'],
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      const team = await record();
      expect(team.jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
      expect(team.jiraClaims).toBeUndefined();
      expect(team.jiraParentClaims).toBeUndefined();

      pod.controls.msPerCreate = 0;
      jira.reset();
      jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'created', key: 'PROJ-2', parentKey: 'PROJ-1' }]);
      expect(createRequests()).toHaveLength(1);
    });

    // 9.
    it('stops after the parent’s key when the pod starts draining during the parent’s creation', async () => {
      pod.controls.onCreate = () => {
        pod.controls.shuttingDown = true;
      };
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [],
        remaining: ['a1', 'a2'],
        stopped: 'server_restarting',
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      // One Jira call after the flip: the one in flight.
      expect(createRequests()).toHaveLength(1);
      const team = await record();
      expect(team.jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
      expect(team.jiraClaims).toBeUndefined();
    });

    it('stops after the parent’s key when the caller leaves during the parent’s creation', async () => {
      const controller = new AbortController();
      pod.controls.onCreate = async () => {
        if (controller.signal.aborted) return;
        const { socket } = pod.issuesRequests[0];
        const closed = new Promise((resolve) => {
          if (socket.destroyed) resolve(undefined);
          else socket.once('close', resolve);
        });
        controller.abort();
        await closed;
      };
      await expect(pod.post(issuesPath(TEAM_ID), pod.asTeam(TEAM_ID, { actionIds: ['a1', 'a2'] }), controller.signal)).rejects.toThrow();
      expect(await pod.issuesRequests[0].answered).toEqual({
        results: [],
        remaining: ['a1', 'a2'],
        stopped: 'client_gone',
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      expect(createRequests()).toHaveLength(1);
      expect((await record()).jiraClaims).toBeUndefined();
    });

    // 10.
    it('answers the parent’s key when it cannot be saved, and leaves its claim to expire into a doubt', async () => {
      // Write 1 claims the parent; writes 2 to 4, its key, all fail.
      pod.controls.failTeamWrite = (n) => n >= 2;
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [],
        remaining: ['a1'],
        stopped: 'link_not_saved',
        parents: [{ scope: RETRO_SCOPE, status: 'not_saved', key: 'PROJ-1' }]
      });
      expect(vi.mocked(console.error).mock.calls.some(([line]) => String(line).includes('PROJ-1') && String(line).includes(RETRO_SCOPE))).toBe(true);
      pod.controls.failTeamWrite = () => false;
      let team = await record();
      expect(team.jiraParents).toBeUndefined();
      expect(team.jiraParentClaims).toEqual({ [RETRO_SCOPE]: expect.objectContaining({ at: at() }) });

      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'parent_in_progress' }]);
      pod.controls.clockMs += JIRA_CLAIM_TTL_MS;
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'parent_uncertain' }]);
      team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { uncertainSince: at() } });
      expect(jira.issues()).toHaveLength(1);
    });

    // 11.
    it('keeps the parent another request stored meanwhile, creates the sub-task under it, and logs the duplicate', async () => {
      let raced = false;
      pod.controls.onCreate = async () => {
        if (raced) return;
        raced = true;
        const rival = jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001', summary: 'The rival’s parent' });
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.jiraParents = { [RETRO_SCOPE]: { key: rival, createdAt: at(), subtaskTypeId: '10005' } };
          return team;
        });
      };
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'created', key: 'PROJ-3', parentKey: 'PROJ-1' }],
        remaining: [],
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      expect(subtasksOf('PROJ-1').map((issue) => issue.key)).toEqual(['PROJ-3']);
      expect((await record()).jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
      expect(vi.mocked(console.error).mock.calls.some(([line]) => {
        const text = String(line);
        return text.includes('PROJ-2') && text.includes('PROJ-1') && text.includes('duplicate') && text.includes(RETRO_SCOPE);
      })).toBe(true);
    });

    // 12.
    it('creates under a parent in another project with the sub-task type recorded for it, and the target’s own type otherwise', async () => {
      const ops = jira.addIssue({ projectKey: 'OPS', issueTypeId: '10001' });
      const proj = jira.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
      await editRecord((team) => {
        team.jiraParents = {
          [RETRO_SCOPE]: { key: ops, createdAt: at(-1000), subtaskTypeId: '10006' },
          // Recorded before the target's sub-task type changed: the target wins in its own project.
          [HC_SCOPE]: { key: proj, createdAt: at(-1000), subtaskTypeId: '99999' }
        };
      });
      expect((await create({ actionIds: ['a1', 'h1'] })).body.results).toEqual([
        { actionId: 'a1', status: 'created', key: 'OPS-2', parentKey: ops },
        { actionId: 'h1', status: 'created', key: 'PROJ-2', parentKey: proj }
      ]);
      expect(subtasksOf(ops)[0].fields).toMatchObject({ project: { key: 'OPS' }, parent: { key: ops }, issuetype: { id: '10006' } });
      expect(subtasksOf(proj)[0].fields).toMatchObject({ project: { key: 'PROJ' }, parent: { key: proj }, issuetype: { id: '10005' } });
    });

    // 14.
    it('never creates a parent for an action it would not send', async () => {
      await editRecord((team) => {
        const [a1, a2, a3, a4] = team.retrospectives[0].actions;
        a1.jira = { key: 'PROJ-41', createdAt: at(-1000) };
        a2.jira = { uncertainSince: at(-1000) };
        a4.text = ' ';
        team.jiraClaims = { [a3.id]: { at: at(), requestId: 'another-request' } };
      });
      expect((await create({ actionIds: ['b-done', 'a1', 'a2', 'a3', 'a4', 'p1'] })).body).toEqual({
        results: [
          { actionId: 'b-done', status: 'closed' },
          { actionId: 'a1', status: 'already_linked', key: 'PROJ-41' },
          { actionId: 'a2', status: 'uncertain' },
          { actionId: 'a3', status: 'in_progress' },
          { actionId: 'a4', status: 'refused', reason: 'no_text', jiraMessages: [] },
          { actionId: 'p1', status: 'not_found' }
        ],
        remaining: []
      });
      expect(createRequests()).toEqual([]);
      const team = await record();
      expect(team.jiraParents).toBeUndefined();
      expect(team.jiraParentClaims).toBeUndefined();
    });

    // 16.
    it('lets no claim span two Jira calls: the parent’s claim goes in the write that claims the action', async () => {
      const seen: Json[] = [];
      pod.controls.onCreate = async () => {
        const team = await record();
        seen.push({ claims: team.jiraClaims ?? null, parentClaims: team.jiraParentClaims ?? null });
      };
      await create({ actionIds: ['a1'] });
      expect(seen).toEqual([
        // The parent's call: the scope claimed, the action not yet.
        { claims: null, parentClaims: { [RETRO_SCOPE]: expect.objectContaining({ at: at() }) } },
        // The sub-task's call: the action claimed, the parent's claim gone.
        { claims: { a1: expect.objectContaining({ at: at() }) }, parentClaims: null }
      ]);
    });

    // 17.
    it('keeps a fresh parent whose first sub-task Jira refuses, and never creates a second one for the session', async () => {
      jira.setBehaviour({ refuseNthCreate: 2 });
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'refused', jiraMessages: ['Team is required.'], jiraFields: ['customfield_10100'] }],
        remaining: [],
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      expect((await record()).jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');

      expect((await create({ actionIds: ['a2'] })).body.results).toEqual([{ actionId: 'a2', status: 'created', key: 'PROJ-2', parentKey: 'PROJ-1' }]);
      expect(parentIssues()).toHaveLength(1);
    });

    it('stops with jira_target_refused when Jira refuses a sub-task for a field the target sets, the fresh parent kept', async () => {
      jira.setBehaviour({ refuseNthCreate: 2, refuseNthCreateErrors: { issuetype: 'The issue type selected is invalid.' } });
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'refused', jiraMessages: ['The issue type selected is invalid.'], jiraFields: ['issuetype'] }],
        remaining: ['a2'],
        stopped: 'jira_target_refused',
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      expect((await record()).jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
    });

    // 18.
    it('answers in progress, with no sub-task and no claim of its own, when another request took the action while its parent was created', async () => {
      const takeover = { at: at(), requestId: 'another-request' };
      let taken = false;
      pod.controls.onCreate = async () => {
        if (taken) return;
        taken = true;
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.jiraClaims = { a1: takeover };
          return team;
        });
      };
      expect((await create({ actionIds: ['a1'] })).body).toEqual({
        results: [{ actionId: 'a1', status: 'in_progress' }],
        remaining: [],
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      expect(createRequests()).toHaveLength(1);
      const team = await record();
      expect(team.jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
      expect(team.jiraClaims).toEqual({ a1: takeover });
    });

    // 19.
    it('starts no sub-task when the pod starts draining during the parent’s write, and releases the action’s claim', async () => {
      // Write 1 claims the parent; write 2 stores its key and claims a1, and
      // the SIGTERM lands while it runs.
      pod.controls.failTeamWrite = (n) => {
        if (n === 2) pod.controls.shuttingDown = true;
        return false;
      };
      expect((await create({ actionIds: ['a1', 'a2'] })).body).toEqual({
        results: [],
        remaining: ['a1', 'a2'],
        stopped: 'server_restarting',
        parents: [{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]
      });
      expect(createRequests()).toHaveLength(1);
      const team = await record();
      expect(team.jiraClaims).toBeUndefined();
      expect(copiesOf(team, 'a1')[0].jira).toBeUndefined();
      expect(team.jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
    });

    it('applies a one-time sessionParent target like the stored one, and stores the parent it creates', async () => {
      // The dialog's "change the target for this creation only" offers the
      // mode too [R3]: the parent it creates is the session's from then on.
      await pod.post(`/api/team/${TEAM_ID}/jira/target`, pod.asTeam(TEAM_ID, { target: TARGET }));
      expect((await create({ actionIds: ['a1'], target: SESSION_TARGET })).body.parents).toEqual([{ scope: RETRO_SCOPE, status: 'created', key: 'PROJ-1' }]);
      const team = await record();
      expect(team.jiraParents[RETRO_SCOPE].key).toBe('PROJ-1');
      expect(team.jiraTarget).toEqual(TARGET);
    });
  });

  // 13.
  describe('naming the parent at send time (adoptParent)', () => {
    const at = (offsetMs = 0) => new Date(CLOCK_START + offsetMs).toISOString();
    let named: string;
    const sendUnder = (extra: Json = {}) => ({ target: { mode: 'parent', parentKey: named, issueTypeId: '10006', labels: [] }, adoptParent: true, ...extra });

    beforeEach(async () => {
      expect((await pod.post(`/api/team/${TEAM_ID}/jira/target`, pod.asTeam(TEAM_ID, { target: SESSION_TARGET }))).status).toBe(200);
      jira.reset();
      named = jira.addIssue({ projectKey: 'OPS', issueTypeId: '10001', summary: 'Named at send time' });
      pod.resetCounts();
    });

    it('becomes the parent of each scope without one, or with a doubt, and leaves a scope’s key alone', async () => {
      await editRecord((team) => {
        team.jiraParents = { backlog: { uncertainSince: at(-5000) }, [HC_SCOPE]: { key: 'PROJ-9', createdAt: at(-5000), subtaskTypeId: '10005' } };
      });
      const answer = await create({ actionIds: ['a1', 'b1', 'h1'], ...sendUnder() });

      expect(answer.body).toEqual({
        results: [
          { actionId: 'a1', status: 'created', key: 'OPS-2', parentKey: named },
          { actionId: 'b1', status: 'created', key: 'OPS-3', parentKey: named },
          { actionId: 'h1', status: 'created', key: 'OPS-4', parentKey: named }
        ],
        remaining: [],
        parents: [
          { scope: RETRO_SCOPE, status: 'adopted', key: named },
          { scope: 'backlog', status: 'adopted', key: named }
        ]
      });
      expect(jira.issues({ parentKey: named })).toHaveLength(3);
      expect((await record()).jiraParents).toEqual({
        [RETRO_SCOPE]: { key: named, createdAt: at(), subtaskTypeId: '10006' },
        backlog: { key: named, createdAt: at(), subtaskTypeId: '10006' },
        [HC_SCOPE]: { key: 'PROJ-9', createdAt: at(-5000), subtaskTypeId: '10005' }
      });
    });

    it('replaces a scope’s key only when asked to', async () => {
      await editRecord((team) => {
        team.jiraParents = { [HC_SCOPE]: { key: 'PROJ-9', createdAt: at(-5000) } };
      });
      expect((await create({ actionIds: ['h1'], ...sendUnder({ replaceParents: true }) })).body.parents)
        .toEqual([{ scope: HC_SCOPE, status: 'adopted', key: named }]);
      expect((await record()).jiraParents).toEqual({ [HC_SCOPE]: { key: named, createdAt: at(), subtaskTypeId: '10006' } });
    });

    it('replaces an expired parent claim, and leaves a live one alone while still sending under the named parent', async () => {
      await editRecord((team) => {
        team.jiraParentClaims = {
          [RETRO_SCOPE]: { at: at(-JIRA_CLAIM_TTL_MS - 1), requestId: 'a-request-that-died' },
          [HC_SCOPE]: { at: at(), requestId: 'another-request' }
        };
      });
      const answer = await create({ actionIds: ['a1', 'h1'], ...sendUnder() });
      expect(answer.body.results.map((result: Json) => [result.status, result.parentKey])).toEqual([['created', named], ['created', named]]);
      expect(answer.body.parents).toEqual([{ scope: RETRO_SCOPE, status: 'adopted', key: named }]);
      const team = await record();
      expect(team.jiraParents).toEqual({ [RETRO_SCOPE]: { key: named, createdAt: at(), subtaskTypeId: '10006' } });
      expect(team.jiraParentClaims).toEqual({ [HC_SCOPE]: { at: at(), requestId: 'another-request' } });
    });

    it('stores nothing about parents for a parent-mode send that does not ask to adopt', async () => {
      const answer = await create({ actionIds: ['a1'], target: { mode: 'parent', parentKey: named, issueTypeId: '10006', labels: [] } });
      expect(answer.body).toEqual({ results: [{ actionId: 'a1', status: 'created', key: 'OPS-2', parentKey: named }], remaining: [] });
      expect((await record()).jiraParents).toBeUndefined();
    });

    // [R1] The parent becomes a scope's only once Jira has created a sub-task of it there.
    it.each([
      ['Jira refuses the sub-task', () => { jira.setBehaviour({ refuseNthCreate: 1 }); }, 'refused'],
      ['the sub-task’s answer is lost', () => { jira.setBehaviour({ dropAfterNthCreate: 1 }); }, 'uncertain'],
      ['the sub-task’s key cannot be saved', () => { pod.controls.failTeamWrite = (n) => n >= 2; }, 'created_not_saved']
    ])('adopts nothing when %s', async (_label, fail, status) => {
      const parents = { backlog: { uncertainSince: at(-5000) } };
      await editRecord((team) => {
        team.jiraParents = parents;
      });
      fail();
      const answer = await create({ actionIds: ['a1'], ...sendUnder() });
      expect(answer.body.results[0].status).toBe(status);
      expect(answer.body).not.toHaveProperty('parents');
      pod.controls.failTeamWrite = () => false;
      expect((await record()).jiraParents).toEqual(parents);
    });

    it('adopts in the write that stores the first sub-task’s key, and once per scope', async () => {
      const rev = await revision();
      const answer = await create({ actionIds: ['a1', 'a2'], ...sendUnder() });
      expect(answer.body.parents).toEqual([{ scope: RETRO_SCOPE, status: 'adopted', key: named }]);
      // a1's claim; a1's key, the adoption and a2's claim; a2's key: no write of its own.
      expect(await revision()).toBe(rev + 3);
      expect((await record()).jiraParents[RETRO_SCOPE]).toEqual({ key: named, createdAt: at(), subtaskTypeId: '10006' });
    });

    it('refuses an epic on Jira Cloud as the parent, once, before anything is created', async () => {
      const epics = await startJiraMock({
        contextPath: '/jira',
        deployment: 'Server',
        projects: [{ id: '10000', key: 'PROJ', name: 'Project', issueTypes: [
          { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 },
          { id: '10005', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }
        ] }]
      });
      try {
        const epic = epics.addIssue({ projectKey: 'PROJ', issueTypeId: '10000' });
        // The parent is read from the Jira that holds an epic; nothing is created anywhere.
        pod.controls.readBaseUrl = epics.url;
        const answer = await create({ actionIds: ['a1', 'a2'], target: { mode: 'parent', parentKey: epic, issueTypeId: '10005', labels: [] }, adoptParent: true });
        expect(answer.body).toEqual({ results: [], remaining: ['a1', 'a2'], stopped: 'jira_parent_invalid' });
        expect(createRequests()).toEqual([]);
        expect(epics.requests().filter((entry) => entry.method === 'POST')).toEqual([]);
        expect(pod.controls.teamWrites).toBe(0);
      } finally {
        await epics.close();
      }
    });
  });

  describe('the live sessions', () => {
    const seedSession = async (sessionId: string, data: Json) => {
      store.getSqliteDb()!.prepare('DELETE FROM kv_store WHERE key = ?').run(`session:${sessionId}`);
      const saved = await store.saveSessionState(sessionId, { id: sessionId, _rev: 0, ...data });
      expect(saved.success).toBe(true);
    };
    const session = async (sessionId: string) => (await store.loadSessionState(sessionId)) as Json;

    beforeEach(async () => {
      const team = await record();
      await seedSession(RETRO_ID, {
        teamId: TEAM_ID,
        phase: 'REVIEW',
        reviewSummary: 'We ship smaller.',
        actions: team.retrospectives[0].actions,
        openActionsSnapshot: [action('b1', { text: 'Clean up the backlog' })],
        historyActionsSnapshot: [action('b1', { text: 'Clean up the backlog' })]
      });
      await seedSession(HC_ID, { teamId: TEAM_ID, phase: 'REVIEW', actions: team.healthChecks[0].actions });
      // Another team's row, named by a request that is not its team's.
      await seedSession('foreign-retro', {
        teamId: OTHER_TEAM_ID,
        actions: [action('b1')],
        historyActionsSnapshot: [action('b1')]
      });
      pod.resetCounts();
    });

    const writesTo = (sessionId: string) => pod.store.saveSessionState.mock.calls.filter(([id]) => id === sessionId).length;

    it('patches each touched session once per request, the request’s own session included', async () => {
      const answer = await create({ actionIds: ['a1', 'a2', 'b1', 'h1'], sessionId: RETRO_ID });
      expect(answer.body.results.map((result: Json) => result.status)).toEqual(['created', 'created', 'created', 'created']);

      expect(writesTo(RETRO_ID)).toBe(1);
      expect(writesTo(HC_ID)).toBe(1);
      expect(pod.store.saveSessionState).toHaveBeenCalledTimes(2);
      expect(pod.controls.broadcasts.map(({ room, event }) => [room, event]).sort()).toEqual([
        [HC_ID, 'session-update'],
        [RETRO_ID, 'session-update']
      ]);

      const retro = await session(RETRO_ID);
      const keyOf = (list: Json[], id: string) => list.find((entry) => entry.id === id)?.jira?.key;
      expect(keyOf(retro.actions, 'a1')).toBe('PROJ-1');
      expect(keyOf(retro.actions, 'a2')).toBe('PROJ-2');
      // A previous action, shown only from the session's snapshots (A-5).
      expect(keyOf(retro.historyActionsSnapshot, 'b1')).toBe('PROJ-3');
      expect(keyOf(retro.openActionsSnapshot, 'b1')).toBe('PROJ-3');
      // Nothing else of the session moved.
      expect(retro.reviewSummary).toBe('We ship smaller.');
      expect(keyOf((await session(HC_ID)).actions, 'h1')).toBe('PROJ-4');
    });

    it('carries the key already on the record, not the duplicate, when another request linked the action meanwhile', async () => {
      const other = { key: 'OPS-7', createdAt: '2026-10-20T09:59:00.000Z' };
      pod.controls.onCreate = async () => {
        pod.controls.onCreate = null;
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.globalActions.find((entry: Json) => entry.id === 'shared').jira = { ...other };
          return team;
        });
      };
      await create({ actionIds: ['shared'], sessionId: RETRO_ID });
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'shared').jira).toEqual(other);
    });

    it('carries the key already on the record, not a mark, when another request linked the action and Jira’s answer was lost', async () => {
      jira.setBehaviour({ failStatus: 502, endpoints: ['create'] });
      const other = { key: 'OPS-7', createdAt: '2026-10-20T09:59:00.000Z' };
      pod.controls.onCreate = async () => {
        pod.controls.onCreate = null;
        await store.atomicTeamUpdate(TEAM_ID, (team: Json) => {
          team.globalActions.find((entry: Json) => entry.id === 'shared').jira = { ...other };
          return team;
        });
      };
      await create({ actionIds: ['shared'], sessionId: RETRO_ID });
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'shared').jira).toEqual(other);
    });

    // The session row can be ahead of the record: another request patched it
    // with a key. A mark is "may already be in Jira", and must never take a
    // key's place on screen any more than on the record.
    it('never replaces a key a session already shows with an uncertain mark', async () => {
      jira.setBehaviour({ failStatus: 502, endpoints: ['create'] });
      const shown = { key: 'OPS-9', createdAt: '2026-10-20T09:59:00.000Z' };
      const team = await record();
      await seedSession(RETRO_ID, {
        teamId: TEAM_ID,
        phase: 'REVIEW',
        actions: team.retrospectives[0].actions.map((entry: Json) => (entry.id === 'a1' ? { ...entry, jira: shown } : entry))
      });

      expect((await create({ actionIds: ['a1', 'a2'], sessionId: RETRO_ID })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'a1').jira).toEqual(shown);
    });

    // A parent issue is never put on a session row: it adds no link to carry.
    it('patches nothing for a request that only created a parent', async () => {
      pod.controls.msPerCreate = 11000;
      const answer = await create({ actionIds: ['a1'], sessionId: RETRO_ID, target: SESSION_TARGET });
      expect(answer.body).toMatchObject({ results: [], remaining: ['a1'], parents: [{ scope: RETRO_SCOPE, status: 'created' }] });
      expect(pod.store.saveSessionState).not.toHaveBeenCalled();
      expect(pod.controls.broadcasts).toEqual([]);
    });

    it('still patches each session once when the batch creates their parents', async () => {
      const answer = await create({ actionIds: ['a1', 'a2', 'h1'], sessionId: RETRO_ID, target: SESSION_TARGET });
      expect(answer.body.results.map((result: Json) => result.status)).toEqual(['created', 'created', 'created']);
      expect(answer.body.parents.map((entry: Json) => entry.scope)).toEqual([RETRO_SCOPE, HC_SCOPE]);
      expect(writesTo(RETRO_ID)).toBe(1);
      expect(writesTo(HC_ID)).toBe(1);
      const retro = await session(RETRO_ID);
      expect(retro.actions.find((entry: Json) => entry.id === 'a1').jira?.key).toBe(answer.body.results[0].key);
      // Nothing about the parent on the row.
      expect(JSON.stringify(retro)).not.toContain('jiraParent');
    });

    it('patches nothing when nothing changed', async () => {
      await create({ actionIds: ['a1'], sessionId: RETRO_ID });
      pod.resetCounts();
      expect((await create({ actionIds: ['a1', 'b-done'], sessionId: RETRO_ID })).body.results)
        .toEqual([{ actionId: 'a1', status: 'already_linked', key: 'PROJ-1' }, { actionId: 'b-done', status: 'closed' }]);
      expect(pod.store.saveSessionState).not.toHaveBeenCalled();
    });

    it('carries an already linked key into a session that missed it', async () => {
      await editRecord((team) => {
        team.globalActions[0].jira = { key: 'PROJ-41', createdAt: '2026-10-01T00:00:00.000Z' };
      });
      await create({ actionIds: ['b1'], sessionId: RETRO_ID });
      expect((await session(RETRO_ID)).historyActionsSnapshot[0].jira).toEqual({ key: 'PROJ-41', createdAt: '2026-10-01T00:00:00.000Z' });
    });

    it('carries an uncertain mark into the sessions too', async () => {
      jira.setBehaviour({ failStatus: 502, endpoints: ['create'] });
      await create({ actionIds: ['a1'], sessionId: RETRO_ID });
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'a1').jira)
        .toEqual({ uncertainSince: new Date(CLOCK_START).toISOString() });
    });

    // Marks that no Jira call made: participants must not keep a Create
    // button for an action the record says may already be in Jira.
    it('carries the mark an expired claim leaves into the action’s own session', async () => {
      const at = new Date(CLOCK_START - JIRA_CLAIM_TTL_MS - 1).toISOString();
      await editRecord((team) => {
        team.jiraClaims = { a1: { at, requestId: 'a-request-that-died' } };
      });
      // No session named: the action's home is enough.
      expect((await create({ actionIds: ['a1'] })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'a1').jira).toEqual({ uncertainSince: at });
      expect(writesTo(RETRO_ID)).toBe(1);
      expect(writesTo(HC_ID)).toBe(0);
    });

    it('carries a mark already on the record into a session that missed it', async () => {
      await editRecord((team) => {
        team.retrospectives[0].actions[0].jira = { uncertainSince: '2026-10-19T08:00:00.000Z' };
      });
      expect((await create({ actionIds: ['a1'], sessionId: RETRO_ID })).body.results).toEqual([{ actionId: 'a1', status: 'uncertain' }]);
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'a1').jira)
        .toEqual({ uncertainSince: '2026-10-19T08:00:00.000Z' });
      expect(writesTo(RETRO_ID)).toBe(1);
    });

    it('never patches another team’s session, whatever the request names', async () => {
      const before = await session('foreign-retro');
      const answer = await create({ actionIds: ['b1'], sessionId: 'foreign-retro' });
      expect(answer.body.results).toEqual([{ actionId: 'b1', status: 'created', key: 'PROJ-1' }]);
      expect(writesTo('foreign-retro')).toBe(0);
      expect(await session('foreign-retro')).toEqual(before);
    });

    it('patches the sessions with what was created before a stop', async () => {
      jira.setBehaviour({ rateLimitNthCreate: 2 });
      await create({ actionIds: ['a1', 'a2'], sessionId: RETRO_ID });
      const retro = await session(RETRO_ID);
      expect(retro.actions.find((entry: Json) => entry.id === 'a1').jira?.key).toBe('PROJ-1');
      expect(retro.actions.find((entry: Json) => entry.id === 'a2').jira).toBeUndefined();
      expect(writesTo(RETRO_ID)).toBe(1);
    });

    it('patches the sessions with the keys already saved when a later write fails', async () => {
      // Write 1 claims a1; write 2 saves its key and finds b-done closed;
      // write 3, a2's claim, fails and the request answers 500. a1's key is on
      // the record by then, and the session must show it too.
      pod.controls.failTeamWrite = (n) => n === 3;
      expect(await create({ actionIds: ['a1', 'b-done', 'a2'], sessionId: RETRO_ID }))
        .toEqual({ status: 500, body: { error: 'failed_to_create' } });
      expect(copiesOf(await record(), 'a1')[0].jira?.key).toBe('PROJ-1');
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'a1').jira?.key).toBe('PROJ-1');
      expect(writesTo(RETRO_ID)).toBe(1);
    });

    it('carries into the sessions no mark the record could not store', async () => {
      jira.setBehaviour({ failStatus: 502, endpoints: ['create'] });
      // Write 1 claims a1; write 2, the mark, fails. The record still holds
      // the claim, which expires into the mark; the session shows nothing yet.
      pod.controls.failTeamWrite = (n) => n === 2;
      expect((await create({ actionIds: ['a1'], sessionId: RETRO_ID })).body)
        .toEqual({ results: [{ actionId: 'a1', status: 'uncertain' }], remaining: [], stopped: 'jira_unavailable' });
      expect((await record()).jiraClaims).toEqual({ a1: expect.objectContaining({ at: new Date(CLOCK_START).toISOString() }) });
      expect((await session(RETRO_ID)).actions.find((entry: Json) => entry.id === 'a1').jira).toBeUndefined();
      expect(writesTo(RETRO_ID)).toBe(0);
    });

    it('answers a closed action that has a key as closed, and carries nothing of it into the sessions', async () => {
      // Closed comes first: a closed action is out of the batch, whatever its
      // Jira state. The session shows it among the previous actions.
      await editRecord((team) => {
        team.globalActions.find((entry: Json) => entry.id === 'b-done').jira = { key: 'PROJ-41', createdAt: '2026-10-01T00:00:00.000Z' };
      });
      await seedSession(RETRO_ID, {
        teamId: TEAM_ID,
        phase: 'REVIEW',
        actions: [],
        historyActionsSnapshot: [action('b-done', { done: true })]
      });
      pod.resetCounts();
      expect((await create({ actionIds: ['b-done'], sessionId: RETRO_ID })).body)
        .toEqual({ results: [{ actionId: 'b-done', status: 'closed' }], remaining: [] });
      expect(pod.store.saveSessionState).not.toHaveBeenCalled();
    });
  });

  describe('refused before anything is attempted', () => {
    it('answers 409 without a connection, without a token, and with a token it cannot use', async () => {
      await store.saveJiraSettings({ enabled: false, baseUrl: jira.url, allowSelfSignedCerts: false });
      expect(await create({ actionIds: ['a1'] })).toEqual({ status: 409, body: { error: 'jira_not_configured' } });

      await store.saveJiraSettings({ enabled: true, baseUrl: 'https://jira.elsewhere.example.org', allowSelfSignedCerts: false });
      expect(await create({ actionIds: ['a1'] })).toEqual({ status: 409, body: { error: 'jira_token_unusable' } });

      await store.saveJiraSettings({ enabled: true, baseUrl: jira.url, allowSelfSignedCerts: false });
      await pod.post(`/api/team/${TEAM_ID}/jira/token/delete`, pod.asTeam(TEAM_ID));
      expect(await create({ actionIds: ['a1'] })).toEqual({ status: 409, body: { error: 'jira_token_missing' } });
      expect(jira.requests()).toEqual([]);
      expect(pod.controls.teamWrites).toBe(0);
    });

    it('answers 400 without a target, and for a one-time target that is not one', async () => {
      await pod.post(`/api/team/${TEAM_ID}/jira/target`, pod.asTeam(TEAM_ID, { target: null }));
      pod.resetCounts();
      expect(await create({ actionIds: ['a1'] })).toEqual({ status: 400, body: { error: 'jira_target_missing' } });
      expect(await create({ actionIds: ['a1'], target: { ...TARGET, projectKey: 'not a key' } }))
        .toEqual({ status: 400, body: { error: 'invalid_jira_target' } });
      expect(await create({ actionIds: ['a1'], target: { ...TARGET, labels: ['two words'] } }))
        .toEqual({ status: 400, body: { error: 'invalid_jira_labels' } });
      expect(await create({ actionIds: [] })).toEqual({ status: 400, body: { error: 'invalid_request' } });
      expect(jira.requests()).toEqual([]);
      expect(pod.controls.teamWrites).toBe(0);
    });

    it.each([
      ['no one-time target', {}],
      ['a project-mode one-time target', { target: TARGET }],
      ['a sessionParent one-time target', { target: SESSION_TARGET }]
    ])('answers 400 to adoptParent with %s: there is no parent named to adopt', async (_label, extra) => {
      // Even with a stored parent-mode target: adopting is a choice made for one send.
      await pod.post(`/api/team/${TEAM_ID}/jira/target`, pod.asTeam(TEAM_ID, { target: { mode: 'parent', parentKey: 'PROJ-1', issueTypeId: '10005', labels: [] } }));
      pod.resetCounts();
      expect(await create({ actionIds: ['a1'], adoptParent: true, ...extra })).toEqual({ status: 400, body: { error: 'invalid_request' } });
      expect(jira.requests()).toEqual([]);
      expect(pod.controls.teamWrites).toBe(0);
    });

    it('reads a stored target the rule no longer accepts as none', async () => {
      await editRecord((team) => {
        team.jiraTarget = { mode: 'project', projectKey: 'lowercase', issueTypeId: '10001', labels: [] };
      });
      expect(await create({ actionIds: ['a1'] })).toEqual({ status: 400, body: { error: 'jira_target_missing' } });
    });

    it('never shows the claims in a team response', async () => {
      await editRecord((team) => {
        team.jiraClaims = { a1: { at: new Date(CLOCK_START).toISOString(), requestId: 'r' } };
      });
      const answer = await pod.post(`/api/team/${TEAM_ID}`, pod.asTeam(TEAM_ID));
      expect(answer.status).toBe(200);
      expect(JSON.stringify(answer.body)).not.toContain('jiraClaims');
    });
  });
});

// Two pods on one database, racing on one action: the claim is taken under
// the team's row lock, so exactly one of them creates the issue. SQLite always
// runs; on SQLite two connections in one process never interleave inside a
// transaction, so the race is only truly concurrent on PostgreSQL, e.g.
// `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run __tests__/jiraIssues.test.ts`.
const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-jira-race-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-jira-race-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`two pods racing on one action (${engine.name})`, () => {
    const teamId = `jira-race-${Date.now().toString(36)}`;
    let dir: string;
    let first: Store;
    let second: Store;
    let jira: JiraMock;
    let settingsBefore: unknown;
    const savedEnv: Record<string, string | undefined> = {};
    // The pods share this instead of the `jira-settings` row: on PostgreSQL the
    // row is global to a database other suites run against in parallel
    // (teamSecretStore rewrites and corrupts it on purpose), and the claim
    // raced here takes the team's row lock, not that one.
    const jiraSettings: { value: Json | null } = { value: null };

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      first = createDataStore({ rootDir: dir });
      await first.initDatabase();
      // A second store on the same database stands in for a second pod.
      second = createDataStore({ rootDir: dir });
      await second.initDatabase();
      settingsBefore = await first.loadJiraSettings();
      jira = await startJiraMock({ contextPath: '/jira', deployment: 'Server' });
      await first.saveTeam(teamId, teamRecord(teamId, await hashPassword(TEAM_PASSWORD)));
    });

    afterAll(async () => {
      await first.deleteTeamRecord(teamId).catch(() => {});
      await first.deleteTeamSecret(teamId).catch(() => {});
      await jira.close();
      await second.closeDatabase();
      await first.closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('creates the issue once', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const podA = await startPod({ store: first, jira, jiraSettings });
      const podB = await startPod({ store: second, jira, jiraSettings });
      try {
        await connectTeam(podA, podA.store, jira, teamId);
        jira.reset();
        // Both requests are in flight while Jira works on the first.
        jira.setBehaviour({ delayMs: 100, endpoints: ['create'] });

        const answers = await Promise.all([
          podA.post(issuesPath(teamId), podA.asTeam(teamId, { actionIds: ['a1'] })),
          podB.post(issuesPath(teamId), podB.asTeam(teamId, { actionIds: ['a1'] }))
        ]);

        const statuses = answers.map((answer) => answer.body.results?.[0]?.status).sort();
        expect(statuses).toEqual(['created', 'in_progress']);
        expect(jira.issues()).toHaveLength(1);
        const team = (await second.loadTeam(teamId)) as Json;
        expect(copiesOf(team, 'a1')[0].jira?.key).toBe(jira.issues()[0].key);
        expect(team.jiraClaims).toBeUndefined();
        // The shared row was neither read for the race nor written.
        expect(await first.loadJiraSettings()).toEqual(settingsBefore);
      } finally {
        await podA.close();
        await podB.close();
        vi.restoreAllMocks();
      }
    });

    // The parent's claim is taken under the same row lock: two pods sending
    // two actions of one retro create one parent between them.
    it('creates a session’s parent once', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const podA = await startPod({ store: first, jira, jiraSettings });
      const podB = await startPod({ store: second, jira, jiraSettings });
      try {
        await connectTeam(podA, podA.store, jira, teamId);
        jira.reset();
        jira.setBehaviour({ delayMs: 100, endpoints: ['create'] });

        const answers = await Promise.all([
          podA.post(issuesPath(teamId), podA.asTeam(teamId, { actionIds: ['a2'], target: SESSION_TARGET })),
          podB.post(issuesPath(teamId), podB.asTeam(teamId, { actionIds: ['a3'], target: SESSION_TARGET }))
        ]);

        const statuses = answers.map((answer) => answer.body.results?.[0]?.status).sort();
        expect(statuses).toEqual(['created', 'parent_in_progress']);
        expect(jira.issues({ parentKey: null })).toHaveLength(1);
        const team = (await second.loadTeam(teamId)) as Json;
        expect(team.jiraParents[RETRO_SCOPE].key).toBe(jira.issues({ parentKey: null })[0].key);
        expect(team.jiraParentClaims).toBeUndefined();
      } finally {
        await podA.close();
        await podB.close();
        vi.restoreAllMocks();
      }
    });
  });
}

describe('wired into the real server', () => {
  it('tells the batch when the pod is draining', () => {
    // `registerTeamRoutes` defaults the question to "never", which is also
    // what would let a forgotten argument leave every suite green and a
    // draining pod start creations it may not live to link. A source check:
    // it proves the argument is written, not that it runs.
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
    const call = (name: string) => {
      const start = source.indexOf(`${name}({`);
      expect(start, `${name} is not called in server.js`).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf('})', start));
    };
    expect(call('registerTeamRoutes')).toMatch(/\bisShuttingDown: shutdown\.isShuttingDown\b/);
    // The handler asked is the one the signals run.
    expect(source).toMatch(/const shutdown = createShutdownHandler\(\{/);
    expect(source).toMatch(/process\.once\('SIGTERM', shutdown\)/);

    const teamRoutes = readFileSync(join(__dirname, '..', 'server', 'routes', 'teamRoutes.js'), 'utf8');
    const start = teamRoutes.indexOf('registerJiraTeamRoutes({');
    expect(teamRoutes.slice(start, teamRoutes.indexOf('})', start))).toMatch(/\bisShuttingDown\b/);
  });
});
