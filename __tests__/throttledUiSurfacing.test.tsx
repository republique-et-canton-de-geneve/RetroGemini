import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import Dashboard from '../components/Dashboard';
import { Team, User } from '../types';

/**
 * Codex review on PR #401 (audit H5 follow-up). `throttledClientFlows.test.ts`
 * pins that `dataService` tells a throttled request apart from a domain answer;
 * these pin that the two components a user actually sees do not throw that
 * distinction away again.
 *
 * The rename case guards something subtler than a message: `handleRenameTeam`
 * did not `await` the async `renameTeam`, so *no* rejection could ever reach
 * its own `catch` — not the new throttling one, and not the pre-existing
 * "name already taken" one. The success banner was shown unconditionally.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    listTeams: vi.fn(async () => []),
    verifyResetToken: vi.fn(),
    resetPassword: vi.fn(),
    renameTeam: vi.fn(),
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
    getAuthenticatedPassword: vi.fn(() => 'pw')
  }
}));

global.fetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({ infoMessage: '', enabled: false })
})) as unknown as typeof fetch;

const LIVE_TOKEN = 'a'.repeat(64);

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const team: Team = {
  id: 'team-1',
  name: 'Platform Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

describe('the reset link view distinguishes throttling from a dead link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', `/?reset=${LIVE_TOKEN}`);
  });

  it('asks the user to retry instead of declaring the link expired', async () => {
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.verifyResetToken).mockResolvedValue({ valid: false, throttled: true });

    render(<TeamLogin onLogin={vi.fn()} />);

    const banner = await screen.findByText(/too many/i);
    expect(banner).toBeTruthy();
    // The link in their inbox is still good — saying otherwise sends them off
    // to request another one.
    expect(screen.queryByText(/invalid or has expired/i)).toBeNull();
  });

  it('still declares a genuinely dead link expired', async () => {
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.verifyResetToken).mockResolvedValue({ valid: false });

    render(<TeamLogin onLogin={vi.fn()} />);

    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
  });
});

describe('the team rename reports a rename that did not happen', () => {
  const renderSettings = async () => {
    render(
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab="SETTINGS"
      />
    );

    return screen.findByPlaceholderText(/new team name/i);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('shows the throttling error instead of a success banner', async () => {
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.renameTeam).mockRejectedValue(
      new Error('Too many requests right now — please wait a moment and try renaming again')
    );

    const input = await renderSettings();

    fireEvent.change(input, { target: { value: 'Renamed Team' } });
    fireEvent.click(screen.getByRole('button', { name: /rename team/i }));

    await waitFor(() => expect(screen.getByText(/too many requests/i)).toBeTruthy());
    expect(screen.queryByText(/renamed successfully/i)).toBeNull();
  });

  it('surfaces a duplicate name rather than claiming success', async () => {
    // Pre-existing: this rejection could never reach the handler's catch,
    // because the call was not awaited.
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.renameTeam).mockRejectedValue(new Error('A team with this name already exists'));

    const input = await renderSettings();

    fireEvent.change(input, { target: { value: 'Taken Name' } });
    fireEvent.click(screen.getByRole('button', { name: /rename team/i }));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy());
    expect(screen.queryByText(/renamed successfully/i)).toBeNull();
  });

  it('still confirms a rename that succeeded', async () => {
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.renameTeam).mockResolvedValue(undefined);

    const input = await renderSettings();

    fireEvent.change(input, { target: { value: 'Fresh Name' } });
    fireEvent.click(screen.getByRole('button', { name: /rename team/i }));

    await waitFor(() => expect(screen.getByText(/renamed successfully/i)).toBeTruthy());
  });
});
