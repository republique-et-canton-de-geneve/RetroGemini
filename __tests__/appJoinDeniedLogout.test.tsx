import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { RetroSession, Team, User } from '../types';

/**
 * Audit H12 — end-to-end wiring of the denied-join logout, at the highest level
 * this flow can actually be reached.
 *
 * The rest of the chain is already pinned elsewhere: the server refuses an
 * unauthenticated or foreign-team join (`socketJoinAuthentication.test.ts`),
 * `syncService` fans the `join-denied` frame out to its subscribers
 * (`syncService.test.ts`), and the banner renders the states apart
 * (`sessionConnectionStatus.test.tsx`). What was left untested is the last leg:
 * the real `Session` component reaching the denied state inside the real `App`,
 * and "Log in again" actually landing on the login screen.
 *
 * This deliberately is not a Playwright scenario. `dataService` holds one
 * in-memory `authenticatedSessionToken` shared by the REST calls and the
 * socket, so a browser test cannot poison the socket credential alone —
 * tampering with it fails the REST path too and the app returns to login
 * through a different route, never rendering the banner under test. Mocking
 * only the socket transport is what isolates this flow.
 */

vi.mock('../services/dataService', () => ({
  OPEN_SESSION_STORAGE_KEY: 'retro-open-session',
  dataService: {
    hydrateFromServer: vi.fn(() => Promise.resolve()),
    refreshFromServer: vi.fn(() => Promise.resolve()),
    getAllTeams: vi.fn(() => []),
    listTeams: vi.fn(() => Promise.resolve([])),
    getTeam: vi.fn(),
    getSessionToken: vi.fn(() => 'rg1.session-token'),
    restoreSession: vi.fn(),
    ensureSessionPlaceholder: vi.fn(),
    ensureHealthCheckPlaceholder: vi.fn(),
    persistParticipants: vi.fn(),
    updateSession: vi.fn(),
    applyRemoteSession: vi.fn()
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    leaveSession: vi.fn(),
    sendActivity: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(() => 'retro-1'),
    isConnected: vi.fn(() => true)
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Fran',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const retro: RetroSession = {
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 42 retro',
  date: '2026-07-29T00:00:00.000Z',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [
    {
      id: 'col-good',
      title: 'Went well',
      color: 'bg-emerald-500',
      border: 'border-emerald-500',
      icon: 'sentiment_satisfied',
      text: 'text-emerald-700',
      ring: 'ring-emerald-300'
    }
  ],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
};

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [retro],
  globalActions: []
};

type DeniedHandler = (data: { sessionId: string; reason: string }) => void;

describe('a denied join routes the user back to the login screen', () => {
  let denied: DeniedHandler | null;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    denied = null;

    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(syncService.onJoinDenied).mockImplementation((cb: DeniedHandler) => {
      denied = cb;
      return () => {};
    });

    // App only reaches out for the version banner on mount.
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: '27.26', announcements: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;

    // A facilitator who was in the retro when the tab was last open: App
    // restores straight into the session, exactly as after a page refresh.
    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: team.id,
        userId: facilitator.id,
        userName: facilitator.name,
        view: 'SESSION',
        activeSessionId: retro.id,
        sessionToken: 'rg1.session-token'
      })
    );

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const renderInSession = async () => {
    render(<App />);
    // The real Session component is on screen once its phase nav renders.
    await screen.findByRole('button', { name: 'BRAINSTORM' });
    await waitFor(() => expect(denied).not.toBeNull());
  };

  it('restores into the live retro with no connection banner', async () => {
    await renderInSession();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
  });

  it('surfaces the expired-session banner inside the running retro', async () => {
    await renderInSession();

    act(() => {
      denied?.({ sessionId: retro.id, reason: 'unauthenticated' });
    });

    expect(screen.getByRole('alert').textContent).toMatch(/expired/i);
    // Still the retro, not a crash or a blank screen.
    expect(screen.getByRole('button', { name: 'BRAINSTORM' })).toBeTruthy();
  });

  it('lands on the login screen when the user takes the way out', async () => {
    await renderInSession();

    act(() => {
      denied?.({ sessionId: retro.id, reason: 'unauthenticated' });
    });
    fireEvent.click(screen.getByRole('button', { name: /log in again/i }));

    // TeamLogin is what the login screen renders.
    expect(await screen.findByRole('heading', { name: 'RetroGemini' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'BRAINSTORM' })).toBeNull();
    // The stored session is cleared, so a reload cannot drop the user back
    // into the retro they were just signed out of.
    expect(localStorage.getItem('retro-open-session')).toBeNull();
  });

  it('says the session belongs to another team when the token is foreign', async () => {
    await renderInSession();

    act(() => {
      denied?.({ sessionId: retro.id, reason: 'forbidden' });
    });

    expect(screen.getByRole('alert').textContent).toMatch(/belongs to another team/i);
  });
});
