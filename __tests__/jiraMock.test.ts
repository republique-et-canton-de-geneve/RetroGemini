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
