import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

/**
 * Group phase, keyboard path (H42 — WCAG 2.1.1 Keyboard).
 *
 * The manual accessibility pass found the Group phase unreachable without a
 * pointer: the card was a `div` with `draggable="true"` and `tabIndex: -1`, so
 * a 14-step tab walk never touched it. `groupingKeyboard.test.ts` pins the
 * rules; this pins the **wiring** — that every target really is a button a
 * keyboard can reach and activate, and that doing so groups the tickets.
 *
 * These drive the keyboard for real (`user.tab()`, `user.keyboard('{Enter}')`)
 * rather than firing synthetic key events at an element: the whole finding was
 * that the control could not be *reached*, so a test that starts by grabbing
 * the element would not have caught it.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => 'session-1'),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    isConnected: vi.fn(() => true),
  },
}));

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'GROUP',
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [
    { id: 'col-1', title: 'What Went Well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  ],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  tickets: [
    { id: 't1', colId: 'col-1', text: 'Deploys are scary', authorId: 'facilitator-1', groupId: null, votes: [] },
    { id: 't2', colId: 'col-1', text: 'Rollbacks are slow', authorId: 'facilitator-1', groupId: null, votes: [] },
  ],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides,
});

const createTeam = (session: RetroSession): Team => ({
  id: 'team-1',
  name: 'Test Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [session],
  globalActions: [],
});

const renderGroupPhase = (session: RetroSession = createSession()) =>
  render(
    <Session
      team={createTeam(session)}
      sessionId={session.id}
      currentUser={facilitator}
      onExit={() => {}}
    />
  );

const card = (name: RegExp) => screen.getByRole('button', { name });

/** Tab until the named button has focus, or give up after a full walk. */
const tabTo = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  const target = card(name);
  for (let step = 0; step < 60; step += 1) {
    if (document.activeElement === target) return target;
    await user.tab();
  }
  throw new Error(`never reached ${name} by tabbing`);
};

describe('Group phase — grouping tickets with the keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('offers every ticket a control that says what activating it will do', async () => {
    renderGroupPhase();

    const first = await waitFor(() => card(/Pick up the ticket Deploys are scary/));
    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps that control off the screen until it is focused', async () => {
    renderGroupPhase();

    const first = await waitFor(() => card(/Pick up the ticket Deploys are scary/));
    // The board must look exactly as it did: a control on every card is clutter
    // for the people already using it, and a change they never asked for. The
    // assertion is on classes because jsdom has no layout engine and cannot tell
    // a clipped element from a visible one — `e2e/accessibility-audit.spec.ts`
    // measures the real bounding box, which is the assertion that has teeth.
    expect(first.className).toContain('sr-only');
    expect(first.className).toContain('focus:not-sr-only');
  });

  it('is reachable by tabbing — the whole finding was that it was not', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    const reached = await tabTo(user, /Pick up the ticket Deploys are scary/);
    expect(reached).toBe(card(/Pick up the ticket Deploys are scary/));
  });

  it('picks a card up on Enter, and the other cards then offer to group with it', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(card(/Selected for grouping: Deploys are scary/).getAttribute('aria-pressed')).toBe('true');
    });
    // The second card now announces the pending action, not itself.
    expect(card(/Group the selected ticket with Rollbacks are slow/)).toBeTruthy();
  });

  it('groups the two tickets when the second card is activated', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard('{Enter}');
    await waitFor(() => card(/Group the selected ticket with Rollbacks are slow/));
    await tabTo(user, /Group the selected ticket with Rollbacks are slow/);
    await user.keyboard('{Enter}');

    // Both tickets end up in one group — the same outcome a drag produces.
    const { dataService } = await import('../services/dataService');
    await waitFor(() => {
      const calls = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const persisted = calls[calls.length - 1][1] as RetroSession;
      expect(persisted.groups).toHaveLength(1);
      const groupId = persisted.groups[0].id;
      expect(persisted.tickets.filter(t => t.groupId === groupId)).toHaveLength(2);
    });
  });

  it('supports Space as well as Enter, which is what a button promises', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard(' ');

    await waitFor(() => {
      expect(card(/Selected for grouping: Deploys are scary/)).toBeTruthy();
    });
  });

  it('cancels on Escape from anywhere, leaving the tickets ungrouped', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard('{Enter}');
    await waitFor(() => card(/Selected for grouping: Deploys are scary/));

    // Focus deliberately moved off the control first: Escape is bound to the
    // document precisely because focus can be anywhere after a pick-up.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(card(/Pick up the ticket Deploys are scary/).getAttribute('aria-pressed')).toBe('false');
    });
    // Mounting persists the participant roster, so "no writes" is the wrong
    // assertion — "no grouping" is the one that matters.
    const { dataService } = await import('../services/dataService');
    const calls = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, persisted] of calls) {
      expect((persisted as RetroSession).groups).toHaveLength(0);
      expect((persisted as RetroSession).tickets.every(t => !t.groupId)).toBe(true);
    }
  });

  it('puts the card back down when its own control is activated again', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard('{Enter}');
    await waitFor(() => card(/Selected for grouping: Deploys are scary/));
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(card(/Pick up the ticket Deploys are scary/).getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('offers a keyboard way out of a group, once a card is held', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard('{Enter}');

    // The column drop target is a real button, and names the column it moves to.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /into What Went Well/ })).toBeTruthy();
    });
  });

  it('lets an open dialog own Escape, so one press does not also drop the card', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await waitFor(() => card(/Pick up the ticket Deploys are scary/));

    await tabTo(user, /Pick up the ticket Deploys are scary/);
    await user.keyboard('{Enter}');
    await waitFor(() => card(/Selected for grouping: Deploys are scary/));

    // The comment button is reachable while a card is held.
    await user.click(screen.getAllByTestId('ticket-comment-btn')[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    await user.keyboard('{Escape}');

    // The dialog closes; the card stays held. Both listeners sit on `document`,
    // so the grouping one has to stand down rather than rely on propagation.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(card(/Selected for grouping: Deploys are scary/)).toBeTruthy();
  });

  it('leaves the card a plain card outside the Group phase', async () => {
    renderGroupPhase(createSession({ phase: 'VOTE' }));

    await waitFor(() => expect(screen.getByText('Deploys are scary')).toBeTruthy());
    // No stray control: nothing offers to group when grouping is over.
    expect(screen.queryByRole('button', { name: /Pick up the ticket/ })).toBeNull();
  });
});
