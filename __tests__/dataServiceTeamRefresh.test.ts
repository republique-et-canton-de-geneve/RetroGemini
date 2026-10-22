import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '../types';

/**
 * The Dashboard's refresh (synthesis item 8, and review finding R7).
 *
 * Login, creation, restore-session and an invite join each download the whole
 * team; the Dashboard then refreshed it a moment later, so a facilitator paid
 * for every login twice. `refreshFromServer({ maxAgeMs })` reuses such a load
 * once. A refresh also waits, at most 3 s, for the writes queued before it:
 * the session exit queues the session's last save and enters the Dashboard in
 * the same tick, and a refresh answered before that save landed replaced the
 * cache with a copy that lacked it.
 */

let dataService: typeof import('../services/dataService').dataService;

let mockTeamSequence = 0;
const createMockTeam = (overrides: Partial<Team> = {}): Team => ({
  id: `team-${++mockTeamSequence}`,
  name: 'RefreshTeam',
  passwordHash: 'secret',
  members: [{ id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const COLUMNS = [{ id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring-3' }];

describe('dataService.refreshFromServer', () => {
  let mockTeam: Team;
  let mockFetch: ReturnType<typeof vi.fn>;
  // Set by a test to hold the next retrospective persist until it resolves.
  let holdRetroPersist: Promise<void> | null;

  const teamReads = () =>
    mockFetch.mock.calls.filter((call) => String(call[0]) === `/api/team/${mockTeam.id}`).length;

  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

  beforeEach(async () => {
    vi.resetModules();
    mockTeam = createMockTeam();
    holdRetroPersist = null;

    mockFetch = vi.fn().mockImplementation(async (url: string, options?: { body?: string }) => {
      const path = String(url);
      if (path === '/api/team/create') {
        const body = JSON.parse(options?.body || '{}');
        mockTeam = createMockTeam({ name: body.name });
        return answer({ team: mockTeam, sessionToken: `token-${mockTeam.id}` }, 201);
      }
      if (path === '/api/team/login') {
        return answer({ team: mockTeam, sessionToken: `token-${mockTeam.id}` });
      }
      if (path === '/api/team/restore-session') {
        return answer({ team: mockTeam });
      }
      if (/\/retrospective\/[^/]+$/.test(path) && holdRetroPersist) {
        await holdRetroPersist;
        return answer({ success: true });
      }
      return answer({ team: mockTeam });
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    dataService = (await import('../services/dataService')).dataService;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('reusing a whole-team load once', () => {
    it('serves the first Dashboard entry after a login from the login', async () => {
      await dataService.loginTeam('RefreshTeam', 'secret');
      mockFetch.mockClear();

      await dataService.refreshFromServer({ maxAgeMs: 5000 });

      expect(teamReads()).toBe(0);
    });

    it('fetches on the next entry: the reuse is consumed', async () => {
      await dataService.loginTeam('RefreshTeam', 'secret');
      await dataService.refreshFromServer({ maxAgeMs: 5000 });
      mockFetch.mockClear();

      await dataService.refreshFromServer({ maxAgeMs: 5000 });

      expect(teamReads()).toBe(1);
    });

    it('serves an entry right after a creation, a restore or an invite join', async () => {
      await dataService.createTeam('Alpha', 'secret-pass', 'fac@example.com');
      mockFetch.mockClear();
      await dataService.refreshFromServer({ maxAgeMs: 5000 });
      expect(teamReads()).toBe(0);

      dataService.logout();
      await dataService.restoreSession('token-restored');
      mockFetch.mockClear();
      await dataService.refreshFromServer({ maxAgeMs: 5000 });
      expect(teamReads()).toBe(0);

      dataService.logout();
      await dataService.importTeam({ id: mockTeam.id, name: mockTeam.name, inviteCredential: 'invite-cred' });
      mockFetch.mockClear();
      await dataService.refreshFromServer({ maxAgeMs: 5000 });
      expect(teamReads()).toBe(0);
    });

    it('fetches when the load is older than maxAgeMs', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
      await dataService.restoreSession('token-restored');
      vi.setSystemTime(new Date('2026-10-22T10:00:06Z'));
      mockFetch.mockClear();

      await dataService.refreshFromServer({ maxAgeMs: 5000 });

      expect(teamReads()).toBe(1);
    });

    it('always fetches without maxAgeMs', async () => {
      await dataService.loginTeam('RefreshTeam', 'secret');
      mockFetch.mockClear();

      await dataService.refreshFromServer();

      expect(teamReads()).toBe(1);
    });

    it('fetches after setAuthFromInvite, which carries a team the client already held', async () => {
      dataService.setAuthFromInvite(mockTeam.id, 'secret', mockTeam);
      mockFetch.mockClear();

      await dataService.refreshFromServer({ maxAgeMs: 5000 });

      expect(teamReads()).toBe(1);
    });

    it('forgets the load on logout, and a new creation brings the reuse back once', async () => {
      await dataService.loginTeam('RefreshTeam', 'secret');
      dataService.logout();
      await dataService.createTeam('Bravo', 'secret-pass', 'bravo@example.com');
      mockFetch.mockClear();

      await dataService.refreshFromServer({ maxAgeMs: 5000 });
      expect(teamReads()).toBe(0);
      await dataService.refreshFromServer({ maxAgeMs: 5000 });
      expect(teamReads()).toBe(1);
    });

    it('does not reuse a load across a logout', async () => {
      await dataService.loginTeam('RefreshTeam', 'secret');
      dataService.logout();
      dataService.setAuthFromInvite(mockTeam.id, 'secret', mockTeam);
      mockFetch.mockClear();

      await dataService.refreshFromServer({ maxAgeMs: 5000 });

      expect(teamReads()).toBe(1);
    });
  });

  describe('waiting for the writes queued before it (R7)', () => {
    it('sends the team read only once a write queued before it has settled', async () => {
      await dataService.createTeam('Alpha', 'secret-pass', 'fac@example.com');
      let release!: () => void;
      holdRetroPersist = new Promise<void>((resolve) => { release = resolve; });
      dataService.createSession(mockTeam.id, 'Retro', COLUMNS);
      mockFetch.mockClear();

      const refresh = dataService.refreshFromServer();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(teamReads()).toBe(0);

      release();
      await refresh;
      expect(teamReads()).toBe(1);
    });

    it('stops waiting after 3 s for a write that never settles', async () => {
      await dataService.createTeam('Alpha', 'secret-pass', 'fac@example.com');
      vi.useFakeTimers();
      holdRetroPersist = new Promise<void>(() => {});
      dataService.createSession(mockTeam.id, 'Retro', COLUMNS);
      mockFetch.mockClear();

      const refresh = dataService.refreshFromServer();
      await vi.advanceTimersByTimeAsync(2999);
      expect(teamReads()).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      await refresh;
      expect(teamReads()).toBe(1);
    });

    it('leaves no timer behind when nothing is queued', async () => {
      await dataService.createTeam('Alpha', 'secret-pass', 'fac@example.com');
      vi.useFakeTimers();
      mockFetch.mockClear();

      await dataService.refreshFromServer();

      expect(teamReads()).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('sends nothing when the team logged out during the wait', async () => {
      await dataService.createTeam('Alpha', 'secret-pass', 'fac@example.com');
      let release!: () => void;
      holdRetroPersist = new Promise<void>((resolve) => { release = resolve; });
      dataService.createSession(mockTeam.id, 'Retro', COLUMNS);
      mockFetch.mockClear();

      const refresh = dataService.refreshFromServer();
      dataService.logout();
      release();
      await refresh;

      expect(teamReads()).toBe(0);
    });
  });
});
