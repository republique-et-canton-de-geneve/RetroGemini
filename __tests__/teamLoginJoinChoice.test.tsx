import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import { dataService } from '../services/dataService';
import type { Team } from '../types';

/**
 * The invite-join screen must keep the choice the user made on it.
 *
 * TeamLogin initialises that screen — member picker, nothing selected — when it
 * first shows it, and that initialisation used to undo a choice the user had
 * already made, in two different ways:
 *
 *  1. **Too late.** It was a passive effect, which React runs one task after the
 *     commit that shows the screen. A tap on "I'm not in the list" in between
 *     was queued before the reset and undone by it.
 *  2. **Too often.** It was keyed on the team *object*, and the invite effect
 *     re-imports the team whenever it re-runs — StrictMode's double mount, or any
 *     App re-render, since App hands down fresh `onJoin`/`onLogin` functions each
 *     time. Every import is a new object, so every re-import reset the screen.
 *
 * Each fix alone still loses the click in a real browser;
 * `e2e/invite-join-early-click.spec.ts` is the proof, and these are the cheap,
 * deterministic guards for each half.
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

const inviteData = { teamId: 'team-1', teamName: 'Alpha Team' } as never;

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => []),
      // A fresh object per call, as the real import (a parsed response) returns.
      importTeam: vi.fn(async () => ({ ...fullTeam })),
      autoJoinFromInvite: vi.fn(() => {
        throw new (actual.InviteAutoJoinError as new (m: string, c: string) => Error)(
          'not verified',
          'INVITE_NOT_VERIFIED'
        );
      })
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ infoMessage: '' })
  })) as unknown as typeof fetch;
});

describe('TeamLogin — the invite-join screen keeps the user\'s choice', () => {
  it("keeps the name field when \"I'm not in the list\" is clicked on the commit that first shows the picker", async () => {
    // The earliest moment a user can act is the commit that puts the button in
    // the DOM. A MutationObserver callback runs right after that commit and
    // before React's next task, so this reproduces race 1 on every run instead
    // of on a slow runner.
    let clicked = false;
    const observer = new MutationObserver(() => {
      const button = screen.queryByText(/I'm not in the list/);
      if (button && !clicked) {
        clicked = true;
        fireEvent.click(button);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={inviteData} />);
      await waitFor(() => expect(clicked).toBe(true));
    } finally {
      observer.disconnect();
    }

    await waitFor(() => expect(screen.getByLabelText('Your Name')).toBeTruthy());
  });

  it('keeps the name field when the team is re-imported after the choice', async () => {
    const { rerender } = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={inviteData} />);
    fireEvent.click(await screen.findByText(/I'm not in the list/));
    await waitFor(() => expect(screen.getByLabelText('Your Name')).toBeTruthy());

    // App re-renders with new callbacks, which re-runs the invite effect. Hold
    // the re-import open so the assertion below is made after it has landed,
    // not before it.
    let resolveReimport: (team: Team) => void = () => {};
    vi.mocked(dataService.importTeam).mockImplementationOnce(
      () => new Promise<Team>((resolve) => { resolveReimport = resolve; })
    );
    rerender(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={inviteData} />);
    await waitFor(() => expect(dataService.importTeam).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveReimport({ ...fullTeam });
    });

    expect(screen.getByLabelText('Your Name')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Select Your Name' })).toBeNull();
  });
});
