// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { createTeamService } from '../server/services/teamService.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { request as outboundRequest } from '../server/services/outboundHttp.js';
import { SECURITY_ACTIONS } from '../server/services/securityEvents.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { parseJiraIssuesRequest, registerJiraAdminRoutes } from '../server/routes/jiraRoutes.js';
import { createJiraCredentials } from '../server/services/jiraCredentials.js';
import {
  JIRA_MOCK_CLOUD_EMAIL,
  JIRA_MOCK_CLOUD_TOKEN,
  JIRA_MOCK_PAT,
  startJiraMock,
  type JiraMock
} from './helpers/jiraMock';

/**
 * The Jira routes a team's screens and the console call: the status, the
 * team's token, its target, the issue types, and the connection settings.
 *
 * They run on a real data store (SQLite in a temporary directory), the real
 * token service with a fixed signing secret — the one the token envelope's key
 * is derived from — and `helpers/jiraMock` mounted under `/jira`, in its Data
 * Center and its Cloud flavour. What is at stake:
 *
 *  - **the token is write-only.** Once saved it never comes back: not in the
 *    status, not in the team fetch, login, session restore or team list, not
 *    in a backup archive, not in an audit row;
 *  - **the status never calls Jira** and says exactly why a stored token cannot
 *    be used: the address changed, or the key that sealed it is gone;
 *  - **a token is only stored once Jira accepted it**, and a refusal says what
 *    went wrong (Cloud's usual cause has its own code);
 *  - **"refused by Jira" belongs to one token**: a request that started before
 *    the token was replaced does not mark the new one refused.
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

const SIGNING_SECRET = 'jira-routes-test-signing-secret';
const ADMIN_PASSWORD = 'jira-routes-admin-password';
const TEAM_PASSWORD = 'team-password-jira';
const TEAM_ID = 'jira-team';
const OTHER_TEAM_ID = 'jira-other-team';
const TARGET = { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: ['retrospective'] };

type Json = Record<string, any>;
type Answer = { status: number; body: Json; text: string; headers: Headers };
type Recorded = { action: string; actor: string; outcome: string; target?: string | null; detail?: unknown };

let dir: string;
let dataStore: ReturnType<typeof createDataStore>;
let server: JiraMock;
let cloud: JiraMock;
let passwordHash: string;
const savedEnv: Record<string, string | undefined> = {};

const signer = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: ADMIN_PASSWORD, tokenSecret: SIGNING_SECRET });
const teamToken = signer.createSessionToken(TEAM_ID, null);

// Every response body any test read, so the write-only rule can be checked
// against all of them at once.
const bodiesSeen: string[] = [];

const buildApp = async ({
  // `null` stands for no configured secret: the per-process fallback.
  tokenSecret = SIGNING_SECRET as string | null,
  store = dataStore as ReturnType<typeof createDataStore>,
  jiraClientOptions = {} as Json
} = {}) => {
  const tokenService = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: ADMIN_PASSWORD, tokenSecret });
  const teamService = createTeamService({ dataStore: store, tokenService });
  const recorded: Recorded[] = [];
  const securityEvents = { record: vi.fn(async (_req: unknown, event: Recorded) => { recorded.push(event); }) };
  const logService = { addServerLog: vi.fn() };
  const app = express();
  app.use(express.json());
  registerTeamRoutes({
    app,
    dataStore: store,
    teamService,
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService,
    escapeHtml: (value: string) => value,
    securityEvents,
    jiraClientOptions
  });
  registerJiraAdminRoutes({ app, dataStore: store, tokenService, logService, securityEvents, jiraClientOptions });

  const listening = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listening.once('listening', resolve));
  const base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  const read = async (response: Response): Promise<Answer> => {
    const text = await response.text();
    bodiesSeen.push(text);
    let body: Json = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, body, text, headers: response.headers };
  };
  return {
    recorded,
    logService,
    post: async (path: string, payload: Json = {}) => read(await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })),
    get: async (path: string) => read(await fetch(`${base}${path}`)),
    close: () => new Promise<void>((resolve) => listening.close(() => resolve()))
  };
};

type Api = Awaited<ReturnType<typeof buildApp>>;
let api: Api;

const team = (path = '') => `/api/team/${TEAM_ID}/jira${path}`;
const asTeam = (body: Json = {}) => ({ sessionToken: teamToken, ...body });
const asAdmin = (body: Json = {}) => ({ password: ADMIN_PASSWORD, ...body });

const configureJira = (baseUrl: string, { enabled = true, allowSelfSignedCerts = false } = {}) =>
  dataStore.saveJiraSettings({ enabled, baseUrl, allowSelfSignedCerts });
const removeJiraSettings = () => dataStore.getSqliteDb()!.prepare('DELETE FROM kv_store WHERE key = ?').run('jira-settings');
const secretRow = () => dataStore.getSqliteDb()!.prepare('SELECT value FROM kv_store WHERE key = ?').get(`team-secret:${TEAM_ID}`) as { value: string } | undefined;

const saveDataCenterToken = async () => {
  await configureJira(server.url);
  const answer = await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }));
  expect(answer.status).toBe(200);
  return answer;
};

// A port nothing listens on: bound, then released.
const closedPortUrl = async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}/jira`;
};

// The certificate of the TLS case is made for the run; a machine without
// openssl skips it rather than carrying a private key in the repository.
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const NO_TOKEN = { configured: false, usable: false, reason: null, connectedAs: null, deploymentType: null, setAt: null, refusedAt: null };

beforeAll(async () => {
  for (const key of PG_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'retro-jira-routes-'));
  process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
  dataStore = createDataStore({ rootDir: dir });
  await dataStore.initDatabase();
  passwordHash = await hashPassword(TEAM_PASSWORD);
  server = await startJiraMock({ contextPath: '/jira', deployment: 'Server' });
  cloud = await startJiraMock({ contextPath: '/jira', deployment: 'Cloud' });
});

afterAll(async () => {
  await server.close();
  await cloud.close();
  await dataStore.closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  for (const id of [TEAM_ID, OTHER_TEAM_ID]) {
    await dataStore.deleteTeamRecord(id);
    await dataStore.saveTeam(id, {
      id,
      name: id === TEAM_ID ? 'Jira Team' : 'Other Team',
      passwordHash,
      members: [{ id: 'm1', name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
      retrospectives: [],
      globalActions: []
    });
  }
  await dataStore.atomicTeamIndexUpdate(() => new Map([['jira team', TEAM_ID], ['other team', OTHER_TEAM_ID]]));
  removeJiraSettings();
  server.reset();
  cloud.reset();
  api = await buildApp();
});

afterEach(async () => {
  await api.close();
  vi.restoreAllMocks();
});

describe('POST /jira/status', () => {
  it('reads as not configured, with no token, before the console says anything', async () => {
    const answer = await api.post(team('/status'), asTeam());
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ enabled: false, baseUrl: null, target: null, token: NO_TOKEN });
  });

  it('gives the address even while the connection is off, and turns on with it', async () => {
    await configureJira(`${server.url}/`, { enabled: false });
    expect((await api.post(team('/status'), asTeam())).body).toMatchObject({ enabled: false, baseUrl: server.url });

    await configureJira(server.url);
    expect((await api.post(team('/status'), asTeam())).body).toEqual({ enabled: true, baseUrl: server.url, target: null, token: NO_TOKEN });
  });

  it('describes a usable token from its envelope, and the target from the team record', async () => {
    const saved = await saveDataCenterToken();
    await api.post(team('/target'), asTeam({ target: TARGET }));

    const answer = await api.post(team('/status'), asTeam());
    expect(answer.body).toEqual({
      enabled: true,
      baseUrl: server.url,
      target: TARGET,
      token: {
        configured: true,
        usable: true,
        reason: null,
        connectedAs: 'Retro Bot',
        deploymentType: 'Server',
        setAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        refusedAt: null
      }
    });
    // The token route answered the same status, the target aside.
    expect(saved.body.token).toEqual(answer.body.token);
  });

  it('never calls Jira', async () => {
    await saveDataCenterToken();
    server.reset();
    for (let i = 0; i < 3; i += 1) await api.post(team('/status'), asTeam());
    expect(server.requests()).toEqual([]);
  });

  it('says the address changed when the console points at another Jira', async () => {
    await saveDataCenterToken();
    await configureJira('https://jira.elsewhere.example.org');
    expect((await api.post(team('/status'), asTeam())).body.token).toMatchObject({ configured: true, usable: false, reason: 'address_changed' });

    // And with no address at all: the token's address is not the current one.
    await configureJira('', { enabled: false });
    expect((await api.post(team('/status'), asTeam())).body.token).toMatchObject({ usable: false, reason: 'address_changed' });

    // Back to the same Jira, spelt differently: usable again.
    await configureJira(`${server.url.toUpperCase().replace('/JIRA', '/jira')}/`);
    expect((await api.post(team('/status'), asTeam())).body.token).toMatchObject({ usable: true, reason: null });
  });

  it('says the token is unreadable when the signing secret was rotated', async () => {
    await saveDataCenterToken();
    const rotated = await buildApp({ tokenSecret: 'a-rotated-signing-secret' });
    try {
      const answer = await rotated.post(team('/status'), { password: TEAM_PASSWORD });
      expect(answer.status).toBe(200);
      expect(answer.body.token).toMatchObject({ configured: true, usable: false, reason: 'unreadable', connectedAs: 'Retro Bot' });
    } finally {
      await rotated.close();
    }
  });

  it('binds a token to its team: a row moved onto another team does not open there', async () => {
    // The sealed credential names its team, so a secret row copied verbatim
    // onto another team (a hand edit, a botched restore) is unreadable there
    // and is never sent to Jira on that team's behalf.
    await saveDataCenterToken();
    await dataStore.saveTeamSecret(OTHER_TEAM_ID, JSON.parse(secretRow()!.value));
    server.reset();
    const other = (path: string) => `/api/team/${OTHER_TEAM_ID}/jira${path}`;
    const asOther = (body: Json = {}) => ({ sessionToken: signer.createSessionToken(OTHER_TEAM_ID, null), ...body });

    expect((await api.post(other('/status'), asOther())).body.token).toMatchObject({ configured: true, usable: false, reason: 'unreadable' });
    expect(await api.post(other('/issue-types'), asOther({ projectKey: 'PROJ' })))
      .toMatchObject({ status: 409, body: { error: 'jira_token_unusable' } });
    expect(server.requests()).toEqual([]);
    // The team it was sealed for still uses it.
    expect((await api.post(team('/status'), asTeam())).body.token).toMatchObject({ usable: true, reason: null });
  });

  it('reads an envelope it cannot parse as unreadable, never as a 500', async () => {
    await configureJira(server.url);
    await dataStore.saveTeamSecret(TEAM_ID, { jira: { v: 1, iv: 'x', tag: 'y', ct: 'z', setAt: 42 } });
    const answer = await api.post(team('/status'), asTeam());
    expect(answer.status).toBe(200);
    expect(answer.body.token).toEqual({ ...NO_TOKEN, configured: true, reason: 'unreadable' });
  });

  it('answers 500, not "not configured", when the settings cannot be read', async () => {
    const failing = { ...dataStore, loadJiraSettings: async () => { throw new Error('db down'); } };
    const broken = await buildApp({ store: failing as typeof dataStore });
    try {
      expect(await broken.post(team('/status'), asTeam())).toMatchObject({ status: 500, body: { error: 'failed_to_load' } });
    } finally {
      await broken.close();
    }
  });

  // The rows below were not written by the validating routes — another
  // release, another path, a hand edit — and must still read as what the
  // routes would have stored, or as nothing.
  it('reads a stored address that is not a Jira base URL as no connection, and calls nothing', async () => {
    await dataStore.saveJiraSettings({ enabled: true, baseUrl: 'not a url', allowSelfSignedCerts: false });
    expect((await api.post(team('/status'), asTeam())).body).toMatchObject({ enabled: false, baseUrl: null });
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    expect(server.requests()).toEqual([]);
  });

  it.each([
    ['the string "false"', 'false'],
    ['the string "true"', 'true'],
    ['the number 1', 1]
  ])('reads a stored enabled that is %s as off, and calls nothing', async (_label, enabled) => {
    await dataStore.saveJiraSettings({ enabled, baseUrl: server.url, allowSelfSignedCerts: false });
    expect((await api.post(team('/status'), asTeam())).body).toMatchObject({ enabled: false, baseUrl: server.url });
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    expect(server.requests()).toEqual([]);
    expect(secretRow()).toBeUndefined();
  });

  it('reads a stored target the routes would refuse as no target', async () => {
    await dataStore.atomicTeamUpdate(TEAM_ID, (current: Json) => ({ ...current, jiraTarget: { mode: 'epic' } }));
    expect((await api.post(team('/status'), asTeam())).body.target).toBeNull();
  });

  it('reads only the values it knows from the envelope’s clear fields', async () => {
    await saveDataCenterToken();
    const { jira: envelope } = JSON.parse(secretRow()!.value);
    await dataStore.saveTeamSecret(TEAM_ID, { jira: { ...envelope, deploymentType: 'Mainframe', connectedAs: 'x'.repeat(300) } });
    const { token } = (await api.post(team('/status'), asTeam())).body;
    expect(token).toMatchObject({ usable: true, deploymentType: null });
    expect(token.connectedAs).toBe('x'.repeat(255));
  });

  it('never loads the team record: the target comes from the summary cache', async () => {
    // Read on every Review entry and every reconnect, by every participant,
    // while a team's record can weigh megabytes.
    await saveDataCenterToken();
    await api.post(team('/target'), asTeam({ target: TARGET }));
    const loadTeam = vi.fn(dataStore.loadTeam);
    const loadTeamRaw = vi.fn(dataStore.loadTeamRaw);
    const watched = await buildApp({ store: { ...dataStore, loadTeam, loadTeamRaw } as typeof dataStore });
    try {
      expect((await watched.post(team('/status'), asTeam())).body).toMatchObject({ target: TARGET, token: { usable: true } });
      expect(await watched.post(team('/token/delete'), asTeam())).toMatchObject({ status: 200, body: { token: NO_TOKEN } });
    } finally {
      await watched.close();
    }
    expect(loadTeam).not.toHaveBeenCalled();
    expect(loadTeamRaw).not.toHaveBeenCalled();
  });
});

describe('POST /jira/token', () => {
  it('checks a Data Center token with Jira, seals it and records who changed it', async () => {
    await configureJira(server.url);
    const answer = await api.post(team('/token'), asTeam({ token: `  ${JIRA_MOCK_PAT}\n` }));

    expect(answer.status).toBe(200);
    expect(answer.body.token).toMatchObject({ configured: true, usable: true, connectedAs: 'Retro Bot', deploymentType: 'Server' });
    // Bearer, checked with serverInfo then myself.
    expect(server.requests().map((r) => [r.path, r.headers.authorization])).toEqual([
      ['/jira/rest/api/2/serverInfo', `Bearer ${JIRA_MOCK_PAT}`],
      ['/jira/rest/api/2/myself', `Bearer ${JIRA_MOCK_PAT}`]
    ]);
    // Sealed: the row holds no token, only what describes it.
    const row = JSON.parse(secretRow()!.value);
    expect(row.jira).toMatchObject({ v: 1, baseUrl: server.url, connectedAs: 'Retro Bot', deploymentType: 'Server', version: '10.3.1' });
    expect(secretRow()!.value).not.toContain(JIRA_MOCK_PAT);
    expect(api.recorded).toEqual([{
      action: SECURITY_ACTIONS.TEAM_JIRA_TOKEN_CHANGE,
      actor: `team:${TEAM_ID}`,
      outcome: 'success',
      target: TEAM_ID,
      detail: { cleared: false, via: 'session-token' }
    }]);
  });

  it('records the team password as the credential when that is what authenticated', async () => {
    await configureJira(server.url);
    expect((await api.post(team('/token'), { password: TEAM_PASSWORD, token: JIRA_MOCK_PAT })).status).toBe(200);
    expect(api.recorded[0].detail).toEqual({ cleared: false, via: 'team-password' });
  });

  it('checks a Cloud token with Basic email:token, and keeps the email out of every answer and row', async () => {
    await configureJira(cloud.url);
    const answer = await api.post(team('/token'), asTeam({ token: JIRA_MOCK_CLOUD_TOKEN, email: ` ${JIRA_MOCK_CLOUD_EMAIL.toUpperCase()};` }));

    expect(answer.status).toBe(200);
    expect(answer.body.token).toMatchObject({ usable: true, deploymentType: 'Cloud', connectedAs: 'Retro Bot' });
    const basic = `Basic ${Buffer.from(`${JIRA_MOCK_CLOUD_EMAIL}:${JIRA_MOCK_CLOUD_TOKEN}`).toString('base64')}`;
    expect(cloud.requests().every((r) => r.headers.authorization === basic)).toBe(true);
    expect(answer.text).not.toContain(JIRA_MOCK_CLOUD_EMAIL);
    expect(secretRow()!.value).not.toContain(JIRA_MOCK_CLOUD_EMAIL);
    expect(JSON.stringify(api.recorded)).not.toContain(JIRA_MOCK_CLOUD_EMAIL);
    expect(JSON.stringify(api.recorded)).not.toContain(JIRA_MOCK_CLOUD_TOKEN);
  });

  it('replaces the token: a new envelope, a new date, the old token gone', async () => {
    await saveDataCenterToken();
    const first = JSON.parse(secretRow()!.value).jira;
    await new Promise((resolve) => setTimeout(resolve, 5));
    server.setAuth({ bearer: 'a-second-personal-access-token' });

    const answer = await api.post(team('/token'), asTeam({ token: 'a-second-personal-access-token' }));
    expect(answer.status).toBe(200);
    const second = JSON.parse(secretRow()!.value).jira;
    expect(second.iv).not.toBe(first.iv);
    expect(second.setAt > first.setAt).toBe(true);
    expect(answer.body.token.setAt).toBe(second.setAt);
    expect(api.recorded).toHaveLength(2);
  });

  it.each([
    ['absent', {}],
    ['blank', { token: '   ' }],
    ['not a string', { token: 42 }]
  ])('refuses a token that is %s, before calling Jira', async (_label, body) => {
    await configureJira(server.url);
    expect(await api.post(team('/token'), asTeam(body))).toMatchObject({ status: 400, body: { error: 'jira_token_missing' } });
    expect(server.requests()).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['blank', '   ']
  ])('reads an %s email as none: a Data Center token, sent as Bearer', async (_label, email) => {
    await configureJira(server.url);
    expect((await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT, email }))).status).toBe(200);
    expect(server.requests().map((r) => r.headers.authorization)).toEqual([`Bearer ${JIRA_MOCK_PAT}`, `Bearer ${JIRA_MOCK_PAT}`]);
  });

  it('refuses an email that is not one address, before calling Jira', async () => {
    await configureJira(cloud.url);
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_CLOUD_TOKEN, email: 'a@b.ch, c@d.ch' })))
      .toMatchObject({ status: 400, body: { error: 'invalid_email' } });
    expect(cloud.requests()).toEqual([]);
  });

  it('answers a value no header can carry as refused, without sending it', async () => {
    await configureJira(server.url);
    expect(await api.post(team('/token'), asTeam({ token: 'two words' }))).toMatchObject({ status: 400, body: { error: 'jira_auth_failed' } });
    expect(await api.post(team('/token'), asTeam({ token: 'x'.repeat(5000) }))).toMatchObject({ status: 400, body: { error: 'jira_auth_failed' } });
    expect(server.requests()).toEqual([]);
  });

  it('answers 409 while the console has not turned Jira on', async () => {
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    await configureJira(server.url, { enabled: false });
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    expect(secretRow()).toBeUndefined();
  });

  it('refuses to store a token without a stable signing secret', async () => {
    await configureJira(server.url);
    const unstable = await buildApp({ tokenSecret: null });
    try {
      expect(await unstable.post(team('/token'), { password: TEAM_PASSWORD, token: JIRA_MOCK_PAT }))
        .toMatchObject({ status: 503, body: { error: 'jira_secret_unavailable' } });
    } finally {
      await unstable.close();
    }
    expect(secretRow()).toBeUndefined();
    expect(server.requests()).toEqual([]);
  });

  // The secret templates ship a value anyone can read: a token sealed under it
  // is open to whoever holds a dump.
  it('refuses to store a token under the example signing secret', async () => {
    await configureJira(server.url);
    const published = await buildApp({ tokenSecret: 'change-me-to-a-long-random-secret' });
    try {
      expect(await published.post(team('/token'), { password: TEAM_PASSWORD, token: JIRA_MOCK_PAT }))
        .toMatchObject({ status: 503, body: { error: 'jira_secret_unavailable' } });
    } finally {
      await published.close();
    }
    expect(secretRow()).toBeUndefined();
    expect(server.requests()).toEqual([]);
  });

  it('answers a token Jira refuses with 400, never 401, and stores nothing', async () => {
    await configureJira(server.url);
    const answer = await api.post(team('/token'), asTeam({ token: 'not-the-right-token' }));
    expect(answer).toMatchObject({ status: 400, body: { error: 'jira_auth_failed' } });
    expect(secretRow()).toBeUndefined();
    expect(api.recorded).toEqual([]);
  });

  it('says so when Jira Cloud refuses it, the usual cause being a scoped or expired API token', async () => {
    await configureJira(cloud.url);
    expect(await api.post(team('/token'), asTeam({ token: 'wrong', email: JIRA_MOCK_CLOUD_EMAIL })))
      .toMatchObject({ status: 400, body: { error: 'jira_auth_failed_cloud' } });
    // A token sent without the email reaches Cloud as Bearer, and is refused the same way.
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_CLOUD_TOKEN })))
      .toMatchObject({ status: 400, body: { error: 'jira_auth_failed_cloud' } });
    expect(secretRow()).toBeUndefined();
  });

  it('takes the Cloud hint from the authenticated serverInfo when only myself refuses', async () => {
    await configureJira(cloud.url);
    cloud.setBehaviour({ failStatus: 401, endpoints: ['myself'] });
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_CLOUD_TOKEN, email: JIRA_MOCK_CLOUD_EMAIL })))
      .toMatchObject({ status: 400, body: { error: 'jira_auth_failed_cloud' } });
    // No anonymous call was needed for the hint.
    expect(cloud.requests().filter((r) => !r.headers.authorization)).toEqual([]);
  });

  it('answers 400 jira_forbidden when Jira forbids the account, and 502 when it cannot be reached', async () => {
    await configureJira(server.url);
    server.setBehaviour({ failStatus: 403, endpoints: ['myself'] });
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 400, body: { error: 'jira_forbidden' } });

    await configureJira(await closedPortUrl());
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 502, body: { error: 'jira_unreachable' } });
    expect(secretRow()).toBeUndefined();
  });

  it('answers an unexpected Jira answer as unavailable', async () => {
    await configureJira(server.url);
    server.setBehaviour({ failStatus: 503 });
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).toMatchObject({ status: 502, body: { error: 'jira_unavailable' } });
  });

  it.each([
    ['a session token', () => asTeam()],
    ['the team password', () => ({ password: TEAM_PASSWORD })]
  ])('takes the token back when the team was deleted while Jira answered (%s)', async (_label, credential) => {
    // The team is really deleted, at the moment Jira answers `myself`: after
    // the caller was authenticated, before the token is sealed and stored.
    await configureJira(server.url);
    const racing = await buildApp({
      jiraClientOptions: {
        request: async (options: { url: string }) => {
          const answer = await outboundRequest(options as Parameters<typeof outboundRequest>[0]);
          if (options.url.endsWith('/rest/api/2/myself')) await dataStore.deleteTeamRecord(TEAM_ID);
          return answer;
        }
      }
    });
    try {
      expect(await racing.post(team('/token'), { ...credential(), token: JIRA_MOCK_PAT }))
        .toMatchObject({ status: 401, body: { error: 'team_not_found' } });
      expect(racing.recorded).toEqual([]);
    } finally {
      await racing.close();
    }
    expect(server.requests().map((r) => r.path)).toEqual(['/jira/rest/api/2/serverInfo', '/jira/rest/api/2/myself']);
    expect(await dataStore.teamExists(TEAM_ID)).toBe(false);
    expect(secretRow()).toBeUndefined();
  });
});

describe('POST /jira/token/delete', () => {
  it('removes the token and records it', async () => {
    await saveDataCenterToken();
    api.recorded.length = 0;

    const answer = await api.post(team('/token/delete'), asTeam());
    expect(answer.status).toBe(200);
    expect(answer.body.token).toEqual(NO_TOKEN);
    expect(secretRow()).toBeUndefined();
    expect(api.recorded).toEqual([{
      action: SECURITY_ACTIONS.TEAM_JIRA_TOKEN_CHANGE,
      actor: `team:${TEAM_ID}`,
      outcome: 'success',
      target: TEAM_ID,
      detail: { cleared: true, via: 'session-token' }
    }]);
  });

  it('records nothing when there was no token to remove', async () => {
    expect((await api.post(team('/token/delete'), asTeam())).status).toBe(200);
    expect(api.recorded).toEqual([]);
  });
});

describe('the token is write-only', () => {
  it('never appears in any answer of any team route, nor in a backup archive', async () => {
    bodiesSeen.length = 0;
    await saveDataCenterToken();
    const { value: sealedRow } = secretRow()!;
    const { ct } = JSON.parse(sealedRow).jira;

    await api.post(team('/status'), asTeam());
    await api.post(team('/target'), asTeam({ target: TARGET }));
    // A real issue-types answer, made with the stored token.
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' })))
      .toMatchObject({ status: 200, body: { projectKey: 'PROJ', issueTypes: expect.arrayContaining([expect.objectContaining({ id: '10001' })]) } });
    expect((await api.post(`/api/team/${TEAM_ID}`, asTeam())).status).toBe(200);
    expect((await api.post('/api/team/login', { teamName: 'Jira Team', password: TEAM_PASSWORD })).status).toBe(200);
    expect((await api.post('/api/team/restore-session', { sessionToken: teamToken })).status).toBe(200);
    expect((await api.get('/api/team/list')).status).toBe(200);

    // Then a Cloud credential, whose email is half of the secret.
    await configureJira(cloud.url);
    // Stored for real: otherwise the bodies below would be searched for a
    // credential that was never saved, and the check would prove nothing.
    expect(await api.post(team('/token'), asTeam({ token: JIRA_MOCK_CLOUD_TOKEN, email: JIRA_MOCK_CLOUD_EMAIL })))
      .toMatchObject({ status: 200, body: { token: { usable: true, deploymentType: 'Cloud' } } });
    expect((await api.post(team('/status'), asTeam())).body.token).toMatchObject({ usable: true, deploymentType: 'Cloud' });
    expect((await api.post(`/api/team/${TEAM_ID}`, asTeam())).status).toBe(200);

    expect(bodiesSeen.length).toBeGreaterThan(9);
    for (const body of bodiesSeen) {
      for (const secret of [JIRA_MOCK_PAT, JIRA_MOCK_CLOUD_TOKEN, JIRA_MOCK_CLOUD_EMAIL, ct]) {
        expect(body).not.toContain(secret);
      }
    }

    const archive = JSON.stringify(await dataStore.loadPersistedData());
    for (const secret of [JIRA_MOCK_PAT, JIRA_MOCK_CLOUD_TOKEN, JIRA_MOCK_CLOUD_EMAIL, ct, 'team-secret']) {
      expect(archive).not.toContain(secret);
    }
  });
});

describe('POST /jira/target', () => {
  const stored = async () => ((await dataStore.loadTeam(TEAM_ID)) as Json).jiraTarget;

  it('stores a project target, normalised, and answers the status with it', async () => {
    const answer = await api.post(team('/target'), asTeam({
      target: { ...TARGET, labels: ['retrospective', 'retrospective', 'sprint-12'], parentKey: 'PROJ-9', extra: 'dropped' }
    }));
    const expected = { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: ['retrospective', 'sprint-12'] };
    expect(answer.status).toBe(200);
    expect(answer.body.target).toEqual(expected);
    expect(await stored()).toEqual(expected);
  });

  it('stores a parent target with no labels', async () => {
    const target = { mode: 'parent', parentKey: 'PROJ-12', issueTypeId: '10005' };
    expect((await api.post(team('/target'), asTeam({ target }))).body.target).toEqual({ ...target, labels: [] });
  });

  // One parent issue per retrospective or health check (F2): the status
  // carries it back to every screen, as for the other two modes.
  it('stores a sessionParent target and answers the status with it', async () => {
    const target = { mode: 'sessionParent', projectKey: 'PROJ', parentIssueTypeId: '10001', issueTypeId: '10005', labels: ['retro'] };
    const answer = await api.post(team('/target'), asTeam({ target: { ...target, parentKey: 'PROJ-9' } }));
    expect(answer.status).toBe(200);
    expect(answer.body.target).toEqual(target);
    expect(await stored()).toEqual(target);
    expect((await api.post(team('/status'), asTeam())).body.target).toEqual(target);
  });

  it('removes the target with null, and writes nothing when the target is unchanged', async () => {
    await api.post(team('/target'), asTeam({ target: TARGET }));
    const rev = ((await dataStore.loadTeamRaw(TEAM_ID)) as Json)._rev;
    await api.post(team('/target'), asTeam({ target: { ...TARGET } }));
    expect(((await dataStore.loadTeamRaw(TEAM_ID)) as Json)._rev).toBe(rev);

    const cleared = await api.post(team('/target'), asTeam({ target: null }));
    expect(cleared.body.target).toBeNull();
    expect(await dataStore.loadTeam(TEAM_ID)).not.toHaveProperty('jiraTarget');
    const afterClear = ((await dataStore.loadTeamRaw(TEAM_ID)) as Json)._rev;
    await api.post(team('/target'), asTeam({ target: null }));
    expect(((await dataStore.loadTeamRaw(TEAM_ID)) as Json)._rev).toBe(afterClear);
  });

  it.each([
    ['no target at all', undefined, 'invalid_jira_target'],
    ['an unknown mode', { ...TARGET, mode: 'epic' }, 'invalid_jira_target'],
    ['a lower-case project key', { ...TARGET, projectKey: 'proj' }, 'invalid_jira_target'],
    ['an issue type given by name', { ...TARGET, issueTypeId: 'Task' }, 'invalid_jira_target'],
    ['a parent mode without a parent key', { mode: 'parent', issueTypeId: '10005' }, 'invalid_jira_target'],
    ['a sessionParent mode without a parent type', { mode: 'sessionParent', projectKey: 'PROJ', issueTypeId: '10005' }, 'invalid_jira_target'],
    ['a sessionParent mode without a project', { mode: 'sessionParent', parentIssueTypeId: '10001', issueTypeId: '10005' }, 'invalid_jira_target'],
    ['a sessionParent mode with one type for both', { mode: 'sessionParent', projectKey: 'PROJ', parentIssueTypeId: '10005', issueTypeId: '10005' }, 'invalid_jira_target'],
    ['a label with a space', { ...TARGET, labels: ['two words'] }, 'invalid_jira_labels'],
    ['eleven labels', { ...TARGET, labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }, 'invalid_jira_labels'],
    ['labels that are not a list', { ...TARGET, labels: 'retrospective' }, 'invalid_jira_labels']
  ])('refuses %s', async (_label, target, error) => {
    await api.post(team('/target'), asTeam({ target: TARGET }));
    expect(await api.post(team('/target'), asTeam({ target }))).toMatchObject({ status: 400, body: { error } });
    expect(await stored()).toEqual(TARGET);
  });

  it.each([
    ['refused', async () => ({ success: false, error: 'max_retries_exceeded' }), 'max_retries_exceeded'],
    ['thrown', async () => { throw new Error('db down'); }, 'failed_to_save']
  ])('answers 500 when the write is %s, never a status that reads as saved', async (_label, atomicTeamUpdate, error) => {
    await api.post(team('/target'), asTeam({ target: TARGET }));
    const broken = await buildApp({ store: { ...dataStore, atomicTeamUpdate } as typeof dataStore });
    try {
      expect(await broken.post(team('/target'), asTeam({ target: { ...TARGET, projectKey: 'OPS' } })))
        .toMatchObject({ status: 500, body: { error } });
    } finally {
      await broken.close();
    }
    expect(await stored()).toEqual(TARGET);
  });
});

describe('POST /jira/issue-types', () => {
  // The sessionParent form needs a project's standard types (for the parent)
  // and its sub-task types (for the actions) from one read. Every screen
  // filters the list by mode, so a project-mode form still offers none of
  // the sub-task types; `subtasksIncluded` tells the new form it is talking
  // to a pod that sends them.
  it('lists every type of a project from every page, sub-task types included, and says so', async () => {
    await saveDataCenterToken();
    server.reset();

    const answer = await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }));
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      projectKey: 'PROJ',
      subtasksIncluded: true,
      issueTypes: [
        { id: '10001', name: 'Task', subtask: false },
        { id: '10002', name: 'Bug', subtask: false },
        { id: '10003', name: 'Story', subtask: false },
        { id: '10005', name: 'Sub-task', subtask: true }
      ]
    });
    // The mock answers three types a page; the fourth is on page two.
    expect(server.requests().filter((r) => r.path.includes('/createmeta/PROJ/issuetypes'))).toHaveLength(2);
  });

  it('lists the sub-task types of the parent’s project for a parent issue', async () => {
    await saveDataCenterToken();
    const parentKey = server.addIssue({ projectKey: 'OPS', issueTypeId: '10001' });

    const answer = await api.post(team('/issue-types'), asTeam({ parentKey }));
    expect(answer.body).toEqual({ projectKey: 'OPS', issueTypes: [{ id: '10006', name: 'Technical sub-task', subtask: true }] });
    expect(server.requests().some((r) => r.path === `/jira/rest/api/2/issue/${parentKey}?fields=project,issuetype`)).toBe(true);
  });

  it('reads the sub-task types from the project the parent lives in, not the one its key names', async () => {
    // An issue moved from PROJ to OPS still answers to its old key, and a
    // sub-task is created in the parent's project: its types are OPS's.
    await saveDataCenterToken();
    const parentKey = server.addIssue({ key: 'PROJ-77', projectKey: 'OPS', issueTypeId: '10001' });

    const answer = await api.post(team('/issue-types'), asTeam({ parentKey }));
    expect(answer.body).toEqual({ projectKey: 'OPS', issueTypes: [{ id: '10006', name: 'Technical sub-task', subtask: true }] });
    const createmeta = server.requests().map((r) => r.path).filter((path) => path.includes('/createmeta/'));
    expect(createmeta.length).toBeGreaterThan(0);
    expect(createmeta.every((path) => path.startsWith('/jira/rest/api/2/issue/createmeta/OPS/issuetypes'))).toBe(true);
  });

  it('refuses a parent that is itself a sub-task, and says a parent does not exist', async () => {
    await saveDataCenterToken();
    const story = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10003' });
    const subtask = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10005', parentKey: story });

    expect(await api.post(team('/issue-types'), asTeam({ parentKey: subtask }))).toMatchObject({ status: 400, body: { error: 'jira_parent_invalid' } });
    expect(await api.post(team('/issue-types'), asTeam({ parentKey: 'PROJ-999' }))).toMatchObject({ status: 404, body: { error: 'jira_not_found' } });
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'NOPE' }))).toMatchObject({ status: 404, body: { error: 'jira_not_found' } });
  });

  describe('on Jira Cloud, whose types say their hierarchy level', () => {
    let epics: JiraMock;

    beforeAll(async () => {
      epics = await startJiraMock({
        contextPath: '/jira',
        deployment: 'Cloud',
        projects: [{
          id: '10000',
          key: 'PROJ',
          name: 'Project',
          issueTypes: [
            { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 },
            { id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 },
            { id: '10005', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }
          ]
        }]
      });
    });

    afterAll(async () => {
      await epics.close();
    });

    beforeEach(async () => {
      epics.reset();
      await configureJira(epics.url);
      expect((await api.post(team('/token'), asTeam({ token: JIRA_MOCK_CLOUD_TOKEN, email: JIRA_MOCK_CLOUD_EMAIL }))).status).toBe(200);
    });

    it('passes each type’s level on', async () => {
      const answer = await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }));
      expect(answer.body.issueTypes).toEqual([
        { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 },
        { id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 },
        { id: '10005', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }
      ]);
    });

    // Cloud puts sub-tasks under level-0 issues only: an epic named as a
    // parent is refused once, here, before anything is created [R1].
    it('refuses an epic as a parent, as it refuses a sub-task', async () => {
      const epic = epics.addIssue({ projectKey: 'PROJ', issueTypeId: '10000' });
      const task = epics.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
      expect(await api.post(team('/issue-types'), asTeam({ parentKey: epic }))).toMatchObject({ status: 400, body: { error: 'jira_parent_invalid' } });
      expect(await api.post(team('/issue-types'), asTeam({ parentKey: task })))
        .toMatchObject({ status: 200, body: { projectKey: 'PROJ', issueTypes: [{ id: '10005', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }] } });
    });
  });

  it.each([
    ['neither key', {}],
    ['both keys', { projectKey: 'PROJ', parentKey: 'PROJ-1' }],
    ['a malformed project key', { projectKey: 'proj' }],
    ['a malformed parent key', { parentKey: 'PROJ-0' }]
  ])('refuses %s before reading anything', async (_label, body) => {
    await saveDataCenterToken();
    server.reset();
    const loadJiraSettings = vi.fn(dataStore.loadJiraSettings);
    const loadTeamSecret = vi.fn(dataStore.loadTeamSecret);
    const watched = await buildApp({ store: { ...dataStore, loadJiraSettings, loadTeamSecret } as typeof dataStore });
    try {
      expect(await watched.post(team('/issue-types'), asTeam(body))).toMatchObject({ status: 400, body: { error: 'invalid_jira_target' } });
    } finally {
      await watched.close();
    }
    expect(server.requests()).toEqual([]);
    expect(loadJiraSettings).not.toHaveBeenCalled();
    expect(loadTeamSecret).not.toHaveBeenCalled();
  });

  it('answers 409 without a connection, without a token, and with a token it cannot use', async () => {
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    await configureJira(server.url);
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 409, body: { error: 'jira_token_missing' } });
    await api.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }));

    // The console turned the connection off and kept the address: the team's
    // token, still readable, is no longer sent anywhere.
    await configureJira(server.url, { enabled: false });
    server.reset();
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 409, body: { error: 'jira_not_configured' } });
    expect(server.requests()).toEqual([]);

    await configureJira(cloud.url);
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 409, body: { error: 'jira_token_unusable' } });
    expect(cloud.requests()).toEqual([]);
  });

  it('answers a Jira 401 as 400 and marks the token refused', async () => {
    await saveDataCenterToken();
    server.setAuth({ bearer: 'revoked-meanwhile' });

    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 400, body: { error: 'jira_auth_failed' } });
    const { token } = (await api.post(team('/status'), asTeam())).body;
    expect(token).toMatchObject({ usable: true, refusedAt: expect.stringMatching(/^\d{4}-/) });

    // A second refusal keeps the first date.
    await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }));
    expect((await api.post(team('/status'), asTeam())).body.token.refusedAt).toBe(token.refusedAt);
  });

  it('still answers the refusal when it cannot be recorded', async () => {
    // Recording it is best-effort: the client must be told the token was
    // refused, not that something failed.
    await saveDataCenterToken();
    const broken = await buildApp({
      store: { ...dataStore, updateTeamSecret: async () => { throw new Error('db down'); } } as typeof dataStore
    });
    server.setAuth({ bearer: 'revoked-meanwhile' });
    try {
      expect(await broken.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 400, body: { error: 'jira_auth_failed' } });
    } finally {
      await broken.close();
    }
    expect((await api.post(team('/status'), asTeam())).body.token.refusedAt).toBeNull();
  });

  it('does not mark a token refused when it was replaced while the refused call was in flight', async () => {
    // The call to createmeta is held at a gate before it is sent, the token is
    // replaced meanwhile, and only then does the old token reach Jira.
    let reachedGate: () => void = () => {};
    const reached = new Promise<void>((resolve) => { reachedGate = resolve; });
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const gated = await buildApp({
      jiraClientOptions: {
        request: async (options: { url: string }) => {
          if (options.url.includes('/issuetypes')) {
            reachedGate();
            await gate;
          }
          return outboundRequest(options as Parameters<typeof outboundRequest>[0]);
        }
      }
    });
    try {
      await saveDataCenterToken();
      const before = JSON.parse(secretRow()!.value).jira;
      server.setAuth({ bearer: 'the-replacement-token' });

      const inFlight = gated.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }));
      await reached;
      expect((await api.post(team('/token'), asTeam({ token: 'the-replacement-token' }))).status).toBe(200);
      openGate();

      expect(await inFlight).toMatchObject({ status: 400, body: { error: 'jira_auth_failed' } });
      const after = JSON.parse(secretRow()!.value).jira;
      expect(after.iv).not.toBe(before.iv);
      expect(after).not.toHaveProperty('refusedAt');
      expect((await api.post(team('/status'), asTeam())).body.token).toMatchObject({ usable: true, refusedAt: null });
    } finally {
      openGate();
      await gated.close();
    }
  });

  it('tells apart two tokens saved in the same millisecond', async () => {
    // A 401 to token A must not mark token B refused even when B was sealed
    // in the very millisecond A was: the date is then equal, and only the
    // random iv tells the envelopes apart. `now` does not reach the routes,
    // so the credentials are driven directly, on the same store.
    const at = '2026-10-20T10:00:00.000Z';
    const credentials = createJiraCredentials({ dataStore, tokenService: signer, now: () => new Date(at) });
    const save = (token: string) => credentials.save(TEAM_ID, {
      baseUrl: server.url,
      credential: { token },
      connectedAs: 'Retro Bot',
      serverInfo: { deploymentType: 'Server', version: '10.3.1' }
    });
    const stored = async () => ((await dataStore.loadTeamSecret(TEAM_ID)) as Json).jira;

    await save('token-a');
    const tokenA = await stored();
    await save('token-b');
    const tokenB = await stored();
    expect(tokenB.setAt).toBe(tokenA.setAt);
    expect(tokenB.iv).not.toBe(tokenA.iv);

    expect(await credentials.markRefused(TEAM_ID, tokenA)).toBe(false);
    expect(await stored()).not.toHaveProperty('refusedAt');
    // The stored token is still marked by a refusal of its own.
    expect(await credentials.markRefused(TEAM_ID, tokenB)).toBe(true);
    expect((await stored()).refusedAt).toBe(at);
  });

  it('keeps a 403 apart from a refused token, and maps a rate limit and an outage', async () => {
    await saveDataCenterToken();
    server.setBehaviour({ failStatus: 403, endpoints: ['issueTypes'] });
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 400, body: { error: 'jira_forbidden' } });
    expect((await api.post(team('/status'), asTeam())).body.token.refusedAt).toBeNull();

    server.setBehaviour({ failStatus: 429 });
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 429, body: { error: 'jira_rate_limited' } });
    server.setBehaviour({ failStatus: 502 });
    expect(await api.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).toMatchObject({ status: 502, body: { error: 'jira_unavailable' } });
  });

  it('passes on how long Jira asks to wait', async () => {
    await saveDataCenterToken();
    const limited = await buildApp({
      jiraClientOptions: { request: async () => ({ status: 429, headers: { 'retry-after': '30' }, body: '' }) }
    });
    try {
      expect(await limited.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' })))
        .toMatchObject({ status: 429, body: { error: 'jira_rate_limited', retryAfterSeconds: 30 } });
    } finally {
      await limited.close();
    }
  });
});

// The body's shape, checked before anything else is read. A well-formed body
// passes on to the connection check, which answers 409 here (no connection is
// configured); the creation itself is `__tests__/jiraIssues.test.ts`.
const PAST_THE_SHAPE_CHECK = { status: 409, body: { error: 'jira_not_configured' } };

describe('POST /jira/issues: the body', () => {
  it('passes an authenticated, well-formed request on to the connection check', async () => {
    expect(await api.post(team('/issues'), asTeam({ actionIds: ['a1'] }))).toMatchObject(PAST_THE_SHAPE_CHECK);
  });

  it.each([
    ['no ids', {}],
    ['an empty list', { actionIds: [] }],
    ['eleven ids', { actionIds: Array.from({ length: 11 }, (_, i) => `a${i}`) }],
    ['a repeated id', { actionIds: ['a1', 'a1'] }],
    ['a non-string id', { actionIds: [1] }],
    ['a target that is a list', { actionIds: ['a1'], target: [] }],
    ['an unknown language', { actionIds: ['a1'], language: 'de' }],
    ['a force that is not a boolean', { actionIds: ['a1'], force: 'yes' }],
    ['an empty session id', { actionIds: ['a1'], sessionId: '' }],
    ['a session id that is not a string', { actionIds: ['a1'], sessionId: 42 }],
    ['a session id over 128 characters', { actionIds: ['a1'], sessionId: 's'.repeat(129) }],
    ['an action id over 128 characters', { actionIds: ['a'.repeat(129)] }],
    ['a target that is a string', { actionIds: ['a1'], target: 'PROJ' }],
    ['a requester name that is not a string', { actionIds: ['a1'], requestedBy: 42 }],
    ['an adoptParent that is not a boolean', { actionIds: ['a1'], adoptParent: 'yes' }],
    ['a replaceParents that is not a boolean', { actionIds: ['a1'], adoptParent: true, replaceParents: 1 }],
    // [review F2-1] The parents in doubt the facilitator confirmed, by scope:
    // a list of scopes, each once, never more than the request has actions
    // (each action goes under one parent).
    ['a forceParentScopes that is not a list', { actionIds: ['a1'], forceParentScopes: 'retro:r1' }],
    ['a forceParentScopes that is a boolean', { actionIds: ['a1'], forceParentScopes: true }],
    ['a forceParentScopes entry that is not a scope', { actionIds: ['a1'], forceParentScopes: ['r1'] }],
    ['a forceParentScopes entry that is not a string', { actionIds: ['a1'], forceParentScopes: [7] }],
    ['a repeated forceParentScopes entry', { actionIds: ['a1', 'a2'], forceParentScopes: ['backlog', 'backlog'] }],
    ['more forceParentScopes than actions', { actionIds: ['a1'], forceParentScopes: ['retro:r1', 'backlog'] }],
    // Replacing a session's parent is only ever a consequence of naming one.
    ['replaceParents without adoptParent', { actionIds: ['a1'], replaceParents: true }],
    ['replaceParents with adoptParent false', { actionIds: ['a1'], adoptParent: false, replaceParents: true }]
  ])('refuses %s as invalid_request', async (_label, body) => {
    expect(await api.post(team('/issues'), asTeam(body))).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });

  it('accepts every bound at its limit', async () => {
    expect(await api.post(team('/issues'), asTeam({
      actionIds: ['a'.repeat(128), 'b'],
      sessionId: 's'.repeat(128)
    }))).toMatchObject(PAST_THE_SHAPE_CHECK);
  });

  it('cuts a long requester name instead of refusing the batch', async () => {
    // A member's name has no length limit anywhere, and in the issue it is
    // cosmetic (the description keeps 80 characters of it): a facilitator
    // with a long name must still be able to create issues.
    expect(await api.post(team('/issues'), asTeam({ actionIds: ['a1'], requestedBy: 'x'.repeat(257) })))
      .toMatchObject(PAST_THE_SHAPE_CHECK);
    expect(parseJiraIssuesRequest({ actionIds: ['a1'], requestedBy: 'x'.repeat(300) }))
      .toMatchObject({ ok: true, request: { requestedBy: 'x'.repeat(256) } });
    expect(parseJiraIssuesRequest({ actionIds: ['a1'], requestedBy: 'x'.repeat(256) }))
      .toMatchObject({ ok: true, request: { requestedBy: 'x'.repeat(256) } });
    // An emoji is two UTF-16 units: one straddling the cut goes whole, never half.
    expect(parseJiraIssuesRequest({ actionIds: ['a1'], requestedBy: `${'x'.repeat(255)}\u{1F600}` }))
      .toMatchObject({ ok: true, request: { requestedBy: 'x'.repeat(255) } });
  });

  it('keeps what a well-formed body says, with the defaults filled in', () => {
    const defaults = { adoptParent: false, replaceParents: false, forceParentScopes: [] };
    expect(parseJiraIssuesRequest({ actionIds: ['a1', 'a2'] })).toEqual({
      ok: true,
      request: { actionIds: ['a1', 'a2'], target: null, sessionId: null, requestedBy: '', language: null, force: false, ...defaults }
    });
    expect(parseJiraIssuesRequest({ actionIds: ['a1'], target: TARGET, sessionId: 'r1', requestedBy: 'Ann', language: 'fr', force: true }))
      .toEqual({ ok: true, request: { actionIds: ['a1'], target: TARGET, sessionId: 'r1', requestedBy: 'Ann', language: 'fr', force: true, ...defaults } });
    expect(parseJiraIssuesRequest({ actionIds: ['a1', 'a2'], adoptParent: true, replaceParents: true, forceParentScopes: ['retro:r1', 'backlog'] }))
      .toMatchObject({ ok: true, request: { adoptParent: true, replaceParents: true, forceParentScopes: ['retro:r1', 'backlog'] } });
    expect(parseJiraIssuesRequest({ actionIds: ['a1'], adoptParent: false, replaceParents: false, forceParentScopes: [] }))
      .toMatchObject({ ok: true, request: defaults });
    // The boolean of the unreleased draft confirms nothing: a whole request
    // is not a parent the facilitator saw in doubt.
    expect(parseJiraIssuesRequest({ actionIds: ['a1'], forceParent: true })).toEqual({
      ok: true,
      request: { actionIds: ['a1'], target: null, sessionId: null, requestedBy: '', language: null, force: false, ...defaults }
    });
  });
});

describe('the console’s Jira connection', () => {
  it('reads an absent connection as off and empty', async () => {
    expect(await api.post('/api/super-admin/jira-settings', asAdmin())).toMatchObject({
      status: 200,
      body: { enabled: false, baseUrl: '', allowSelfSignedCerts: false }
    });
  });

  it.each([
    ['in another spelling', 'HTTPS://Jira.Example.ORG/', 'https://jira.example.org'],
    ['that is not a Jira base URL', 'not a url', '']
  ])('shows a stored address %s in its canonical form, or none', async (_label, storedUrl, shown) => {
    // Not written by the console's save: another release or path wrote it.
    await dataStore.saveJiraSettings({ enabled: false, baseUrl: storedUrl, allowSelfSignedCerts: 'yes' });
    expect((await api.post('/api/super-admin/jira-settings', asAdmin())).body)
      .toEqual({ enabled: false, baseUrl: shown, allowSelfSignedCerts: false });
  });

  it('takes only true for true: a string never turns Jira on, nor certificate checks off', async () => {
    const answer = await api.post('/api/super-admin/update-jira-settings', asAdmin({
      enabled: 'true',
      baseUrl: server.url,
      allowSelfSignedCerts: 'true'
    }));
    const expected = { enabled: false, baseUrl: server.url, allowSelfSignedCerts: false };
    expect(answer).toMatchObject({ status: 200, body: expected });
    expect(await dataStore.loadJiraSettings()).toEqual(expected);
    expect(api.recorded[0].detail).toEqual(expected);
  });

  it('stores the address in its canonical form and records where tokens now go', async () => {
    const answer = await api.post('/api/super-admin/update-jira-settings', asAdmin({
      enabled: true,
      baseUrl: '  HTTPS://Jira.Example.ORG:443/Context//  ',
      allowSelfSignedCerts: true
    }));
    const expected = { enabled: true, baseUrl: 'https://jira.example.org/Context', allowSelfSignedCerts: true };
    expect(answer).toMatchObject({ status: 200, body: expected });
    expect(await dataStore.loadJiraSettings()).toEqual(expected);
    expect((await api.post('/api/super-admin/jira-settings', asAdmin())).body).toEqual(expected);
    expect(api.recorded).toEqual([{
      action: SECURITY_ACTIONS.JIRA_SETTINGS_UPDATE,
      actor: 'super-admin',
      outcome: 'success',
      detail: expected
    }]);
    expect(api.logService.addServerLog).toHaveBeenCalledWith('info', 'server', 'Jira settings updated (enabled: true)');
  });

  it('allows an empty address only with the connection off', async () => {
    expect(await api.post('/api/super-admin/update-jira-settings', asAdmin({ enabled: false, baseUrl: '' })))
      .toMatchObject({ status: 200, body: { enabled: false, baseUrl: '', allowSelfSignedCerts: false } });
    expect(await api.post('/api/super-admin/update-jira-settings', asAdmin({ enabled: true, baseUrl: ' ' })))
      .toMatchObject({ status: 400, body: { error: 'invalid_jira_base_url' } });
    expect(await dataStore.loadJiraSettings()).toMatchObject({ enabled: false });
  });

  it.each([
    'http://jira.example.org',
    'https://user:pass@jira.example.org',
    'https://jira.example.org/?a=1',
    'https://jira.example.org/#top',
    'ftp://jira.example.org',
    42
  ])('refuses %s and saves nothing', async (baseUrl) => {
    expect(await api.post('/api/super-admin/update-jira-settings', asAdmin({ enabled: true, baseUrl })))
      .toMatchObject({ status: 400, body: { error: 'invalid_jira_base_url' } });
    expect(await dataStore.loadJiraSettings()).toBeNull();
    expect(api.recorded).toEqual([]);
  });

  it('answers 500 and records nothing when the save fails', async () => {
    const failing = { ...dataStore, saveJiraSettings: async () => { throw new Error('disk full'); } };
    const broken = await buildApp({ store: failing as typeof dataStore });
    try {
      expect(await broken.post('/api/super-admin/update-jira-settings', asAdmin({ enabled: true, baseUrl: server.url })))
        .toMatchObject({ status: 500, body: { error: 'failed_to_save' } });
      expect(broken.recorded).toEqual([]);
    } finally {
      await broken.close();
    }
  });

  it('answers 500 when the settings cannot be read, rather than an empty form', async () => {
    const failing = { ...dataStore, loadJiraSettings: async () => { throw new Error('db down'); } };
    const broken = await buildApp({ store: failing as typeof dataStore });
    try {
      expect(await broken.post('/api/super-admin/jira-settings', asAdmin())).toMatchObject({ status: 500, body: { error: 'failed_to_load' } });
    } finally {
      await broken.close();
    }
  });

  // A team route answers a bare `jira_unreachable`, as the `/api/ai/*` routes
  // answer a bare `ai_error`: a team credential gets no deployment detail.
  // The detail goes to the log, which only the super admin reads.
  it('logs why a team route could not reach Jira, and tells the team only that it could not', async () => {
    await saveDataCenterToken();
    const unreachable = await closedPortUrl();
    const request = (options: Parameters<typeof outboundRequest>[0]) => outboundRequest(
      options.url.includes('/issuetypes') ? { ...options, url: options.url.replace(server.url, unreachable) } : options
    );
    const app = await buildApp({ jiraClientOptions: { request } });
    let answer: Answer;
    try {
      answer = await app.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }));
    } finally {
      await app.close();
    }
    expect(answer.status).toBe(502);
    expect(answer.body).toEqual({ error: 'jira_unreachable' });
    const lines = vi.mocked(console.warn).mock.calls.map((call) => call.join(' '));
    expect(lines).toContain(`[Server] Jira could not be reached (reading the issue types, team ${JSON.stringify(TEAM_ID)}): network ECONNREFUSED`);
    expect(lines.join('\n')).not.toContain(new URL(unreachable).port);
  });

  it('refuses every route without the super-admin credential', async () => {
    for (const path of ['/api/super-admin/jira-settings', '/api/super-admin/update-jira-settings', '/api/super-admin/test-jira']) {
      expect(await api.post(path, { password: 'wrong', enabled: true, baseUrl: server.url })).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    }
    expect(await dataStore.loadJiraSettings()).toBeNull();
    expect(server.requests()).toEqual([]);
  });

  describe('POST /api/super-admin/test-jira', () => {
    it('tests an address anonymously without saving it', async () => {
      const answer = await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: `${server.url}/` }));
      expect(answer).toMatchObject({ status: 200, body: { ok: true, version: '10.3.1', deploymentType: 'Server' } });
      expect(server.requests().map((r) => [r.path, r.headers.authorization])).toEqual([['/jira/rest/api/2/serverInfo', undefined]]);
      expect(await dataStore.loadJiraSettings()).toBeNull();
      expect(api.recorded).toEqual([]);

      expect((await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: cloud.url }))).body)
        .toEqual({ ok: true, version: '1001.0.0-SNAPSHOT', deploymentType: 'Cloud' });
    });

    it('shows where a redirect leads instead of following it', async () => {
      server.setBehaviour({ redirectServerInfo: 'https://sso.example.org/login?next=%2Fjira' });
      expect((await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: server.url }))).body).toEqual({
        ok: false,
        error: 'jira_redirect',
        status: 302,
        location: 'https://sso.example.org/login?next=%2Fjira'
      });
      expect(server.requests()).toHaveLength(1);
    });

    it('answers what it parsed from a failure, never the raw answer', async () => {
      server.setBehaviour({ failStatus: 500 });
      expect((await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: server.url }))).body)
        .toEqual({ ok: false, error: 'jira_unavailable', status: 500, messages: ['Internal server error'] });

      server.setBehaviour({ failStatus: 502 });
      const page = await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: server.url }));
      expect(page.body).toEqual({ ok: false, error: 'jira_unavailable', status: 502 });
      expect(page.text).not.toContain('<');

      // What stopped it, for the super admin alone: a refused port reads as
      // a connection problem, never as the host's address and port.
      const unreachable = await closedPortUrl();
      const refusedPort = await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: unreachable }));
      expect(refusedPort.body).toEqual({ ok: false, error: 'jira_unreachable', transport: 'network', transportCode: 'ECONNREFUSED' });
      expect(refusedPort.text).not.toContain(new URL(unreachable).port);
      const lines = vi.mocked(console.warn).mock.calls.map((call) => call.join(' '));
      expect(lines).toContain('[Server] Jira connection test failed: jira_unreachable (network ECONNREFUSED)');
    });

    describe.skipIf(!hasOpenssl)('against a Jira whose certificate this server does not trust', () => {
      let secure: https.Server;
      let secureUrl = '';
      let certificateDir = '';

      beforeAll(async () => {
        certificateDir = mkdtempSync(join(tmpdir(), 'jira-routes-tls-'));
        const keyFile = join(certificateDir, 'key.pem');
        const certFile = join(certificateDir, 'cert.pem');
        execFileSync('openssl', [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', '/CN=localhost'
        ], { stdio: 'ignore' });
        secure = https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
          req.resume();
          req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            res.end('{"version":"10.3.1","deploymentType":"Server"}');
          });
        });
        await new Promise<void>((resolve) => secure.listen(0, '127.0.0.1', () => resolve()));
        secureUrl = `https://127.0.0.1:${(secure.address() as AddressInfo).port}/jira`;
      });

      afterAll(async () => {
        if (secure) await new Promise<void>((resolve) => secure.close(() => resolve()));
        if (certificateDir) rmSync(certificateDir, { recursive: true, force: true });
      });

      // The first setup against an internal Data Center whose certificate an
      // internal CA signed: the admin must be able to tell "mount the CA" from
      // "the host is down" or "fix NO_PROXY".
      it('says the certificate is the problem, with OpenSSL\'s code', async () => {
        const answer = await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: secureUrl }));
        expect(answer.body).toEqual({ ok: false, error: 'jira_unreachable', transport: 'tls', transportCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
        expect(answer.text).not.toContain(new URL(secureUrl).port);

        // The switch the console offers as the last resort lets it through.
        expect((await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: secureUrl, allowSelfSignedCerts: true }))).body)
          .toEqual({ ok: true, version: '10.3.1', deploymentType: 'Server' });
      });
    });

    it('refuses an address that is not a Jira base URL before calling anything', async () => {
      expect(await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: 'http://169.254.169.254/latest' })))
        .toMatchObject({ status: 400, body: { error: 'invalid_jira_base_url' } });
      expect(await api.post('/api/super-admin/test-jira', asAdmin({}))).toMatchObject({ status: 400, body: { error: 'invalid_jira_base_url' } });
    });
  });
});

describe('the console’s certificate setting', () => {
  // What the Jira client hands the transport: `rejectUnauthorized: false`
  // accepts a self-signed certificate, `undefined` keeps Node's checks.
  const capturing = () => {
    const seen: unknown[] = [];
    const request = async (options: Parameters<typeof outboundRequest>[0]) => {
      seen.push(options.rejectUnauthorized);
      return outboundRequest(options);
    };
    return { seen, request };
  };

  it.each([
    ['on', true, false],
    ['off', false, undefined]
  ])('reaches every call a team route makes to Jira (%s)', async (_label, allowSelfSignedCerts, rejectUnauthorized) => {
    const { seen, request } = capturing();
    const app = await buildApp({ jiraClientOptions: { request } });
    try {
      await configureJira(server.url, { allowSelfSignedCerts });
      expect((await app.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).status).toBe(200);
      expect((await app.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).status).toBe(200);
    } finally {
      await app.close();
    }
    // serverInfo, myself, and the two pages of issue types.
    expect(seen).toEqual(Array(4).fill(rejectUnauthorized));
  });

  it.each([
    ['the string "false"', 'false'],
    ['the string "yes"', 'yes'],
    ['the number 1', 1]
  ])('keeps Node’s checks on every team call when the stored setting is %s', async (_label, allowSelfSignedCerts) => {
    // Not written by the console's save: another release, another path or a
    // hand edit wrote it. Only `true` turns certificate checks off.
    const { seen, request } = capturing();
    const app = await buildApp({ jiraClientOptions: { request } });
    try {
      await dataStore.saveJiraSettings({ enabled: true, baseUrl: server.url, allowSelfSignedCerts });
      expect((await app.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT }))).status).toBe(200);
      expect((await app.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' }))).status).toBe(200);
    } finally {
      await app.close();
    }
    expect(seen).toEqual(Array(4).fill(undefined));
  });

  it.each([
    ['ticked', true, false],
    ['not ticked', false, undefined],
    ['sent as a string', 'true', undefined]
  ])('reaches the connection test when the box is %s', async (_label, allowSelfSignedCerts, rejectUnauthorized) => {
    const { seen, request } = capturing();
    const app = await buildApp({ jiraClientOptions: { request } });
    try {
      expect((await app.post('/api/super-admin/test-jira', asAdmin({ baseUrl: server.url, allowSelfSignedCerts }))).body)
        .toMatchObject({ ok: true });
    } finally {
      await app.close();
    }
    expect(seen).toEqual([rejectUnauthorized]);
  });
});

describe('the rate limits of the Jira routes', () => {
  // `standardHeaders` announces each limiter on every answer it counts.
  const limit = (answer: Answer) => ({
    limit: answer.headers.get('ratelimit-limit'),
    remaining: answer.headers.get('ratelimit-remaining'),
    policy: answer.headers.get('ratelimit-policy')
  });

  it('give the status a read budget, the team writes one shared budget, and the creation its own', async () => {
    await saveDataCenterToken();
    // That save was one request of the writes' budget: this app starts fresh.
    const app = await buildApp();
    try {
      expect(limit(await app.post(team('/status'), asTeam()))).toEqual({ limit: '120', remaining: '119', policy: '120;w=60' });
      expect(limit(await app.post(team('/token'), asTeam({ token: JIRA_MOCK_PAT })))).toEqual({ limit: '60', remaining: '59', policy: '60;w=60' });
      expect(limit(await app.post(team('/target'), asTeam({ target: TARGET })))).toMatchObject({ limit: '60', remaining: '58' });
      expect(limit(await app.post(team('/issue-types'), asTeam({ projectKey: 'PROJ' })))).toMatchObject({ limit: '60', remaining: '57' });
      expect(limit(await app.post(team('/token/delete'), asTeam()))).toMatchObject({ limit: '60', remaining: '56' });
      // Neither the writes nor the status drew on the creation's budget…
      expect(limit(await app.post(team('/issues'), asTeam({ actionIds: ['a1'] })))).toEqual({ limit: '60', remaining: '59', policy: '60;w=60' });
      // …and nothing but the status draws on its own.
      expect(limit(await app.post(team('/status'), asTeam()))).toMatchObject({ limit: '120', remaining: '118' });
    } finally {
      await app.close();
    }
  });

  it('give the console’s Jira routes the console’s read and action budgets', async () => {
    expect(limit(await api.post('/api/super-admin/jira-settings', asAdmin()))).toMatchObject({ limit: '120', policy: '120;w=60' });
    expect(limit(await api.post('/api/super-admin/update-jira-settings', asAdmin({ enabled: false, baseUrl: '' }))))
      .toEqual({ limit: '60', remaining: '59', policy: '60;w=900' });
    expect(limit(await api.post('/api/super-admin/test-jira', asAdmin({ baseUrl: server.url }))))
      .toEqual({ limit: '60', remaining: '58', policy: '60;w=900' });
  });
});
