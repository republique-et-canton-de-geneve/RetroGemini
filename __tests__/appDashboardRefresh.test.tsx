import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { Team, User } from '../types';

/**
 * Every Dashboard entry asks `dataService.refreshFromServer` to reuse a
 * whole-team load younger than 5 s (synthesis item 8). The login, restore,
 * creation or invite join that led there has just downloaded the team, and
 * the Dashboard used to fetch it again at once. Whether a call is served from
 * that load, and that the reuse is consumed, is `dataService`'s job
 * (`dataServiceTeamRefresh.test.ts`); this pins App's half: every entry passes
 * the option, a return from a session included.
 *
 * The Dashboard and the session are stubs: the wiring under test is App's.
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
    persistParticipants: vi.fn()
  }
}));

vi.mock('../components/Dashboard', () => ({
  default: ({ onOpenSession }: { onOpenSession: (id: string) => void }) => (
    <button type="button" onClick={() => onOpenSession('retro-1')}>Open the retro</button>
  )
}));

vi.mock('../components/Session', () => ({
  default: ({ onExit }: { onExit: () => void }) => (
    <button type="button" onClick={onExit}>Leave the retro</button>
  )
}));

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

describe('App: the Dashboard reuses a fresh whole-team load', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: '41.0', announcements: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;
    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: team.id,
        userId: facilitator.id,
        userName: facilitator.name,
        view: 'DASHBOARD',
        sessionToken: 'rg1.session-token'
      })
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('passes maxAgeMs: 5000 on the first entry and on a return from a session', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open the retro' }));
    await waitFor(() => expect(dataService.refreshFromServer).toHaveBeenCalledTimes(1));
    expect(dataService.refreshFromServer).toHaveBeenLastCalledWith({ maxAgeMs: 5000 });

    fireEvent.click(await screen.findByRole('button', { name: 'Leave the retro' }));
    await screen.findByRole('button', { name: 'Open the retro' });
    await waitFor(() => expect(dataService.refreshFromServer).toHaveBeenCalledTimes(2));
    expect(dataService.refreshFromServer).toHaveBeenLastCalledWith({ maxAgeMs: 5000 });
  });
});
