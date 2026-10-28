import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import LanguageProvider from '../i18n/LanguageProvider';
import { RetroSession, Team, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

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
let connectionListener: ((connected: boolean) => void) | null = null;
let sessionUpdateListener: ((session: RetroSession) => void) | null = null;

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    getSessionToken: vi.fn(() => 'token-1'),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => 'session-1'),
    onSessionUpdate: vi.fn((listener: (session: RetroSession) => void) => {
      sessionUpdateListener = listener;
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn((listener: (roster: { id: string; name: string }[]) => void) => {
      rosterListener = listener;
      return () => {};
    }),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn((listener: (connected: boolean) => void) => {
      connectionListener = listener;
      return () => {};
    }),
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
    connectionListener = null;
    sessionUpdateListener = null;
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

/**
 * Every hold on the board and everything it can be dropped on, the matrix the
 * state-machines review drew for the open board: a card held for grouping (the
 * Group phase's hold), a group held to move it whole (Brainstorm's), and what
 * puts each down. The cells the first tests left open are pinned here, among
 * them the three it found the code getting wrong: a held card that outlived a
 * lost connection or its own deletion, and "Delete group" dropping the votes.
 */
describe('Open board — every hold and every drop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rosterListener = null;
    connectionListener = null;
    sessionUpdateListener = null;
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
    // Discuss scrolls the topic under discussion into view, 50ms after it
    // renders; jsdom has no scrollIntoView.
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
  });

  const ticket = (id: string, text: string, overrides: Partial<RetroSession['tickets'][number]> = {}) => ({
    id, colId: 'todo', text, authorId: 'alice', groupId: null, votes: [] as string[], ...overrides,
  });
  // Delivery: Flaky deploys + Slow rollbacks, with Bob's vote; Too many meetings
  // on its own with Alice's.
  const groupedBoard = (overrides: Partial<RetroSession> = {}) => createBoard({
    tickets: [
      ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
      ticket('t-b', 'Slow rollbacks', { authorId: 'bob', groupId: 'g1' }),
      ticket('t-c', 'Too many meetings', { votes: ['alice'] }),
    ],
    groups: [{ id: 'g1', title: 'Delivery', colId: 'todo', votes: ['bob'], anchorTicketId: 't-a' }],
    ...overrides,
  });
  const groupElement = (title: string) => screen.getByDisplayValue(title).closest('.group-container') as HTMLElement;
  const drag = (from: HTMLElement, to: HTMLElement) => {
    const transfer = dataTransfer();
    fireEvent.dragStart(from, { dataTransfer: transfer });
    fireEvent.drop(to, { dataTransfer: transfer });
  };
  const cardTargets = () => screen.queryAllByRole('button', {
    name: /Group here: group the selected ticket|Add selected card to this group|Move selected card here/,
  });
  const groupTargets = () => screen.queryAllByRole('button', { name: /move the selected group to/ });

  it('a card dropped on a group joins it, and the group gains the card’s votes', async () => {
    renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');

    drag(cardElement('Too many meetings'), groupElement('Delivery'));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find((t) => t.id === 't-c')).toMatchObject({ groupId: 'g1', votes: [] });
      expect([...persisted!.groups[0].votes].sort()).toEqual(['alice', 'bob']);
    });
  });

  it('a card dropped on another column moves there ungrouped, keeping its votes', async () => {
    renderBoard(createBoard({
      tickets: [ticket('t-c', 'Too many meetings', { votes: ['alice'], originColId: 'doing' })],
    }));
    await screen.findByText('Too many meetings');

    drag(cardElement('Too many meetings'), columnElement('doing'));

    await waitFor(async () => {
      const moved = (await lastPersisted())?.tickets.find((t) => t.id === 't-c');
      expect(moved).toMatchObject({ colId: 'doing', groupId: null, votes: ['alice'] });
      expect(moved).not.toHaveProperty('originColId');
    });
  });

  it('a card dropped back on its own column writes nothing', async () => {
    renderBoard();
    await screen.findByText('Too many meetings');
    const before = await persistedCount();

    drag(cardElement('Too many meetings'), columnElement('todo'));

    expect(await persistedCount()).toBe(before);
  });

  it('a grouped card dropped on another group joins it, and the pair it left hands its votes to its last card', async () => {
    renderBoard(groupedBoard({
      tickets: [
        ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
        ticket('t-b', 'Slow rollbacks', { groupId: 'g1' }),
        ticket('t-c', 'Too many meetings', { colId: 'doing', groupId: 'g2' }),
        ticket('t-d', 'Long stand-ups', { colId: 'doing', groupId: 'g2' }),
      ],
      groups: [
        { id: 'g1', title: 'Delivery', colId: 'todo', votes: ['bob'] },
        { id: 'g2', title: 'Meetings', colId: 'doing', votes: ['alice'] },
      ],
    }));
    await screen.findByText('Flaky deploys');

    drag(cardElement('Flaky deploys'), groupElement('Meetings'));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.find((t) => t.id === 't-a')).toMatchObject({ groupId: 'g2', colId: 'doing' });
      expect(persisted?.groups.map((g) => g.id)).toEqual(['g2']);
      expect(persisted?.groups[0].votes).toEqual(['alice']);
      expect(persisted?.tickets.find((t) => t.id === 't-b')).toMatchObject({ groupId: null, votes: ['bob'] });
    });
  });

  it('a grouped card dropped on its own column leaves its group, and the card left gets the votes', async () => {
    renderBoard(groupedBoard());
    await screen.findByText('Slow rollbacks');

    drag(cardElement('Slow rollbacks'), columnElement('todo'));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toEqual([]);
      expect(persisted?.tickets.find((t) => t.id === 't-b')).toMatchObject({ groupId: null, colId: 'todo', votes: [] });
      expect(persisted?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob']);
    });
  });

  it('deleting a grouped card hands the votes to the card left', async () => {
    const user = userEvent.setup();
    renderBoard(groupedBoard());
    await screen.findByText('Slow rollbacks');

    await user.click(within(cardElement('Slow rollbacks')).getByRole('button', { name: 'Delete ticket' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.tickets.map((t) => t.id)).toEqual(['t-a', 't-c']);
      expect(persisted?.groups).toEqual([]);
      expect(persisted?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob']);
    });
  });

  it('"Delete group" keeps the cards and gives the votes to the card the group was made on', async () => {
    const user = userEvent.setup();
    renderBoard(groupedBoard());
    await screen.findByText('Flaky deploys');

    await user.click(screen.getByRole('button', { name: 'Delete group' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toEqual([]);
      expect(persisted?.tickets.find((t) => t.id === 't-a')).toMatchObject({ groupId: null, votes: ['bob'] });
      expect(persisted?.tickets.find((t) => t.id === 't-b')).toMatchObject({ groupId: null, votes: [] });
    });
  });

  it('a group dropped on a card of another column moves there whole, never merged', async () => {
    renderBoard(groupedBoard({
      tickets: [
        ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
        ticket('t-b', 'Slow rollbacks', { groupId: 'g1' }),
        ticket('t-c', 'Too many meetings', { colId: 'doing' }),
      ],
    }));
    await screen.findByText('Too many meetings');

    drag(groupElement('Delivery'), cardElement('Too many meetings'));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups[0]).toMatchObject({ id: 'g1', colId: 'doing', votes: ['bob'] });
      expect(persisted?.tickets.filter((t) => t.groupId === 'g1').every((t) => t.colId === 'doing')).toBe(true);
      expect(persisted?.tickets.find((t) => t.id === 't-c')?.groupId).toBeNull();
    });
  });

  it('a group dropped on a group of another column moves there whole, never merged', async () => {
    renderBoard(groupedBoard({
      tickets: [
        ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
        ticket('t-b', 'Slow rollbacks', { groupId: 'g1' }),
        ticket('t-c', 'Too many meetings', { colId: 'doing', groupId: 'g2' }),
        ticket('t-d', 'Long stand-ups', { colId: 'doing', groupId: 'g2' }),
      ],
      groups: [
        { id: 'g1', title: 'Delivery', colId: 'todo', votes: ['bob'] },
        { id: 'g2', title: 'Meetings', colId: 'doing', votes: [] },
      ],
    }));
    await screen.findByText('Flaky deploys');

    drag(groupElement('Delivery'), groupElement('Meetings'));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups.find((g) => g.id === 'g1')).toMatchObject({ colId: 'doing', votes: ['bob'] });
      expect(persisted?.tickets.filter((t) => t.groupId === 'g2').map((t) => t.id).sort()).toEqual(['t-c', 't-d']);
    });
  });

  // What puts a hold down, for each of the three things a board holds.
  const holds = [
    { held: 'a card', pickUp: /Pick up the ticket Too many meetings/, targets: cardTargets, id: 't-c' },
    { held: 'a grouped card', pickUp: /Pick up the ticket Flaky deploys/, targets: cardTargets, id: 't-a' },
    { held: 'a group', pickUp: /Move the group Delivery to another column/, targets: groupTargets, id: 'g1' },
  ];

  it.each(holds)('Escape puts $held down, and writes nothing', async ({ pickUp, targets }) => {
    const user = userEvent.setup();
    renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');
    const before = await persistedCount();

    await user.click(button(pickUp));
    expect(targets().length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');

    expect(targets()).toHaveLength(0);
    expect(await persistedCount()).toBe(before);
  });

  it.each(holds)('switching the board to a guided retro puts $held down', async ({ pickUp }) => {
    const user = userEvent.setup();
    renderBoard(groupedBoard({ guidedPhase: 'GROUP' }));
    await screen.findByText('Too many meetings');

    await user.click(button(pickUp));
    await user.click(screen.getByRole('button', { name: 'Switch to a guided retrospective' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Group Ideas' })).toBeTruthy();
    // The Group phase offers the same targets for a card it holds.
    expect(cardTargets()).toHaveLength(0);
    expect(groupTargets()).toHaveLength(0);
  });

  it.each(holds)('losing the connection puts $held down, for good', async ({ pickUp, targets }) => {
    const user = userEvent.setup();
    renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');

    await user.click(button(pickUp));
    expect(targets().length).toBeGreaterThan(0);

    act(() => connectionListener?.(false));
    expect(targets()).toHaveLength(0);
    act(() => connectionListener?.(true));
    expect(targets()).toHaveLength(0);
  });

  it.each(holds)('$held is put down when someone else deletes it', async ({ pickUp, targets, id }) => {
    const user = userEvent.setup();
    const board = groupedBoard();
    renderBoard(board);
    await screen.findByText('Too many meetings');

    await user.click(button(pickUp));
    expect(targets().length).toBeGreaterThan(0);

    const gone = id.startsWith('g')
      ? { ...board, groups: [], tickets: board.tickets.map((t) => ({ ...t, groupId: null })) }
      : { ...board, tickets: board.tickets.filter((t) => t.id !== id) };
    act(() => sessionUpdateListener?.({ ...gone, _rev: 9 } as RetroSession));

    await waitFor(() => expect(targets()).toHaveLength(0));
  });

  it('applies AI-suggested groups with the votes of their cards', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(
        url.includes('/api/ai/suggest-groups')
          ? { groups: [{ title: 'Delivery', ticketIds: ['t-a', 't-b'] }] }
          : { enabled: url.includes('/api/ai-status') },
      ),
    })) as unknown as typeof fetch;
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Suggest groups with AI/ }));
    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toHaveLength(1);
      expect([...persisted!.groups[0].votes].sort()).toEqual(['alice', 'bob', 'fac']);
    });
  });

  it('shows hover-only card controls on focus, and on touch screens', async () => {
    renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');

    const bareOpacity0 = /(^|\s)opacity-0(\s|$)/;
    const edits = screen.getAllByRole('button', { name: 'Edit ticket' });
    const deletes = screen.getAllByRole('button', { name: 'Delete ticket' });
    expect(deletes.length).toBeGreaterThan(1); // the grouped cards' corner and the vote row's
    for (const control of [...edits, ...deletes]) {
      // Hidden only where a pointer can hover: on a phone, where nothing
      // hovers, an edit no one sees is never found and a delete no one sees
      // is tapped by accident.
      expect(control.className).not.toMatch(bareOpacity0);
      expect(control.className).toContain('[@media(hover:hover)]:opacity-0');
      expect(control.className).toContain('focus:opacity-100');
    }
    // A card's first comment is added from a control shown the same way.
    const commentControl = within(cardElement('Too many meetings')).getByTestId('ticket-comment-btn').parentElement!;
    expect(commentControl.className).not.toMatch(bareOpacity0);
    expect(commentControl.className).toContain('[@media(hover:hover)]:opacity-0');
    expect(commentControl.className).toContain('focus-within:opacity-100');
  });

  it('keeps the first line clear of the edit control, where nothing hovers', async () => {
    renderBoard(groupedBoard(), alice);
    await screen.findByText('Too many meetings');

    // Alice edits her own cards only, so only they make room for the control.
    const room = within(cardElement('Too many meetings')).getByTestId('ticket-edit-room');
    expect(room.className).toContain('hidden');
    expect(room.className).toContain('[@media(hover:none)]:block');
    expect(room.className).toContain('float-right');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    expect(within(cardElement('Slow rollbacks')).queryByTestId('ticket-edit-room')).toBeNull();
    expect(within(cardElement('Slow rollbacks')).queryByRole('button', { name: 'Edit ticket' })).toBeNull();
  });

  it('draws the edit control at a contrast a phone user can see', async () => {
    renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');

    const edit = within(cardElement('Too many meetings')).getByRole('button', { name: 'Edit ticket' });
    // An icon is non-text: 3:1 (1.4.11).
    expect(effectivePair(edit).ratio).toBeGreaterThanOrEqual(3);
  });

  it('takes the corner delete away while the card is edited', async () => {
    const user = userEvent.setup();
    renderBoard(groupedBoard());
    await screen.findByText('Flaky deploys');
    expect(within(cardElement('Flaky deploys')).getByRole('button', { name: 'Delete ticket' })).toBeTruthy();

    await user.click(within(cardElement('Flaky deploys')).getByRole('button', { name: 'Edit ticket' }));

    const field = screen.getByDisplayValue('Flaky deploys');
    expect(within(field.closest('.group') as HTMLElement).queryByRole('button', { name: 'Delete ticket' })).toBeNull();
  });

  it('never paints a card in its author’s colour while the board is anonymous', async () => {
    const colourful = (isAnonymous: boolean) => createBoard({
      settings: { ...createBoard().settings, isAnonymous, colorBy: 'author' },
    });

    const { unmount } = renderBoard(colourful(false));
    await screen.findByText('Flaky deploys');
    // Alice's rose: the control the anonymous case is measured against.
    expect(cardElement('Flaky deploys').style.backgroundColor).not.toBe('');
    unmount();

    renderBoard(colourful(true));
    await screen.findByText('Flaky deploys');
    expect(cardElement('Flaky deploys').style.backgroundColor).toBe('');
    const select = screen.getByRole('combobox', { name: /colou?r/i }) as HTMLSelectElement;
    expect(select.value).toBe('topic');
    expect((within(select).getByRole('option', { name: 'Author' }) as HTMLOptionElement).disabled).toBe(true);
  });

  // Back from a board the guided Group phase has votes on its cards, and it
  // shows none of them: grouping there must carry them as the board does.
  it('keeps the votes when the guided Group phase groups cards a board voted on', async () => {
    renderBoard(createBoard({ phase: 'GROUP' }));
    await screen.findByText('Flaky deploys');

    drag(cardElement('Flaky deploys'), cardElement('Slow rollbacks'));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toHaveLength(1);
      expect([...persisted!.groups[0].votes].sort()).toEqual(['alice', 'bob', 'fac']);
      expect(persisted?.tickets.flatMap((t) => t.votes)).toEqual([]);
    });
  });

  it('keeps them when the guided Group phase deletes a group', async () => {
    const user = userEvent.setup();
    renderBoard(groupedBoard({ phase: 'GROUP' }));
    await screen.findByText('Flaky deploys');

    await user.click(screen.getByRole('button', { name: 'Delete group' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.groups).toEqual([]);
      expect(persisted?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob']);
    });
  });

  it('expands the most voted topic instead when the board grouped the one under discussion', async () => {
    const user = userEvent.setup();
    // The discussion was on Flaky deploys, which the board then put in a group.
    renderBoard(groupedBoard({
      guidedPhase: 'DISCUSS',
      discussionFocusId: 't-a',
      tickets: [
        ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
        ticket('t-b', 'Slow rollbacks', { groupId: 'g1' }),
        ticket('t-c', 'Too many meetings', { votes: ['alice', 'bob'] }),
      ],
    }));

    await user.click(await screen.findByRole('button', { name: 'Switch to a guided retrospective' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.phase).toBe('DISCUSS');
      expect(persisted?.discussionFocusId).toBe('t-c');
    });
  });

  it('turning a board back into the Discuss phase keeps the topic under discussion', async () => {
    const user = userEvent.setup();
    // Slow rollbacks has the most votes: entering Discuss afresh would focus it.
    renderBoard(createBoard({ guidedPhase: 'DISCUSS', discussionFocusId: 't-c' }));

    await user.click(await screen.findByRole('button', { name: 'Switch to a guided retrospective' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.phase).toBe('DISCUSS');
      expect(persisted?.discussionFocusId).toBe('t-c');
    });
  });

  it('removing a column moves its cards and their votes to the column beside it', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [ticket('t-x', 'Pairing on Fridays', { colId: 'doing', votes: ['bob', 'alice'] })],
    }));
    await screen.findByText('Pairing on Fridays');

    await user.click(button(/Edit Layout/));
    await user.click(screen.getByRole('button', { name: 'Remove the Discussing column' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.columns.map((c) => c.id)).toEqual(['todo']);
      expect(persisted?.tickets.find((t) => t.id === 't-x')).toMatchObject({ colId: 'todo', votes: ['bob', 'alice'] });
    });
  });
});
