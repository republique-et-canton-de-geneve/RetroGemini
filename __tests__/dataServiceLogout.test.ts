import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '../types';

/**
 * `dataService.logout`, which App now calls on every sign-out.
 *
 * App's sign-out used to leave dataService signed in, so `getTeam` kept
 * answering the team, and anything answered after the sign-out — the
 * Dashboard's refresh, a save it was awaiting — could open it again
 * (`appSignOut.test.tsx`). Three rules: the team leaves at once, for every
 * reader, an answer arriving late included (a save, a refresh, a password
 * change and the credentials it hands back); the writes queued before the
 * logout still go out, with its credentials — a participant's exit queues the
 * session's last save and the roster just before signing out; and a login
 * made meanwhile keeps its own credentials.
 */

let dataService: typeof import('../services/dataService').dataService;

const COLUMNS = [{ id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring-3' }];

describe('dataService.logout', () => {
  let mockTeam: Team;
  let mockFetch: ReturnType<typeof vi.fn>;
  // Set by a test to hold the answer of the requests whose path matches.
  let holds: { pattern: RegExp; until: Promise<void> }[];

  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const hold = (pattern: RegExp) => {
    let release!: () => void;
    holds.push({ pattern, until: new Promise<void>((resolve) => { release = resolve; }) });
    return () => release();
  };
  const bodiesSentTo = (pattern: RegExp) =>
    mockFetch.mock.calls
      .filter((call) => pattern.test(String(call[0])))
      .map((call) => JSON.parse((call[1] as { body?: string })?.body || '{}'));
  // Lets the queue start the operation it holds: the request leaves on a later
  // microtask than the call that queued it.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    vi.resetModules();
    holds = [];
    mockTeam = {
      id: 'team-1',
      name: 'LogoutTeam',
      passwordHash: 'secret',
      members: [{ id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
      archivedMembers: [],
      customTemplates: [],
      retrospectives: [],
      globalActions: []
    };

    mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const path = String(url);
      const held = holds.find(({ pattern }) => pattern.test(path));
      if (held) await held.until;
      if (path === '/api/team/login') return answer({ team: mockTeam, sessionToken: 'token-login' });
      if (path === '/api/team/restore-session') return answer({ team: mockTeam });
      if (/\/retrospective\/[^/]+$/.test(path)) return answer({ success: true });
      if (/\/password$/.test(path)) return answer({ success: true, sessionToken: 'token-rotated' });
      return answer({ team: mockTeam });
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    dataService = (await import('../services/dataService')).dataService;
    await dataService.loginTeam('LogoutTeam', 'secret');
  });

  it('forgets the team at once, and still sends the writes queued before it, with its credentials', async () => {
    const release = hold(/\/retrospective\/[^/]+$/);
    const first = dataService.createSession(mockTeam.id, 'Retro 1', COLUMNS);
    const second = dataService.createSession(mockTeam.id, 'Retro 2', COLUMNS);
    await tick();

    dataService.logout();

    expect(dataService.getTeam(mockTeam.id)).toBeUndefined();
    expect(dataService.isAuthenticated()).toBe(false);

    // The first save was on its way; the second was waiting behind it.
    release();
    await dataService.whenPersisted();

    const saves = bodiesSentTo(/\/retrospective\/[^/]+$/);
    expect(saves.map((body) => body.retrospective.id)).toEqual([first.id, second.id]);
    expect(saves.map((body) => body.sessionToken)).toEqual(['token-login', 'token-login']);
    // Once they are out, nothing is held any more.
    expect(dataService.getSessionToken()).toBeNull();
    expect(dataService.getAuthenticatedPassword()).toBeNull();
  });

  it('keeps no team that a save answers after the logout', async () => {
    const release = hold(/\/update$/);
    const saving = dataService.updateFacilitatorEmail(mockTeam.id, 'fran@example.ch');
    await tick();

    dataService.logout();
    release();
    await saving;

    expect(dataService.getTeam(mockTeam.id)).toBeUndefined();
  });

  it('keeps no team that a refresh answers after the logout', async () => {
    const release = hold(new RegExp(`^/api/team/${mockTeam.id}$`));
    const refreshing = dataService.refreshFromServer();
    await tick();
    expect(bodiesSentTo(new RegExp(`^/api/team/${mockTeam.id}$`))).toHaveLength(1);

    dataService.logout();
    release();
    await refreshing;

    expect(dataService.getTeam(mockTeam.id)).toBeUndefined();
  });

  it('keeps none of the credentials a password change answers after the logout', async () => {
    const release = hold(/\/password$/);
    const changing = dataService.changeTeamPassword(mockTeam.id, 'a-new-password', 'secret');
    await tick();

    dataService.logout();
    release();
    await changing;
    await dataService.whenPersisted();

    expect(dataService.getSessionToken()).toBeNull();
    expect(dataService.getAuthenticatedPassword()).toBeNull();
  });

  it('never clears the credentials of a login made while those writes were going out', async () => {
    const release = hold(/\/retrospective\/[^/]+$/);
    dataService.createSession(mockTeam.id, 'Retro 1', COLUMNS);
    await tick();

    dataService.logout();
    await dataService.restoreSession('token-restored');
    release();
    await dataService.whenPersisted();

    expect(dataService.isAuthenticated()).toBe(true);
    expect(dataService.getSessionToken()).toBe('token-restored');
    // The logout's password is not the restored session's either.
    expect(dataService.getAuthenticatedPassword()).toBeNull();
    expect(dataService.getTeam(mockTeam.id)).toBeDefined();
  });
});
