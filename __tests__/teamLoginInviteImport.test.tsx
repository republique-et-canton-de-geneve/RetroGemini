import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import { dataService } from '../services/dataService';
import type { Team, User } from '../types';

/**
 * An invite link imports its team once (review finding R1 of the payloads
 * lane).
 *
 * The invite effect depended on `onJoin`/`onLogin`, and App hands down new
 * ones on every render — `/api/version` answering during the import is one.
 * Each re-run imported the team again: a `POST /api/team/login` answered with
 * the team's whole history, so every invitee downloaded it at least twice, and
 * each import of a stale link was one more `401` counted by the login
 * limiter. The effect now runs once per link object and calls the latest
 * callbacks through refs.
 */

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

const bob = fullTeam.members[1] as User;

const makeInvite = () => ({ id: 'team-1', name: 'Alpha Team', inviteCredential: 'cred' }) as never;

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => []),
      importTeam: vi.fn(),
      autoJoinFromInvite: vi.fn()
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ infoMessage: '' }) })) as unknown as typeof fetch;
  vi.mocked(dataService.autoJoinFromInvite).mockImplementation(() => ({ team: { ...fullTeam }, user: bob }));
});

const holdImport = () => {
  let resolve!: (team: Team) => void;
  let reject!: (err: Error) => void;
  vi.mocked(dataService.importTeam).mockImplementation(
    () => new Promise<Team>((res, rej) => { resolve = res; reject = rej; })
  );
  return { resolve: (team: Team) => resolve(team), reject: (err: Error) => reject(err) };
};

describe('TeamLogin — an invite link imports its team once', () => {
  it('does not re-import when App re-renders with new callbacks, and calls the latest onJoin', async () => {
    const held = holdImport();
    const invite = makeInvite();
    const firstJoin = vi.fn();
    const { rerender } = render(<TeamLogin onLogin={vi.fn()} onJoin={firstJoin} inviteData={invite} />);
    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalledTimes(1));

    rerender(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    const latestJoin = vi.fn();
    rerender(<TeamLogin onLogin={vi.fn()} onJoin={latestJoin} inviteData={invite} />);

    await act(async () => {
      held.resolve({ ...fullTeam });
    });

    expect(dataService.importTeam).toHaveBeenCalledTimes(1);
    expect(latestJoin).toHaveBeenCalledTimes(1);
    expect(latestJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 'team-1' }), bob);
    expect(firstJoin).not.toHaveBeenCalled();
  });

  it('does not retry a refused import behind the user\'s back; the error stays on screen', async () => {
    const held = holdImport();
    const invite = makeInvite();
    const { rerender } = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalledTimes(1));

    await act(async () => {
      held.reject(new Error('Failed to join team - invalid invite link'));
    });
    rerender(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);

    expect(await screen.findByText('Failed to join team - invalid invite link')).toBeTruthy();
    expect(dataService.importTeam).toHaveBeenCalledTimes(1);
  });

  it('imports again for a new link', async () => {
    holdImport();
    const { rerender } = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />);
    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalledTimes(1));

    rerender(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />);

    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalledTimes(2));
  });

  it('imports once under StrictMode\'s double mount', async () => {
    holdImport();
    render(
      <React.StrictMode>
        <TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />
      </React.StrictMode>
    );
    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalled());
    // Give a second effect run every chance to show up.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(dataService.importTeam).toHaveBeenCalledTimes(1);
  });
});
