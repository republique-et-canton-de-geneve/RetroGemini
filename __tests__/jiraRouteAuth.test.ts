// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { createTeamService } from '../server/services/teamService.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { createJiraCredentials } from '../server/services/jiraCredentials.js';
import { registerJiraTeamRoutes } from '../server/routes/jiraRoutes.js';
import { JIRA_MOCK_PAT, startJiraMock, type JiraMock } from './helpers/jiraMock';

/**
 * T-50 — every team Jira route refuses a caller that is not the team, before
 * doing anything at all.
 *
 * The paths are read out of the Express router of an app built with
 * `registerJiraTeamRoutes` alone, as `superAdminRoutes.test.ts` does for the
 * console, so a route added later without an authentication check fails here
 * without anyone having to remember to list it.
 *
 * The setting is the one where a missing check would do the most: Jira is
 * configured and the team holds a working token. Each of three wrong
 * credentials — a forged token, a valid token of another team, a wrong
 * password — must get a 401, and leave Jira untouched, the team's secret
 * neither read nor written, and the audit trail empty. And it must get that
 * 401 whatever the body: one that carries what the route needs to act, and
 * ones the route would refuse, so a route that judges the body before the
 * caller cannot pass.
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

const TEAM_ID = 'auth-team';
const OTHER_TEAM_ID = 'auth-other-team';
const TEAM_PASSWORD = 'auth-team-password';
const tokenService = createTokenService({
  secureCompare: (a: string, b: string) => a === b,
  superAdminPassword: 'unused',
  tokenSecret: 'jira-route-auth-test-secret'
});

const NAMED_PATHS = [
  '/api/team/:teamId/jira/status',
  '/api/team/:teamId/jira/token',
  '/api/team/:teamId/jira/token/delete',
  '/api/team/:teamId/jira/target',
  '/api/team/:teamId/jira/issue-types',
  '/api/team/:teamId/jira/issues'
];

// Everything any of the routes would act on, in one body.
const ACTIONABLE_BODY = {
  token: JIRA_MOCK_PAT,
  target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: [] },
  projectKey: 'PROJ',
  actionIds: ['a1']
};

// Bodies every route would refuse on its own. A route that judged the body
// before the caller would answer them 400 and tell an anonymous caller what
// it accepts; authenticating first, it answers 401 whatever the body says.
const BODIES: [string, Record<string, unknown>][] = [
  ['an actionable body', ACTIONABLE_BODY],
  ['an empty body', {}],
  ['a malformed body', { actionIds: [], target: 'x', projectKey: 'bad', parentKey: 'bad', token: 42, email: 'a@b' }]
];

const CREDENTIALS: [string, () => Record<string, unknown>][] = [
  ['a forged token', () => ({ sessionToken: 'rg1.forged.token' })],
  ['a valid token of another team', () => ({ sessionToken: tokenService.createSessionToken(OTHER_TEAM_ID, null) })],
  ['a wrong password', () => ({ password: 'not-the-team-password' })]
];

const listJiraTeamPostRoutes = (): string[] => {
  const app = express();
  registerJiraTeamRoutes({
    app,
    dataStore: {},
    tokenService: {},
    authenticateTeam: vi.fn(),
    atomicUpdateTeam: vi.fn()
  });
  const router = (app as unknown as {
    router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  }).router;
  return (router?.stack ?? [])
    .map((layer) => layer.route)
    .filter((route): route is { path: string; methods: Record<string, boolean> } => Boolean(route?.methods?.post))
    .map((route) => route.path);
};

const REGISTERED = listJiraTeamPostRoutes();

let dir: string;
let dataStore: ReturnType<typeof createDataStore>;
let jira: JiraMock;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of PG_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'retro-jira-auth-'));
  process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
  dataStore = createDataStore({ rootDir: dir });
  await dataStore.initDatabase();
  jira = await startJiraMock();

  const passwordHash = await hashPassword(TEAM_PASSWORD);
  for (const id of [TEAM_ID, OTHER_TEAM_ID]) {
    await dataStore.saveTeam(id, { id, name: id, passwordHash, members: [], retrospectives: [], globalActions: [] });
  }
  await dataStore.saveJiraSettings({ enabled: true, baseUrl: jira.url, allowSelfSignedCerts: false });
  await createJiraCredentials({ dataStore, tokenService }).save(TEAM_ID, {
    baseUrl: jira.url,
    credential: { token: JIRA_MOCK_PAT },
    connectedAs: 'Retro Bot',
    serverInfo: { deploymentType: 'Server', version: '10.3.1' }
  });
});

afterAll(async () => {
  await jira.close();
  await dataStore.closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  jira.reset();
});

describe('the team Jira routes, derived from the router', () => {
  it('include the six named paths, so the checks below cannot pass vacuously', () => {
    expect(REGISTERED).toEqual(expect.arrayContaining(NAMED_PATHS));
  });

  describe.each(REGISTERED.flatMap((path) => BODIES.map(([label, body]) => [path, label, body] as const)))('%s, %s', (path, _bodyLabel, body) => {
    it.each(CREDENTIALS)('refuses %s with 401, before Jira, the secret or the audit trail', async (_label, credential) => {
      const secretAccess = {
        loadTeamSecret: vi.fn(dataStore.loadTeamSecret),
        saveTeamSecret: vi.fn(dataStore.saveTeamSecret),
        updateTeamSecret: vi.fn(dataStore.updateTeamSecret),
        deleteTeamSecret: vi.fn(dataStore.deleteTeamSecret),
        loadJiraSettings: vi.fn(dataStore.loadJiraSettings)
      };
      const store = { ...dataStore, ...secretAccess };
      const securityEvents = { record: vi.fn(async () => undefined) };
      const atomicUpdateTeam = vi.fn(async () => ({ success: true }));
      const app = express();
      app.use(express.json());
      registerJiraTeamRoutes({
        app,
        dataStore: store,
        tokenService,
        authenticateTeam: createTeamService({ dataStore: store, tokenService }).authenticateTeam,
        atomicUpdateTeam,
        securityEvents
      });

      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}${path.replace(':teamId', TEAM_ID)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, ...credential() })
        });
        expect(response.status).toBe(401);
        expect((await response.json()).error).toMatch(/^invalid_(token|password)$/);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      expect(jira.requests()).toEqual([]);
      for (const spy of Object.values(secretAccess)) expect(spy).not.toHaveBeenCalled();
      expect(atomicUpdateTeam).not.toHaveBeenCalled();
      expect(securityEvents.record).not.toHaveBeenCalled();
    });
  });
});
