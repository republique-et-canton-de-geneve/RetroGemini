import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraIssueResult, JiraStatus, JiraTarget } from '../types';

/**
 * The client side of the Jira routes (contracts §3 and §4), against a fetch
 * mock that answers the way those routes and the gateways in front of them do.
 *
 * The rule that matters most is when a request may be sent again (finding A-2).
 * Creating an issue is not idempotent: a request whose answer was lost — a
 * gateway's 504 page, a 502, a dropped connection — may have created issues,
 * and sending it again would create them twice. The one answer that proves
 * nothing ran is a 404 that is not JSON: a pod from before the feature, during
 * a rolling update, answering a route it does not know with Express's own page.
 * Only that one is retried. A status read is idempotent, so it also retries the
 * read limiter's 429.
 */

const mocks = vi.hoisted(() => ({
  dataService: {
    getSessionToken: (() => 'token-1') as (() => string | null) | undefined,
    getAuthenticatedPassword: (() => null) as () => string | null,
    whenPersisted: async () => {},
    applyJiraLinks: (_teamId: string, _links: unknown[]) => {},
    applyJiraParents: (_teamId: string, _entries: unknown[]) => {}
  }
}));

vi.mock('../services/dataService', () => ({ dataService: mocks.dataService }));

import { jiraService, JiraServiceError } from '../services/jiraService';
import { registerRevocationResolver } from '../services/sessionRevocation';

type Answer =
  | { json: unknown; status?: number }
  | { html: string; status: number }
  | { networkError: true }
  // A request still in flight: answered once `after` settles.
  | { after: Promise<void>; answer: Answer };

type Call = { url: string; body: Record<string, unknown> };

const STATUS: JiraStatus = {
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

const NOW = '2026-10-20T10:00:00.000Z';
const ids = (count: number, prefix = 'a') => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
const created = (actionId: string, n: number): JiraIssueResult => ({ actionId, status: 'created', key: `TEAM-${n}` });

describe('jiraService', () => {
  let answers: Answer[];
  let calls: Call[];
  let applyJiraLinks: ReturnType<typeof vi.fn>;
  let applyJiraParents: ReturnType<typeof vi.fn>;

  const queue = (...next: Answer[]) => { answers.push(...next); };
  const json = (body: unknown, status = 200): Answer => ({ json: body, status });
  const html = (status: number): Answer => ({ html: `<!DOCTYPE html><title>${status}</title>`, status });

  beforeEach(() => {
    answers = [];
    calls = [];
    applyJiraLinks = vi.fn();
    applyJiraParents = vi.fn();
    mocks.dataService.applyJiraParents = applyJiraParents as unknown as typeof mocks.dataService.applyJiraParents;
    mocks.dataService.getSessionToken = () => 'token-1';
    mocks.dataService.getAuthenticatedPassword = () => null;
    mocks.dataService.whenPersisted = async () => {};
    mocks.dataService.applyJiraLinks = applyJiraLinks as unknown as typeof mocks.dataService.applyJiraLinks;

    global.fetch = vi.fn(async (url: string, options?: { body?: string }) => {
      calls.push({ url, body: JSON.parse(options?.body || '{}') });
      let answer = answers.shift();
      if (!answer) throw new Error(`unexpected request to ${url}`);
      while ('after' in answer) {
        await answer.after;
        answer = answer.answer;
      }
      if ('networkError' in answer) throw new TypeError('Failed to fetch');
      const status = answer.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if ('html' in answer) throw new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
          return answer.json;
        }
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getStatus', () => {
    it('posts the session token to the status route and returns the status', async () => {
      queue(json(STATUS));

      await expect(jiraService.getStatus('team-1')).resolves.toEqual(STATUS);
      expect(calls).toEqual([{ url: '/api/team/team-1/jira/status', body: { sessionToken: 'token-1' } }]);
    });

    // Decision D3b: a token a password change revoked. Sent again once, with
    // the token held now, when this page holds another one by then (the
    // change was made here, or another tab's token was adopted); otherwise
    // the refusal stands, and the session is revoked.
    it('sends a request refused for a revoked token again once, with the token that replaced it', async () => {
      registerRevocationResolver(async () => {
        mocks.dataService.getSessionToken = () => 'token-2';
        return 'retry';
      });
      queue(json({ error: 'session_revoked' }, 401), json(STATUS));

      await expect(jiraService.getStatus('team-1')).resolves.toEqual(STATUS);
      expect(calls.map(c => c.body.sessionToken)).toEqual(['token-1', 'token-2']);
    });

    it('stops on a revoked token nothing replaced, without a loop', async () => {
      registerRevocationResolver(async () => 'revoked');
      queue(json({ error: 'session_revoked' }, 401));

      await expect(jiraService.getStatus('team-1')).rejects.toMatchObject({ message: 'session_revoked' });
      expect(calls).toHaveLength(1);
    });

    it('reads the credential when the call runs, never earlier', async () => {
      queue(json(STATUS), json(STATUS));
      await jiraService.getStatus('team-1');
      mocks.dataService.getSessionToken = () => 'token-2';
      mocks.dataService.getAuthenticatedPassword = () => 'team-password';
      await jiraService.getStatus('team-1');

      expect(calls.map(c => c.body)).toEqual([
        { sessionToken: 'token-1' },
        { sessionToken: 'token-2', password: 'team-password' }
      ]);
    });

    it('rejects, and does not throw synchronously, when the credential cannot be read', async () => {
      // The hook calls getStatus from an effect; a synchronous throw there
      // would escape its catch and take the screen down.
      mocks.dataService.getSessionToken = undefined;

      let pending: Promise<JiraStatus> | undefined;
      expect(() => { pending = jiraService.getStatus('team-1'); }).not.toThrow();
      await expect(pending).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it('retries a 404 page from a pod that does not serve the route yet', async () => {
      vi.useFakeTimers();
      queue(html(404), html(404), json(STATUS));

      const pending = jiraService.getStatus('team-1');
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toEqual(STATUS);
      expect(calls).toHaveLength(3);
    });

    it('reads the credential again for every attempt across a rollout', async () => {
      // A re-login while the old pods drain must not leave the retries sending
      // the token it replaced, which the server would refuse with a 401.
      vi.useFakeTimers();
      mocks.dataService.getSessionToken = () => (calls.length === 0 ? 'token-1' : 'token-2');
      queue(html(404), json(STATUS));

      const pending = jiraService.getStatus('team-1');
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toEqual(STATUS);
      expect(calls.map(c => c.body.sessionToken)).toEqual(['token-1', 'token-2']);
    });

    it('retries the read limiter\'s 429, since a status read is idempotent', async () => {
      vi.useFakeTimers();
      queue(json({ error: 'too_many_requests' }, 429), json(STATUS));

      const pending = jiraService.getStatus('team-1');
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toEqual(STATUS);
      expect(calls).toHaveLength(2);
    });

    it('gives up after the rolling-update window, about seven seconds', async () => {
      vi.useFakeTimers();
      queue(html(404), html(404), html(404), html(404), html(404), html(404));

      const pending = jiraService.getStatus('team-1');
      const outcome = expect(pending).rejects.toThrow('unknown_error');
      await vi.advanceTimersByTimeAsync(7_000);
      expect(calls).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(1_000);
      await outcome;
      expect(calls).toHaveLength(5);
    });

    it('rejects with the route\'s code, without retrying it', async () => {
      queue(json({ error: 'invalid_token' }, 401));

      await expect(jiraService.getStatus('team-1')).rejects.toThrow('invalid_token');
      expect(calls).toHaveLength(1);
    });

    it.each([
      ['a gateway page', 'unknown_error', html(502)],
      ['a dropped connection', 'unknown_error', { networkError: true } as Answer],
      ['a success that is not JSON', 'unknown_error', html(200)],
      ['a success that is not a status', 'unknown_error', json({ hello: 'world' })],
      ['a refusal without a code', 'unknown_error', json({}, 400)],
      // A route's own code passes through whatever the status: a read created
      // nothing, so there is no outcome to doubt.
      ['a server error with the route\'s code', 'failed_to_load', json({ error: 'failed_to_load' }, 500)],
      ['a JSON request timeout', 'request_timeout', json({ error: 'request_timeout' }, 408)]
    ])('rejects on %s with %s, without retrying it', async (_label, code, answer) => {
      queue(answer);

      const error = await jiraService.getStatus('team-1').catch(e => e);
      expect(error).toBeInstanceOf(JiraServiceError);
      expect(error.code).toBe(code);
      expect(error.message).toBe(code);
      expect(calls).toHaveLength(1);
    });

    it('throws a JiraServiceError whose message is the code', async () => {
      queue(json({ error: 'team_not_found' }, 401));

      const error = await jiraService.getStatus('team-1').catch(e => e);
      expect(error).toBeInstanceOf(JiraServiceError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('team_not_found');
      expect(error.code).toBe('team_not_found');
    });
  });

  describe('the settings routes', () => {
    it('saves a token with the Cloud email, trimmed, and returns the new status', async () => {
      queue(json(STATUS));

      await expect(jiraService.saveToken('team-1', '  secret-token\n', ' bot@example.org ')).resolves.toEqual(STATUS);
      expect(calls).toEqual([{
        url: '/api/team/team-1/jira/token',
        body: { sessionToken: 'token-1', token: 'secret-token', email: 'bot@example.org' }
      }]);
    });

    it('sends no email for a Data Center token', async () => {
      queue(json(STATUS), json(STATUS));

      await jiraService.saveToken('team-1', 'pat');
      await jiraService.saveToken('team-1', 'pat', '   ');
      expect(calls.map(c => c.body)).toEqual([
        { sessionToken: 'token-1', token: 'pat' },
        { sessionToken: 'token-1', token: 'pat' }
      ]);
    });

    it('rejects with the code Jira\'s check produced', async () => {
      queue(json({ error: 'jira_auth_failed_cloud' }, 400));

      await expect(jiraService.saveToken('team-1', 'bad', 'bot@example.org')).rejects.toThrow('jira_auth_failed_cloud');
    });

    it('removes the token', async () => {
      queue(json({ ...STATUS, token: { ...STATUS.token, configured: false, usable: false } }));

      const status = await jiraService.removeToken('team-1');
      expect(status.token.configured).toBe(false);
      expect(calls).toEqual([{ url: '/api/team/team-1/jira/token/delete', body: { sessionToken: 'token-1' } }]);
    });

    it('saves a target, and clears it with null', async () => {
      const target: JiraTarget = { mode: 'parent', parentKey: 'TEAM-9', issueTypeId: '10003', labels: [] };
      queue(json({ ...STATUS, target }), json({ ...STATUS, target: null }));

      await expect(jiraService.saveTarget('team-1', target)).resolves.toMatchObject({ target });
      await expect(jiraService.saveTarget('team-1', null)).resolves.toMatchObject({ target: null });
      expect(calls).toEqual([
        { url: '/api/team/team-1/jira/target', body: { sessionToken: 'token-1', target } },
        { url: '/api/team/team-1/jira/target', body: { sessionToken: 'token-1', target: null } }
      ]);
    });

    it('reads the issue types of a project or of a parent issue', async () => {
      const issueTypes = [{ id: '10001', name: 'Task', subtask: false }];
      queue(
        json({ issueTypes, projectKey: 'TEAM' }),
        json({ issueTypes: [{ id: '10003', name: 'Sub-task', subtask: true }], projectKey: 'TEAM' })
      );

      await expect(jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })).resolves.toEqual({ issueTypes, projectKey: 'TEAM', subtasksIncluded: false });
      await jiraService.getIssueTypes('team-1', { parentKey: 'TEAM-9' });
      expect(calls.map(c => c.body)).toEqual([
        { sessionToken: 'token-1', projectKey: 'TEAM' },
        { sessionToken: 'token-1', parentKey: 'TEAM-9' }
      ]);
    });

    // A pod of this release answers a project's every type, sub-task types
    // included, and says so; one of an older release answers standard types
    // only, with no flag: the form must not read that as "no sub-task type".
    it('says whether the answer holds the project\'s sub-task types', async () => {
      const issueTypes = [{ id: '10001', name: 'Task', subtask: false }, { id: '10003', name: 'Sub-task', subtask: true }];
      queue(json({ issueTypes, projectKey: 'TEAM', subtasksIncluded: true }), json({ issueTypes, projectKey: 'TEAM', subtasksIncluded: 'yes' }));

      await expect(jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })).resolves.toEqual({ issueTypes, projectKey: 'TEAM', subtasksIncluded: true });
      await expect(jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })).resolves.toMatchObject({ subtasksIncluded: false });
    });

    it('rejects an issue-type answer that holds no list', async () => {
      queue(json({ projectKey: 'TEAM' }));

      await expect(jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })).rejects.toThrow('unknown_error');
    });

    it.each([
      // The server's own codes for a server-side failure (contracts §3): the
      // screens have a sentence for each, and "Something went wrong" helps no
      // one fix a missing SESSION_TOKEN_SECRET or a Jira blocked by egress.
      ['saving a token', 'jira_secret_unavailable', 503, () => jiraService.saveToken('team-1', 'pat')],
      ['saving a token', 'jira_unreachable', 502, () => jiraService.saveToken('team-1', 'pat')],
      ['removing the token', 'failed_to_save', 500, () => jiraService.removeToken('team-1')],
      ['saving a target', 'failed_to_save', 500, () => jiraService.saveTarget('team-1', null)],
      ['reading the issue types', 'jira_unavailable', 502, () => jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })],
      ['reading the issue types', 'jira_unreachable', 502, () => jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })]
    ])('rejects %s with the server\'s %s, sent once', async (_label, code, status, call) => {
      queue(json({ error: code }, status));

      const error = await call().catch(e => e);
      expect(error).toBeInstanceOf(JiraServiceError);
      expect(error.message).toBe(code);
      expect(calls).toHaveLength(1);
    });

    it('rejects with the route\'s own 404 code, without retrying it', async () => {
      // Real timers: a retry would wait half a second, then find no answer
      // queued. Only a 404 that is not JSON comes from a pod without the route.
      queue(json({ error: 'jira_not_found' }, 404));

      await expect(jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })).rejects.toThrow('jira_not_found');
      expect(calls).toHaveLength(1);
    });

    it('passes Jira\'s rate limit on the issue types through, without retrying it', async () => {
      queue(json({ error: 'jira_rate_limited' }, 429));

      await expect(jiraService.getIssueTypes('team-1', { projectKey: 'TEAM' })).rejects.toThrow('jira_rate_limited');
      expect(calls).toHaveLength(1);
    });

    it('retries a 404 page on the settings routes too: nothing ran', async () => {
      vi.useFakeTimers();
      queue(html(404), json(STATUS));

      const pending = jiraService.removeToken('team-1');
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual(STATUS);
      expect(calls).toHaveLength(2);
    });
  });

  describe('createIssues', () => {
    const OPTIONS = { requestedBy: 'Alice', language: 'fr' as const };
    // The requests that could create something. After an answer is lost the
    // service also reads the team once (see "after an answer was lost").
    const issueCalls = () => calls.filter(call => call.url.endsWith('/jira/issues'));

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(NOW));
    });

    it('waits for the writes queued before the click, then sends', async () => {
      let release!: () => void;
      mocks.dataService.whenPersisted = () => new Promise<void>(resolve => { release = resolve; });
      queue(json({ results: [created('a1', 1)], remaining: [] }));

      const pending = jiraService.createIssues('team-1', ['a1'], OPTIONS);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(calls).toHaveLength(0);

      release();
      await pending;
      expect(calls).toHaveLength(1);
    });

    it('sends what the request needs, the credential included', async () => {
      const target: JiraTarget = { mode: 'project', projectKey: 'OTHER', issueTypeId: '10001', labels: ['sprint-42'] };
      queue(json({ results: [created('a1', 1)], remaining: [] }));

      await jiraService.createIssues('team-1', ['a1'], { ...OPTIONS, target, sessionId: 'retro-1', force: true });

      expect(calls).toEqual([{
        url: '/api/team/team-1/jira/issues',
        body: {
          sessionToken: 'token-1',
          actionIds: ['a1'],
          target,
          sessionId: 'retro-1',
          requestedBy: 'Alice',
          language: 'fr',
          force: true
        }
      }]);
    });

    it('sends at most ten actions per request', async () => {
      const all = ids(23);
      queue(
        json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
        json({ results: all.slice(10, 20).map((id, i) => created(id, i + 11)), remaining: [] }),
        json({ results: all.slice(20).map((id, i) => created(id, i + 21)), remaining: [] })
      );

      const outcome = await jiraService.createIssues('team-1', all, OPTIONS);

      expect(calls.map(c => c.body.actionIds)).toEqual([all.slice(0, 10), all.slice(10, 20), all.slice(20)]);
      expect(outcome.results).toHaveLength(23);
      expect(outcome.notSent).toEqual([]);
      expect(outcome.unknown).toEqual([]);
      expect(outcome.stopped).toBeUndefined();
      // One cache update per request, each with that request's keys.
      expect(applyJiraLinks).toHaveBeenCalledTimes(3);
      expect(applyJiraLinks.mock.calls.map(([, links]) => links.map((l: { actionId: string }) => l.actionId)))
        .toEqual([all.slice(0, 10), all.slice(10, 20), all.slice(20)]);
    });

    it('caches the keys of a request before the next one is answered', async () => {
      // A request may take ten seconds or more: a screen refreshed from the
      // cache meanwhile must already show the issues the dialog announced
      // (finding A-6).
      const all = ids(12);
      let release!: () => void;
      const secondAnswered = new Promise<void>(resolve => { release = resolve; });
      queue(
        json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
        { after: secondAnswered, answer: json({ results: all.slice(10).map((id, i) => created(id, i + 11)), remaining: [] }) }
      );

      const pending = jiraService.createIssues('team-1', all, OPTIONS);
      // Real timers here (only Date is faked): `vi.waitFor` would move the clock.
      while (calls.length < 2) await new Promise(resolve => setTimeout(resolve, 0));

      expect(applyJiraLinks).toHaveBeenCalledTimes(1);
      expect(applyJiraLinks).toHaveBeenCalledWith('team-1', all.slice(0, 10).map((actionId, i) => ({
        actionId,
        jira: { key: `TEAM-${i + 1}`, createdAt: NOW }
      })));

      release();
      await pending;
      expect(applyJiraLinks).toHaveBeenCalledTimes(2);
    });

    it('sends again what the server left for later, before the rest', async () => {
      // The server stops starting creations after its time budget and answers
      // with `remaining` (finding A-1); those go first in the next request.
      const all = ids(14);
      queue(
        json({ results: all.slice(0, 6).map((id, i) => created(id, i + 1)), remaining: all.slice(6, 10) }),
        json({ results: all.slice(6, 14).map((id, i) => created(id, i + 7)), remaining: [] })
      );

      const outcome = await jiraService.createIssues('team-1', all, OPTIONS);

      expect(calls.map(c => c.body.actionIds)).toEqual([all.slice(0, 10), all.slice(6, 14)]);
      expect(outcome.results.map(r => r.actionId)).toEqual(all);
    });

    it('reports progress after each request, with every result so far', async () => {
      const all = ids(12);
      const onProgress = vi.fn();
      queue(
        json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
        json({ results: all.slice(10).map((id, i) => created(id, i + 11)), remaining: [] })
      );

      await jiraService.createIssues('team-1', all, { ...OPTIONS, onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress.mock.calls[0][0]).toHaveLength(10);
      expect(onProgress.mock.calls[1][0]).toHaveLength(12);
    });

    it('puts every key and every uncertain outcome on the cached actions, after each request', async () => {
      queue(json({
        results: [
          { actionId: 'a1', status: 'created', key: 'TEAM-1' },
          { actionId: 'a2', status: 'already_linked', key: 'TEAM-2' },
          { actionId: 'a3', status: 'created_not_saved', key: 'TEAM-3' },
          { actionId: 'a4', status: 'uncertain' },
          { actionId: 'a5', status: 'refused', jiraMessages: ['Summary is required'] },
          { actionId: 'a6', status: 'closed' },
          { actionId: 'a7', status: 'in_progress' },
          { actionId: 'a8', status: 'not_found' }
        ],
        remaining: [],
        stopped: 'link_not_saved'
      }));

      await jiraService.createIssues('team-1', ids(8), OPTIONS);

      expect(applyJiraLinks).toHaveBeenCalledTimes(1);
      expect(applyJiraLinks).toHaveBeenCalledWith('team-1', [
        { actionId: 'a1', jira: { key: 'TEAM-1', createdAt: NOW } },
        { actionId: 'a2', jira: { key: 'TEAM-2', createdAt: NOW } },
        { actionId: 'a3', jira: { key: 'TEAM-3', createdAt: NOW } },
        { actionId: 'a4', jira: { uncertainSince: NOW } }
      ]);
    });

    it('never caches a key the server did not send as one', async () => {
      queue(json({ results: [{ actionId: 'a1', status: 'created', key: 'https://evil.example/TEAM-1' }], remaining: [] }));

      await jiraService.createIssues('team-1', ['a1'], OPTIONS);

      expect(applyJiraLinks).not.toHaveBeenCalled();
    });

    it.each([
      'token_refused',
      'jira_forbidden',
      'jira_not_found',
      'jira_unavailable',
      'jira_unreachable',
      'link_not_saved',
      'server_restarting',
      'jira_parent_invalid'
    ])('stops on %s and reports what was not sent', async (stopped) => {
      const all = ids(15);
      const onProgress = vi.fn();
      queue(json({ results: [created('a1', 1), created('a2', 2)], remaining: all.slice(2, 10), stopped }));

      const outcome = await jiraService.createIssues('team-1', all, { ...OPTIONS, onProgress });

      expect(calls).toHaveLength(1);
      expect(outcome.stopped).toBe(stopped);
      expect(outcome.results.map(r => r.actionId)).toEqual(['a1', 'a2']);
      expect(outcome.notSent).toEqual(all.slice(2));
      // The request that stops a batch reports its results too: a key created
      // before `link_not_saved` is the one the dialog most needs to announce.
      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress.mock.calls[0][0].map((r: JiraIssueResult) => r.actionId)).toEqual(['a1', 'a2']);
    });

    it('passes Jira\'s delay through when it asks to wait', async () => {
      const onProgress = vi.fn();
      queue(json({ results: [created('a1', 1)], remaining: ['a2'], stopped: 'jira_rate_limited', retryAfterSeconds: 30 }));

      const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], { ...OPTIONS, onProgress });

      expect(outcome).toMatchObject({ stopped: 'jira_rate_limited', retryAfterSeconds: 30, notSent: ['a2'] });
      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress.mock.calls[0][0].map((r: JiraIssueResult) => r.actionId)).toEqual(['a1']);
    });

    it('sends the same request again after a 404 page from an older pod', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW));
      queue(html(404), html(404), json({ results: [created('a1', 1)], remaining: [] }));

      const pending = jiraService.createIssues('team-1', ['a1'], OPTIONS);
      await vi.advanceTimersByTimeAsync(10_000);
      const outcome = await pending;

      expect(calls).toHaveLength(3);
      expect(calls[1].body).toEqual(calls[0].body);
      expect(calls[2].body).toEqual(calls[0].body);
      expect(outcome.results).toEqual([created('a1', 1)]);
    });

    it('reads a 404 page that outlasts the rollout window as a server restarting, with nothing sent', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW));
      queue(html(404), html(404), html(404), html(404), html(404));
      const all = ids(12);

      const pending = jiraService.createIssues('team-1', all, OPTIONS);
      await vi.advanceTimersByTimeAsync(10_000);
      const outcome = await pending;

      expect(calls).toHaveLength(5);
      expect(outcome).toEqual({ results: [], notSent: all, unknown: [], parents: [], stopped: 'server_restarting' });
    });

    it.each([
      ['a gateway timeout page', html(504)],
      ['a bad gateway page', html(502)],
      ['a request timeout', html(408)],
      ['a JSON request timeout', json({ error: 'request_timeout' }, 408)],
      ['a JSON server error', json({ error: 'internal_error' }, 500)],
      ['a JSON bad gateway', json({ error: 'bad_gateway' }, 502)],
      ['a dropped connection', { networkError: true } as Answer],
      ['a success that is not JSON', html(200)],
      ['a success that is not an answer', json({ results: 'nope' })]
    ])('never sends a request again after %s: its outcome is unknown', async (_label, answer) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW));
      const all = ids(13);
      queue(json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }), answer);

      const pending = jiraService.createIssues('team-1', all, OPTIONS);
      await vi.advanceTimersByTimeAsync(30_000);
      const outcome = await pending;

      expect(issueCalls()).toHaveLength(2);
      expect(outcome.stopped).toBe('outcome_unknown');
      expect(outcome.results).toHaveLength(10);
      expect(outcome.unknown).toEqual(all.slice(10));
      expect(outcome.notSent).toEqual([]);
    });

    it('keeps the actions after an unknown outcome as not sent', async () => {
      const all = ids(15);
      queue({ networkError: true });

      const outcome = await jiraService.createIssues('team-1', all, OPTIONS);

      expect(issueCalls()).toHaveLength(1);
      expect(outcome).toEqual({ results: [], unknown: all.slice(0, 10), notSent: all.slice(10), parents: [], stopped: 'outcome_unknown' });
    });

    it('throws the route\'s code when it refuses the request before creating anything', async () => {
      queue(json({ error: 'jira_target_missing' }, 400));

      const error = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS).catch(e => e);

      expect(error).toBeInstanceOf(JiraServiceError);
      expect(error.message).toBe('jira_target_missing');
      expect(error.results).toEqual([]);
      expect(error.notSent).toEqual(['a1', 'a2']);
      expect(issueCalls()).toHaveLength(1);
    });

    it('rejects with the route\'s own 404 code after one request', async () => {
      // Real timers: a retry would wait half a second, then find no answer
      // queued. Only a 404 that is not JSON comes from a pod without the route.
      queue(json({ error: 'jira_not_found' }, 404));

      const error = await jiraService.createIssues('team-1', ['a1'], OPTIONS).catch(e => e);

      expect(error).toBeInstanceOf(JiraServiceError);
      expect(error.message).toBe('jira_not_found');
      expect(issueCalls()).toHaveLength(1);
    });

    it('never retries the write limiter\'s 429, which leaves the actions safe to send again', async () => {
      // The limiter answers before the route runs, so nothing was created; but
      // a retry would spend the budget a whole office shares for seven seconds.
      queue(json({ error: 'too_many_requests' }, 429));

      const error = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS).catch(e => e);

      expect(error).toBeInstanceOf(JiraServiceError);
      expect(error.message).toBe('too_many_requests');
      expect(error.notSent).toEqual(['a1', 'a2']);
      expect(issueCalls()).toHaveLength(1);
    });

    it('keeps what landed when a later request is refused', async () => {
      const all = ids(12);
      queue(
        json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
        json({ error: 'jira_token_unusable' }, 409)
      );

      const error = await jiraService.createIssues('team-1', all, OPTIONS).catch(e => e);

      expect(error.message).toBe('jira_token_unusable');
      expect(error.results).toHaveLength(10);
      expect(error.notSent).toEqual(all.slice(10));
      expect(applyJiraLinks).toHaveBeenCalledTimes(1);
    });

    it('reads the credential again for every request', async () => {
      const all = ids(11);
      queue(
        json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
        json({ results: [created('a11', 11)], remaining: [] })
      );
      const onProgress = () => { mocks.dataService.getSessionToken = () => 'token-2'; };

      await jiraService.createIssues('team-1', all, { ...OPTIONS, onProgress });

      expect(calls.map(c => c.body.sessionToken)).toEqual(['token-1', 'token-2']);
    });

    it('stops instead of looping when the server makes no progress', async () => {
      queue(
        json({ results: [], remaining: ['a1', 'a2'] }),
        json({ results: [], remaining: ['a1', 'a2'] })
      );

      const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS);

      expect(issueCalls()).toHaveLength(2);
      expect(outcome.notSent).toEqual(['a1', 'a2']);
      expect(outcome.stopped).toBeUndefined();
    });

    it('goes on after an empty round that a productive one follows', async () => {
      // Only two empty rounds in a row end the batch: one request the server
      // could not start on, between two that made progress, is not a loop.
      const all = ids(12);
      queue(
        json({ results: [], remaining: all.slice(0, 10) }),
        json({ results: all.slice(0, 5).map((id, i) => created(id, i + 1)), remaining: all.slice(5, 10) }),
        json({ results: [], remaining: all.slice(5) }),
        json({ results: all.slice(5).map((id, i) => created(id, i + 6)), remaining: [] })
      );

      const outcome = await jiraService.createIssues('team-1', all, OPTIONS);

      expect(calls.map(c => c.body.actionIds)).toEqual([all.slice(0, 10), all.slice(0, 10), all.slice(5), all.slice(5)]);
      expect(outcome.results.map(r => r.actionId)).toEqual(all);
      expect(outcome.notSent).toEqual([]);
      expect(outcome.unknown).toEqual([]);
      expect(outcome.stopped).toBeUndefined();
    });

    it('counts an action the server answered nothing about as unknown, and never sends it again', async () => {
      // a2 was neither attempted nor left for later: nothing says what became
      // of it, so it may be in Jira (finding A-2). The second answer is queued
      // so that a resend would show as a request that succeeds, not as a
      // failing mock read as an unknown outcome.
      queue(
        json({ results: [created('a1', 1)], remaining: [] }),
        json({ results: [created('a2', 2)], remaining: [] })
      );

      const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS);

      expect(issueCalls()).toHaveLength(1);
      expect(outcome.unknown).toEqual(['a2']);
      expect(outcome.notSent).toEqual([]);
      expect(outcome.stopped).toBeUndefined();
    });

    it.each([
      ['a gateway timeout page', html(504)],
      ['a success that is not an answer', json({ results: 'nope' })]
    ])('still counts an action an earlier request left unaccounted for after %s', async (_label, answer) => {
      // a10 is lost by the first request and a11-a12 by the second: all three
      // may be in Jira, and the screen marks only what the outcome names.
      const all = ids(12);
      queue(json({ results: all.slice(0, 9).map((id, i) => created(id, i + 1)), remaining: [] }), answer);

      const outcome = await jiraService.createIssues('team-1', all, OPTIONS);

      expect(issueCalls()).toHaveLength(2);
      expect(outcome.stopped).toBe('outcome_unknown');
      expect(outcome.results.map(r => r.actionId)).toEqual(all.slice(0, 9));
      expect(outcome.unknown).toEqual(['a10', 'a11', 'a12']);
      expect(outcome.notSent).toEqual([]);
    });

    it('ignores results and remaining ids the request did not send', async () => {
      queue(json({ results: [created('a1', 1), created('ghost', 9)], remaining: ['other'] }));

      const outcome = await jiraService.createIssues('team-1', ['a1'], OPTIONS);

      expect(calls).toHaveLength(1);
      expect(outcome.results).toEqual([created('a1', 1)]);
      expect(outcome.notSent).toEqual([]);
    });

    it('sends each action once even when it is listed twice', async () => {
      queue(json({ results: [created('a1', 1)], remaining: [] }));

      await jiraService.createIssues('team-1', ['a1', 'a1'], OPTIONS);

      expect(calls[0].body.actionIds).toEqual(['a1']);
    });

    it('sends nothing for an empty list', async () => {
      await expect(jiraService.createIssues('team-1', [], OPTIONS)).resolves.toEqual({ results: [], notSent: [], unknown: [], parents: [] });
      expect(calls).toEqual([]);
    });

    it('does not let a failing progress callback stop the batch', async () => {
      const all = ids(11);
      queue(
        json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
        json({ results: [created('a11', 11)], remaining: [] })
      );
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const outcome = await jiraService.createIssues('team-1', all, {
        ...OPTIONS,
        onProgress: () => { throw new Error('render failed'); }
      });

      expect(calls).toHaveLength(2);
      expect(outcome.results).toHaveLength(11);
    });

    describe('session parent issues', () => {
      const P_TARGET: JiraTarget = { mode: 'parent', parentKey: 'OPS-1', issueTypeId: '10006', labels: [] };

      it('sends the parent flags with every request, and none of them when they are off', async () => {
        const all = ids(11);
        queue(
          json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
          json({ results: [created('a11', 11)], remaining: [] }),
          json({ results: [created('b1', 12)], remaining: [] })
        );

        await jiraService.createIssues('team-1', all, { ...OPTIONS, target: P_TARGET, adoptParent: true, replaceParents: true });
        await jiraService.createIssues('team-1', ['b1'], { ...OPTIONS, adoptParent: false, replaceParents: false, forceParents: [] });

        const bodies = issueCalls().map(call => call.body);
        expect(bodies).toHaveLength(3);
        for (const body of bodies.slice(0, 2)) {
          expect(body).toMatchObject({ target: P_TARGET, adoptParent: true, replaceParents: true });
        }
        expect(bodies[2]).not.toHaveProperty('adoptParent');
        expect(bodies[2]).not.toHaveProperty('replaceParents');
        expect(bodies[2]).not.toHaveProperty('forceParentScopes');
      });

      // [review F2-1] A confirmation is the parent the facilitator saw in
      // doubt, not the whole batch.
      it('sends with each request the confirmed parents of its own actions only', async () => {
        const all = ids(11);
        queue(
          json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [] }),
          json({ results: [created('a11', 11)], remaining: [] })
        );

        await jiraService.createIssues('team-1', all, {
          ...OPTIONS,
          forceParents: [
            { scope: 'retro:r1', actionIds: ['a1', 'a11'] },
            { scope: 'retro:r2', actionIds: ['a2'] },
            // A row of the dialog whose actions are not in this batch.
            { scope: 'retro:r9', actionIds: ['zz'] },
            { scope: 'not a scope', actionIds: ['a3'] }
          ]
        });

        const bodies = issueCalls().map(call => call.body);
        expect(bodies.map(body => body.forceParentScopes)).toEqual([['retro:r1', 'retro:r2'], ['retro:r1']]);
        expect(bodies.every(body => !('forceParent' in body))).toBe(true);
      });

      it('confirms no parent again once an answer says it is in doubt: the doubt is the server’s, never shown', async () => {
        queue(
          json({
            results: [{ actionId: 'a1', status: 'parent_uncertain' }],
            remaining: ['a2', 'a3'],
            parents: [{ scope: 'retro:r1', status: 'uncertain', uncertainSince: '2026-10-20T09:00:00.000Z' }]
          }),
          json({ results: [{ actionId: 'a2', status: 'parent_uncertain' }, created('a3', 3)], remaining: [] })
        );

        await jiraService.createIssues('team-1', ['a1', 'a2', 'a3'], {
          ...OPTIONS,
          forceParents: [{ scope: 'retro:r1', actionIds: ['a1', 'a2'] }, { scope: 'retro:r2', actionIds: ['a3'] }]
        });

        expect(issueCalls().map(call => call.body.forceParentScopes)).toEqual([['retro:r1', 'retro:r2'], ['retro:r2']]);
      });

      it('reads the parents of each answer, keeps the last status of each scope, and drops what is not one', async () => {
        const all = ids(11);
        queue(
          json({
            results: [{ actionId: 'a1', status: 'parent_in_progress' }, ...all.slice(1, 10).map((id, i) => created(id, i + 2))],
            remaining: [],
            parents: [
              { scope: 'retro:r1', status: 'in_progress' },
              { scope: 'backlog', status: 'created', key: 'TEAM-90' },
              { scope: 'not a scope', status: 'created', key: 'TEAM-91' },
              { scope: 'retro:r2', status: 'created', key: 'not a key' },
              { scope: 'retro:r3', status: 7 },
              'nope'
            ]
          }),
          json({
            results: [created('a11', 11)],
            remaining: [],
            parents: [{ scope: 'retro:r1', status: 'created', key: 'TEAM-92', jiraMessages: ['ignored', 3] }]
          })
        );

        const outcome = await jiraService.createIssues('team-1', all, OPTIONS);

        expect(outcome.parents).toEqual([
          { scope: 'retro:r1', status: 'created', key: 'TEAM-92', jiraMessages: ['ignored'] },
          { scope: 'backlog', status: 'created', key: 'TEAM-90' }
        ]);
      });

      it('caches each parent key and mark the server reports, after each request', async () => {
        queue(json({
          results: [{ actionId: 'a1', status: 'parent_uncertain' }],
          remaining: ['a2'],
          stopped: 'jira_unavailable',
          parents: [
            { scope: 'retro:r1', status: 'created', key: 'TEAM-90' },
            { scope: 'retro:r2', status: 'adopted', key: 'OPS-1' },
            { scope: 'healthcheck:h1', status: 'uncertain', uncertainSince: '2026-10-20T09:58:00.000Z' },
            // The mark could not be stored: nothing to cache.
            { scope: 'healthcheck:h2', status: 'uncertain' },
            // Created, its key not stored: the server will read it as uncertain.
            { scope: 'backlog', status: 'not_saved', key: 'TEAM-91' },
            { scope: 'retro:r3', status: 'refused', jiraMessages: ['Epic Name is required.'] }
          ]
        }));

        const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS);

        expect(applyJiraParents).toHaveBeenCalledTimes(1);
        expect(applyJiraParents).toHaveBeenCalledWith('team-1', [
          { scope: 'retro:r1', jira: { key: 'TEAM-90', createdAt: NOW } },
          { scope: 'retro:r2', jira: { key: 'OPS-1', createdAt: NOW } },
          { scope: 'healthcheck:h1', jira: { uncertainSince: '2026-10-20T09:58:00.000Z' } }
        ]);
        // Nothing was sent for a1: it is not an action in doubt.
        expect(applyJiraLinks).not.toHaveBeenCalled();
        expect(outcome.stopped).toBe('jira_unavailable');
        expect(outcome.notSent).toEqual(['a2']);
      });

      it('counts a request that only created a parent issue as progress', async () => {
        // The server's time budget can run out on the parent: the action is
        // left for later with nothing in `results`. Two such rounds in a row
        // are not a loop when each created something.
        queue(
          json({ results: [], remaining: ['a1', 'a2'], parents: [{ scope: 'retro:r1', status: 'created', key: 'TEAM-90' }] }),
          json({ results: [], remaining: ['a1', 'a2'], parents: [{ scope: 'retro:r2', status: 'created', key: 'TEAM-91' }] }),
          json({ results: [created('a1', 1), created('a2', 2)], remaining: [] })
        );

        const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS);

        expect(issueCalls()).toHaveLength(3);
        expect(outcome.results.map(r => r.actionId)).toEqual(['a1', 'a2']);
        expect(outcome.notSent).toEqual([]);
        expect(outcome.parents.map(p => p.key)).toEqual(['TEAM-90', 'TEAM-91']);
      });

      it('keeps the parents that landed when a later request is refused', async () => {
        const all = ids(11);
        queue(
          json({ results: all.slice(0, 10).map((id, i) => created(id, i + 1)), remaining: [], parents: [{ scope: 'retro:r1', status: 'created', key: 'TEAM-90' }] }),
          json({ error: 'jira_token_unusable' }, 409)
        );

        const error = await jiraService.createIssues('team-1', all, OPTIONS).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(JiraServiceError);
        expect((error as JiraServiceError).parents).toEqual([{ scope: 'retro:r1', status: 'created', key: 'TEAM-90' }]);
      });
    });

    // The screens re-render from the cache, so after a lost answer the
    // service asks the record what landed: an action the server linked shows
    // its key, and only what the record cannot explain stays "unknown". A
    // parent-mode 504 at the router's 30 s is the case: the server created
    // and linked the first action, then stopped (client gone) before the rest.
    describe('after an answer was lost', () => {
      const linkedTeam = {
        id: 'team-1',
        globalActions: [{ id: 'a2', text: 'Two', jira: { uncertainSince: '2026-10-20T09:59:00.000Z' } }],
        retrospectives: [{ id: 'r1', actions: [
          { id: 'a1', text: 'One', jira: { key: 'TEAM-1', createdAt: '2026-10-20T09:59:30.000Z' } },
          { id: 'a3', text: 'Three' }
        ] }],
        healthChecks: [{ id: 'h1', actions: [{ id: 'a4', text: 'Four', jira: { key: 'not a key' } }] }]
      };

      it('reads the team once, after the queued writes, and shows the keys the server stored', async () => {
        const order: string[] = [];
        mocks.dataService.whenPersisted = async () => { order.push('whenPersisted'); };
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        const answerWith = fetchMock.getMockImplementation() as (url: string, options?: { body?: string }) => Promise<unknown>;
        fetchMock.mockImplementation((url: string, options?: { body?: string }) => {
          order.push(url);
          return answerWith(url, options);
        });
        queue(html(504), json({ team: linkedTeam }));

        const outcome = await jiraService.createIssues('team-1', ['a1', 'a2', 'a3', 'a4'], OPTIONS);

        expect(issueCalls()).toHaveLength(1);
        expect(order).toEqual(['whenPersisted', '/api/team/team-1/jira/issues', 'whenPersisted', '/api/team/team-1']);
        expect(calls[1].body).toEqual({ sessionToken: 'token-1' });
        expect(outcome).toEqual({
          results: [{ actionId: 'a1', status: 'already_linked', key: 'TEAM-1' }],
          notSent: [],
          // A mark, no link or a malformed key: the record cannot say, and the
          // call may still be finishing on the server.
          unknown: ['a2', 'a3', 'a4'],
          parents: [],
          stopped: 'outcome_unknown'
        });
        expect(applyJiraLinks).toHaveBeenCalledTimes(1);
        expect(applyJiraLinks).toHaveBeenCalledWith('team-1', [
          { actionId: 'a1', jira: { key: 'TEAM-1', createdAt: '2026-10-20T09:59:30.000Z' } },
          { actionId: 'a2', jira: { uncertainSince: '2026-10-20T09:59:00.000Z' } }
        ]);
      });

      it('reads the team after an answer that named no outcome for an action', async () => {
        queue(json({ results: [created('a1', 1)], remaining: [] }), json({ team: { ...linkedTeam, globalActions: [{ id: 'a2', jira: { key: 'TEAM-2', createdAt: 'x' } }] } }));

        const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS);

        expect(issueCalls()).toHaveLength(1);
        expect(outcome.results).toEqual([created('a1', 1), { actionId: 'a2', status: 'already_linked', key: 'TEAM-2' }]);
        expect(outcome.unknown).toEqual([]);
        expect(outcome.stopped).toBeUndefined();
      });

      it.each([
        ['the read fails', { networkError: true } as Answer],
        ['the read is refused', { json: { error: 'invalid_token' }, status: 401 } as Answer],
        ['the read answers no team', { json: { nope: true } } as Answer]
      ])('leaves the outcome as it was when %s', async (_label, read) => {
        queue(html(504), read);

        const outcome = await jiraService.createIssues('team-1', ['a1', 'a2'], OPTIONS);

        expect(issueCalls()).toHaveLength(1);
        expect(outcome).toEqual({ results: [], notSent: [], unknown: ['a1', 'a2'], parents: [], stopped: 'outcome_unknown' });
        expect(applyJiraLinks).not.toHaveBeenCalled();
        expect(applyJiraParents).not.toHaveBeenCalled();
      });

      // The next dialog's preview reads the cached team's parents: after a lost
      // answer it must say what the server holds, a parent the lost request
      // created included.
      it('puts the record\'s session parents in the cache too', async () => {
        const parentsTeam = {
          ...linkedTeam,
          jiraParents: {
            'retro:r1': { key: 'TEAM-50', createdAt: '2026-10-20T09:59:10.000Z', subtaskTypeId: '10003' },
            backlog: { uncertainSince: '2026-10-20T09:59:20.000Z' },
            'not a scope': { key: 'TEAM-51', createdAt: 'x' },
            'healthcheck:h1': { key: 'not a key' }
          }
        };
        queue(html(504), json({ team: parentsTeam }));

        await jiraService.createIssues('team-1', ['a3'], OPTIONS);

        expect(applyJiraParents).toHaveBeenCalledTimes(1);
        expect(applyJiraParents).toHaveBeenCalledWith('team-1', [
          { scope: 'retro:r1', jira: { key: 'TEAM-50', createdAt: '2026-10-20T09:59:10.000Z' } },
          { scope: 'backlog', jira: { uncertainSince: '2026-10-20T09:59:20.000Z' } }
        ]);
      });

      it('reads nothing when every action is accounted for', async () => {
        queue(json({ results: [created('a1', 1)], remaining: [] }));

        await jiraService.createIssues('team-1', ['a1'], OPTIONS);

        expect(calls).toHaveLength(1);
      });
    });
  });
});
