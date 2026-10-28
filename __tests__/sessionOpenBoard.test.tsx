import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import LanguageProvider from '../i18n/LanguageProvider';
import { RetroSession, Team, User } from '../types';

/**
 * The open board (utils/openBoard.ts): every card activity of a retrospective
 * on one screen, with no phases — a Lean Coffee, a board kept open for weeks.
 *
 * `openBoard.test.ts` pins the rules and `retroGrouping.test.ts` how the votes
 * travel when cards are grouped; this pins the **wiring**: that the board
 * really does carry every control on one screen, that the keyboard reaches the
 * two ways of moving things (a card to group or re-home it, a group to move it
 * whole), that the facilitator can turn it into a guided retrospective and
 * back, and that its participants panel lists the people connected right now
 * and nobody else.
 */

let rosterListener: ((roster: { id: string; name: string }[]) => void) | null = null;

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
    onRoster: vi.fn((listener: (roster: { id: string; name: string }[]) => void) => {
      rosterListener = listener;
      return () => {};
    }),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true),
  },
}));

const facilitator: User = { id: 'fac', name: 'Fiona Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'alice', name: 'Alice Martin', color: 'bg-rose-500', role: 'participant' };
const bob: User = { id: 'bob', name: 'Bob Keller', color: 'bg-emerald-500', role: 'participant' };

const column = (id: string, title: string) => ({
  id,
  title,
  color: 'bg-slate-50',
  border: 'border-slate-400',
  icon: 'pending',
  text: 'text-slate-700',
  ring: 'focus:ring-slate-200',
});

const createBoard = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Lean Coffee',
  date: '2026-10-28',
  status: 'IN_PROGRESS',
  phase: 'OPEN_BOARD',
  participants: [facilitator, alice, bob],
  icebreakerQuestion: '',
  columns: [column('todo', 'To Discuss'), column('doing', 'Discussing')],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    // Off on purpose: a board shows every card whatever this says.
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300,
  },
  tickets: [
    { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['bob'] },
    { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: ['alice', 'fac'] },
    { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'alice', groupId: null, votes: [] },
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
  name: 'Coffee Team',
  passwordHash: 'hash',
  members: [facilitator, alice, bob],
  customTemplates: [],
  retrospectives: [session],
  globalActions: [],
});

const renderBoard = (session: RetroSession = createBoard(), user: User = facilitator) =>
  render(<Session team={createTeam(session)} sessionId={session.id} currentUser={user} onExit={() => {}} />);

const button = (name: RegExp) => screen.getByRole('button', { name });

const tabTo = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  const target = button(name);
  for (let step = 0; step < 120; step += 1) {
    if (document.activeElement === target) return target;
    await user.tab();
  }
  throw new Error(`never reached ${name} by tabbing`);
};

const lastPersisted = async (): Promise<RetroSession | null> => {
  const { dataService } = await import('../services/dataService');
  const calls = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
  if (calls.length === 0) return null;
  return calls[calls.length - 1][1] as RetroSession;
};

const persistedCount = async () => {
  const { dataService } = await import('../services/dataService');
  return (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
};

const dataTransfer = () => ({
  effectAllowed: 'none',
  setDragImage: vi.fn(),
  setData: vi.fn(),
  getData: vi.fn(() => ''),
});

const cardElement = (text: string) => screen.getByText(text).closest('div.group') as HTMLElement;
const columnElement = (colId: string) => {
  const el = document.querySelector<HTMLElement>(`[data-column-id="${colId}"]`);
  if (!el) throw new Error(`no column ${colId}`);
  return el;
};

describe('Open board — one screen for every card activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rosterListener = null;
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('puts writing, voting and every card on the same screen, with no phases', async () => {
    renderBoard();

    expect(await screen.findByRole('heading', { level: 2, name: 'Open board' })).toBeTruthy();
    // Writing: one field per column.
    expect(screen.getAllByPlaceholderText('Add an idea...')).toHaveLength(2);
    // Voting, straight on the cards, with what everyone gave each one.
    expect(screen.getAllByRole('button', { name: 'Add a vote to this ticket' })).toHaveLength(3);
    expect(screen.getByText('2 votes in total')).toBeTruthy();
    // The facilitator already gave one of their five.
    expect(screen.getByText('4 votes remaining')).toBeTruthy();
    // Every card readable, although "Reveal cards" is off.
    expect(screen.getByText('Slow rollbacks').className).not.toContain('ticket-blur');
    // No phase to go through.
    expect(document.querySelectorAll('.phase-nav-btn')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Next Phase' })).toBeNull();
    expect(screen.queryByRole('button', { name: "I'm Finished" })).toBeNull();
  });

  it('adds a card from any column', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard(), alice);

    const field = (await screen.findAllByPlaceholderText('Add an idea...'))[1];
    await user.type(field, 'Pairing on Fridays{Enter}');

    await waitFor(async () => {
      const card = (await lastPersisted())?.tickets.find((t) => t.text === 'Pairing on Fridays');
      expect(card).toMatchObject({ colId: 'doing', authorId: 'alice', groupId: null, votes: [] });
    });
  });

  it('adds and removes the user’s own vote on a card', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard(), alice);

    const flaky = within(cardElement('Flaky deploys'));
    await user.click(flaky.getByRole('button', { name: 'Add a vote to this ticket' }));
    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob', 'alice']);
    });

    await user.click(within(cardElement('Flaky deploys')).getByRole('button', { name: 'Remove a vote from this ticket' }));
    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob']);
    });
  });

  it('groups a card dropped on another one, and the group keeps both cards’ votes', async () => {
    renderBoard();
    await screen.findByText('Flaky deploys');

    const transfer = dataTransfer();
    fireEvent.dragStart(cardElement('Flaky deploys'), { dataTransfer: transfer });
    fireEvent.drop(cardElement('Slow rollbacks'), { dataTransfer: transfer });

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toHaveLength(1);
      const group = persisted!.groups[0];
      expect(persisted!.tickets.filter((t) => t.groupId === group.id).map((t) => t.id).sort()).toEqual(['t-a', 't-b']);
      expect([...group.votes].sort()).toEqual(['alice', 'bob', 'fac']);
    });
  });

  it('takes a card out of its group when it is dropped on a column', async () => {
    renderBoard(createBoard({
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: 'g1', votes: [] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'alice', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Delivery', colId: 'todo', votes: ['bob'] }],
    }));
    await screen.findByText('Flaky deploys');

    const transfer = dataTransfer();
    fireEvent.dragStart(cardElement('Too many meetings'), { dataTransfer: transfer });
    fireEvent.drop(columnElement('doing'), { dataTransfer: transfer });

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find((t) => t.id === 't-c')).toMatchObject({ colId: 'doing', groupId: null });
      expect(persisted?.groups[0].votes).toEqual(['bob']);
    });
  });

  it('moves a whole group when the group is dropped on another column', async () => {
    renderBoard(createBoard({
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: 'g1', votes: [] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'alice', groupId: null, votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Delivery', colId: 'todo', votes: ['bob', 'alice'] }],
    }));
    await screen.findByText('Flaky deploys');

    const groupElement = document.querySelector<HTMLElement>('.group-container')!;
    const transfer = dataTransfer();
    fireEvent.dragStart(groupElement, { dataTransfer: transfer });
    fireEvent.drop(columnElement('doing'), { dataTransfer: transfer });

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups[0]).toMatchObject({ colId: 'doing', votes: ['bob', 'alice'] });
      expect(persisted?.tickets.filter((t) => t.groupId === 'g1').every((t) => t.colId === 'doing')).toBe(true);
      expect(persisted?.tickets.find((t) => t.id === 't-c')?.colId).toBe('todo');
    });
  });

  it('writes nothing when a group is dropped back on its own column', async () => {
    renderBoard(createBoard({
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: 'g1', votes: [] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Delivery', colId: 'todo', votes: [] }],
    }));
    await screen.findByText('Flaky deploys');
    const before = await persistedCount();

    const transfer = dataTransfer();
    fireEvent.dragStart(document.querySelector<HTMLElement>('.group-container')!, { dataTransfer: transfer });
    fireEvent.drop(columnElement('todo'), { dataTransfer: transfer });

    expect(await persistedCount()).toBe(before);
  });

  it('groups two cards with the keyboard, as the Group phase does', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');

    await tabTo(user, /Pick up the ticket Flaky deploys/);
    await user.keyboard('{Enter}');
    await waitFor(() => button(/group the selected ticket with Slow rollbacks/));
    await tabTo(user, /group the selected ticket with Slow rollbacks/);
    await user.keyboard('{Enter}');

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toHaveLength(1);
      expect(persisted?.tickets.filter((t) => t.groupId === persisted.groups[0].id)).toHaveLength(2);
    });
  });

  it('moves a whole group with the keyboard, and only to another column', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: 'g1', votes: [] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Delivery', colId: 'todo', votes: [] }],
    }));
    await screen.findByText('Flaky deploys');

    await tabTo(user, /Move the group Delivery to another column/);
    await user.keyboard('{Enter}');
    const target = await waitFor(() => button(/move the selected group to Discussing/));
    expect(screen.queryByRole('button', { name: /move the selected group to To Discuss/ })).toBeNull();
    await user.click(target);

    await waitFor(async () => {
      expect((await lastPersisted())?.groups[0].colId).toBe('doing');
    });
  });

  it('lets a participant delete their own card, and no one else’s', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard(), bob);
    await screen.findByText('Slow rollbacks');

    expect(within(cardElement('Flaky deploys')).queryByRole('button', { name: 'Delete ticket' })).toBeNull();
    await user.click(within(cardElement('Slow rollbacks')).getByRole('button', { name: 'Delete ticket' }));

    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.map((t) => t.id)).toEqual(['t-a', 't-c']);
    });
  });

  it('turns back into a guided retrospective where it left off', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ guidedPhase: 'VOTE' }));

    await user.click(await screen.findByRole('button', { name: 'Switch to a guided retrospective' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.phase).toBe('VOTE');
      expect(persisted).not.toHaveProperty('guidedPhase');
      // Nothing on the board is lost on the way.
      expect(persisted?.tickets).toHaveLength(3);
      expect(persisted?.tickets.find((t) => t.id === 't-b')?.votes).toEqual(['alice', 'fac']);
      // A phase change, like any other: the timer stops at the phase's timebox.
      expect(persisted?.settings).toMatchObject({ timerRunning: false, timerSeconds: 180 });
    });
  });

  it('starts a board created open at the beginning of the guided retrospective', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: 'Switch to a guided retrospective' }));

    await waitFor(async () => expect((await lastPersisted())?.phase).toBe('ICEBREAKER'));
  });

  it('offers the switch to the facilitator only', async () => {
    renderBoard(createBoard(), alice);
    await screen.findByText('Flaky deploys');

    expect(screen.queryByRole('button', { name: 'Switch to a guided retrospective' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Anonymous' })).toBeNull();
  });

  it('turns a guided Brainstorm into an open board, remembering the phase', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ phase: 'BRAINSTORM' }));

    await user.click(await screen.findByRole('button', { name: 'Switch to an open board' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.phase).toBe('OPEN_BOARD');
      expect(persisted?.guidedPhase).toBe('BRAINSTORM');
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Open board' })).toBeTruthy();
  });

  it('offers the switch from the Icebreaker, where a facilitator who chose wrong lands', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ phase: 'ICEBREAKER' }));

    await user.click(await screen.findByRole('button', { name: 'Switch to an open board' }));

    await waitFor(async () => expect((await lastPersisted())?.phase).toBe('OPEN_BOARD'));
  });

  it('leaves a finished retrospective as it is', async () => {
    renderBoard(createBoard({ phase: 'GROUP', status: 'CLOSED' }));
    await screen.findByText('Flaky deploys');

    expect(screen.queryByRole('button', { name: 'Switch to an open board' })).toBeNull();
  });

  it('lists only the people connected right now', async () => {
    renderBoard(createBoard({
      invitedUsers: [{ id: 'zoe', name: 'Zoe Waiting', email: 'zoe@example.com' }],
    }));
    await screen.findByText('Flaky deploys');

    act(() => rosterListener?.([{ id: 'fac', name: 'Fiona Facilitator' }, { id: 'alice', name: 'Alice Martin' }]));

    expect(await screen.findByText('Connected now (2)')).toBeTruthy();
    const rows = screen.getAllByTestId('participant-row').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.includes('Alice Martin'))).toBe(true);
    expect(rows.some((row) => row.includes('Bob Keller'))).toBe(false);
    // No waiting list and no "has left" marking on a board kept open for weeks.
    expect(screen.queryByTestId('invited-section')).toBeNull();
    expect(screen.queryByTestId('toggle-left-btn')).toBeNull();

    // Alice leaves: she disappears from the panel.
    act(() => rosterListener?.([{ id: 'fac', name: 'Fiona Facilitator' }]));
    await waitFor(() => expect(screen.getAllByTestId('participant-row')).toHaveLength(1));
    expect(screen.getByText('Connected now (1)')).toBeTruthy();
  });

  it('hides the authors on an anonymous board, and asks before showing them again', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: { ...createBoard().settings, isAnonymous: true } }));
    await screen.findByText('Flaky deploys');
    // No initials on the cards.
    expect(within(cardElement('Flaky deploys')).queryByText('AL')).toBeNull();

    const anonymous = screen.getByRole('checkbox', { name: 'Anonymous' });
    expect((anonymous as HTMLInputElement).checked).toBe(true);
    const before = await persistedCount();

    // Turning it off shows the authors of every card, the earlier ones too.
    await user.click(anonymous);
    const dialog = await screen.findByRole('dialog', { name: 'Show who wrote each card?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it anonymous' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await persistedCount()).toBe(before);
    expect((screen.getByRole('checkbox', { name: 'Anonymous' }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Anonymous' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Show the authors' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.isAnonymous).toBe(false));
  });

  it('makes a board anonymous without asking', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');

    await user.click(screen.getByRole('checkbox', { name: 'Anonymous' }));

    await waitFor(async () => expect((await lastPersisted())?.settings.isAnonymous).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the max votes field, on the board and in the Vote phase', async () => {
    // It had no name at all: the visible "Max:" beside it is a plain span, and
    // axe reported it (critical) on the first audit of the board.
    const { unmount } = renderBoard();
    expect(await screen.findByRole('textbox', { name: 'Max votes per person' })).toHaveProperty('value', '5');
    unmount();

    renderBoard(createBoard({ phase: 'VOTE' }));
    expect(await screen.findByRole('textbox', { name: 'Max votes per person' })).toBeTruthy();
  });

  it('reads in French for a French reader', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <Session team={createTeam(createBoard())} sessionId="session-1" currentUser={facilitator} onExit={() => {}} />
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { level: 2, name: 'Tableau ouvert' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Passer en rétrospective guidée' })).toBeTruthy();
    expect(screen.getByText('2 votes au total')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Anonyme' })).toBeTruthy();
  });
});
