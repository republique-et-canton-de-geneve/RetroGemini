import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

/**
 * Brainstorm: moving a card (or a whole group) from one column to another.
 *
 * `brainstormMoveRules.test.ts` pins the rules and `brainstormColumnMove.test.ts`
 * the mutation; this pins the **wiring** — that the controls really are on the
 * board, that the ones a user may not use are absent, and that using them
 * persists a move and never a group.
 *
 * The keyboard is driven for real, as in `sessionGroupKeyboard.test.ts`: a
 * control that exists but cannot be reached is the defect this product has
 * already shipped once (H42).
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

const me: User = { id: 'me', name: 'Mine', color: 'bg-indigo-500', role: 'participant' };
const other: User = { id: 'other', name: 'Theirs', color: 'bg-rose-500', role: 'facilitator' };

const column = (id: string, title: string) => ({
  id,
  title,
  color: 'bg-emerald-500',
  border: 'border-emerald-500',
  icon: 'sentiment_satisfied',
  text: 'text-emerald-700',
  ring: 'ring-emerald-300',
});

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [me, other],
  icebreakerQuestion: '',
  columns: [column('col-1', 'What Went Well'), column('col-2', 'What Went Wrong')],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  tickets: [
    { id: 't-mine', colId: 'col-1', text: 'My idea', authorId: 'me', groupId: null, votes: [] },
    { id: 't-theirs', colId: 'col-1', text: 'Their idea', authorId: 'other', groupId: null, votes: [] },
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
  members: [me, other],
  customTemplates: [],
  retrospectives: [session],
  globalActions: [],
});

const renderBrainstorm = (session: RetroSession = createSession(), user: User = me) =>
  render(
    <Session team={createTeam(session)} sessionId={session.id} currentUser={user} onExit={() => {}} />
  );

const button = (name: RegExp) => screen.getByRole('button', { name });

/** Tab until the named button has focus, or give up after a full walk. */
const tabTo = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  const target = button(name);
  for (let step = 0; step < 80; step += 1) {
    if (document.activeElement === target) return target;
    await user.tab();
  }
  throw new Error(`never reached ${name} by tabbing`);
};

/** The session as last handed to the data layer. */
const lastPersisted = async (): Promise<RetroSession | null> => {
  const { dataService } = await import('../services/dataService');
  const calls = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
  if (calls.length === 0) return null;
  return calls[calls.length - 1][1] as RetroSession;
};

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

/** Enough of a DataTransfer for jsdom: the drag image is a real DOM clone. */
const dataTransfer = () => ({
  effectAllowed: 'none',
  setDragImage: vi.fn(),
  setData: vi.fn(),
  getData: vi.fn(() => ''),
});

const columnElement = (colId: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-column-id="${colId}"]`);
  if (!el) throw new Error(`no column ${colId} on the board`);
  return el;
};

describe('Brainstorm — moving a card to another column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('offers a move control on the user’s own card', async () => {
    renderBrainstorm();

    const control = await waitFor(() => button(/Move the card My idea to another column/));
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('aria-pressed')).toBe('false');
    // Off-screen until focused: the board must look exactly as it did.
    expect(control.className).toContain('sr-only');
    expect(control.className).toContain('focus:not-sr-only');
  });

  it('offers no control on a card the user cannot read', async () => {
    renderBrainstorm();

    await waitFor(() => button(/Move the card My idea/));
    expect(screen.queryByRole('button', { name: /Move the card Their idea/ })).toBeNull();
  });

  it('opens every card once the facilitator reveals them', async () => {
    renderBrainstorm(createSession({
      settings: { ...createSession().settings, revealBrainstorm: true },
    }));

    await waitFor(() => expect(button(/Move the card Their idea to another column/)).toBeTruthy());
  });

  it('moves the card to the chosen column — and creates no group', async () => {
    const user = userEvent.setup();
    renderBrainstorm();
    await waitFor(() => button(/Move the card My idea/));

    await tabTo(user, /Move the card My idea/);
    await user.keyboard('{Enter}');

    // Every other column now offers to receive it.
    const target = await waitFor(() => button(/Move the selected card to What Went Wrong/));
    await user.click(target);

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find(t => t.id === 't-mine')?.colId).toBe('col-2');
    });
    const persisted = await lastPersisted();
    expect(persisted?.groups).toHaveLength(0);
    expect(persisted?.tickets.every(t => !t.groupId)).toBe(true);
    // The other card stayed exactly where it was.
    expect(persisted?.tickets.find(t => t.id === 't-theirs')?.colId).toBe('col-1');
  });

  it('never offers to move a card into the column it is already in', async () => {
    const user = userEvent.setup();
    renderBrainstorm();
    await waitFor(() => button(/Move the card My idea/));

    await tabTo(user, /Move the card My idea/);
    await user.keyboard('{Enter}');

    await waitFor(() => button(/Move the selected card to What Went Wrong/));
    expect(screen.queryByRole('button', { name: /Move the selected card to What Went Well/ })).toBeNull();
  });

  it('offers no drop target on another card — that would be grouping', async () => {
    const user = userEvent.setup();
    renderBrainstorm(createSession({
      settings: { ...createSession().settings, revealBrainstorm: true },
    }));
    await waitFor(() => button(/Move the card My idea/));

    await tabTo(user, /Move the card My idea/);
    await user.keyboard('{Enter}');

    await waitFor(() => button(/Move the selected card to What Went Wrong/));
    expect(screen.queryByRole('button', { name: /Move the card Their idea/ })).toBeNull();
  });

  it('cancels on Escape, leaving every card where it was', async () => {
    const user = userEvent.setup();
    renderBrainstorm();
    await waitFor(() => button(/Move the card My idea/));

    await tabTo(user, /Move the card My idea/);
    await user.keyboard('{Enter}');
    await waitFor(() => button(/Selected to move: My idea/));

    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(button(/Move the card My idea/).getAttribute('aria-pressed')).toBe('false');
    });
    // Mounting itself persists the participant roster, so "no writes" is the
    // wrong assertion — "nothing moved" is the one that matters.
    const { dataService } = await import('../services/dataService');
    const calls = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, persisted] of calls) {
      expect((persisted as RetroSession).tickets.every(t => t.colId === 'col-1')).toBe(true);
    }
  });

  it('puts the card back down when its own control is activated again', async () => {
    const user = userEvent.setup();
    renderBrainstorm();
    await waitFor(() => button(/Move the card My idea/));

    await tabTo(user, /Move the card My idea/);
    await user.keyboard('{Enter}');
    await waitFor(() => button(/Selected to move: My idea/));
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(button(/Move the card My idea/).getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('picks a card up with a tap and moves it, for a phone with no drag', async () => {
    const user = userEvent.setup();
    renderBrainstorm();
    const card = await waitFor(() => screen.getByText('My idea').closest('div.group') as HTMLElement);

    fireEvent.touchStart(card, touch(40, 40));
    fireEvent.touchEnd(card, touch(40, 40));

    const target = await waitFor(() => button(/Move the selected card to What Went Wrong/));
    await user.click(target);

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find(t => t.id === 't-mine')?.colId).toBe('col-2');
    });
  });

  it('ignores a swipe: a finger that travelled was scrolling the board', async () => {
    renderBrainstorm();
    const card = await waitFor(() => screen.getByText('My idea').closest('div.group') as HTMLElement);

    fireEvent.touchStart(card, touch(40, 200));
    fireEvent.touchMove(card, touch(42, 60));
    fireEvent.touchEnd(card, touch(42, 60));

    expect(screen.queryByRole('button', { name: /Move the selected card to/ })).toBeNull();
  });

  it('moves the card when it is dragged onto another column', async () => {
    // The pointer path, which the keyboard tests above cannot cover: the card
    // really is `draggable`, and the column really does receive the drop.
    renderBrainstorm();
    const card = await waitFor(() => screen.getByText('My idea').closest('div.group') as HTMLElement);
    expect(card.getAttribute('draggable')).toBe('true');

    const transfer = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(columnElement('col-2'), { dataTransfer: transfer });

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find(t => t.id === 't-mine')?.colId).toBe('col-2');
    });
    expect((await lastPersisted())?.groups).toHaveLength(0);
  });

  it('writes nothing when the card is dropped back on its own column', async () => {
    // A no-op write is not harmless: every client pays a broadcast for it.
    renderBrainstorm();
    const card = await waitFor(() => screen.getByText('My idea').closest('div.group') as HTMLElement);
    const { dataService } = await import('../services/dataService');
    const before = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const transfer = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(columnElement('col-1'), { dataTransfer: transfer });

    expect((dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it('stops being draggable while it is open for editing', async () => {
    // A draggable element competes with the text selection its own textarea
    // needs, so the card stands down for as long as it is being edited.
    const user = userEvent.setup();
    renderBrainstorm();
    await waitFor(() => screen.getByText('My idea'));

    await user.click(screen.getByRole('button', { name: 'Edit ticket' }));

    const editor = await waitFor(() => screen.getByDisplayValue('My idea'));
    expect((editor.closest('div.group') as HTMLElement).getAttribute('draggable')).toBe('false');
  });

  it('drops a held card when the facilitator hides the cards again', async () => {
    // A hold outlives the state it was made in (Codex, PR #483): picked up
    // while revealed, it must not still be movable once the facilitator turns
    // "Reveal cards" off — the card is blurred now, and its own control (the
    // way to cancel) is gone with it.
    const user = userEvent.setup();
    const revealed = createSession({
      settings: { ...createSession().settings, revealBrainstorm: true },
    });
    renderBrainstorm(revealed, other); // the facilitator owns the reveal toggle
    await waitFor(() => button(/Move the card My idea/));

    await tabTo(user, /Move the card My idea/);
    await user.keyboard('{Enter}');
    await waitFor(() => button(/Move the selected card to What Went Wrong/));

    await user.click(screen.getByLabelText('Reveal cards'));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Move the selected card to/ })).toBeNull();
    });
    const persisted = await lastPersisted();
    expect(persisted?.tickets.find(t => t.id === 't-mine')?.colId).toBe('col-1');
  });

  it('keeps holding the user’s own card when the cards are hidden', async () => {
    // The same toggle must not drop a hold that stays legitimate, or the rule
    // would be "any incoming change cancels your move".
    const user = userEvent.setup();
    const revealed = createSession({
      settings: { ...createSession().settings, revealBrainstorm: true },
      tickets: [
        { id: 't-fac', colId: 'col-1', text: 'Facilitator idea', authorId: 'other', groupId: null, votes: [] },
      ],
    });
    renderBrainstorm(revealed, other);
    await waitFor(() => button(/Move the card Facilitator idea/));

    await tabTo(user, /Move the card Facilitator idea/);
    await user.keyboard('{Enter}');
    await waitFor(() => button(/Move the selected card to What Went Wrong/));

    await user.click(screen.getByLabelText('Reveal cards'));

    await user.click(await waitFor(() => button(/Move the selected card to What Went Wrong/)));
    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find(t => t.id === 't-fac')?.colId).toBe('col-2');
    });
  });

  it('leaves the cards alone outside the Brainstorm phase', async () => {
    renderBrainstorm(createSession({ phase: 'VOTE' }));

    await waitFor(() => expect(screen.getByText('My idea')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /to another column/ })).toBeNull();
  });
});

describe('Brainstorm — moving a group that was formed in the Group phase', () => {
  const grouped = () =>
    createSession({
      settings: { ...createSession().settings, revealBrainstorm: true },
      tickets: [
        { id: 't-mine', colId: 'col-1', text: 'My idea', authorId: 'me', groupId: 'g1', votes: [] },
        { id: 't-theirs', colId: 'col-1', text: 'Their idea', authorId: 'other', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Deploys', colId: 'col-1', votes: [], anchorTicketId: 't-mine' }],
    });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('offers one control for the whole group and none for the cards inside it', async () => {
    renderBrainstorm(grouped());

    await waitFor(() => expect(button(/Move the group Deploys to another column/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Move the card My idea/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move the card Their idea/ })).toBeNull();
  });

  it('moves the group with every card in it, composition untouched', async () => {
    const user = userEvent.setup();
    renderBrainstorm(grouped());
    await waitFor(() => button(/Move the group Deploys/));

    await tabTo(user, /Move the group Deploys/);
    await user.keyboard('{Enter}');
    await user.click(await waitFor(() => button(/Move the selected group to What Went Wrong/)));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups[0].colId).toBe('col-2');
    });
    const persisted = await lastPersisted();
    expect(persisted?.groups).toHaveLength(1);
    expect(persisted?.tickets.every(t => t.groupId === 'g1')).toBe(true);
    expect(persisted?.tickets.every(t => t.colId === 'col-2')).toBe(true);
  });

  it('picks the group up when a card inside it is tapped, not the card', async () => {
    // Touch events bubble, and the card is the innermost handler. It has to
    // stay inert here — a card that claimed (or merely ended) the gesture
    // would take it away from the container that bubbling reaches next, which
    // is the exact shape of the Group phase's #436 defect.
    const user = userEvent.setup();
    renderBrainstorm(grouped());
    const inner = await waitFor(() => screen.getByText('My idea').closest('div.group') as HTMLElement);

    fireEvent.touchStart(inner, touch(40, 40));
    fireEvent.touchEnd(inner, touch(40, 40));

    await user.click(await waitFor(() => button(/Move the selected group to What Went Wrong/)));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups[0].colId).toBe('col-2');
      expect(persisted?.tickets.every(t => t.groupId === 'g1')).toBe(true);
    });
  });

  it('refuses the group while it holds a card this user cannot read', async () => {
    renderBrainstorm(
      createSession({
        tickets: grouped().tickets,
        groups: grouped().groups,
      })
    );

    await waitFor(() => expect(screen.getByText('My idea')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Move the group Deploys/ })).toBeNull();
  });
});
