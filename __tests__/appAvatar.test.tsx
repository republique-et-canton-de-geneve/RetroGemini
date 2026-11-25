import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { clearSessionRevoked, markSessionRevoked } from '../services/sessionRevocation';
import type { MemberAvatarChoice, Team, User } from '../types';

/**
 * A pick made from the dashboard's top bar, at App's level.
 *
 * The write is awaited (`dataService.setMemberAvatar`), and App merges the
 * map it resolved with into the open team's, member by member (the newer
 * entry of each), on a **new** team object, so every screen holding the
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
  default: ({ team, onRefresh }: { team: Team; onRefresh: () => void }) => (
    <>
      <p data-testid="dashboard-stub" data-team={team.id} data-avatars={JSON.stringify(team.memberAvatars ?? null)}>Dashboard stub</p>
      {/* The Dashboard's own refresh: the team as the data layer holds it now. */}
      <button type="button" onClick={onRefresh}>Refresh the team</button>
    </>
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

  // The answer is the map as the route stored it at this pick's write. The
  // team on screen may hold a later choice of another member (a refresh
  // answered first): App merges the answer into it, member by member, the
  // newer entry of each, rather than taking it whole.
  it("keeps another member's newer choice the open team holds when the pick's answer is older", async () => {
    vi.mocked(dataService.getTeam).mockReturnValue({ ...team, memberAvatars: { 'fac-1': { id: 'owl', at: 100 }, m2: { id: 'moon', at: 2000 } } });
    vi.mocked(dataService.setMemberAvatar).mockResolvedValue({ 'fac-1': { id: 'cat', at: 500 }, m2: { id: 'bee', at: 50 } });
    await openDashboard();

    pickCat();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Fran, choose my avatar' }).querySelector('[data-avatar-art="cat"]')).not.toBeNull());
    expect(JSON.parse(screen.getByTestId('dashboard-stub').getAttribute('data-avatars')!)).toEqual({
      'fac-1': { id: 'cat', at: 500 },
      m2: { id: 'moon', at: 2000 }
    });
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

// The one-time hint that the avatar can be changed (AGENTS.md, *Avatars*),
// under the dashboard's top bar: App says whether the viewer has a choice,
// and whether the credential was revoked (the picker could not save).
describe('App — the avatar hint on the dashboard', () => {
  const HINT = 'New: choose your avatar';
  const HINT_KEY = 'retro-avatar-hint-seen';
  const originalFetch = global.fetch;
  const opener = () => document.querySelector('header [data-viewer-avatar]') as HTMLElement;

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

  it('shows under the top bar to a facilitator who never chose, and its button opens the picker', async () => {
    await openDashboard();
    const note = screen.getByRole('note', { name: HINT });
    const header = document.querySelector('header') as HTMLElement;
    // A sibling right after the bar, never inside it: the header-fit e2e measures the bar.
    expect(header.nextElementSibling).toBe(note);
    expect(opener().querySelector('[data-avatar-hint-dot]')).not.toBeNull();

    fireEvent.click(within(note).getByRole('button', { name: 'Choose my avatar' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose my avatar' });
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['fac-1']);
    // The picker gives the focus back to the avatar it was opened for.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(opener()).toHaveFocus());
  });

  it('is not shown once the team holds a choice for the viewer, a cleared one included', async () => {
    vi.mocked(dataService.getTeam).mockReturnValue({ ...team, memberAvatars: { 'fac-1': { id: null, at: 5 } } });
    await openDashboard();
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();
  });

  it('goes, without being written, when a choice made elsewhere reaches the team', async () => {
    await openDashboard();
    expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
    vi.mocked(dataService.getTeam).mockReturnValue({ ...team, memberAvatars: { 'fac-1': { id: 'owl', at: 5 } } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the team' }));
    await waitFor(() => expect(screen.queryByRole('note', { name: HINT })).toBeNull());
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('is not shown again to the same person once dismissed, and still is to another', async () => {
    await openDashboard();
    fireEvent.click(within(screen.getByRole('note', { name: HINT })).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    cleanup();

    await openDashboard();
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    cleanup();

    // Another facilitator seat of the same browser.
    const second: User = { id: 'fac-2', name: 'Sam', color: 'bg-rose-500', role: 'facilitator' };
    vi.mocked(dataService.getTeam).mockReturnValue({ ...team, members: [facilitator, second] });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      teamId: team.id,
      userId: second.id,
      userName: second.name,
      view: 'DASHBOARD',
      sessionToken: 'rg1.session-token'
    }));
    render(<App />);
    expect(await screen.findByRole('note', { name: HINT })).toBeInTheDocument();
  });

  // A key's "Got it" hands the keyboard on to the first drawn control after
  // the band: the dashboard's own, here its stub's refresh button.
  it('hands the keyboard to the dashboard when a key presses "Got it", and is remembered', async () => {
    await openDashboard();
    const note = screen.getByRole('note', { name: HINT });
    const gotIt = within(note).getByRole('button', { name: 'Got it' });
    act(() => { gotIt.focus(); });
    // A key's click: Enter or Space sends one with no count.
    fireEvent.click(gotIt, { detail: 0 });
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['fac-1']);
    expect(screen.getByRole('button', { name: 'Refresh the team' })).toHaveFocus();
  });

  // The person found the picker on their own, from the top bar's avatar:
  // remembered, and the band does not come back when the picker closes.
  it("goes, remembered, when the picker opens from the top bar's avatar, and closing the picker does not bring it back", async () => {
    await openDashboard();
    expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
    const avatar = screen.getByRole('button', { name: 'FR, Fran, choose my avatar' });
    expect(avatar).toBe(opener());

    fireEvent.click(avatar);
    const dialog = screen.getByRole('dialog', { name: 'Choose my avatar' });
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['fac-1']);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();
  });

  // The team's password was changed under the dashboard: the picker could not
  // save a choice, so the band goes. Another tab's new token clears the
  // revocation, and the band stays gone: nothing brings it back while the
  // screen lasts. It was never dismissed, so it is not remembered.
  it('goes when the session is revoked, unwritten, and stays gone once the revocation is cleared', async () => {
    await openDashboard();
    expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
    expect(opener().querySelector('[data-avatar-hint-dot]')).not.toBeNull();

    act(() => { markSessionRevoked(); });
    // The dashboard says why, with the way out.
    expect(screen.getByRole('button', { name: 'Log in again' })).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();

    act(() => { clearSessionRevoked(); });
    expect(screen.queryByRole('button', { name: 'Log in again' })).toBeNull();
    expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    expect(opener().querySelector('[data-avatar-hint-dot]')).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('shows nothing once signed out', async () => {
    await openDashboard();
    expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Logout Team' }));
    await screen.findByRole('heading', { name: 'RetroGemini' });
    expect(screen.queryByRole('note')).toBeNull();
    // Logging out is no dismissal: the person never acted on it.
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });
});

describe("App — a What's New put off for later", () => {
  const originalFetch = global.fetch;
  const WHATS_NEW = { name: "What's New" };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearSessionRevoked();
    window.history.replaceState({}, '', '/');
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    // A release the facilitator has not read yet: the note opens by itself.
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        current: '45.3',
        announcements: [{ version: '45.0', date: '2026-11-19', items: [{ type: 'feature', description: 'A new look' }] }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // The note opened itself whenever the open team changed object. A pick puts
  // a new team on screen (the answered map, merged on a new object), so each
  // pick brought back the note just put off, over the picker still open.
  it('stays closed when an avatar pick puts a new team object on screen', async () => {
    vi.mocked(dataService.setMemberAvatar).mockResolvedValue({ 'fac-1': { id: 'cat', at: 500 } });
    await openDashboard();
    const note = await screen.findByRole('dialog', WHATS_NEW);
    fireEvent.click(within(note).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog', WHATS_NEW)).toBeNull());

    pickCat();
    await waitFor(() => expect(screen.getByTestId('dashboard-stub').dataset.avatars).toContain('cat'));
    // The commit that drew the new team has run its effects.
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('dialog', WHATS_NEW)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Choose my avatar' })).toBeInTheDocument();
  });

  it('still opens by itself when the facilitator comes back to the dashboard', async () => {
    await openDashboard();
    expect(await screen.findByRole('dialog', WHATS_NEW)).toBeInTheDocument();
  });
});
