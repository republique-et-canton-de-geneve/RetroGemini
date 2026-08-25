import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

/**
 * Group phase, keyboard path (H42 — WCAG 2.1.1 Keyboard).
 *
 * The manual accessibility pass found the Group phase unreachable without a
 * pointer: the card was a `div` with `draggable="true"` and `tabIndex: -1`, so
 * a 14-step tab walk never touched it. `groupingKeyboard.test.ts` pins the
 * rules; this pins the **wiring** — that the rules are actually attached to the
 * card, and that pressing the keys really groups the tickets.
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

describe('Group phase — grouping tickets with the keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('puts every ticket card in the tab order and says what Enter does', async () => {
    renderGroupPhase();

    const first = await waitFor(() => card(/Ticket: Deploys are scary/));
    expect(first.getAttribute('tabindex')).toBe('0');
    expect(first.getAttribute('aria-label')).toContain('Press Enter');
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('picks a card up on Enter, and the other cards then offer to group with it', async () => {
    renderGroupPhase();

    const first = await waitFor(() => card(/Ticket: Deploys are scary/));
    fireEvent.keyDown(first, { key: 'Enter' });

    await waitFor(() => {
      expect(card(/Selected for grouping: Deploys are scary/).getAttribute('aria-pressed')).toBe('true');
    });
    // The second card now announces the pending action, not itself.
    expect(card(/Group the selected ticket with Rollbacks are slow/)).toBeTruthy();
  });

  it('groups the two tickets when Enter confirms on the second card', async () => {
    renderGroupPhase();

    fireEvent.keyDown(await waitFor(() => card(/Ticket: Deploys are scary/)), { key: 'Enter' });
    fireEvent.keyDown(await waitFor(() => card(/Group the selected ticket with Rollbacks are slow/)), { key: 'Enter' });

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

  it('supports Space as well as Enter, which is what a button role promises', async () => {
    renderGroupPhase();

    fireEvent.keyDown(await waitFor(() => card(/Ticket: Deploys are scary/)), { key: ' ' });

    await waitFor(() => {
      expect(card(/Selected for grouping: Deploys are scary/)).toBeTruthy();
    });
  });

  it('cancels on Escape, leaving the tickets ungrouped', async () => {
    renderGroupPhase();

    const first = await waitFor(() => card(/Ticket: Deploys are scary/));
    fireEvent.keyDown(first, { key: 'Enter' });
    await waitFor(() => card(/Selected for grouping: Deploys are scary/));

    fireEvent.keyDown(card(/Selected for grouping: Deploys are scary/), { key: 'Escape' });

    await waitFor(() => {
      expect(card(/Ticket: Deploys are scary/).getAttribute('aria-pressed')).toBe('false');
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

  it('puts the card back down when Enter is pressed on the card that is held', async () => {
    renderGroupPhase();

    fireEvent.keyDown(await waitFor(() => card(/Ticket: Deploys are scary/)), { key: 'Enter' });
    fireEvent.keyDown(await waitFor(() => card(/Selected for grouping: Deploys are scary/)), { key: 'Enter' });

    await waitFor(() => {
      expect(card(/Ticket: Deploys are scary/).getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('offers a keyboard way out of a group, once a card is held', async () => {
    renderGroupPhase();

    fireEvent.keyDown(await waitFor(() => card(/Ticket: Deploys are scary/)), { key: 'Enter' });

    // The column drop target is a real button, and names the column it moves to.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /into What Went Well/ })).toBeTruthy();
    });
  });

  it('leaves the card a plain card outside the Group phase', async () => {
    renderGroupPhase(createSession({ phase: 'VOTE' }));

    await waitFor(() => expect(screen.getByText('Deploys are scary')).toBeTruthy());
    // No fake control: nothing announces a grouping action when grouping is over.
    expect(screen.queryByRole('button', { name: /Ticket: Deploys are scary/ })).toBeNull();
  });
});
