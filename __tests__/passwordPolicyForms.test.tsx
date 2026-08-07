import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import Dashboard from '../components/Dashboard';
import SuperAdmin from '../components/SuperAdmin';
import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy.js';
import type { Team, User } from '../types';

/**
 * Audit H39, client half — every form that *sets* a password states the rule
 * before the user types, and refuses a short one without a round-trip.
 *
 * Two distinct properties are asserted per form, and the first is the one that
 * is easy to forget:
 *
 *  1. **The rule is visible up front.** H39's acceptance is explicit that the
 *     message must be readable before the submit, not discovered by failing
 *     one. Three of these four forms already said "min 4 characters" in a
 *     placeholder, so raising the server rule without touching them would have
 *     left the UI actively lying about the policy — worse than saying nothing.
 *  2. **The client refuses before the network call.** Not a security control
 *     (the server check is), but the difference between a sentence and a raw
 *     `password_too_short` code, and it keeps a doomed write off the wire.
 *
 * The literals are derived from `PASSWORD_MIN_LENGTH` so this suite follows the
 * rule if it is raised again; the number itself is pinned in
 * `passwordPolicy.test.ts`.
 */

const TOO_SHORT = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
const LONG_ENOUGH = 'a'.repeat(PASSWORD_MIN_LENGTH);

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => []),
      createTeam: vi.fn(async () => ({ id: 'team-1', name: 'Alpha' })),
      verifyResetToken: vi.fn(async () => ({ valid: true })),
      resetPassword: vi.fn(async () => ({ success: true, message: 'done' })),
      changeTeamPassword: vi.fn(async () => undefined),
      getTeamMembers: vi.fn(async () => []),
      loadTeam: vi.fn(async () => null),
      getAuthenticatedTeamId: vi.fn(() => 'team-1'),
      getAuthenticatedPassword: vi.fn(() => 'existing-password'),
      getSessionToken: vi.fn(() => 'session-token'),
      getPresets: vi.fn(() => []),
      getHealthCheckTemplates: vi.fn(() => []),
      hasStoredPassword: vi.fn(() => true)
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn(async (url: unknown) => {
    const href = String(url);
    if (href.includes('/api/super-admin/teams')) {
      return { ok: true, json: async () => ({ teams: [superAdminTeam] }) } as unknown as Response;
    }
    if (href.includes('/api/super-admin/feedbacks')) {
      return { ok: true, json: async () => ({ feedbacks: [] }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ infoMessage: '' }) } as unknown as Response;
  }) as unknown as typeof fetch;
});

// --------------------------------------------------------------------------
// TeamLogin — the create form
// --------------------------------------------------------------------------

describe('H39 — the team creation form', () => {
  const openCreateView = async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('+ New Team')).toBeTruthy());
    fireEvent.click(screen.getByText('+ New Team'));
  };

  it('states the minimum before the user types', async () => {
    await openCreateView();

    // The create form carried no hint at all before H39 — the user learned the
    // rule only by failing it.
    expect(screen.getByText(PASSWORD_POLICY_MESSAGE)).toBeTruthy();
  });

  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password without calling the API`, async () => {
    const { dataService } = await import('../services/dataService');
    await openCreateView();

    fireEvent.change(screen.getByPlaceholderText('e.g. Design Team'), {
      target: { value: 'Alpha' }
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: TOO_SHORT }
    });
    fireEvent.click(screen.getByRole('button', { name: /create & join/i }));

    await waitFor(() => {
      expect(screen.getAllByText(PASSWORD_POLICY_MESSAGE).length).toBeGreaterThan(0);
    });
    expect(dataService.createTeam).not.toHaveBeenCalled();
  });

  it(`submits a ${PASSWORD_MIN_LENGTH}-character password`, async () => {
    const { dataService } = await import('../services/dataService');
    await openCreateView();

    fireEvent.change(screen.getByPlaceholderText('e.g. Design Team'), {
      target: { value: 'Alpha' }
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: LONG_ENOUGH }
    });
    fireEvent.click(screen.getByRole('button', { name: /create & join/i }));

    await waitFor(() => {
      expect(dataService.createTeam).toHaveBeenCalledWith('Alpha', LONG_ENOUGH, undefined);
    });
  });
});

// --------------------------------------------------------------------------
// TeamLogin — the password-reset form
// --------------------------------------------------------------------------

describe('H39 — the password-reset form', () => {
  const RESET_TOKEN = 'a'.repeat(64);

  const openResetView = async () => {
    window.history.replaceState({}, '', `/?reset=${RESET_TOKEN}`);
    render(<TeamLogin onLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('New Password')).toBeTruthy());
  };

  it('states the minimum before the user types', async () => {
    await openResetView();

    // Was "At least 4 characters", i.e. the wrong rule stated confidently.
    expect(screen.getByText(PASSWORD_POLICY_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/at least 4 characters/i)).toBeNull();
  });

  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password without calling the API`, async () => {
    const { dataService } = await import('../services/dataService');
    await openResetView();

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: TOO_SHORT }
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getAllByText(PASSWORD_POLICY_MESSAGE).length).toBeGreaterThan(0);
    });
    expect(dataService.resetPassword).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Dashboard — the team's own password change
// --------------------------------------------------------------------------

const dashboardTeam: Team = {
  id: 'team-1',
  name: 'Alpha',
  passwordHash: 'hash',
  members: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
} as unknown as Team;

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

describe('H39 — the dashboard password-change form', () => {
  const renderSettings = () =>
    render(
      <Dashboard
        team={dashboardTeam}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab="SETTINGS"
      />
    );

  it('states the minimum in the field the user types into', async () => {
    renderSettings();

    // The placeholder said "New password (min 4 characters)".
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(new RegExp(`min ${PASSWORD_MIN_LENGTH} characters`, 'i'))
      ).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText(/min 4 characters/i)).toBeNull();
  });

  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password without calling the API`, async () => {
    const { dataService } = await import('../services/dataService');
    renderSettings();

    const newPassword = await screen.findByPlaceholderText(
      new RegExp(`min ${PASSWORD_MIN_LENGTH} characters`, 'i')
    );
    fireEvent.change(newPassword, { target: { value: TOO_SHORT } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
      target: { value: TOO_SHORT }
    });
    fireEvent.click(screen.getByRole('button', { name: /^change password$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(PASSWORD_POLICY_MESSAGE).length).toBeGreaterThan(0);
    });
    expect(dataService.changeTeamPassword).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// SuperAdmin — setting a team's password on the operator's behalf
// --------------------------------------------------------------------------

const superAdminTeam = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  members: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

describe('H39 — the super-admin password form', () => {
  const openPasswordEditor = async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Alpha Team')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  };

  it('states the minimum in the field the operator types into', async () => {
    await openPasswordEditor();

    // The placeholder said "New password (min 4 chars)".
    expect(
      screen.getByPlaceholderText(new RegExp(`min ${PASSWORD_MIN_LENGTH} chars`, 'i'))
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText(/min 4 chars/i)).toBeNull();
  });

  it(`refuses a ${PASSWORD_MIN_LENGTH - 1}-character password without calling the API`, async () => {
    await openPasswordEditor();

    const field = screen.getByPlaceholderText(
      new RegExp(`min ${PASSWORD_MIN_LENGTH} chars`, 'i')
    );
    fireEvent.change(field, { target: { value: TOO_SHORT } });

    const callsBefore = vi.mocked(global.fetch).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(PASSWORD_POLICY_MESSAGE).length).toBeGreaterThan(0);
    });
    // No update-password request went out.
    expect(
      vi.mocked(global.fetch).mock.calls
        .slice(callsBefore)
        .filter(([url]) => String(url).includes('update-password'))
    ).toHaveLength(0);
  });
});
