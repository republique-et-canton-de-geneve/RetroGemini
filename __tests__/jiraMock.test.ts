// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { request } from '../server/services/outboundHttp.js';
import {
  JIRA_MOCK_CLOUD_EMAIL,
  JIRA_MOCK_CLOUD_TOKEN,
  JIRA_MOCK_PAT,
  startJiraMock,
  type JiraMock
} from './helpers/jiraMock';

/**
 * The Jira mock is what the client, route and e2e suites stand on. A behaviour
 * it silently stops having makes those suites pass for nothing (the client's
 * Cloud page shape is guarded only while the mock answers that shape), so the
 * ones they rely on are pinned here on the raw answers, not through the client
 * that reads them.
 */

let server: JiraMock;
let cloud: JiraMock;

beforeAll(async () => {
  server = await startJiraMock({ deployment: 'Server' });
  cloud = await startJiraMock({ deployment: 'Cloud' });
});

afterEach(() => {
  server.reset();
  cloud.reset();
});

afterAll(async () => {
  await server.close();
  await cloud.close();
});

const bearer = { Authorization: `Bearer ${JIRA_MOCK_PAT}` };
const basic = {
  Authorization: `Basic ${Buffer.from(`${JIRA_MOCK_CLOUD_EMAIL}:${JIRA_MOCK_CLOUD_TOKEN}`).toString('base64')}`
};

const getJson = async (url: string, headers: Record<string, string> = {}) => {
  const answer = await request({ url, headers: { Accept: 'application/json', ...headers }, timeoutMs: 1000 });
  return { status: answer.status, data: JSON.parse(answer.body) };
};

const firstPage = '/rest/api/2/issue/createmeta/PROJ/issuetypes?startAt=0&maxResults=100';
const secondPage = '/rest/api/2/issue/createmeta/PROJ/issuetypes?startAt=3&maxResults=100';

describe('jiraMock', () => {
  it('pages the issue types in the Data Center shape, the sub-task type on the second page only', async () => {
    const first = await getJson(`${server.url}${firstPage}`, bearer);
    expect(first.status).toBe(200);
    expect(Object.keys(first.data).sort()).toEqual(['isLast', 'maxResults', 'startAt', 'total', 'values']);
    expect(first.data).toMatchObject({ startAt: 0, total: 4, isLast: false });
    expect(first.data.values.some((type: { subtask: boolean }) => type.subtask)).toBe(false);

    const second = await getJson(`${server.url}${secondPage}`, bearer);
    expect(second.data).toMatchObject({ startAt: 3, total: 4, isLast: true });
    expect(second.data.values).toEqual([expect.objectContaining({ id: '10005', subtask: true })]);
  });

  it('pages the issue types in the Cloud shape: issueTypes, with no values and no isLast', async () => {
    const { status, data } = await getJson(`${cloud.url}${firstPage}`, basic);

    expect(status).toBe(200);
    expect(data).not.toHaveProperty('values');
    expect(data).not.toHaveProperty('isLast');
    expect(data).toMatchObject({ startAt: 0, total: 4 });
    expect(data.issueTypes).toHaveLength(3);
  });

  it('answers only the fields an issue read asks for', async () => {
    const key = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001', summary: 'Seeded parent' });

    const some = await getJson(`${server.url}/rest/api/2/issue/${key}?fields=project,issuetype`, bearer);
    expect(Object.keys(some.data.fields).sort()).toEqual(['issuetype', 'project']);

    const all = await getJson(`${server.url}/rest/api/2/issue/${key}`, bearer);
    expect(all.data.fields).toMatchObject({ summary: 'Seeded parent', project: { key: 'PROJ' } });
  });

  it('refuses the N-th create as a project with a required field does, in Jira’s shape, and creates nothing', async () => {
    const create = () => request({
      url: `${server.url}/rest/api/2/issue`,
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: { project: { key: 'PROJ' }, issuetype: { id: '10001' }, summary: 'Ship smaller' } }),
      timeoutMs: 1000
    });
    server.setBehaviour({ refuseNthCreate: 2 });

    expect((await create()).status).toBe(201);
    const refused = await create();
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body)).toEqual({ errorMessages: [], errors: { customfield_10100: 'Team is required.' } });
    expect((await create()).status).toBe(201);
    expect(server.issues().map((issue) => issue.key)).toEqual(['PROJ-1', 'PROJ-2']);
  });

  it('refuses a field off the create screen whatever its name, __proto__ included, and creates nothing', async () => {
    // Written as raw JSON: an object literal would set a prototype instead of
    // sending a field named "__proto__".
    const body = '{"fields":{"project":{"key":"PROJ"},"issuetype":{"id":"10001"},"summary":"Ship smaller","__proto__":"x"}}';
    const refused = await request({
      url: `${server.url}/rest/api/2/issue`,
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      timeoutMs: 1000
    });

    expect(refused.status).toBe(400);
    const { errors } = JSON.parse(refused.body);
    expect(Object.keys(errors)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(errors, '__proto__')?.value)
      .toBe("Field '__proto__' cannot be set. It is not on the appropriate screen, or unknown.");
    expect(server.issues()).toEqual([]);
  });

  it('sends the Retry-After it is given with a 429 on any endpoint', async () => {
    const parent = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001' });
    const read = () => request({ url: `${server.url}/rest/api/2/issue/${parent}`, headers: bearer, timeoutMs: 1000 });
    server.setBehaviour({ failStatus: 429, retryAfter: '30', endpoints: ['issue'] });
    const limited = await read();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('30');

    server.setBehaviour({ retryAfter: null });
    expect((await read()).headers).not.toHaveProperty('retry-after');
  });

  const createTask = (summary: string, extra: Record<string, unknown> = {}) => request({
    url: `${server.url}/rest/api/2/issue`,
    method: 'POST',
    headers: { ...bearer, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fields: { project: { key: 'PROJ' }, issuetype: { id: '10001' }, summary, ...extra } }),
    timeoutMs: 1000
  });

  // A parent issue is create #1 of a session-parent send and its first
  // sub-task create #2: the knob tells "parent answer lost" from "sub-task
  // answer lost".
  it('records the N-th create and drops its connection, that one only', async () => {
    server.setBehaviour({ dropAfterNthCreate: 2 });

    expect((await createTask('First')).status).toBe(201);
    await expect(createTask('Second')).rejects.toThrow();
    expect((await createTask('Third')).status).toBe(201);
    // Jira created all three; the second answer never reached the caller.
    expect(server.issues().map((issue) => issue.summary)).toEqual(['First', 'Second', 'Third']);
  });

  it('lists the issues under one parent, or those with none', async () => {
    const parent = server.addIssue({ projectKey: 'PROJ', issueTypeId: '10001', summary: 'Parent' });
    const sub = await request({
      url: `${server.url}/rest/api/2/issue`,
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: { project: { key: 'PROJ' }, issuetype: { id: '10005' }, parent: { key: parent }, summary: 'Child', labels: ['retro'] } }),
      timeoutMs: 1000
    });
    expect(sub.status).toBe(201);
    await createTask('Loose', { labels: ['retro'] });

    expect(server.issues({ parentKey: parent }).map((issue) => issue.summary)).toEqual(['Child']);
    expect(server.issues({ parentKey: null }).map((issue) => issue.summary)).toEqual(['Parent', 'Loose']);
    expect(server.issues({ parentKey: null, label: 'retro' }).map((issue) => issue.summary)).toEqual(['Loose']);
    expect(server.issues()).toHaveLength(3);
  });

  it('passes a type’s hierarchy level on, in the type list and in an issue read, when the project gives one', async () => {
    const cloudEpics = await startJiraMock({
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
    try {
      const { data } = await getJson(`${cloudEpics.url}${firstPage}`, basic);
      expect(data.issueTypes.map((type: { hierarchyLevel?: number }) => type.hierarchyLevel)).toEqual([1, 0, -1]);
      const epic = cloudEpics.addIssue({ projectKey: 'PROJ', issueTypeId: '10000' });
      const read = await getJson(`${cloudEpics.url}/rest/api/2/issue/${epic}?fields=project,issuetype`, basic);
      expect(read.data.fields.issuetype).toMatchObject({ id: '10000', subtask: false, hierarchyLevel: 1 });
    } finally {
      await cloudEpics.close();
    }
    // The default projects carry none, as Data Center sends none.
    const { data } = await getJson(`${server.url}${firstPage}`, bearer);
    expect(data.values.some((type: Record<string, unknown>) => 'hierarchyLevel' in type)).toBe(false);
  });

  it('waits delayMs before answering, on the endpoints the knob is set for only', async () => {
    server.setBehaviour({ delayMs: 150 });
    const started = performance.now();
    await getJson(`${server.url}/rest/api/2/serverInfo`);
    // A timer can fire a little before the interval measured here: a few milliseconds' slack.
    expect(performance.now() - started).toBeGreaterThanOrEqual(145);

    server.setBehaviour({ delayMs: 150, endpoints: ['create'] });
    const quick = performance.now();
    await getJson(`${server.url}/rest/api/2/serverInfo`);
    expect(performance.now() - quick).toBeLessThan(100);
  });
});
