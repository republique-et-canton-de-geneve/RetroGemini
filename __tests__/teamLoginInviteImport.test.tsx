import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import { dataService, InviteAutoJoinError } from '../services/dataService';
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
 *
 * A failed import is then retried by the user, never by a render (review
 * finding on the payloads lane): App strips `?join=` from the URL as soon as
 * it reads the link, so a reload lands on the team list and cannot retry. The
 * error screen offers "Try again" (one import per click) and a way back to the
 * team list.
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

/** Each call to importTeam waits for the test to settle it, in call order. */
const holdEachImport = () => {
  const pending: Array<{ resolve: (team: Team) => void; reject: (err: Error) => void }> = [];
  vi.mocked(dataService.importTeam).mockImplementation(
    () => new Promise<Team>((resolve, reject) => { pending.push({ resolve, reject }); })
  );
  return pending;
};

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

describe('TeamLogin — a failed invite import is retried by the user', () => {
  const refusal = () => new Error('The team could not be joined right now. Please try again in a moment.');

  it('offers Try again, imports once per click, and never on a re-render', async () => {
    const pending = holdEachImport();
    const invite = makeInvite();
    const { rerender } = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].reject(refusal()); });

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalledTimes(2));

    // While the attempt runs, the error and the button stay (the pane would go
    // blank otherwise, and the keyboard would lose its place); a second press
    // sends nothing.
    expect(screen.getByRole('alert')).toHaveTextContent('The team could not be joined right now.');
    const running = screen.getByRole('button', { name: 'Trying again...' });
    expect(running).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(running);

    const latestJoin = vi.fn();
    rerender(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    rerender(<TeamLogin onLogin={vi.fn()} onJoin={latestJoin} inviteData={invite} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(dataService.importTeam).toHaveBeenCalledTimes(2);

    await act(async () => { pending[1].resolve({ ...fullTeam }); });
    expect(latestJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 'team-1' }), bob);
    expect(dataService.importTeam).toHaveBeenCalledTimes(2);
  });

  it('keeps the error and gives the button back when the retry fails too', async () => {
    const pending = holdEachImport();
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].reject(refusal()); });

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1].reject(new Error('The server could not be reached. Check your connection, then try again.')); });

    expect(screen.getByRole('alert')).toHaveTextContent('The server could not be reached.');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).not.toHaveAttribute('aria-disabled', 'true');
    expect(dataService.importTeam).toHaveBeenCalledTimes(2);
  });

  // The alert stays mounted while a retry runs. A retry that fails with the
  // same message changed no text, so the live region said nothing: a screen
  // reader user who pressed "Try again" heard no answer at all. Each failure
  // puts a new alert in, which is announced even with the same text.
  it('announces a retry that fails with the same message again', async () => {
    const pending = holdEachImport();
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].reject(refusal()); });
    const first = screen.getByRole('alert');

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    // Still the first alert while the attempt runs: nothing is announced yet.
    expect(screen.getByRole('alert')).toBe(first);
    await act(async () => { pending[1].reject(refusal()); });

    const second = screen.getByRole('alert');
    expect(second).toHaveTextContent('The team could not be joined right now.');
    expect(second).not.toBe(first);
  });

  it('moves focus to the join screen when a retry lands on it', async () => {
    const pending = holdEachImport();
    vi.mocked(dataService.autoJoinFromInvite).mockImplementation(() => {
      throw new InviteAutoJoinError('Invitation could not be verified. Please join manually.');
    });
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].reject(refusal()); });

    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1].resolve({ ...fullTeam }); });

    const heading = await screen.findByRole('heading', { name: 'Join Alpha Team' });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('goes back to the team list without importing again', async () => {
    const pending = holdEachImport();
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={makeInvite()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].reject(refusal()); });

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('heading', { name: 'Your Teams' })).toBeInTheDocument();
    expect(screen.queryByText(/could not be joined/)).toBeNull();
    expect(dataService.importTeam).toHaveBeenCalledTimes(1);
  });
});
