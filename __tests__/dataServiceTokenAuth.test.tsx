import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Team } from '../types';

// Hardening stage 7b: the client prefers the HMAC session token on routine
// team/feedback API calls. The password keeps working as a fallback (invite
// imports from old links carry no token), but a token-only session — what
// restore-session always produces since stage 7e stopped echoing or locally
// persisting the password — must behave like a fully authenticated one for
// reads, writes and invite minting (links embed a server-derived invite
// credential, stage 7e).

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
  let mintedCredentials: number;

  beforeEach(async () => {
    vi.resetModules();
    mockTeam = createMockTeam();
    mintedCredentials = 0;

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
        // The stage-7e server never echoes a password from restore-session.
        return {
          ok: true,
          status: 200,
          json: async () => ({ team: mockTeam })
        };
      }

      if (/\/api\/team\/[^/]+\/invite-credential$/.test(urlPath) && options?.method === 'POST') {
        mintedCredentials += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ inviteCredential: `invite-cred-${mockTeam.id}-${mintedCredentials}` })
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

  describe('token-only session (restore-session, stage 7e server)', () => {
    beforeEach(async () => {
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

    it('never holds a plaintext password after a restore (stage 7e)', () => {
      expect(dataService.getAuthenticatedPassword()).toBeNull();
    });

    it('mints session invite links through the server invite credential', async () => {
      const { inviteLink } = await dataService.createSessionInvite(mockTeam.id);
      expect(inviteLink).toContain('join=');

      // The credential request itself authenticates with the session token.
      const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+\/invite-credential$/);
      expect(body).not.toBeNull();
      expect(body.sessionToken).toBe('token-restored');

      const encoded = decodeURIComponent(inviteLink.split('join=')[1]);
      const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
      expect(payload.inviteCredential).toBe(`invite-cred-${mockTeam.id}-1`);
      expect(payload.password).toBeUndefined();
    });

    it('mints member invites too (stage 7e closes trap C-7c)', async () => {
      const { user, inviteLink } = await dataService.createMemberInvite(mockTeam.id, 'alice@example.com');
      expect(user.email).toBe('alice@example.com');
      expect(inviteLink).toContain('join=');
    });

    it('reuses the cached invite credential across consecutive mints', async () => {
      await dataService.createSessionInvite(mockTeam.id);
      await dataService.createMemberInvite(mockTeam.id, 'alice@example.com');

      const credentialCalls = mockFetch.mock.calls
        .filter(c => /\/api\/team\/[^/]+\/invite-credential$/.test(String(c[0])));
      expect(credentialCalls).toHaveLength(1);
    });

    it('requires the current password for password changes', async () => {
      // A leaked session token (or stolen saved-session blob) must never be
      // able to rotate the team password and durably take over the team.
      await expect(dataService.changeTeamPassword(mockTeam.id, 'newpassword-long'))
        .rejects.toThrow('Current password required');
    });

    it('changes the password when the current one is supplied explicitly', async () => {
      await dataService.changeTeamPassword(mockTeam.id, 'newpassword-long', 'current-secret');

      const body = bodyOfLastCallTo(mockFetch, /\/api\/team\/[^/]+\/password$/);
      expect(body).not.toBeNull();
      expect(body.password).toBe('current-secret');
      expect(body.newPassword).toBe('newpassword-long');
      expect('sessionToken' in body).toBe(false);
    });
  });

  describe('invite credential cache invalidation', () => {
    it('refetches the credential after a password rotation (epoch bump)', async () => {
      await dataService.createTeam('Alpha', 'secret');
      const first = await dataService.createSessionInvite(mockTeam.id);
      await dataService.changeTeamPassword(mockTeam.id, 'rotated-password');
      const second = await dataService.createSessionInvite(mockTeam.id);

      const decode = (link: string) => JSON.parse(
        decodeURIComponent(escape(atob(decodeURIComponent(link.split('join=')[1]))))
      );
      expect(decode(first.inviteLink).inviteCredential).not.toBe(decode(second.inviteLink).inviteCredential);
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
