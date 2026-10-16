import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../components/Dashboard';
import { dataService, TEAM_DELETE_FAILED } from '../services/dataService';
import type { Team, User } from '../types';

/**
 * Deleting a team from its Dashboard used to close the modal and log out
 * without waiting for the server's answer, so a deletion that failed looked
 * exactly like one that worked — and the facilitator who logged back in found
 * the team they had been told was gone.
 */

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<typeof import('../services/dataService')>('../services/dataService');
  return {
    TEAM_DELETE_FAILED: actual.TEAM_DELETE_FAILED,
    dataService: {
      getHealthCheckTemplates: vi.fn(() => []),
      deleteTeam: vi.fn(),
      getAuthenticatedPassword: vi.fn(() => 'pw'),
      getSessionToken: vi.fn(() => 'token')
    }
  };
});

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const team: Team = {
  id: 'team-1',
  name: 'Produit',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

const openAndConfirm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete Team' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Team' });
  fireEvent.change(within(dialog).getByPlaceholderText('Type team name here'), { target: { value: 'Produit' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Team' }));
  return dialog;
};

const renderDashboard = (onDeleteTeam = vi.fn()) => {
  render(
    <Dashboard
      team={team}
      currentUser={facilitator}
      onOpenSession={vi.fn()}
      onOpenHealthCheck={vi.fn()}
      onRefresh={vi.fn()}
      onDeleteTeam={onDeleteTeam}
    />
  );
  return onDeleteTeam;
};

describe('Dashboard — deleting the team', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the dialog open and says so when the deletion failed', async () => {
    vi.mocked(dataService.deleteTeam).mockRejectedValue(new Error(TEAM_DELETE_FAILED));
    const onDeleteTeam = renderDashboard();

    const dialog = openAndConfirm();

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toMatch(/could not be deleted/));
    expect(onDeleteTeam).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Delete Team' })).toBeTruthy();
  });

  it('sends one deletion at a time and says it is working on it', async () => {
    let finish: () => void = () => {};
    vi.mocked(dataService.deleteTeam).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onDeleteTeam = renderDashboard();

    const dialog = openAndConfirm();
    const pending = within(dialog).getByRole('button', { name: 'Deleting...' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(dataService.deleteTeam).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(onDeleteTeam).toHaveBeenCalled());
  });

  it('still logs out once the team is really deleted', async () => {
    vi.mocked(dataService.deleteTeam).mockResolvedValue(undefined);
    const onDeleteTeam = renderDashboard();

    openAndConfirm();

    await waitFor(() => expect(onDeleteTeam).toHaveBeenCalled());
    expect(dataService.deleteTeam).toHaveBeenCalledWith('team-1');
  });
});
