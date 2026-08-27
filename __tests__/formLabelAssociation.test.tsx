import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import Dashboard from '../components/Dashboard';
import SuperAdmin from '../components/SuperAdmin';
import TeamFeedback from '../components/TeamFeedback';
import ReleaseAnalysisModal from '../components/dashboard/ReleaseAnalysisModal';
import { orphanLabels } from './helpers/formLabels';
import type { Team, User, RetroSession } from '../types';

/**
 * Audit H42, remaining gap (lot L23) — **every label names its control.**
 *
 * The accessibility pass closed the axe baseline at zero and then said plainly
 * what it had *not* done: 29 labels that were only visually above their field.
 * Nothing automated in this repository could fail on them —
 * `jsx-a11y/label-has-associated-control` counted them inside a warning budget
 * that was allowed to stay put, and axe stayed silent because a `placeholder`
 * satisfies its accessible-name check.
 *
 * Two properties are asserted, and they fail for different reasons:
 *
 *  1. **No orphan labels on the screen.** `orphanLabels` walks every rendered
 *     `<label>` and reports the ones resolving to no control. This is the guard
 *     that keeps working when someone adds a field next year — a named-field
 *     assertion only covers the fields somebody thought to name.
 *  2. **The name is the visible text.** `getByLabelText` for the fields that
 *     matter, so the association cannot be satisfied by pointing `htmlFor` at
 *     the wrong control — a mistake that leaves the count at zero and the
 *     screen reader saying "Password" over the team-name box.
 *
 * A label naming a *group* of controls (Columns, Dimensions, feedback Type)
 * cannot be fixed with `htmlFor`: there is no single control to point at. Those
 * become a real group with an accessible name, asserted through
 * `getByRole('group' | 'radiogroup', { name })` — which is what a screen reader
 * announces when entering the fieldset.
 */

const RESET_TOKEN = 'a'.repeat(64);

const teamSummary = {
  id: 'team-1',
  name: 'Alpha Team',
  memberCount: 2,
  lastConnectionDate: '2026-08-01T10:00:00.000Z'
};

const fullTeam = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' },
    { id: 'u2', name: 'Bob', color: 'bg-teal-500', role: 'participant' }
  ],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: []
} as unknown as Team;

const facilitator: User = {
  id: 'u1',
  name: 'Alice',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => [teamSummary]),
      createTeam: vi.fn(async () => fullTeam),
      importTeam: vi.fn(async () => fullTeam),
      autoJoinFromInvite: vi.fn(() => {
        throw new (actual.InviteAutoJoinError as new (m: string, c: string) => Error)(
          'not verified',
          'INVITE_NOT_VERIFIED'
        );
      }),
      verifyResetToken: vi.fn(async () => ({ valid: true, teamName: 'Alpha Team' })),
      resetPassword: vi.fn(async () => ({ success: true, message: 'done' })),
      changeTeamPassword: vi.fn(async () => undefined),
      getTeamMembers: vi.fn(async () => fullTeam.members),
      loadTeam: vi.fn(async () => fullTeam),
      getAuthenticatedTeamId: vi.fn(() => 'team-1'),
      getAuthenticatedPassword: vi.fn(() => 'existing-password'),
      getSessionToken: vi.fn(() => 'session-token'),
      getPresets: vi.fn(() => []),
      getHealthCheckTemplates: vi.fn(() => []),
      hasStoredPassword: vi.fn(() => true),
      updateTeamMembers: vi.fn(async () => undefined),
      saveTeam: vi.fn(async () => undefined)
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(async (url: unknown) => {
    const href = String(url);
    if (href.includes('/api/super-admin/teams')) {
      return { ok: true, json: async () => ({ teams: [fullTeam] }) } as unknown as Response;
    }
    if (href.includes('/api/super-admin/feedbacks') || href.includes('/api/feedbacks/all')) {
      return { ok: true, json: async () => ({ feedbacks: [] }) } as unknown as Response;
    }
    if (href.includes('/api/super-admin/ai-settings')) {
      // Enabled, because the four LLM fields only render behind the toggle.
      return {
        ok: true,
        json: async () => ({ ai: { enabled: true, apiUrl: '', apiKey: '', model: '' } })
      } as unknown as Response;
    }
    return { ok: true, json: async () => ({ infoMessage: '', settings: {} }) } as unknown as Response;
  }) as unknown as typeof fetch;
});

// --------------------------------------------------------------------------
// TeamLogin — every view is a form, and every one of them was unlabelled
// --------------------------------------------------------------------------

describe('L23 — TeamLogin names every field', () => {
  const renderList = async () => {
    const view = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} onSuperAdminLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('+ New Team')).toBeTruthy());
    return view;
  };

  it('names the team-creation fields', async () => {
    const { container } = await renderList();
    fireEvent.click(screen.getByText('+ New Team'));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Team Name')).toBeTruthy();
    expect(screen.getByLabelText('Create Password')).toBeTruthy();
    expect(screen.getByLabelText(/Recovery Email/)).toBeTruthy();
  });

  it('names the login password field', async () => {
    const { container } = await renderList();
    fireEvent.click(screen.getByRole('button', { name: /Alpha Team/ }));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('names the forgotten-password field', async () => {
    const { container } = await renderList();
    fireEvent.click(screen.getByRole('button', { name: /Alpha Team/ }));
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Recovery Email')).toBeTruthy();
  });

  it('names the reset-password field', async () => {
    window.history.replaceState({}, '', `/?reset=${RESET_TOKEN}`);
    const { container } = render(<TeamLogin onLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Password')).toBeTruthy());

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('New Password')).toBeTruthy();
  });

  it('names the super-admin password field', async () => {
    const { container } = await renderList();
    fireEvent.click(screen.getByTitle('Super Admin Access'));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Super Admin Password')).toBeTruthy();
  });

  it('names the member picker and the participant name field on the invite-join screen', async () => {
    const { container } = render(
      <TeamLogin
        onLogin={vi.fn()}
        onJoin={vi.fn()}
        inviteData={{ teamId: 'team-1', teamName: 'Alpha Team' } as never}
      />
    );

    // The picker first. Its "Select Your Name" label is the one ESLint could
    // **not** report — the rule skips a label whose children are a conditional
    // expression — so only a rendered check finds it.
    await waitFor(() => expect(screen.getByText(/I'm not in the list/)).toBeTruthy());
    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByRole('group', { name: 'Select Your Name' })).toBeTruthy();

    // Awaited, like the assertion above it, and for the same reason: the screen
    // this checks exists only after React commits the click's state update.
    // Asserting it synchronously made the test **flaky under load** — it failed
    // once on a loaded CI runner while the identical job passed on the same
    // commit in a concurrent run, with a DOM dump still showing the picker.
    //
    // This is not a relaxation. `waitFor` retries for a second and then fails,
    // so the case it was written to catch — the field never gaining a name, or
    // an effect putting the picker back — still fails exactly as loudly. What it
    // stops is a pass/fail decided by how busy the machine was.
    fireEvent.click(screen.getByText(/I'm not in the list/));
    await waitFor(() => expect(screen.getByLabelText('Your Name')).toBeTruthy());
    expect(orphanLabels(container)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Dashboard — the creation modals, the template builders, the member editor
// --------------------------------------------------------------------------

describe('L23 — Dashboard names every field', () => {
  const renderDashboard = (initialTab: 'ACTIONS' | 'MEMBERS' | 'SETTINGS' | 'HEALTH_CHECKS') =>
    render(
      <Dashboard
        team={fullTeam}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab={initialTab}
      />
    );

  it('names the new-retrospective fields', () => {
    const { container } = renderDashboard('ACTIONS');
    fireEvent.click(screen.getByRole('button', { name: /New Retrospective/i }));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Session Name')).toBeTruthy();
  });

  it('names the custom-column builder, whose "Columns" label names a group', () => {
    const { container } = renderDashboard('ACTIONS');
    fireEvent.click(screen.getByRole('button', { name: /New Retrospective/i }));
    fireEvent.click(screen.getByText(/Create Custom Template/i));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText(/Template Name/)).toBeTruthy();
    // "Columns" heads a repeating row of controls; there is no single control
    // for it to point at, so it must be a group rather than a label.
    expect(screen.getByRole('group', { name: 'Columns' })).toBeTruthy();
  });

  it('names the new-health-check fields', () => {
    const { container } = renderDashboard('HEALTH_CHECKS');
    fireEvent.click(screen.getByRole('button', { name: /START HEALTH CHECK/i }));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Session Name')).toBeTruthy();
  });

  it('names the member editor fields', async () => {
    const { container } = renderDashboard('MEMBERS');
    fireEvent.click(screen.getAllByTitle(/edit member/i)[0]);

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// SuperAdmin — the admin email and the whole LLM configuration
// --------------------------------------------------------------------------

describe('L23 — SuperAdmin names every field', () => {
  it('names the notification and AI configuration fields', async () => {
    const { container } = render(<SuperAdmin sessionToken="token" onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Admin Email Address')).toBeTruthy());
    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText(/API URL/)).toBeTruthy();
    expect(screen.getByLabelText('API Key')).toBeTruthy();
    expect(screen.getByLabelText('Model')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// TeamFeedback — the report form, including the bug/feature radio group
// --------------------------------------------------------------------------

describe('L23 — TeamFeedback names every field', () => {
  it('names the report fields and the type group', async () => {
    const { container } = render(
      <TeamFeedback
        teamId="team-1"
        teamName="Alpha Team"
        teamPassword="pw"
        sessionToken="token"
        currentUserId="u1"
        currentUserName="Alice"
        feedbacks={[]}
        onSubmitFeedback={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /New Feedback/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New Feedback/i }));

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByLabelText(/Images/)).toBeTruthy();
    // Two radios, so the name belongs to the group they form.
    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(group).toBeTruthy();

    // The cheap half of the group: a shared `name`, without which the browser
    // sees two independent radios and gives them two tab stops instead of one.
    // What that attribute actually buys can only be shown in a real browser —
    // jsdom implements neither radio-group navigation nor roving tab order —
    // so `e2e/feedback-radio-keyboard.spec.ts` carries that half.
    const names = screen.getAllByRole('radio').map((radio) => radio.getAttribute('name'));
    expect(names).toEqual(['feedback-type', 'feedback-type']);
  });
});

// --------------------------------------------------------------------------
// ReleaseAnalysisModal
// --------------------------------------------------------------------------

describe('L23 — ReleaseAnalysisModal names every field', () => {
  const retro = {
    id: 'r1',
    teamId: 'team-1',
    name: 'Sprint 169',
    date: '2026-02-17',
    status: 'CLOSED',
    phase: 'CLOSE',
    icebreakerQuestion: '',
    columns: [],
    settings: {
      isAnonymous: false,
      maxVotes: 5,
      oneVotePerTicket: false,
      revealBrainstorm: true,
      revealHappiness: false,
      revealRoti: true,
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
  } as unknown as RetroSession;

  it('names the keyword field and the two selection groups', () => {
    const { container } = render(
      <ReleaseAnalysisModal retrospectives={[retro]} onClose={vi.fn()} />
    );

    expect(orphanLabels(container)).toEqual([]);
    expect(screen.getByLabelText(/Release keyword/)).toBeTruthy();
    // A list, not a group: naming it must not cost the item count.
    expect(screen.getByRole('list', { name: /Retrospectives to include/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Analysis style' })).toBeTruthy();
  });
});
