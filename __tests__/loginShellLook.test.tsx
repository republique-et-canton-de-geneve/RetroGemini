import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamLogin from '../components/TeamLogin';
import AnnouncementModal from '../components/AnnouncementModal';
import AppHeader from '../components/AppHeader';
import LanguageProvider from '../i18n/LanguageProvider';
import type { Team, TeamSummary, User, VersionAnnouncement } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The colours of the screens a guest meets first — the login screens, the
 * application's top bar and "What's New" — measured as the build paints them
 * (the Clarté tokens of index.css included).
 *
 * The e2e audit walks the team list, the create form and the join screen of a
 * plain team link in their resting state. It never sees what only a failure,
 * a slow network or a particular link shows: an error, the rate-limit and
 * "could not be reached" messages, the notice of a sign-out, the info banner,
 * the disabled Continue button, the reset confirmation, every type of release
 * note. Those are measured here, at 4.5:1 for text and 3:1 for an icon that
 * is the only sign of what its control does (WCAG 1.4.3, 1.4.11).
 */

const TEXT = 4.5;
const ICON = 3;

const expectText = (element: Element) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `"${element.textContent}": ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(TEXT);
  return pair;
};

const team = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' },
    { id: 'u2', name: 'Bob', color: 'bg-emerald-500', role: 'participant' },
  ],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: [],
} as unknown as Team;

const summaries: TeamSummary[] = [
  { id: 'team-1', name: 'Alpha Team', memberCount: 2, lastConnectionDate: new Date().toISOString() },
  { id: 'team-2', name: 'Beta Team', memberCount: 1 },
];

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn(),
  loginTeam: vi.fn(),
  importTeam: vi.fn(),
  requestPasswordReset: vi.fn(),
  verifyResetToken: vi.fn(),
}));

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      ...mocks,
      autoJoinFromInvite: vi.fn(() => {
        throw new (actual.InviteAutoJoinError as new (m: string, c: string) => Error)('not verified', 'INVITE_NOT_VERIFIED');
      }),
    },
  };
});

let infoMessage = '';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  infoMessage = '';
  window.history.replaceState({}, '', '/');
  mocks.listTeams.mockResolvedValue(summaries);
  mocks.importTeam.mockResolvedValue({ ...team });
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ infoMessage }) })) as unknown as typeof fetch;
});

const openSignIn = async () => {
  render(<TeamLogin onLogin={vi.fn()} />);
  fireEvent.click(await screen.findByText('Alpha Team'));
  return screen.findByLabelText('Password');
};

describe('the team list', () => {
  it('reads the product name, the tagline and the heading', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    expectText(await screen.findByRole('heading', { name: 'Your Teams' }));
    expectText(screen.getByRole('heading', { level: 1 }));
    expectText(screen.getByText(/Collaborative retrospectives/));
  });

  it('reads a team row: its name, its members and its last activity', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    const row = (await screen.findByText('Alpha Team')).closest('button')!;
    expectText(within(row).getByText('Alpha Team'));
    expectText(within(row).getByText('2 members'));
    expectText(within(row).getByText(/Last active/));
    expectText(within(row).getByText('AL'));
  });

  it('draws a favourite as a filled star and the others as an outline, each at 3:1', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: 'Add Alpha Team to favorites' });
    // The outline is what draws the star on the row, so it carries the 3:1.
    const outline = toggle.querySelector('path[fill="none"]')!;
    expect(effectivePairOfIcon(outline)).toBeGreaterThanOrEqual(ICON);
    expect(toggle.querySelectorAll('path')).toHaveLength(1);
    fireEvent.click(toggle);
    const on = screen.getByRole('switch', { name: 'Remove Alpha Team from favorites' });
    // Filled and empty differ in shape, not only in colour (WCAG 1.4.1).
    expect(on.querySelectorAll('path')).toHaveLength(2);
    expect(effectivePairOfIcon(on.querySelector('path[fill="none"]')!)).toBeGreaterThanOrEqual(ICON);
  });

  it('reads the loading line, the empty list and the failed list with its retry', async () => {
    let answer: (value: TeamSummary[] | null) => void = () => {};
    mocks.listTeams.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { unmount } = render(<TeamLogin onLogin={vi.fn()} />);
    expectText(within(screen.getByRole('status')).getByText('Loading teams...'));
    unmount();

    mocks.listTeams.mockResolvedValueOnce([]);
    render(<TeamLogin onLogin={vi.fn()} />);
    expectText(await screen.findByText(/No teams found/));
    answer(null);
  });

  it('reads the list that could not be loaded, and its retry button', async () => {
    mocks.listTeams.mockResolvedValue(null);
    render(<TeamLogin onLogin={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expectText(within(alert).getByText('The team list could not be loaded.'));
    expectText(within(alert).getByRole('button', { name: 'Try again' }));
  });

  it('reads the info banner, the sign-out notice and the error of a bad reset link', async () => {
    infoMessage = 'Maintenance tonight at 22:00';
    window.history.replaceState({}, '', '/?reset=not-a-token');
    render(
      <TeamLogin
        onLogin={vi.fn()}
        signedOutNotice={{ key: 'login.notice.nothingToJoin', params: { teamName: 'Alpha Team' } }}
      />
    );
    expectText(await screen.findByText('Maintenance tonight at 22:00'));
    const alert = await screen.findByRole('alert');
    expectText(alert.querySelector('p') ?? alert);
    const notice = screen.getByRole('status');
    expectText(notice.querySelector('p') ?? notice);
  });

  it('keeps the console entry readable as an icon', async () => {
    render(<TeamLogin onLogin={vi.fn()} onSuperAdminLogin={vi.fn()} />);
    const entry = await screen.findByRole('button', { name: 'Super Admin Access' });
    expect(effectivePair(entry.querySelector('.material-symbols-outlined')!).ratio).toBeGreaterThanOrEqual(ICON);
  });
});

describe('signing in', () => {
  it('reads the title, the label and the link to the reset', async () => {
    await openSignIn();
    expectText(screen.getByRole('heading', { name: 'Login to Alpha Team' }));
    expectText(screen.getByText('Password'));
    expectText(screen.getByRole('button', { name: 'Forgot password?' }));
    expectText(screen.getByRole('button', { name: 'Back' }));
    expectText(screen.getByRole('button', { name: 'Enter Workspace' }));
  });

  it('reads a refused password and the rate-limit message as errors', async () => {
    mocks.loginTeam.mockRejectedValueOnce(new Error('Too many attempts to join this team from this network. Please wait a few minutes, then try again.'));
    fireEvent.change(await openSignIn(), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter Workspace' }));
    const alert = await screen.findByRole('alert');
    const pair = expectText(within(alert).getByText(/Too many attempts/));
    // An error reads as one: a red hue, not the page's neutral ink.
    expect(pair.fg).toMatch(/^(rose|red)-/);
  });

  it('reads the reset form, its refusal and its confirmation', async () => {
    await openSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    const field = await screen.findByLabelText('Recovery Email');
    expectText(screen.getByText('Recovery Email'));

    mocks.requestPasswordReset.mockResolvedValueOnce({ success: false, message: 'Password reset by email is not available on this server. Please contact your administrator.' });
    fireEvent.change(field, { target: { value: 'lead@corp.ch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expect(expectText(await screen.findByText(/not available on this server/)).fg).toMatch(/^(rose|red)-/);

    mocks.requestPasswordReset.mockResolvedValueOnce({ success: true, message: 'If the team and email match, a reset link has been sent.' });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expectText(await screen.findByText('If the team and email match, a reset link has been sent.'));
  });
});

describe('creating a team', () => {
  it('reads every label and hint of the form', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New Team' }));
    expectText(screen.getByRole('heading', { name: 'Create New Team' }));
    for (const label of ['Team Name', 'Create Password', 'Recovery Email']) expectText(screen.getByText(label));
    expectText(screen.getByText(/at least 8 characters/));
    expectText(screen.getByText(/only way to reset your password/));
  });

  it('reads a refused address as an error', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New Team' }));
    fireEvent.change(screen.getByLabelText('Team Name'), { target: { value: 'Gamma' } });
    fireEvent.change(screen.getByLabelText('Create Password'), { target: { value: 'long-enough' } });
    fireEvent.change(screen.getByLabelText('Recovery Email'), { target: { value: 'lead@corp' } });
    fireEvent.submit(screen.getByLabelText('Team Name').closest('form')!);
    expect(expectText(await screen.findByText(/valid email/i)).fg).toMatch(/^(rose|red)-/);
  });
});

describe('the join screen of an invite link', () => {
  const invite = { id: 'team-1', name: 'Alpha Team', inviteCredential: 'cred' } as never;

  it('reads the title, the picker, the divider, the footer and the disabled Continue', async () => {
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    const picker = await screen.findByRole('group', { name: 'Select Your Name' });
    expectText(screen.getByRole('heading', { name: /Join Alpha Team/ }));
    expectText(screen.getByText('Select Your Name'));
    expectText(within(picker).getByText('Bob'));
    expectText(within(picker).getByText('participant'));
    expectText(screen.getByText('OR'));
    expectText(screen.getByRole('button', { name: /not in the list/ }));
    expectText(screen.getByText('You will join as a participant'));
    // Disabled controls are exempt from 1.4.3, but a guest must still be able
    // to read what the button will do once a name is chosen.
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    expectText(next);
  });

  it('draws each member with the shared avatar, in their tone', async () => {
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    const picker = await screen.findByRole('group', { name: 'Select Your Name' });
    const initials = within(picker).getByText('BO');
    expect(initials.getAttribute('aria-hidden')).toBe('true');
    expectText(initials);
  });

  it("draws a member's chosen picture, and the initials for an id this release does not draw", async () => {
    mocks.importTeam.mockResolvedValue({ ...team, memberAvatars: { u2: { id: 'fox', at: 1 } } });
    const { unmount } = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    let picker = await screen.findByRole('group', { name: 'Select Your Name' });
    expect(within(picker).getByText('Bob').closest('button')!.querySelector('[data-avatar-art="fox"]')).not.toBeNull();
    unmount();

    mocks.importTeam.mockResolvedValue({ ...team, memberAvatars: { u2: { id: 'from-a-later-release', at: 1 } } });
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    picker = await screen.findByRole('group', { name: 'Select Your Name' });
    const bob = within(picker).getByText('Bob').closest('button')!;
    expect(bob.querySelector('[data-avatar-art]')).toBeNull();
    expect(within(bob).getByText('BO')).toBeTruthy();
  });

  it('reads the "could not be reached" message and its retry', async () => {
    mocks.importTeam.mockRejectedValueOnce(new Error('The server could not be reached. Check your connection, then try again.'));
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    const alert = await screen.findByRole('alert');
    expect(expectText(within(alert).getByText(/could not be reached/)).fg).toMatch(/^(rose|red)-/);
    expectText(screen.getByRole('button', { name: 'Try again' }));
    expectText(screen.getByRole('button', { name: 'Back' }));
  });

  it('reads the name field path in French', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />
      </LanguageProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: /pas dans la liste/ }));
    expectText(await screen.findByText('Votre nom'));
    expectText(screen.getByRole('button', { name: /Retour à la liste/ }));
  });
});

const effectivePairOfIcon = (path: Element) => {
  // An SVG path paints with `currentColor` (the filled path) or carries its
  // own text class (the outline); either way the nearest text colour is the
  // one drawn, over the row's background.
  return effectivePair(path).ratio;
};

describe('"What\'s New"', () => {
  const allTypes: VersionAnnouncement[] = [
    {
      version: '45.0',
      date: '2026-11-19',
      items: (['feature', 'improvement', 'fix', 'security', 'removed'] as const).map((type) => ({
        type,
        description: `A ${type} note`,
      })),
    },
  ];

  it('reads every type of release note, its chip and its text', () => {
    render(<AnnouncementModal announcements={allTypes} currentVersion="45.0" onDismiss={vi.fn()} onMarkAsRead={vi.fn()} />);
    for (const label of ['New Feature', 'Improvement', 'Bug Fix', 'Security Update', 'Removed']) {
      expectText(screen.getByText(label));
    }
    for (const type of ['feature', 'improvement', 'fix', 'security', 'removed']) {
      expectText(screen.getByText(`A ${type} note`));
    }
  });

  it('reads the title, the version, the date, the close and both buttons', () => {
    render(<AnnouncementModal announcements={allTypes} currentVersion="45.0" onDismiss={vi.fn()} onMarkAsRead={vi.fn()} />);
    expectText(screen.getByRole('heading', { name: "What's New" }));
    expectText(screen.getByText('Version 45.0'));
    expectText(screen.getByText('v45.0'));
    expectText(screen.getByText(/2026/));
    expect(effectivePair(screen.getByRole('button', { name: 'Close' }).querySelector('.material-symbols-outlined')!).ratio).toBeGreaterThanOrEqual(ICON);
    expectText(screen.getByRole('button', { name: 'Later' }));
    expectText(screen.getByRole('button', { name: 'Got it!' }));
  });

  it('reads the empty state', () => {
    render(<AnnouncementModal announcements={[]} currentVersion="45.0" onDismiss={vi.fn()} onMarkAsRead={vi.fn()} />);
    expectText(screen.getByText("You're all caught up!"));
    expectText(screen.getByText(/No new updates/));
  });

  it('veils the page without a blur, through the shared dialog', () => {
    render(<AnnouncementModal announcements={allTypes} currentVersion="45.0" onDismiss={vi.fn()} onMarkAsRead={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: "What's New" });
    const overlay = dialog.parentElement!;
    expect(overlay.className).not.toMatch(/backdrop-blur/);
  });
});

describe('the top bar', () => {
  const user = { id: 'u1', name: 'Claire Dubois', color: 'bg-indigo-500', role: 'facilitator' } as User;
  const header = (props: Partial<React.ComponentProps<typeof AppHeader>> = {}) =>
    render(
      <AppHeader
        teamName="Alpha Team"
        currentUser={user}
        onHome={vi.fn()}
        announcementsAvailable
        unreadCount={3}
        onOpenAnnouncements={vi.fn()}
        onLogout={vi.fn()}
        {...props}
      />
    );

  it('reads the product, the team, the user and the unread count', () => {
    header();
    expectText(screen.getByText('RetroGemini'));
    expectText(screen.getByText('Alpha Team'));
    expectText(screen.getByText('Claire Dubois'));
    expectText(screen.getByText('User'));
    expectText(screen.getByText('3'));
  });

  it('names "What\'s New" by its words, its icon hidden', () => {
    header();
    const button = screen.getByRole('button', { name: /^What's New\s*3$/ });
    expectText(within(button).getByText("What's New"));
    expect(button.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps Logout an icon the e2e header check finds, named and at 3:1', () => {
    header();
    const logout = screen.getByRole('button', { name: 'Logout Team' });
    const icon = logout.querySelector('.material-symbols-outlined')!;
    expect(icon.textContent).toBe('logout');
    expect(effectivePair(icon).ratio).toBeGreaterThanOrEqual(ICON);
  });

  it('shows the viewer as a named avatar, and no Logout or badge when not asked', () => {
    header({ onLogout: undefined, unreadCount: null });
    // The avatar opens the picker; named by the person, the name beside it being hidden on a phone.
    expect(screen.getByRole('button', { name: 'CL, Claire Dubois, choose my avatar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logout Team' })).toBeNull();
    expect(screen.getByRole('button', { name: "What's New" })).toBeInTheDocument();
  });

  it('opens the avatar picker from the viewer\'s avatar, by keyboard too, and stores a pick', async () => {
    const onPickAvatar = vi.fn(() => Promise.resolve());
    header({ avatarId: 'owl', avatarChoice: 'owl', onPickAvatar });
    const opener = screen.getByRole('button', { name: 'Claire Dubois, choose my avatar' });
    expect(opener.querySelector('[data-avatar-art="owl"]')).not.toBeNull();
    opener.focus();
    await userEvent.setup().keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Choose my avatar' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fox' }));
    expect(onPickAvatar).toHaveBeenCalledWith('fox');
  });

  it('keeps the picker from storing while the session is revoked', () => {
    const onPickAvatar = vi.fn(() => Promise.resolve());
    header({ onPickAvatar, avatarPickerDisabled: true });
    fireEvent.click(screen.getByRole('button', { name: /choose my avatar/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fox' }));
    expect(onPickAvatar).not.toHaveBeenCalled();
  });

  it('shows no "What\'s New" to a participant', () => {
    header({ currentUser: { ...user, role: 'participant' } });
    expect(screen.queryByRole('button', { name: /What's New/ })).toBeNull();
  });
});
