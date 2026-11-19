import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { clearSessionRevoked } from '../services/sessionRevocation';
import type { MemberAvatarChoice, Team, User } from '../types';

/**
 * A pick made from the dashboard's top bar, at App's level.
 *
 * The write is awaited (`dataService.setMemberAvatar`), and App puts the map
 * the server answered on a **new** team object, so every screen holding the
 * team draws the picture at once. Only onto the team still open: the answer
 * of a write that outlived its screen opens nothing, as a sign-out is final
 * for everything still on its way (`appSignOut.test.tsx`).
 *
 * `dataService` is mocked, and its `getTeam` keeps answering the team after a
 * sign-out: what is under test is App's own rule. The login screen is a stub
 * with one way in, into another team.
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
    persistParticipants: vi.fn(),
    logout: vi.fn(),
    setMemberAvatar: vi.fn(),
    importTeam: vi.fn(),
    autoJoinFromInvite: vi.fn(),
    ensureSessionPlaceholder: vi.fn(),
    ensureHealthCheckPlaceholder: vi.fn()
  }
}));

vi.mock('../components/Dashboard', () => ({
  default: ({ team }: { team: Team }) => (
    <p data-testid="dashboard-stub" data-team={team.id} data-avatars={JSON.stringify(team.memberAvatars ?? null)}>Dashboard stub</p>
  )
}));

// The login screen, as a way into another team: App's rule is under test, not
// the screen that logs a team in.
const { otherTeam } = vi.hoisted(() => ({
  otherTeam: {
    id: 'team-2',
    name: 'Night Shift',
    passwordHash: 'scrypt$stub',
    members: [{ id: 'fac-1', name: 'Nora', color: 'bg-rose-500', role: 'facilitator' }],
    customTemplates: [],
    retrospectives: [],
    healthChecks: [],
    globalActions: []
  }
}));

vi.mock('../components/TeamLogin', () => ({
  default: ({ onLogin }: { onLogin: (team: Team) => void }) => (
    <div>
      <h1>RetroGemini</h1>
      <button type="button" onClick={() => onLogin(otherTeam as Team)}>Log in to Night Shift</button>
    </div>
  )
}));

const STORAGE_KEY = 'retro-open-session';

const facilitator: User = { id: 'fac-1', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: []
};

const openDashboard = async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    teamId: team.id,
    userId: facilitator.id,
    userName: facilitator.name,
    view: 'DASHBOARD',
    sessionToken: 'rg1.session-token'
  }));
  render(<App />);
  await screen.findByTestId('dashboard-stub');
};

const pickCat = () => {
  fireEvent.click(screen.getByRole('button', { name: /choose my avatar/ }));
  const dialog = screen.getByRole('dialog', { name: 'Choose my avatar' });
  fireEvent.click(within(dialog).getByRole('tab', { name: /animals/i }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cat$/ }));
};

describe('App — an avatar picked from the dashboard', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearSessionRevoked();
    window.history.replaceState({}, '', '/');
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: '45.0', announcements: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stores the pick for the viewer, with no session, and draws the answered map on every screen at once', async () => {
    const answered: Record<string, MemberAvatarChoice> = { 'fac-1': { id: 'cat', at: 500 } };
    vi.mocked(dataService.setMemberAvatar).mockResolvedValue(answered);
    await openDashboard();
    // Initials until a picture is chosen: they lead the opener's name.
    expect(screen.getByRole('button', { name: 'FR, Fran, choose my avatar' })).toBeTruthy();

    pickCat();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Fran, choose my avatar' }).querySelector('[data-avatar-art="cat"]')).not.toBeNull());
    expect(dataService.setMemberAvatar).toHaveBeenCalledTimes(1);
    expect(dataService.setMemberAvatar).toHaveBeenCalledWith('fac-1', 'cat');
    // The dashboard holds the same team: it was handed the answered map too.
    expect(JSON.parse(screen.getByTestId('dashboard-stub').getAttribute('data-avatars')!)).toEqual(answered);
    // On a new object: the team the data layer answered is not edited in place.
    expect(team).not.toHaveProperty('memberAvatars');
  });

  it('opens nothing when the answer arrives after a sign-out', async () => {
    let answer: (map: Record<string, MemberAvatarChoice>) => void = () => {};
    vi.mocked(dataService.setMemberAvatar).mockImplementationOnce(
      () => new Promise<Record<string, MemberAvatarChoice>>((resolve) => { answer = resolve; })
    );
    await openDashboard();
    pickCat();
    expect(dataService.setMemberAvatar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout Team' }));
    const loginHeading = await screen.findByRole('heading', { name: 'RetroGemini' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => { answer({ 'fac-1': { id: 'cat', at: 500 } }); });

    // The same element: the login screen was never taken off the page.
    expect(screen.getByRole('heading', { name: 'RetroGemini' })).toBe(loginHeading);
    expect(screen.queryByTestId('dashboard-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: /choose my avatar/ })).toBeNull();
    expect(document.querySelector('[data-avatar-art]')).toBeNull();
    // And nothing wrote the removed session back.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // The answer names its team. Another team opened meanwhile (the same person,
  // under the same member id there) is not handed the first team's pictures.
  it("puts nothing on another team opened before the answer arrives", async () => {
    let answer: (map: Record<string, MemberAvatarChoice>) => void = () => {};
    vi.mocked(dataService.setMemberAvatar).mockImplementationOnce(
      () => new Promise<Record<string, MemberAvatarChoice>>((resolve) => { answer = resolve; })
    );
    await openDashboard();
    pickCat();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout Team' }));
    vi.mocked(dataService.getTeam).mockReturnValue(otherTeam as Team);
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to Night Shift' }));
    const dashboard = await screen.findByTestId('dashboard-stub');
    expect(dashboard.getAttribute('data-team')).toBe('team-2');

    await act(async () => { answer({ 'fac-1': { id: 'cat', at: 500 } }); });

    expect(screen.getByTestId('dashboard-stub').getAttribute('data-team')).toBe('team-2');
    expect(JSON.parse(screen.getByTestId('dashboard-stub').getAttribute('data-avatars')!)).toBeNull();
    expect(document.querySelector('[data-avatar-art]')).toBeNull();
    expect(screen.getByRole('button', { name: 'NO, Nora, choose my avatar' })).toBeTruthy();
  });
});
