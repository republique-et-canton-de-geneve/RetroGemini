import { vi } from 'vitest';
import type { JiraStatus } from '../../types';

/**
 * A `fetch` stand-in for the screens' Jira tests, answering the way the routes
 * of contracts §3 do: `/api/team/:teamId/jira/*` and the super-admin Jira
 * routes. Each route is a handler keyed by the end of its path; it receives the
 * parsed JSON body (credential included) and returns what the route answers.
 * A request to a path with no handler fails the test, so a component cannot
 * call a route nobody expected.
 *
 * Not a `*.test.ts` file, so vitest does not collect it as a suite.
 */

export type RouteAnswer =
  | { status?: number; json: unknown }
  // Express's own HTML page, which is what a pod without the route answers.
  | { status: number; html: string }
  | { networkError: true };

export type RouteHandler = (body: Record<string, unknown>) => RouteAnswer | Promise<RouteAnswer>;

export interface JiraFetchCall {
  url: string;
  path: string;
  body: Record<string, unknown>;
}

export const ok = (json: unknown): RouteAnswer => ({ status: 200, json });
export const refused = (status: number, error: string): RouteAnswer => ({ status, json: { error } });

export const READY_STATUS: JiraStatus = {
  enabled: true,
  baseUrl: 'https://jira.example.org',
  target: { mode: 'project', projectKey: 'TEAM', issueTypeId: '10001', labels: ['retrospective'] },
  token: {
    configured: true,
    usable: true,
    reason: null,
    connectedAs: 'Retro Bot',
    deploymentType: 'Server',
    setAt: '2026-10-20T08:00:00.000Z',
    refusedAt: null
  }
};

export const statusWith = (overrides: Partial<Omit<JiraStatus, 'token'>> & { token?: Partial<JiraStatus['token']> } = {}): JiraStatus => ({
  ...READY_STATUS,
  ...overrides,
  token: { ...READY_STATUS.token, ...overrides.token }
});

/** A promise and the functions that settle it, for answers held back on purpose. */
export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

export const installJiraFetch = (routes: Record<string, RouteHandler>) => {
  const calls: JiraFetchCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const path = url.split('?')[0];
    const body = JSON.parse(init?.body || '{}') as Record<string, unknown>;
    calls.push({ url, path, body });

    const route = Object.keys(routes)
      .filter(key => path.endsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    if (!route) throw new Error(`unexpected request to ${url}`);

    const answer = await routes[route](body);
    if ('networkError' in answer) throw new TypeError('Failed to fetch');
    const status = answer.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if ('html' in answer) throw new SyntaxError('Unexpected token < in JSON');
        return answer.json;
      }
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  return {
    calls,
    fetchMock,
    /** The calls whose path ends with `suffix`. */
    callsTo: (suffix: string) => calls.filter(call => call.path.endsWith(suffix))
  };
};
