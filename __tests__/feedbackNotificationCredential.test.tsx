import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../components/Dashboard';
import { Team, User } from '../types';

/**
 * H29, client half — the notification call must carry the team credential.
 *
 * `/api/notify-new-feedback` now authenticates, and the call that reaches it is
 * fire-and-forget (`.catch(() => {})`), so a client that forgets the credential
 * fails **silently**: the user files a bug report, the UI confirms it, and the
 * administrator is simply never told. Nothing in the product surfaces that, so
 * this is the only thing that can.
 *
 * The test drives the real submission flow rather than inspecting the handler,
 * and asserts both calls of the pair, because the two must agree on which team
 * is speaking.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    addGlobalAction: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    updateSessionName: vi.fn(),
    updateHealthCheckName: vi.fn(),
    createSession: vi.fn(),
    saveTemplate: vi.fn(),
    deleteTeam: vi.fn(),
    deleteRetrospective: vi.fn(),
    createHealthCheckSession: vi.fn(),
    deleteHealthCheck: vi.fn(),
    saveHealthCheckTemplate: vi.fn(),
    deleteHealthCheckTemplate: vi.fn(),
    changeTeamPassword: vi.fn(),
    renameTeam: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'team-password'),
    getSessionToken: vi.fn(() => 'rg1.team-session-token')
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const team: Team = {
  id: 'team-1',
  name: 'Platform Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  teamFeedbacks: []
};

type FetchCall = { url: string; body: Record<string, unknown> };

const captureFetch = () => {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (String(url).includes('/api/feedbacks/create')) {
      return {
        ok: true,
        json: async () => ({ success: true, feedback: { id: 'fb-1', title: 'Timer freezes', type: 'bug' } })
      };
    }
    if (String(url).includes('/api/feedbacks/all')) {
      return { ok: true, json: async () => ({ feedbacks: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof globalThis.fetch;
  return calls;
};

const submitFeedback = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /New Feedback/i }));
  await user.type(screen.getByPlaceholderText('Brief summary'), 'Timer freezes');
  await user.type(screen.getByPlaceholderText(/Describe the issue/i), 'The retro timer stops at 00:00.');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
};

describe('feedback notification credential (H29, client half)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends the team credential with the admin notification', async () => {
    const calls = captureFetch();

    render(
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab="FEEDBACK"
      />
    );

    await submitFeedback();

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/api/notify-new-feedback'))).toBe(true);
    });

    const notify = calls.find((call) => call.url.includes('/api/notify-new-feedback'))!;
    expect(notify.body.teamId).toBe('team-1');
    expect(notify.body.sessionToken).toBe('rg1.team-session-token');
    expect(notify.body.password).toBe('team-password');
    expect(notify.body.feedback).toMatchObject({ id: 'fb-1' });
  });

  it('authenticates the notification as the same team as the creation it follows', async () => {
    const calls = captureFetch();

    render(
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab="FEEDBACK"
      />
    );

    await submitFeedback();

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/api/notify-new-feedback'))).toBe(true);
    });

    const create = calls.find((call) => call.url.includes('/api/feedbacks/create'))!;
    const notify = calls.find((call) => call.url.includes('/api/notify-new-feedback'))!;
    expect(notify.body.teamId).toBe(create.body.teamId);
    expect(notify.body.sessionToken).toBe(create.body.sessionToken);
  });
});
