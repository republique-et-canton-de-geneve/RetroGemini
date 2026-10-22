import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { clearSessionRevoked, markSessionRevoked, notifySessionTokenChanged } from '../services/sessionRevocation';
import { RetroSession, Team, User } from '../types';

/**
 * Decision D3b, at the top of the app — what a person sees when the team's
 * password is changed under them, and what happens to the session this
 * browser saved.
 *
 * `dataService` and `syncService` are mocked as in `appJoinDeniedLogout`; the
 * revocation module is the real one, since that is what App listens to. The
 * Dashboard is a stub with a refresh button: its own behaviour is not under
 * test, only App's reaction around it.
 */

vi.mock('../services/dataService', () => ({
  OPEN_SESSION_STORAGE_KEY: 'retro-open-session',
  dataService: {
    hydrateFromServer: vi.fn(() => Promise.resolve()),
    refreshFromServer: vi.fn(() => Promise.resolve()),
    getAllTeams: vi.fn(() => []),
    listTeams: vi.fn(() => Promise.resolve([])),
    getTeam: vi.fn(),
    getSessionToken: vi.fn(),
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
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    getCurrentSessionId: vi.fn(() => 'retro-1'),
    isConnected: vi.fn(() => true)
  }
}));

vi.mock('../components/Dashboard', () => ({
  default: ({ onRefresh }: { onRefresh: () => void }) => (
    <div>
      <p>Dashboard stub</p>
      <button type="button" onClick={onRefresh}>Refresh stub</button>
    </div>
  )
}));

const STORAGE_KEY = 'retro-open-session';

const token = (label: string, iat: number) =>
  `rg1.${btoa(JSON.stringify({ iat, label })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;
const OLDER = token('older', 1_000);
const NEWER = token('newer', 2_000);

const facilitator: User = { id: 'fac-1', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };

const retro: RetroSession = {
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 42 retro',
  date: '2026-07-29T00:00:00.000Z',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [{ id: 'col-good', title: 'Went well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' }],
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

const NOTICE = 'The team password was changed, so you were signed out. Log in with the new password, or ask the facilitator for a new invitation link.';

const saveSession = (view: 'DASHBOARD' | 'SESSION', sessionToken: string) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    teamId: team.id,
    userId: facilitator.id,
    userName: facilitator.name,
    view,
    activeSessionId: view === 'SESSION' ? retro.id : null,
    sessionToken
  }));
};

const storedToken = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')?.sessionToken ?? null;

describe('App when the team password is changed (decision D3b)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearSessionRevoked();
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getSessionToken).mockReturnValue(OLDER);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: '41.0', announcements: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearSessionRevoked();
  });

  // The Dashboard stays, as a session does: a feedback or a reply being
  // written there lives only on the screen (appSessionRevokedDashboard).
  it('shows the banner on the Dashboard, and its way out lands on the login screen with the notice', async () => {
    saveSession('DASHBOARD', OLDER);
    render(<App />);
    await screen.findByText('Dashboard stub');

    act(() => markSessionRevoked());

    expect(screen.getByRole('alert').textContent).toContain('The team password was changed');
    expect(screen.getByText('Dashboard stub')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log in again' }));

    expect(await screen.findByRole('heading', { name: 'RetroGemini' })).toBeTruthy();
    expect(screen.getByText(NOTICE).getAttribute('role')).toBe('status');
    expect(screen.queryByText('Dashboard stub')).toBeNull();
  });

  it('shows the banner in a session, and its way out lands on the login screen with the notice', async () => {
    saveSession('SESSION', OLDER);
    render(<App />);
    await screen.findByRole('button', { name: 'BRAINSTORM' });

    act(() => markSessionRevoked());

    expect(screen.getByRole('alert').textContent).toContain('The team password was changed');
    // Still the retro: a participant halfway through a card can copy it.
    expect(screen.getByRole('button', { name: 'BRAINSTORM' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log in again' }));

    expect(await screen.findByRole('heading', { name: 'RetroGemini' })).toBeTruthy();
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('stores the token a password change hands back, so a reload stays signed in', async () => {
    saveSession('DASHBOARD', OLDER);
    render(<App />);
    await screen.findByText('Dashboard stub');
    expect(storedToken()).toBe(OLDER);

    vi.mocked(dataService.getSessionToken).mockReturnValue(NEWER);
    act(() => notifySessionTokenChanged());

    await waitFor(() => expect(storedToken()).toBe(NEWER));
  });

  it('never writes its older token over a newer one another tab stored, nor deletes it when revoked, while a logout by hand does', async () => {
    // Another tab changed the password and stored its new token; this tab
    // still holds the one from before.
    saveSession('DASHBOARD', NEWER);
    const view = render(<App />);
    await screen.findByText('Dashboard stub');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh stub' }));
    expect(storedToken()).toBe(NEWER);

    act(() => markSessionRevoked());
    fireEvent.click(screen.getByRole('button', { name: 'Log in again' }));
    expect(await screen.findByRole('heading', { name: 'RetroGemini' })).toBeTruthy();
    expect(storedToken()).toBe(NEWER);

    view.unmount();
    clearSessionRevoked();
    render(<App />);
    await screen.findByText('Dashboard stub');
    fireEvent.click(screen.getByRole('button', { name: 'Logout Team' }));
    await screen.findByRole('heading', { name: 'RetroGemini' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the saved session when the restore fails for now, and deletes it when the token can never work', async () => {
    vi.mocked(dataService.getTeam).mockReturnValue(undefined);
    saveSession('DASHBOARD', OLDER);
    vi.mocked(dataService.restoreSession).mockResolvedValue({ failure: 'transient' });
    const first = render(<App />);
    await waitFor(() => expect(dataService.restoreSession).toHaveBeenCalledWith(OLDER));
    await screen.findByRole('heading', { name: 'RetroGemini' });
    expect(storedToken()).toBe(OLDER);
    first.unmount();

    vi.mocked(dataService.restoreSession).mockResolvedValue({ failure: 'rejected' });
    render(<App />);
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  });
});
