// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '../types';

/**
 * Decision D3b, the client — a `401 session_revoked` is resolved once: retried
 * when the token this browser holds changed since the request left (the
 * rotation was made here, or by another tab), otherwise the session is marked
 * revoked and every write stops, with no storm.
 *
 * `dataService` and `sessionRevocation` are imported fresh for each case, as
 * one pair: they share module state.
 */

type DataService = typeof import('../services/dataService').dataService;
type Revocation = typeof import('../services/sessionRevocation');

const STORAGE_KEY = 'retro-open-session';

// A token as the server mints it, as far as the client can read one: only
// its middle part's `iat` is ever looked at.
const token = (label: string, iat: number) =>
  `rg1.${btoa(JSON.stringify({ iat, label })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig-${label}`;

const T1 = token('t1', 1_000);
const T2 = token('t2', 2_000);
const T3 = token('t3', 3_000);
const T0 = token('t0', 500);

const team = (): Team => ({
  id: 'team-1',
  name: 'Alpha',
  members: [{ id: 'fac-1', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' }],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [{ id: 'r1', teamId: 'team-1', name: 'Sprint', date: '2026-10-22', status: 'IN_PROGRESS', phase: 'BRAINSTORM', columns: [], settings: {}, tickets: [], groups: [], actions: [], _rev: 1 } as never],
  globalActions: []
}) as unknown as Team;

type Reply = { status: number; body?: unknown; json?: boolean };
type Route = (body: Record<string, unknown>) => Reply;

describe('the client side of a session revocation (decision D3b)', () => {
  let dataService: DataService;
  let revocation: Revocation;
  let routes: Record<string, Route>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const calls = (path: string) =>
    fetchMock.mock.calls.filter((call) => call[0] === path).map((call) => JSON.parse((call[1] as { body: string }).body));

  const respond = (reply: Reply) => ({
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: async () => {
      if (reply.json === false) throw new SyntaxError('not JSON');
      return reply.body ?? {};
    }
  });

  const login = async (sessionToken = T1) => {
    routes['/api/team/login'] = () => ({ status: 200, body: { team: team(), sessionToken } });
    await dataService.loginTeam('Alpha', 'old-password');
  };

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    routes = {};
    fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      const route = routes[String(url)];
      if (!route) return respond({ status: 404, json: false });
      return respond(route(JSON.parse(init?.body || '{}')));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    revocation = await import('../services/sessionRevocation');
    dataService = (await import('../services/dataService')).dataService;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks the session revoked once, and then sends no write at all', async () => {
    await login();
    const listener = vi.fn();
    revocation.onSessionRevokedChange(listener);
    routes['/api/feedbacks/all'] = () => ({ status: 401, body: { error: 'session_revoked' } });

    await dataService.loadAllFeedbacks();
    await dataService.loadAllFeedbacks();

    expect(revocation.isSessionRevoked()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);

    fetchMock.mockClear();
    dataService.updateSession('team-1', { ...team().retrospectives[0], name: 'Sprint', _rev: 2 } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries, and revokes nothing, a refusal its own password change caused', async () => {
    // The rotation commits; the cut or a write's 401 can arrive before the
    // rotation's own answer, which carries the token that is current now.
    await login();
    let answerRotation: () => void = () => undefined;
    routes['/api/team/team-1/password'] = () => ({ status: 200, body: { success: true, sessionToken: T2 } });
    const realFetch = fetchMock.getMockImplementation() as (url: string, init?: { body?: string }) => Promise<unknown>;
    fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url === '/api/team/team-1/password') {
        await new Promise<void>((resolve) => { answerRotation = resolve; });
      }
      return realFetch(url, init);
    });
    routes['/api/feedbacks/all'] = (body) => (body.sessionToken === T2
      ? { status: 200, body: { feedbacks: [] } }
      : { status: 401, body: { error: 'session_revoked' } });

    const rotation = dataService.changeTeamPassword('team-1', 'the-new-password', 'old-password');
    const read = dataService.loadAllFeedbacks();
    await new Promise((resolve) => setTimeout(resolve, 20));
    answerRotation();
    await rotation;

    expect((await read).error).toBeNull();
    expect(calls('/api/feedbacks/all').map((body) => body.sessionToken)).toEqual([T1, T2]);
    expect(revocation.isSessionRevoked()).toBe(false);
  });

  it('keeps the token a password change hands back, says so, and keeps the old one when none comes back', async () => {
    await login();
    const changed = vi.fn();
    revocation.onSessionTokenChanged(changed);
    routes['/api/team/team-1/password'] = () => ({ status: 200, body: { success: true, sessionToken: T2 } });

    await dataService.changeTeamPassword('team-1', 'the-new-password', 'old-password');
    expect(dataService.getSessionToken()).toBe(T2);
    expect(changed).toHaveBeenCalledTimes(1);

    // A 41.0 pod served it: no token, and nothing was revoked either.
    routes['/api/team/team-1/password'] = () => ({ status: 200, body: { success: true } });
    await dataService.changeTeamPassword('team-1', 'another-new-password', 'the-new-password');
    expect(dataService.getSessionToken()).toBe(T2);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reads a revoked restore as revoked and rejected', async () => {
    routes['/api/team/restore-session'] = () => ({ status: 401, body: { error: 'session_revoked' } });

    expect(await dataService.restoreSession(T1)).toEqual({ failure: 'rejected' });
    expect(revocation.isSessionRevoked()).toBe(true);
  });

  it('tells a rejected restore from a transient one', async () => {
    const cases: [Reply | 'throw', 'rejected' | 'transient'][] = [
      [{ status: 401, body: { error: 'invalid_or_expired_token' } }, 'rejected'],
      [{ status: 404, body: { error: 'team_not_found' } }, 'rejected'],
      [{ status: 429, body: { error: 'too_many_attempts' } }, 'transient'],
      [{ status: 500, body: { error: 'restore_failed' } }, 'transient'],
      [{ status: 200, json: false }, 'transient'],
      ['throw', 'transient']
    ];
    for (const [reply, failure] of cases) {
      routes['/api/team/restore-session'] = () => {
        if (reply === 'throw') throw new TypeError('Failed to fetch');
        return reply;
      };
      expect([reply, await dataService.restoreSession(T1)]).toEqual([reply, { failure }]);
    }
    routes['/api/team/restore-session'] = () => ({ status: 200, body: { team: team() } });
    expect(await dataService.restoreSession(T1)).toMatchObject({ team: { id: 'team-1' } });
  });

  it('retries with a newer token another tab of this browser stored', async () => {
    await login(T1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId: 'team-1', sessionToken: T2 }));
    routes['/api/feedbacks/all'] = (body) => (body.sessionToken === T2
      ? { status: 200, body: { feedbacks: [] } }
      : { status: 401, body: { error: 'session_revoked' } });

    expect((await dataService.loadAllFeedbacks()).error).toBeNull();
    expect(dataService.getSessionToken()).toBe(T2);
    expect(revocation.isSessionRevoked()).toBe(false);
  });

  it('adopts a token another tab stores after the revocation, and never replaces a token it holds otherwise', async () => {
    await login(T1);
    const changed = vi.fn();
    revocation.onSessionTokenChanged(changed);

    // Not revoked: another tab writing back an older (or any) token is
    // ignored. jsdom fires no `storage` event in the tab that wrote, so the
    // event is dispatched by hand.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId: 'team-1', sessionToken: T2 }));
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(dataService.getSessionToken()).toBe(T1);

    routes['/api/feedbacks/all'] = () => ({ status: 401, body: { error: 'session_revoked' } });
    localStorage.removeItem(STORAGE_KEY);
    await dataService.loadAllFeedbacks();
    expect(revocation.isSessionRevoked()).toBe(true);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId: 'team-1', sessionToken: T3 }));
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(dataService.getSessionToken()).toBe(T3);
    expect(revocation.isSessionRevoked()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('revokes, without retrying forever, when the adopted token is revoked too', async () => {
    await login(T1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId: 'team-1', sessionToken: T2 }));
    routes['/api/feedbacks/all'] = () => ({ status: 401, body: { error: 'session_revoked' } });

    await dataService.loadAllFeedbacks();
    await dataService.loadAllFeedbacks();

    expect(revocation.isSessionRevoked()).toBe(true);
    expect(calls('/api/feedbacks/all').map((body) => body.sessionToken)).toEqual([T1, T2]);
  });

  it('never adopts a stored token older than the one refused', async () => {
    await login(T1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId: 'team-1', sessionToken: T0 }));
    routes['/api/feedbacks/all'] = () => ({ status: 401, body: { error: 'session_revoked' } });

    await dataService.loadAllFeedbacks();

    expect(dataService.getSessionToken()).toBe(T1);
    expect(revocation.isSessionRevoked()).toBe(true);
    expect(calls('/api/feedbacks/all')).toHaveLength(1);
  });

  it('clears the revocation on a new login', async () => {
    await login(T1);
    routes['/api/feedbacks/all'] = () => ({ status: 401, body: { error: 'session_revoked' } });
    await dataService.loadAllFeedbacks();
    expect(revocation.isSessionRevoked()).toBe(true);

    await login(T3);

    expect(revocation.isSessionRevoked()).toBe(false);
  });

  it('does not retry session_revoked across a rolling update', async () => {
    await login(T1);
    routes['/api/team/team-1/retrospective/r1/delete'] = () => ({ status: 401, body: { error: 'session_revoked' } });

    dataService.deleteRetrospective('team-1', 'r1');
    // The rollout retry would send it again after 500 ms.
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(calls('/api/team/team-1/retrospective/r1/delete')).toHaveLength(1);
    expect(revocation.isSessionRevoked()).toBe(true);
  });
});
