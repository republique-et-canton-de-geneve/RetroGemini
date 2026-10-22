import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import DashboardRevokedBanner from '../components/dashboard/DashboardRevokedBanner';
import LanguageProvider from '../i18n/LanguageProvider';
import { dataService } from '../services/dataService';
import { clearSessionRevoked, isSessionRevoked, markSessionRevoked } from '../services/sessionRevocation';
import { Team, User } from '../types';

/**
 * Decision D3b, on the Dashboard — the team's password is changed elsewhere
 * while someone here is writing a feedback, or a reply to one.
 *
 * The Dashboard used to sign out the moment the revocation arrived, so the
 * login screen replaced it and took with it everything the feedback board
 * holds only in React state: the draft's title, description and images, and
 * every comment draft. The form's own answer to the refusal ("copy your text,
 * log in again") was never seen. The Dashboard now does what both session
 * screens do (the H12 rationale): it stays, says why above itself, and offers
 * "Log in again".
 *
 * The real `TeamFeedback` and the real `submitTeamFeedback` run inside App,
 * behind a thin Dashboard stand-in: what is under test is whether App keeps
 * them mounted. `dataService` is mocked as in `appSessionRevoked`, so no
 * resolver is registered and a `401 session_revoked` revokes outright.
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

vi.mock('../components/Dashboard', async () => {
  const { default: TeamFeedback } = await vi.importActual<typeof import('../components/TeamFeedback')>('../components/TeamFeedback');
  const { submitTeamFeedback } = await vi.importActual<typeof import('../services/feedbackSubmission')>('../services/feedbackSubmission');
  const { dataService: mocked } = await import('../services/dataService');
  return {
    default: ({ team, currentUser, onRefresh }: { team: Team; currentUser: User; onRefresh: () => void }) => (
      <TeamFeedback
        teamId={team.id}
        teamName={team.name}
        teamPassword=""
        sessionToken={mocked.getSessionToken()}
        currentUserId={currentUser.id}
        currentUserName={currentUser.name}
        onSubmitFeedback={(feedback) => submitTeamFeedback({ teamId: team.id, sessionToken: mocked.getSessionToken(), feedback })}
        onRefresh={onRefresh}
      />
    )
  };
});

const STORAGE_KEY = 'retro-open-session';
const TOKEN = `rg1.${btoa(JSON.stringify({ iat: 1_000 })).replace(/=+$/, '')}.sig`;

const facilitator: User = { id: 'fac-1', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

const existingFeedback = {
  id: 'feedback-a',
  teamId: 'team-1',
  teamName: 'Rocket Squad',
  type: 'bug',
  title: 'Alpha report',
  description: 'The first feedback',
  submittedBy: 'fac-1',
  submittedByName: 'Fran',
  submittedAt: '2026-08-01T10:00:00.000Z',
  isRead: false,
  status: 'pending',
  comments: []
};

const NOTICE = 'The team password was changed, so you were signed out. Log in with the new password, or ask the facilitator for a new invitation link.';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const revokedBanner = () => screen.queryAllByRole('alert').find((element) => /team password was changed/.test(element.textContent ?? ''));

describe('the Dashboard when the team password is changed elsewhere (decision D3b)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearSessionRevoked();
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getSessionToken).mockReturnValue(TOKEN);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId: team.id, userId: facilitator.id, userName: facilitator.name, view: 'DASHBOARD', sessionToken: TOKEN }));
    global.fetch = vi.fn(async (url: unknown) => {
      const href = String(url);
      if (href.includes('/api/feedbacks/all')) return json(200, { feedbacks: [existingFeedback] });
      if (href.includes('/api/feedbacks/create') || href.includes('/api/feedbacks/comment')) return json(401, { error: 'session_revoked' });
      return json(200, { version: '41.0', announcements: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearSessionRevoked();
  });

  it('keeps a feedback draft on screen when sending it is refused, with the reason above the Dashboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /New Feedback/ }));
    await user.type(screen.getByLabelText('Title'), 'Broken export');
    await user.type(screen.getByLabelText('Description'), 'The export button does nothing.');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(isSessionRevoked()).toBe(true));
    expect(await screen.findByText('Your feedback was not sent: your session has expired. Copy your text, log in again and send it again.')).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Broken export');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('The export button does nothing.');
    expect(revokedBanner()).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'RetroGemini' })).toBeNull();
  });

  it('keeps a comment draft on screen when posting it is refused', async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = (await screen.findByText('Alpha report')).closest('div[class*="bg-white"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /Comments/ }));
    await user.type(within(card).getByPlaceholderText('Add a comment...'), 'Seen it on Firefox too');
    await user.click(within(card).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(isSessionRevoked()).toBe(true));
    await waitFor(() => expect(revokedBanner()).toBeTruthy());
    expect((within(card).getByPlaceholderText('Add a comment...') as HTMLInputElement).value).toBe('Seen it on Firefox too');
  });

  it('shows the reason as an alert with "Log in again", which lands on the login screen with the notice', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: /New Feedback/ });

    act(() => markSessionRevoked());

    const banner = revokedBanner()!;
    expect(banner.textContent).toContain('The team password was changed, so nothing you do here is being saved any more.');
    // Still the Dashboard.
    expect(screen.getByRole('button', { name: /New Feedback/ })).toBeTruthy();
    await user.click(within(banner).getByRole('button', { name: 'Log in again' }));

    expect(await screen.findByRole('heading', { name: 'RetroGemini' })).toBeTruthy();
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('takes the banner away when another tab\'s token clears the revocation', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New Feedback/ });

    act(() => markSessionRevoked());
    expect(revokedBanner()).toBeTruthy();
    act(() => clearSessionRevoked());

    expect(revokedBanner()).toBeUndefined();
    expect(screen.getByRole('button', { name: /New Feedback/ })).toBeTruthy();
  });
});

describe('the Dashboard banner in French', () => {
  it('says why, and offers to log in again', () => {
    const onLogInAgain = vi.fn();
    render(
      <LanguageProvider initialLanguage="fr">
        <DashboardRevokedBanner onLogInAgain={onLogInAgain} />
      </LanguageProvider>
    );

    expect(screen.getByRole('alert').textContent).toContain(
      "Le mot de passe de l'équipe a été changé\u00a0: rien de ce que vous faites ici n'est plus enregistré."
    );
    screen.getByRole('button', { name: 'Se reconnecter' }).click();
    expect(onLogInAgain).toHaveBeenCalledTimes(1);
  });
});
