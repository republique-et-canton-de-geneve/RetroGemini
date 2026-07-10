import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Team } from '../types';

// Hardening stage 7b: the client prefers the HMAC session token on routine
// team/feedback API calls. The password keeps working as a fallback (invite
// imports carry no token), but a token-only session — what restore-session
// returns once passwords stop being echoed back in stage 7c — must behave
// like a fully authenticated one for reads and writes.

let dataService: typeof import('../services/dataService').dataService;

// Deterministic ids: mock team ids feed the mocked sessionToken responses, and
// CodeQL flags any Math.random()-derived value that reaches a token-named
// variable (js/insecure-randomness), even from test doubles.
let mockTeamSequence = 0;

const createMockTeam = (overrides: Partial<Team> = {}): Team => ({
  id: `team-${++mockTeamSequence}`,
  name: 'TokenTeam',
  passwordHash: 'secret',
  members: [
    { id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }
  ],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  lastConnectionDate: new Date().toISOString(),
  ...overrides
});

const flushPersistQueue = () => new Promise(resolve => setTimeout(resolve, 50));

const bodyOfLastCallTo = (mockFetch: ReturnType<typeof vi.fn>, urlPattern: RegExp) => {
  const call = [...mockFetch.mock.calls].reverse()
    .find(c => urlPattern.test(String(c[0])));
  if (!call) return null;
  return JSON.parse((call[1] as { body?: string })?.body || '{}');
};

describe('dataService token-preferred auth (stage 7b)', () => {
  let mockTeam: Team;
  let mockFetch: ReturnType<typeof vi.fn>;
  // When false, restore-session omits the plaintext password from its
  // response, simulating the stage-7c server that no longer echoes it.
  let restoreReturnsPassword: boolean;

  beforeEach(async () => {
    vi.resetModules();
    mockTeam = createMockTeam();
    restoreReturnsPassword = true;

    mockFetch = vi.fn().mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      const urlPath = url.toString();

      if (urlPath === '/api/team/create' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        mockTeam = createMockTeam({ name: body.name, passwordHash: body.password });
        return {
          ok: true,
          status: 201,
          json: async () => ({ team: mockTeam, sessionToken: `token-${mockTeam.id}` })
        };
      }

      if (urlPath === '/api/team/restore-session' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            team: mockTeam,
            sessionToken: body.sessionToken,
            ...(restoreReturnsPassword ? { password: mockTeam.passwordHash } : {})
          })
        };
      }

      // Any other POST endpoint just succeeds and echoes the team.
      return {
        ok: true,
        status: 200,
        json: async () => ({ team: mockTeam, feedbacks: [], meta: { revision: 1 } })
      };
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    dataService = (await import('../services/dataService')).dataService;
  });

  it('sends the session token alongside the password on routine team calls', async () => {
    const team = await dataService.createTeam('Alpha', 'secret');
    mockFetch.mockClear();

    await dataService.refreshFromServer();

    const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+$/);
    expect(body).not.toBeNull();
    expect(body.password).toBe('secret');
    expect(body.sessionToken).toBe(`token-${team.id}`);
  });

  it('sends the session token on queued persist calls', async () => {
    const team = await dataService.createTeam('Alpha', 'secret');
    mockFetch.mockClear();

    dataService.updateFacilitatorEmail(team.id, 'new@example.com');
    await flushPersistQueue();

    const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+\/update$/);
    expect(body).not.toBeNull();
    expect(body.sessionToken).toBe(`token-${team.id}`);
  });

  it('sends the session token on feedback API calls', async () => {
    const team = await dataService.createTeam('Alpha', 'secret');
    mockFetch.mockClear();

    await dataService.loadAllFeedbacks();

    const body = bodyOfLastCallTo(mockFetch, /\/api\/feedbacks\/all$/);
    expect(body).not.toBeNull();
    expect(body.teamId).toBe(team.id);
    expect(body.sessionToken).toBe(`token-${team.id}`);
  });

  it('never sends the session token on password-change requests', async () => {
    // Changing the credential requires the current credential: a session
    // whose password was rotated elsewhere must not be able to rotate it
    // back on the strength of its still-valid token (review finding).
    await dataService.createTeam('Alpha', 'secret');
    mockFetch.mockClear();

    await dataService.changeTeamPassword(mockTeam.id, 'rotated-password');

    const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+\/password$/);
    expect(body).not.toBeNull();
    expect(body.password).toBe('secret');
    expect(body.newPassword).toBe('rotated-password');
    expect('sessionToken' in body).toBe(false);
  });

  it('omits the sessionToken field entirely when no token is held', async () => {
    // Invite imports set credentials without a token; the request body must
    // not grow a null field the server could trip over.
    const team = await dataService.createTeam('Alpha', 'secret');
    dataService.logout();
    dataService.setAuthFromInvite(team.id, 'secret', mockTeam);
    mockFetch.mockClear();

    await dataService.refreshFromServer();

    const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+$/);
    expect(body).not.toBeNull();
    expect(body.password).toBe('secret');
    expect('sessionToken' in body).toBe(false);
  });

  describe('token-only session (restore-session without password, stage 7c server)', () => {
    beforeEach(async () => {
      restoreReturnsPassword = false;
      const restored = await dataService.restoreSession('token-restored');
      expect(restored).not.toBeNull();
      mockFetch.mockClear();
    });

    it('is reported as authenticated', () => {
      expect(dataService.isAuthenticated()).toBe(true);
    });

    it('still persists team updates using the token', async () => {
      dataService.updateFacilitatorEmail(mockTeam.id, 'new@example.com');
      await flushPersistQueue();

      const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+\/update$/);
      expect(body).not.toBeNull();
      expect(body.sessionToken).toBe('token-restored');
      expect(body.password ?? null).toBeNull();
    });

    it('still persists retrospectives using the token', async () => {
      const columns = [
        { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring-3' }
      ];
      dataService.createSession(mockTeam.id, 'Retro', columns);
      await flushPersistQueue();

      const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+\/retrospective\/[^/]+$/);
      expect(body).not.toBeNull();
      expect(body.sessionToken).toBe('token-restored');
    });

    it('still refreshes team state using the token', async () => {
      await dataService.refreshFromServer();

      const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+$/);
      expect(body).not.toBeNull();
      expect(body.sessionToken).toBe('token-restored');
    });

    it('keeps requiring the plaintext password for invite link generation (trap C-7c)', () => {
      // Invite payloads embed the plaintext password, so a token cannot mint
      // them. restore-session must keep returning the password until invite
      // links are migrated; this locks the guard that surfaces the gap.
      expect(() => dataService.createSessionInvite(mockTeam.id)).toThrow();
    });

    it('keeps requiring the in-memory password for password changes', async () => {
      await expect(dataService.changeTeamPassword(mockTeam.id, 'newpassword'))
        .rejects.toThrow();
    });
  });
});

describe('TeamFeedback component token auth (stage 7b)', () => {
  it('includes the session token in the feedback list request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ feedbacks: [] })
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: TeamFeedback } = await import('../components/TeamFeedback');
    render(
      <TeamFeedback
        teamId="team-1"
        teamName="Alpha"
        teamPassword="secret"
        sessionToken="token-abc"
        currentUserId="u1"
        currentUserName="User One"
        feedbacks={[]}
        onSubmitFeedback={() => {}}
        onRefresh={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const call = mockFetch.mock.calls.find(c => String(c[0]) === '/api/feedbacks/all');
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as { body?: string })?.body || '{}');
    expect(body.password).toBe('secret');
    expect(body.sessionToken).toBe('token-abc');
  });
});
