// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createJiraClient,
  isJiraCredential,
  JiraError,
  JIRA_RESPONSE_MAX_BYTES
} from '../server/services/jiraClient.js';
import { OutboundHttpError } from '../server/services/outboundHttp.js';
import {
  JIRA_MOCK_CLOUD_EMAIL,
  JIRA_MOCK_CLOUD_TOKEN,
  JIRA_MOCK_PAT,
  startJiraMock,
  type JiraMock
} from './helpers/jiraMock';

/**
 * The Jira client is the only code that talks to Jira, and three of the
 * integration's promises rest on it:
 *
 *  - **every call reaches the configured Jira and nothing else.** The URL is
 *    built from the base URL and a fixed path, the base keeps its context path,
 *    and keys are validated before they become part of a path;
 *  - **every failure says whether an issue may exist.** `outcome` is
 *    `'refused'` (Jira answered no), `'not_sent'` (Jira never saw it) or
 *    `'unknown'` (it may have been created). The route marks an action
 *    "uncertain" on `'unknown'` instead of creating it a second time;
 *  - **Jira's own words reach the facilitator.** A refusal carries the
 *    `errorMessages` and `errors` Jira wrote.
 *
 * It runs against `helpers/jiraMock`, mounted under `/jira` like a Data Center
 * install on a shared host, and against a fake transport for the answers a
 * well-behaved mock would never give.
 */

let server: JiraMock;
let cloud: JiraMock;

beforeAll(async () => {
  server = await startJiraMock({ contextPath: '/jira', deployment: 'Server' });
  cloud = await startJiraMock({ contextPath: '/jira', deployment: 'Cloud' });
});

afterEach(() => {
  server.reset();
  cloud.reset();
});

afterAll(async () => {
  await server.close();
  await cloud.close();
});

const dataCenter = (options: Record<string, unknown> = {}) =>
  createJiraClient({ baseUrl: server.url, credential: { token: JIRA_MOCK_PAT }, ...options });
const jiraCloud = (options: Record<string, unknown> = {}) =>
  createJiraClient({ baseUrl: cloud.url, credential: { token: JIRA_MOCK_CLOUD_TOKEN, email: JIRA_MOCK_CLOUD_EMAIL }, ...options });

const jiraError = async (promise: Promise<unknown>): Promise<JiraError> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof JiraError) return err;
    throw err;
  }
  throw new Error('expected a JiraError');
};

const pathsOf = (mock: JiraMock) => mock.requests().map((entry) => entry.path);

const taskFields = (overrides: Record<string, unknown> = {}) => ({
  project: { key: 'PROJ' },
  issuetype: { id: '10001' },
  summary: 'Write the onboarding checklist',
  description: 'Action from the retrospective Sprint 12 (2026-10-20).',
  labels: ['retrospective'],
  ...overrides
});

// A transport that answers from a list, recording what it was asked.
const fakeTransport = (answers: Array<{ status: number; body: string; headers?: Record<string, string> }>) => {
  const calls: Array<Record<string, unknown>> = [];
  const request = vi.fn(async (options: Record<string, unknown>) => {
    calls.push(options);
    const next = answers.length > 1 ? answers.shift() : answers[0];
    return { status: next.status, headers: next.headers ?? {}, body: next.body };
  });
  return { request, calls };
};

const fakeClient = (transport: ReturnType<typeof fakeTransport>, options: Record<string, unknown> = {}) =>
  createJiraClient({
    baseUrl: 'https://jira.example.org/jira',
    credential: { token: 'pat' },
    request: transport.request,
    ...options
  });

describe('createJiraClient', () => {
  it('refuses an address that is not a Jira base URL', () => {
    expect(() => createJiraClient({ baseUrl: 'ftp://jira.example.org' })).toThrow(TypeError);
    // Plain http is for the loopback interface only.
    expect(() => createJiraClient({ baseUrl: 'http://jira.example.org' })).toThrow(TypeError);
    expect(() => createJiraClient({ baseUrl: 'https://jira.example.org?x=1' })).toThrow(TypeError);
  });

  it('refuses a credential that cannot be sent in a header', () => {
    const baseUrl = 'https://jira.example.org';
    const unsendable: unknown[] = [
      { token: '' },
      { token: 'two words' },
      { token: 'line\nbreak' },
      { token: 5 },
      { token: 'ok', email: 5 },
      { token: 'ok', email: 'a:b@example.org' },
      // A control character in the email would travel inside the header.
      { token: 'ok', email: 'bot@example.org\n' },
      { token: 'ok', email: 'a\tb@example.org' }
    ];
    for (const credential of unsendable) {
      expect(isJiraCredential(credential)).toBe(false);
      expect(() => createJiraClient({ baseUrl, credential: credential as { token: string } })).toThrow(TypeError);
    }
    expect(isJiraCredential({ token: 'ATATT3xFfGF0-abc_DEF=' })).toBe(true);
    expect(isJiraCredential({ token: 'pat', email: 'bot@example.org' })).toBe(true);
    expect(isJiraCredential(null)).toBe(false);
  });
});

describe('authentication', () => {
  it('sends a Data Center token as Bearer', async () => {
    const me = await dataCenter().myself();

    expect(me).toEqual({ displayName: 'Retro Bot', name: 'retro-bot', accountId: null, emailAddress: 'retro-bot@example.org' });
    expect(server.requests()[0].headers.authorization).toBe(`Bearer ${JIRA_MOCK_PAT}`);
  });

  it('sends a Cloud email and API token as Basic', async () => {
    const me = await jiraCloud().myself();

    expect(me.accountId).toBe('5b10ac8d82e05b22cc7d4ef5');
    expect(me.displayName).toBe('Retro Bot');
    const header = cloud.requests()[0].headers.authorization as string;
    expect(header.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8'))
      .toBe(`${JIRA_MOCK_CLOUD_EMAIL}:${JIRA_MOCK_CLOUD_TOKEN}`);
  });

  it('sends no Authorization header without a credential', async () => {
    await createJiraClient({ baseUrl: server.url }).serverInfo();
    expect(server.requests()[0].headers.authorization).toBeUndefined();
  });

  it('sends JSON headers and its own user agent', async () => {
    const client = dataCenter();
    await client.serverInfo();
    await client.createIssue(taskFields());

    expect(server.requests()).toHaveLength(2);
    for (const { headers } of server.requests()) {
      expect(headers.accept).toBe('application/json');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['user-agent']).toBe('RetroGemini');
    }
  });

  it('answers a wrong token as jira_auth_failed, refused', async () => {
    const err = await jiraError(createJiraClient({ baseUrl: server.url, credential: { token: 'revoked' } }).myself());
    expect(err).toMatchObject({ code: 'jira_auth_failed', status: 401, outcome: 'refused' });
    expect(err.jiraMessages).toEqual(['You are not authenticated. Authentication required to perform this operation.']);

    // Cloud answers its 401 as plain text: no message to pass on.
    const cloudErr = await jiraError(createJiraClient({ baseUrl: cloud.url, credential: { token: 'revoked', email: JIRA_MOCK_CLOUD_EMAIL } }).myself());
    expect(cloudErr).toMatchObject({ code: 'jira_auth_failed', status: 401, outcome: 'refused', jiraMessages: [] });
  });

  it('answers an anonymous myself as jira_auth_failed: it names a credential or nobody', async () => {
    const err = await jiraError(createJiraClient({ baseUrl: server.url }).myself());
    expect(err).toMatchObject({ code: 'jira_auth_failed', status: 401, outcome: 'refused' });
    expect(server.requests()[0].headers.authorization).toBeUndefined();

    const cloudErr = await jiraError(createJiraClient({ baseUrl: cloud.url }).myself());
    expect(cloudErr).toMatchObject({ code: 'jira_auth_failed', status: 401 });
  });

  it('bounds every name it reads about the token holder to 255 characters', async () => {
    // These are stored beside the token and shown in the team's settings; the
    // remote server chooses their length.
    const long = 'x'.repeat(1000);
    const transport = fakeTransport([{
      status: 200,
      body: JSON.stringify({ displayName: long, name: long, accountId: long, emailAddress: long })
    }]);
    const me = await fakeClient(transport).myself();

    expect(me.displayName).toBe('x'.repeat(255));
    expect(me.name).toHaveLength(255);
    expect(me.accountId).toHaveLength(255);
    expect(me.emailAddress).toHaveLength(255);
  });

  it('answers a 2xx myself that names nobody as jira_unavailable, never as a verified identity', async () => {
    // The token route stores who the token belongs to; an answer that names
    // no one (a portal page, a proxy's JSON) proves nothing about the token.
    for (const body of ['{"active":true}', '<html><body>Welcome</body></html>']) {
      const err = await jiraError(fakeClient(fakeTransport([{ status: 200, body }])).myself());
      expect(err).toMatchObject({ code: 'jira_unavailable', status: 200, outcome: 'unknown' });
    }
  });
});

describe('serverInfo', () => {
  it('reads the version and the deployment type of Data Center and of Cloud', async () => {
    expect(await createJiraClient({ baseUrl: server.url }).serverInfo())
      .toEqual({ version: '10.3.1', versionNumbers: [10, 3, 1], deploymentType: 'Server' });
    expect((await createJiraClient({ baseUrl: cloud.url }).serverInfo()).deploymentType).toBe('Cloud');
  });

  it('reports a redirect with its Location, without following it', async () => {
    server.setBehaviour({ redirectServerInfo: 'https://sso.example.org/login?next=jira' });
    const err = await jiraError(createJiraClient({ baseUrl: server.url }).serverInfo());

    expect(err).toMatchObject({ code: 'jira_redirect', status: 302, outcome: 'refused', location: 'https://sso.example.org/login?next=jira' });
    expect(server.requests()).toHaveLength(1);
  });

  it('bounds the Location it reports to 2048 characters', async () => {
    // The Location is shown in the super admin's console; a server chooses its length.
    const transport = fakeTransport([{ status: 302, headers: { location: `https://x/${'a'.repeat(5000)}` }, body: '' }]);
    const err = await jiraError(fakeClient(transport).serverInfo());

    expect(err.code).toBe('jira_redirect');
    expect(err.location).toHaveLength(2048);
    expect(err.location?.startsWith('https://x/aaa')).toBe(true);
  });

  // A single-sign-on portal or an http-to-https proxy answers any of these, and
  // rarely the 302 the mock sends. Each is a refusal that names where it points.
  it.each([301, 303, 307, 308])('reports a %i as a redirect with its Location, on a read and on a creation', async (status) => {
    const answer = { status, headers: { location: 'https://sso.example.org/x' }, body: '' };
    const expected = { code: 'jira_redirect', status, outcome: 'refused', location: 'https://sso.example.org/x' };

    expect(await jiraError(fakeClient(fakeTransport([answer])).serverInfo())).toMatchObject(expected);
    expect(await jiraError(fakeClient(fakeTransport([answer])).createIssue(taskFields()))).toMatchObject(expected);
  });

  it('bounds the version it reads to 255 characters', async () => {
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ version: '1'.repeat(1000) }) }]);
    expect((await fakeClient(transport).serverInfo()).version).toBe('1'.repeat(255));
  });

  it('answers a 2xx that is not Jira JSON as jira_unavailable', async () => {
    // A single-sign-on portal answering its login page with a 200.
    const transport = fakeTransport([{ status: 200, body: '<html><form>Sign in</form></html>' }]);
    const err = await jiraError(fakeClient(transport).serverInfo());
    expect(err).toMatchObject({ code: 'jira_unavailable', status: 200, outcome: 'unknown' });
  });

  it('answers 2xx JSON that is not serverInfo as jira_unavailable', async () => {
    // A proxy or a portal answering JSON of its own: a clean JiraError, so the
    // console's test reports it instead of failing on a missing version.
    for (const body of [JSON.stringify({ baseUrl: 'x' }), JSON.stringify({ version: '' }), JSON.stringify({ version: 10 })]) {
      const err = await jiraError(fakeClient(fakeTransport([{ status: 200, body }])).serverInfo());
      expect(err).toMatchObject({ code: 'jira_unavailable', status: 200, outcome: 'unknown' });
    }
  });
});

describe('the base URL', () => {
  it('keeps the context path of the configured address', async () => {
    await createJiraClient({ baseUrl: server.url }).serverInfo();
    expect(pathsOf(server)).toEqual(['/jira/rest/api/2/serverInfo']);
  });

  it('accepts an address typed with a trailing slash', async () => {
    const info = await createJiraClient({ baseUrl: `${server.url}/` }).serverInfo();
    expect(info.deploymentType).toBe('Server');
    expect(pathsOf(server)).toEqual(['/jira/rest/api/2/serverInfo']);
  });
});

describe('issueTypes', () => {
  it('follows every page and finds the sub-task type that only the second page lists (Data Center)', async () => {
    const types = await dataCenter().issueTypes('PROJ');

    expect(types).toEqual([
      { id: '10001', name: 'Task', subtask: false },
      { id: '10002', name: 'Bug', subtask: false },
      { id: '10003', name: 'Story', subtask: false },
      { id: '10005', name: 'Sub-task', subtask: true }
    ]);
    expect(pathsOf(server)).toEqual([
      '/jira/rest/api/2/issue/createmeta/PROJ/issuetypes?startAt=0&maxResults=100',
      '/jira/rest/api/2/issue/createmeta/PROJ/issuetypes?startAt=3&maxResults=100'
    ]);
  });

  it('reads the Cloud page shape, which has no isLast', async () => {
    const types = await jiraCloud().issueTypes('PROJ');
    expect(types.map((type) => type.id)).toEqual(['10001', '10002', '10003', '10005']);
    expect(cloud.requests()).toHaveLength(2);
  });

  it('answers an unknown project as jira_not_found', async () => {
    const err = await jiraError(dataCenter().issueTypes('NOPE'));
    expect(err).toMatchObject({ code: 'jira_not_found', status: 404, outcome: 'refused' });
    expect(err.jiraMessages).toEqual(["No project could be found with key 'NOPE'."]);
  });

  it('stops after ten pages of a Jira that never says it is done', async () => {
    let page = 0;
    const request = vi.fn(async () => {
      page += 1;
      return { status: 200, headers: {}, body: JSON.stringify({ values: [{ id: String(20000 + page), name: `Type ${page}`, subtask: false }] }) };
    });
    const types = await createJiraClient({ baseUrl: 'https://jira.example.org', request }).issueTypes('PROJ');

    expect(request).toHaveBeenCalledTimes(10);
    expect(types).toHaveLength(10);
  });

  it('stops on an empty page, and on a page that brings no new type', async () => {
    const empty = fakeTransport([
      { status: 200, body: JSON.stringify({ values: [{ id: '1', name: 'Task', subtask: false }] }) },
      { status: 200, body: JSON.stringify({ values: [] }) }
    ]);
    expect(await fakeClient(empty).issueTypes('PROJ')).toHaveLength(1);
    expect(empty.request).toHaveBeenCalledTimes(2);

    // A server that ignores startAt answers its first page again and again.
    const repeating = fakeTransport([
      { status: 200, body: JSON.stringify({ values: [{ id: '1', name: 'Task', subtask: false }], total: 50 }) }
    ]);
    expect(await fakeClient(repeating).issueTypes('PROJ')).toHaveLength(1);
    expect(repeating.request).toHaveBeenCalledTimes(2);
  });

  it('stops at a page that says it is the last, even without a total', async () => {
    // Nothing past the last page is Jira's list: a server that answers one
    // anyway must not add types the project does not offer.
    const transport = fakeTransport([
      { status: 200, body: JSON.stringify({ values: [{ id: '1', name: 'Task', subtask: false }], isLast: true }) },
      { status: 200, body: JSON.stringify({ values: [{ id: '2', name: 'Not in this project', subtask: false }] }) }
    ]);
    expect(await fakeClient(transport).issueTypes('PROJ')).toEqual([{ id: '1', name: 'Task', subtask: false }]);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('keeps only the types it can send back, ids as strings', async () => {
    const transport = fakeTransport([{
      status: 200,
      body: JSON.stringify({
        isLast: true,
        values: [
          { id: 10001, name: 'Task', subtask: false },
          { id: 'abc', name: 'Broken' },
          { name: 'No id' },
          { id: '10005', name: 'Sub-task', subtask: 'yes' },
          // No name, or an empty one: shown by its id, never as a blank option.
          { id: '10007' },
          { id: '10008', name: '' },
          { id: '10009', name: 'y'.repeat(1000) },
          'not an object'
        ]
      })
    }]);
    expect(await fakeClient(transport).issueTypes('PROJ')).toEqual([
      { id: '10001', name: 'Task', subtask: false },
      { id: '10005', name: 'Sub-task', subtask: false },
      { id: '10007', name: '10007', subtask: false },
      { id: '10008', name: '10008', subtask: false },
      { id: '10009', name: 'y'.repeat(255), subtask: false }
    ]);
  });

  it('answers a page without a list as jira_unavailable', async () => {
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ projects: [] }) }]);
    const err = await jiraError(fakeClient(transport).issueTypes('PROJ'));
    expect(err.code).toBe('jira_unavailable');
  });

  it('refuses a project key that is not one, before any request', async () => {
    const transport = fakeTransport([{ status: 200, body: '{}' }]);
    await expect(fakeClient(transport).issueTypes('proj/../../admin')).rejects.toThrow(TypeError);
    expect(transport.request).not.toHaveBeenCalled();
  });
});

describe('parentIssue', () => {
  it('reads the project and the type of a parent, asking Jira for those fields only', async () => {
    const parentKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
    const parent = await dataCenter().parentIssue(parentKey);

    expect(parent).toEqual({ key: parentKey, projectId: '10000', projectKey: 'PROJ', subtask: false });
    expect(pathsOf(server)).toEqual([`/jira/rest/api/2/issue/${parentKey}?fields=project,issuetype`]);
  });

  it('says when the parent is itself a sub-task', async () => {
    const parentKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
    const subtaskKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10005', parentKey });
    expect((await dataCenter().parentIssue(subtaskKey)).subtask).toBe(true);
  });

  it('answers an unknown issue as jira_not_found and refuses a malformed key', async () => {
    const err = await jiraError(dataCenter().parentIssue('PROJ-404'));
    expect(err).toMatchObject({ code: 'jira_not_found', status: 404, outcome: 'refused', jiraMessages: ['Issue Does Not Exist'] });

    await expect(dataCenter().parentIssue('PROJ-1?fields=*all')).rejects.toThrow(TypeError);
    expect(server.requests()).toHaveLength(1);
  });

  it('answers the key Jira holds now, which differs for an issue moved to another project', async () => {
    const transport = fakeTransport([{
      status: 200,
      body: JSON.stringify({ key: 'NEW-7', fields: { project: { id: '10000', key: 'NEW' }, issuetype: { subtask: false } } })
    }]);
    const parent = await fakeClient(transport).parentIssue('OLD-1');

    expect(parent).toEqual({ key: 'NEW-7', projectId: '10000', projectKey: 'NEW', subtask: false });
    expect(transport.calls[0].url).toBe('https://jira.example.org/jira/rest/api/2/issue/OLD-1?fields=project,issuetype');
  });

  it('answers a parent without a usable project as jira_unavailable', async () => {
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ key: 'PROJ-1', fields: { issuetype: { subtask: false } } }) }]);
    const err = await jiraError(fakeClient(transport).parentIssue('PROJ-1'));
    expect(err.code).toBe('jira_unavailable');
  });
});

describe('createIssue', () => {
  it('creates a task and answers its key and id', async () => {
    const created = await dataCenter().createIssue(taskFields());

    expect(created).toEqual({ key: 'PROJ-1', id: expect.stringMatching(/^[0-9]+$/) });
    const [issue] = server.issues({ label: 'retrospective' });
    expect(issue).toMatchObject({ key: 'PROJ-1', summary: 'Write the onboarding checklist', labels: ['retrospective'] });
    expect(server.requests()[0]).toMatchObject({ method: 'POST', path: '/jira/rest/api/2/issue', body: { fields: taskFields() } });
  });

  it('creates a sub-task under a parent, in the parent project', async () => {
    const parentKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
    const created = await dataCenter().createIssue({
      project: { id: '10000' },
      parent: { key: parentKey },
      issuetype: { id: '10005' },
      summary: 'Pair on the flaky test'
    });

    expect(created.key).toBe('PROJ-2');
    expect(server.issues().find((issue) => issue.key === 'PROJ-2')).toMatchObject({ parentKey, subtask: true });
  });

  it('returns the messages Jira wrote when it refuses an issue', async () => {
    const client = dataCenter();

    const tooLong = await jiraError(client.createIssue(taskFields({ summary: 'x'.repeat(256) })));
    expect(tooLong).toMatchObject({ code: 'jira_refused', status: 400, outcome: 'refused' });
    expect(tooLong.jiraMessages).toEqual(['Summary must be less than 255 characters.']);

    server.setBehaviour({ refuseLabels: true });
    const labels = await jiraError(client.createIssue(taskFields()));
    expect(labels.jiraMessages).toEqual(["Field 'labels' cannot be set. It is not on the appropriate screen, or unknown."]);

    // OPS's sub-task type is not valid in PROJ, the parent's project.
    server.setBehaviour({ refuseLabels: false });
    const parentKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
    const wrongType = await jiraError(client.createIssue({ project: { id: '10000' }, parent: { key: parentKey }, issuetype: { id: '10006' }, summary: 'x' }));
    expect(wrongType).toMatchObject({ code: 'jira_refused', jiraMessages: ['The issue type selected is invalid.'] });

    expect(server.issues().filter((issue) => issue.summary !== 'Seeded issue')).toEqual([]);
  });

  it('passes on at most twenty messages, strings only, each at most 500 characters, none blank', async () => {
    const transport = fakeTransport([{
      status: 400,
      body: JSON.stringify({
        errorMessages: ['m'.repeat(600), 42, '', '   ', ...Array.from({ length: 24 }, (_, i) => `message ${i}`)],
        errors: { summary: 'Summary is required', customfield_10010: { nested: true } }
      })
    }]);
    const err = await jiraError(fakeClient(transport).createIssue(taskFields()));

    expect(err.jiraMessages).toHaveLength(20);
    expect(err.jiraMessages[0]).toBe('m'.repeat(500));
    // A blank line would reach the facilitator as an empty refusal, and use up the budget.
    expect(err.jiraMessages[1]).toBe('message 0');
    expect(err.jiraMessages).not.toContain('');
    expect(err.jiraMessages).not.toContain('   ');
    expect(err.jiraMessages.every((message) => typeof message === 'string' && message.length <= 500)).toBe(true);
  });

  it('never cuts a message in the middle of an emoji', async () => {
    // At 500 UTF-16 units the cut would keep the first half of the pair, and a
    // lone surrogate is not text the screen can show.
    const transport = fakeTransport([{ status: 400, body: JSON.stringify({ errorMessages: [`${'a'.repeat(499)}\u{1F600}`] }) }]);
    const err = await jiraError(fakeClient(transport).createIssue(taskFields()));

    expect(err.jiraMessages[0]).toBe('a'.repeat(499));
    expect(err.jiraMessages[0]).toHaveLength(499);
    expect(err.jiraMessages[0]).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('is refused a sub-task under a sub-task, and one outside its parent project', async () => {
    // The two sub-task rules the creation route relies on Jira to enforce,
    // pinned here so that a mock that stopped enforcing them could not make
    // the route's own refusal tests pass for nothing.
    const client = dataCenter();
    const parentKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
    const subtaskKey = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10005', parentKey });

    const underSubtask = await jiraError(client.createIssue({
      project: { key: 'PROJ' },
      parent: { key: subtaskKey },
      issuetype: { id: '10005' },
      summary: 'Nested'
    }));
    expect(underSubtask).toMatchObject({ code: 'jira_refused', status: 400, outcome: 'refused' });
    expect(underSubtask.jiraMessages).toEqual(['A sub-task cannot be the parent of another sub-task.']);

    // 10006 is a valid sub-task type in OPS, but the parent lives in PROJ.
    const otherProject = await jiraError(client.createIssue({
      project: { key: 'OPS' },
      parent: { key: parentKey },
      issuetype: { id: '10006' },
      summary: 'Elsewhere'
    }));
    expect(otherProject).toMatchObject({ code: 'jira_refused', status: 400, outcome: 'refused' });
    expect(otherProject.jiraMessages).toEqual(['A sub-task must be created in the project of its parent issue.']);

    expect(server.issues().map((issue) => issue.key)).toEqual([parentKey, subtaskKey]);
  });

  it.each([
    [401, 'jira_auth_failed', 'refused'],
    [403, 'jira_forbidden', 'refused'],
    [404, 'jira_not_found', 'refused'],
    [500, 'jira_unavailable', 'unknown'],
    [502, 'jira_unavailable', 'unknown'],
    [503, 'jira_unavailable', 'unknown']
  ])('answers a %i as %s, outcome %s', async (status, code, outcome) => {
    server.setBehaviour({ failStatus: status, endpoints: ['create'] });
    const err = await jiraError(dataCenter().createIssue(taskFields()));
    expect(err).toMatchObject({ code, status, outcome });
  });

  it('answers a rate limit as not created, with a Retry-After read only as whole seconds, at most 120', async () => {
    const retryAfterFor = async (retryAfter: string | null) => {
      server.reset();
      server.setBehaviour({ rateLimitNthCreate: 1, retryAfter });
      const err = await jiraError(dataCenter().createIssue(taskFields()));
      expect(err).toMatchObject({ code: 'jira_rate_limited', status: 429, outcome: 'refused' });
      expect(server.issues()).toEqual([]);
      return err.retryAfterSeconds;
    };

    expect(await retryAfterFor('30')).toBe(30);
    expect(await retryAfterFor('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(await retryAfterFor('99999')).toBe(120);
    expect(await retryAfterFor('-5')).toBeNull();
    expect(await retryAfterFor(null)).toBeNull();
  });

  it('reports an issue created whose answer was lost as outcome unknown', async () => {
    server.setBehaviour({ dropAfterCreate: true });
    const err = await jiraError(dataCenter().createIssue(taskFields()));

    expect(err).toMatchObject({ code: 'jira_unreachable', status: null, outcome: 'unknown' });
    expect(err.cause).toBeInstanceOf(OutboundHttpError);
    // The issue exists: this is exactly the case that must never be retried blindly.
    expect(server.issues()).toHaveLength(1);
  });

  it('reports a Jira that never answers as outcome unknown, at the timeout', async () => {
    server.setBehaviour({ hang: true, endpoints: ['create'] });
    const started = Date.now();
    const err = await jiraError(dataCenter({ timeoutMs: 100, deadlineMs: 100 }).createIssue(taskFields()));

    expect(err).toMatchObject({ code: 'jira_unreachable', outcome: 'unknown' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('cuts a trickling answer off at the deadline, outcome unknown', async () => {
    server.setBehaviour({ trickleMs: 30, endpoints: ['create'] });
    const err = await jiraError(dataCenter({ timeoutMs: 100, deadlineMs: 150 }).createIssue(taskFields()));

    expect(err).toMatchObject({ code: 'jira_unreachable', outcome: 'unknown' });
    expect((err.cause as OutboundHttpError).code).toBe('deadline');
  });

  it('reports a refused connection as not sent', async () => {
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const err = await jiraError(createJiraClient({ baseUrl: `http://127.0.0.1:${port}/jira`, credential: { token: 'pat' } }).createIssue(taskFields()));
    expect(err).toMatchObject({ code: 'jira_unreachable', status: null, outcome: 'not_sent' });
  });

  it('answers a 2xx without a valid key as outcome unknown', async () => {
    for (const body of [JSON.stringify({ id: '1', key: 'proj-1' }), '<html>Created</html>', JSON.stringify({ id: '1' })]) {
      const err = await jiraError(fakeClient(fakeTransport([{ status: 201, body }])).createIssue(taskFields()));
      expect(err).toMatchObject({ code: 'jira_unavailable', status: 201, outcome: 'unknown' });
    }
  });

  it('answers any other 4xx as refused and any other status as unknown', async () => {
    const gone = await jiraError(fakeClient(fakeTransport([{ status: 405, body: '' }])).createIssue(taskFields()));
    expect(gone).toMatchObject({ code: 'jira_refused', status: 405, outcome: 'refused' });

    // A request timeout may come from a proxy that already forwarded the request.
    const timeout = await jiraError(fakeClient(fakeTransport([{ status: 408, body: '' }])).createIssue(taskFields()));
    expect(timeout).toMatchObject({ code: 'jira_unavailable', status: 408, outcome: 'unknown' });
  });

  it('refuses fields that are not an object, before any request', async () => {
    const transport = fakeTransport([{ status: 201, body: '{}' }]);
    await expect(fakeClient(transport).createIssue(null as unknown as Record<string, unknown>)).rejects.toThrow(TypeError);
    await expect(fakeClient(transport).createIssue(['x'] as unknown as Record<string, unknown>)).rejects.toThrow(TypeError);
    expect(transport.request).not.toHaveBeenCalled();
  });
});

describe('the transport', () => {
  it('caps every answer at 1 MB and sends the production timeouts by default', async () => {
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ version: '10.3.1', deploymentType: 'Server' }) }]);
    await fakeClient(transport).serverInfo();

    expect(JIRA_RESPONSE_MAX_BYTES).toBe(1024 * 1024);
    expect(transport.calls[0]).toMatchObject({
      url: 'https://jira.example.org/jira/rest/api/2/serverInfo',
      method: 'GET',
      maxBytes: JIRA_RESPONSE_MAX_BYTES,
      timeoutMs: 15000,
      deadlineMs: 15000
    });
    expect(transport.calls[0].rejectUnauthorized).toBeUndefined();
  });

  it('skips certificate checks only when the super admin allowed it', async () => {
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ version: '10.3.1' }) }]);
    await fakeClient(transport, { allowSelfSignedCerts: true }).serverInfo();
    expect(transport.calls[0].rejectUnauthorized).toBe(false);
  });

  it('lets an error that is not a transport failure through as it is', async () => {
    const request = vi.fn(async () => { throw new RangeError('caller bug'); });
    await expect(createJiraClient({ baseUrl: 'https://jira.example.org', request }).serverInfo()).rejects.toThrow(RangeError);
  });
});
