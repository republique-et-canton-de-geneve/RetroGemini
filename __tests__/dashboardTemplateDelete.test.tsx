import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../components/Dashboard';
import { dataService } from '../services/dataService';
import type { Team, User } from '../types';

/**
 * Incident ISS (2026-10-12). Deleting a custom template from the Settings tab
 * sent the tab's whole team object through `updateTeam`, and the server
 * replaced the stored retrospectives, health checks and actions with that
 * tab's copy. A facilitator's second tab left open on an old Dashboard thereby
 * erased the retrospective a team was running. The Dashboard now deletes a
 * template through the narrow `deleteCustomTemplate`, which persists the
 * template list and nothing else.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    updateTeam: vi.fn(),
    deleteCustomTemplate: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token'),
  },
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const team: Team = {
  id: 'team-1',
  name: 'Templates',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [
    { name: 'Starfish', cols: [{ id: 'c1', title: 'Start', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'add', text: 'text-emerald-700', ring: 'ring-emerald-300' }] },
    { name: 'Sailboat', cols: [{ id: 'c2', title: 'Wind', color: 'bg-cyan-500', border: 'border-cyan-500', icon: 'air', text: 'text-cyan-700', ring: 'ring-cyan-300' }] },
  ],
  retrospectives: [],
  globalActions: [],
};

describe('Dashboard — deleting a custom template', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes that template alone, never by rewriting the whole team', () => {
    const onRefresh = vi.fn();
    render(
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={onRefresh}
        initialTab="SETTINGS"
      />
    );

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete template' });
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[1]);

    expect(dataService.deleteCustomTemplate).toHaveBeenCalledWith('team-1', 1, 'Sailboat');
    expect(dataService.updateTeam).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });
});
