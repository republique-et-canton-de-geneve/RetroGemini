import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../components/Dashboard';
import { dataService, MERGED_TEAM_DELETE_REFUSED } from '../services/dataService';
import type { Team, User } from '../types';

/**
 * A team an administrator merged into another can still be deleted from its
 * own Dashboard — unless it changed after the merge, in which case the server
 * keeps it (what was written since is in no other team). The modal used to
 * close and log out without waiting for the answer, so a refused deletion
 * looked exactly like a successful one.
 */

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<typeof import('../services/dataService')>('../services/dataService');
  return {
    MERGED_TEAM_DELETE_REFUSED: actual.MERGED_TEAM_DELETE_REFUSED,
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

describe('Dashboard — deleting a team that was merged into another', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the dialog open and says why when the server keeps the team', async () => {
    vi.mocked(dataService.deleteTeam).mockRejectedValue(new Error(MERGED_TEAM_DELETE_REFUSED));
    const onDeleteTeam = renderDashboard();

    const dialog = openAndConfirm();

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toMatch(/merged into another team/));
    expect(onDeleteTeam).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Delete Team' })).toBeTruthy();
  });

  it('still logs out once the team is really deleted', async () => {
    vi.mocked(dataService.deleteTeam).mockResolvedValue(undefined);
    const onDeleteTeam = renderDashboard();

    openAndConfirm();

    await waitFor(() => expect(onDeleteTeam).toHaveBeenCalled());
    expect(dataService.deleteTeam).toHaveBeenCalledWith('team-1');
  });
});
