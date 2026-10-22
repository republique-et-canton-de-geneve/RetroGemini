import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import LanguageProvider from '../i18n/LanguageProvider';
import { dataService } from '../services/dataService';
import { clearSessionRevoked } from '../services/sessionRevocation';
import { Team, User } from '../types';

/**
 * A sign-out is final for everything still on its way.
 *
 * Whatever was in flight when the user signed out — a save the Dashboard was
 * awaiting, the effects of the commit that had just put the Dashboard on
 * screen — can finish after it. Each of them used to be able to put the team
 * back with the view left on LOGIN, which App rendered as its empty shell (no
 * login screen, no Dashboard) until a reload, or to write the session the
 * sign-out had just removed back into storage. A participant who joined a
 * team with nothing running reached the same empty shell directly.
 *
 * `dataService` is mocked, so `getTeam` keeps answering the team after a
 * sign-out: what is under test is App's own guarantee, which must hold even
 * then. (`dataService.logout` makes the real `getTeam` answer nothing as well —
 * `dataServiceLogout.test.ts`.) The Dashboard is a stub around the real
 * recovery-email field.
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
    updateFacilitatorEmail: vi.fn(),
    importTeam: vi.fn(),
    autoJoinFromInvite: vi.fn(),
    ensureSessionPlaceholder: vi.fn(),
    ensureHealthCheckPlaceholder: vi.fn()
  }
}));

vi.mock('../components/Dashboard', async () => {
  const { default: RecoveryEmailSetting } = await vi.importActual<typeof import('../components/dashboard/RecoveryEmailSetting')>(
    '../components/dashboard/RecoveryEmailSetting'
  );
  return {
    default: ({ team, onRefresh }: { team: Team; onRefresh: () => void }) => (
      <div>
        <p>Dashboard stub</p>
        <RecoveryEmailSetting team={team} onRefresh={onRefresh} />
      </div>
    )
  };
});

const STORAGE_KEY = 'retro-open-session';

const facilitator: User = { id: 'fac-1', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };
const participant: User = { id: 'p-1', name: 'Pat', color: 'bg-rose-500', role: 'participant' };

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  facilitatorEmail: 'old@example.ch',
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: []
};

const NOTHING_TO_JOIN =
  'There is nothing to join in Rocket Squad yet: no retrospective or health check is in progress. Open the invitation link again once the facilitator has started one.';

const saveSession = (user: User) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    teamId: team.id,
    userId: user.id,
    userName: user.name,
    view: 'DASHBOARD',
    sessionToken: 'rg1.session-token'
  }));
};

const openInviteLink = (payload: Record<string, unknown>) => {
  window.history.replaceState({}, '', `/?join=${encodeURIComponent(btoa(JSON.stringify(payload)))}`);
};

describe('App after a sign-out', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearSessionRevoked();
    window.history.replaceState({}, '', '/');
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: '41.0', announcements: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // The realistic way in: edit the recovery address, then click Logout. The
  // blur commits the address, and its save is still on its way when the
  // sign-out lands; once answered, the field refreshes the team through the
  // Dashboard's onRefresh, which used to set the team again unconditionally.
  it('stays on the login screen when a recovery address saved just before Logout is answered after it', async () => {
    let answerSave: (email: string) => void = () => {};
    vi.mocked(dataService.updateFacilitatorEmail).mockImplementationOnce(
      () => new Promise<string | undefined>((resolve) => { answerSave = resolve; })
    );
    saveSession(facilitator);
    render(<App />);
    const field = await screen.findByLabelText('Recovery Email');

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'fran@example.ch' } });
    fireEvent.blur(field);
    expect(dataService.updateFacilitatorEmail).toHaveBeenCalledWith(team.id, 'fran@example.ch');
    fireEvent.click(screen.getByRole('button', { name: 'Logout Team' }));
    const loginHeading = await screen.findByRole('heading', { name: 'RetroGemini' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => { answerSave('fran@example.ch'); });

    // The same element: the login screen was never taken off the page.
    expect(loginHeading.isConnected).toBe(true);
    expect(screen.queryByText('Dashboard stub')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // And dataService forgets the team, so its real getTeam answers nothing.
    expect(dataService.logout).toHaveBeenCalledTimes(1);
  });

  // The order behind appSessionRevoked's intermittent failure, forced. React
  // runs a commit's effects in a later task; a click in between is handled
  // first, and React then runs those effects before rendering the sign-out —
  // after the click had removed the saved session. The effect saving the open
  // session wrote it back, with the team the commit had shown.
  it('never lets the effects of the commit before a Logout save the session back', async () => {
    saveSession(facilitator);
    let clicked = false;
    // Clicks Logout from the first DOM change that shows it: the commit that
    // put the restored Dashboard on screen is done, and its effects are not.
    const observer = new MutationObserver(() => {
      const logout = document.querySelector<HTMLButtonElement>('button[aria-label="Logout Team"]');
      if (!logout || clicked) return;
      clicked = true;
      observer.disconnect();
      fireEvent.click(logout);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      render(<App />);
      await waitFor(() => expect(clicked).toBe(true));
      await screen.findByRole('heading', { name: 'RetroGemini' });
      await act(async () => {});
    } finally {
      observer.disconnect();
    }

    expect(screen.queryByText('Dashboard stub')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // A team invitation with no session in it, to a team where nothing is
  // running: no health check in progress and no retrospective at all. A
  // participant never stays on the Dashboard, so there is nothing to show
  // them. This used to set the team with the view on LOGIN — the empty shell —
  // and save `view: 'LOGIN'` for the next page load.
  it('signs a participant who joins a team with nothing running out, and says why', async () => {
    vi.mocked(dataService.importTeam).mockResolvedValue(team);
    vi.mocked(dataService.autoJoinFromInvite).mockReturnValue({ team, user: participant });
    openInviteLink({ id: team.id, name: team.name, inviteCredential: 'invite-cred', memberId: participant.id });
    render(<App />);

    const notice = await screen.findByText(NOTHING_TO_JOIN);
    expect(notice.getAttribute('role')).toBe('status');
    expect(screen.getByRole('heading', { name: 'RetroGemini' })).toBeTruthy();
    expect(dataService.autoJoinFromInvite).toHaveBeenCalledTimes(1);
    expect(dataService.logout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // The other way a participant reaches a team with nothing running: a saved
  // session restored onto the Dashboard. They were already signed out; the
  // login screen now says why, as for the join.
  it('says the same to a participant restored onto the Dashboard of a team with nothing running', async () => {
    saveSession(participant);
    render(<App />);

    expect((await screen.findByText(NOTHING_TO_JOIN)).getAttribute('role')).toBe('status');
    expect(screen.queryByText('Dashboard stub')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('says it in French to a French reader', async () => {
    saveSession(participant);
    render(
      <LanguageProvider initialLanguage="fr">
        <App />
      </LanguageProvider>
    );

    // getByText normalises the no-break space in the element, not in the
    // matcher: the matcher has an ordinary one, and the next line checks the
    // real character is there.
    const notice = await screen.findByText(
      'Il n’y a encore rien à rejoindre dans Rocket Squad : aucune rétrospective ni aucun bilan de santé n’est en cours. Rouvrez le lien d’invitation lorsque le facilitateur aura lancé une rétrospective ou un bilan de santé.'
    );
    expect(notice.textContent).toContain('Rocket Squad\u00a0: aucune');
  });
});
