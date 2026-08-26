import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

/**
 * Group phase, touch path (Codex, PR #436).
 *
 * Tap-to-group is the oldest interaction in this phase and had **no** test at
 * all, which is how the defect below survived: the ticket card guards its
 * gesture with an 8px movement threshold, and the group *container* carried a
 * bare `onTouchEnd`. Touch events bubble, so the container did not merely lack a
 * guard — it overrode the card's: a swipe beginning on a ticket inside a group
 * was correctly ignored by the ticket and then acted on by its parent.
 *
 * These drive real `touchstart`/`touchmove`/`touchend` sequences rather than
 * calling the handler, because the whole finding is about which handlers a
 * single gesture reaches.
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

const createSession = (): RetroSession => ({
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
    { id: 'loose', colId: 'col-1', text: 'Loose card', authorId: 'facilitator-1', groupId: null, votes: [] },
    { id: 'inside', colId: 'col-1', text: 'Grouped card', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
  ],
  groups: [{ id: 'g1', title: 'Deploys', colId: 'col-1', votes: [] }],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
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

const renderGroupPhase = () => {
  const session = createSession();
  return render(
    <Session team={createTeam(session)} sessionId={session.id} currentUser={facilitator} onExit={() => {}} />
  );
};

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

/** Where the held card ended up, according to the last persisted blob. */
const persistedGroupOf = async (ticketId: string): Promise<string | null | undefined> => {
  const { dataService } = await import('../services/dataService');
  const calls = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
  if (calls.length === 0) return undefined;
  const persisted = calls[calls.length - 1][1] as RetroSession;
  return persisted.tickets.find(t => t.id === ticketId)?.groupId ?? null;
};

/** Pick the loose card up through the keyboard control, which shares the drop path. */
const holdLooseCard = async (user: ReturnType<typeof userEvent.setup>) => {
  const control = await waitFor(() => screen.getByRole('button', { name: /Pick up the ticket Loose card/ }));
  control.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => screen.getByRole('button', { name: /Selected for grouping: Loose card/ }));
};

const groupContainer = () => {
  const container = document.querySelector('.group-container');
  if (!container) throw new Error('no group container rendered');
  return container as HTMLElement;
};

describe('Group phase — dropping a held card with touch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('drops the held card into a group when the group is tapped', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await holdLooseCard(user);

    const container = groupContainer();
    fireEvent.touchStart(container, touch(50, 50));
    fireEvent.touchEnd(container, touch(50, 50));

    // The positive control: without this the two tests below could pass on a
    // component that simply never groups anything.
    await waitFor(async () => expect(await persistedGroupOf('loose')).toBe('g1'));
  });

  it('does not drop when the finger was scrolling the board', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await holdLooseCard(user);

    const container = groupContainer();
    fireEvent.touchStart(container, touch(50, 200));
    fireEvent.touchMove(container, touch(52, 60));
    fireEvent.touchEnd(container, touch(52, 60));

    expect(await persistedGroupOf('loose')).toBeNull();
    // Still held, so the user can put it down where they meant to.
    expect(screen.getByRole('button', { name: /Selected for grouping: Loose card/ })).toBeTruthy();
  });

  it('does not let a swipe that began on a ticket inside the group drop it either', async () => {
    // The card's own threshold refuses this gesture; the finding is that the
    // touchend then bubbled to the container, which acted on it anyway.
    const user = userEvent.setup();
    renderGroupPhase();
    await holdLooseCard(user);

    const nested = screen.getByText('Grouped card');
    fireEvent.touchStart(nested, touch(50, 200));
    fireEvent.touchMove(nested, touch(50, 60));
    fireEvent.touchEnd(nested, touch(50, 60));

    expect(await persistedGroupOf('loose')).toBeNull();
    expect(screen.getByRole('button', { name: /Selected for grouping: Loose card/ })).toBeTruthy();
  });
});
