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
    // Shown, as a board is created; the "Hide cards" cases turn it off.
    revealBrainstorm: true,
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
// A hidden card shows none of its words, so it is found by its id.
const cardById = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-ticket-id="${id}"]`);
  if (!el) throw new Error(`no card ${id}`);
  return el;
};
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

// The facilitator's settings open in a dialog from the board's bar.
const openSettings = async (user: ReturnType<typeof userEvent.setup>, buttonName = 'Settings', dialogName = 'Board settings') => {
  await user.click(screen.getByRole('button', { name: buttonName }));
  return within(await screen.findByRole('dialog', { name: dialogName }));
};
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
    // Voting, straight on the cards: one button each, which carries what
    // everyone gave — the name starts with the number it shows (WCAG 2.5.3).
    expect(screen.getByRole('button', { name: '1 vote, add a vote to this ticket' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2 votes, add a vote to this ticket' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '0 votes, add a vote to this ticket' })).toBeTruthy();
    // The facilitator already gave one of their five, shown as their own.
    expect(screen.getByText('4 votes remaining')).toBeTruthy();
    expect(within(cardElement('Slow rollbacks')).getByText('You gave it 1 vote')).toBeTruthy();
    // One number per card, never the total beside a counter of one's own.
    expect(within(cardElement('Slow rollbacks')).getAllByText('2')).toHaveLength(1);
    // Every card readable: a board is created with its cards shown.
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
    // Nothing of hers to take back yet.
    expect(flaky.queryByRole('button', { name: 'Take back one of your votes on this ticket' })).toBeNull();
    await user.click(flaky.getByRole('button', { name: '1 vote, add a vote to this ticket' }));
    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob', 'alice']);
    });
    expect(within(cardElement('Flaky deploys')).getByRole('button', { name: '2 votes, add a vote to this ticket' })).toBeTruthy();

    await user.click(within(cardElement('Flaky deploys')).getByRole('button', { name: 'Take back one of your votes on this ticket' }));
    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob']);
    });
  });

  it('groups a card dropped on another one, and the group keeps both cards’ votes', async () => {
    renderBoard();
    await screen.findByText('Flaky deploys');

    const transfer = dataTransfer();
    fireEvent.dragStart(cardElement('Flaky deploys'), { dataTransfer: transfer });
    fireEvent.drop(cardById('t-b'), { dataTransfer: transfer });

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

  it('offers the switch and the settings to the facilitator only', async () => {
    renderBoard(createBoard(), alice);
    await screen.findByText('Flaky deploys');

    expect(screen.queryByRole('button', { name: 'Switch to a guided retrospective' })).toBeNull();
    // Anonymity, the hidden cards and the votes are set in the Settings
    // dialog, which a participant is not offered.
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
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

    const settings = await openSettings(user);
    const anonymous = settings.getByRole('checkbox', { name: 'Anonymous' });
    expect((anonymous as HTMLInputElement).checked).toBe(true);
    const before = await persistedCount();

    // Turning it off shows the authors of every card, the earlier ones too:
    // it asks first, over the settings.
    await user.click(anonymous);
    const dialog = await screen.findByRole('dialog', { name: 'Show who wrote each card?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it anonymous' }));
    expect(screen.queryByRole('dialog', { name: 'Show who wrote each card?' })).toBeNull();
    expect(await persistedCount()).toBe(before);
    expect((settings.getByRole('checkbox', { name: 'Anonymous' }) as HTMLInputElement).checked).toBe(true);

    await user.click(settings.getByRole('checkbox', { name: 'Anonymous' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Show who wrote each card?' })).getByRole('button', { name: 'Show the authors' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.isAnonymous).toBe(false));
  });

  it('makes a board anonymous without asking', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');

    const settings = await openSettings(user);
    await user.click(settings.getByRole('checkbox', { name: 'Anonymous' }));

    await waitFor(async () => expect((await lastPersisted())?.settings.isAnonymous).toBe(true));
    expect(screen.queryByRole('dialog', { name: 'Show who wrote each card?' })).toBeNull();
  });

  it('names the max votes field, on the board and in the Vote phase', async () => {
    // It had no name at all: the visible "Max:" beside it is a plain span, and
    // axe reported it (critical) on the first audit of the board.
    const user = userEvent.setup();
    const { unmount } = renderBoard();
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    expect(settings.getByRole('textbox', { name: 'Votes per person' })).toHaveProperty('value', '5');
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
    expect(screen.getByRole('button', { name: '2 votes, ajouter un vote à cette carte' })).toBeTruthy();
    const settings = await openSettings(userEvent.setup(), 'Paramètres', 'Paramètres du tableau');
    expect(settings.getByRole('checkbox', { name: 'Anonyme' })).toBeTruthy();
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

  describe('with the cards hidden', () => {
    // Alice reads her own cards only, and Delivery holds hers and Bob's.
    const hiddenGroupedBoard = () => groupedBoard({ settings: { ...createBoard().settings, revealBrainstorm: false } });
    const containerOf = (text: string) => cardElement(text).closest('.group-container') as HTMLElement;

    it('puts a card released over itself, or anywhere in its own group, back where it was', async () => {
      renderBoard(hiddenGroupedBoard(), alice);
      await screen.findByText('Flaky deploys');
      const before = await persistedCount();

      // The group takes no card (Bob's is hidden from her), so these drops
      // used to go on to the column, which took her card out of the group.
      // Each drag start puts a copy of the card on the page for its image,
      // gone a frame later.
      const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      drag(cardElement('Flaky deploys'), cardElement('Flaky deploys'));
      await nextFrame();
      drag(cardElement('Flaky deploys'), containerOf('Flaky deploys'));
      await nextFrame();
      drag(cardElement('Flaky deploys'), cardById('t-b'));

      expect(await persistedCount()).toBe(before);
    });

    it('keeps her card out of a group it cannot be read with, and takes it to that column', async () => {
      const board = hiddenGroupedBoard();
      board.tickets = board.tickets.map((t) => (t.id === 't-c' ? { ...t, colId: 'doing' } : t));
      renderBoard(board, alice);
      await screen.findByText('Too many meetings');

      drag(cardElement('Too many meetings'), containerOf('Flaky deploys'));

      await waitFor(async () => {
        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')).toMatchObject({ colId: 'todo', groupId: null });
      });
    });

    it('offers no Delete group and no title field on a group holding a card the facilitator cannot read', async () => {
      renderBoard(hiddenGroupedBoard());
      await screen.findByText('Delivery');

      expect(screen.queryByRole('button', { name: 'Delete group' })).toBeNull();
      expect(screen.queryByDisplayValue('Delivery')).toBeNull();
      // Its title is still shown, as its cards are.
      expect(screen.getByText('Delivery')).toBeTruthy();
    });

    it('offers no keyboard target on a card grouped with one its holder cannot read', async () => {
      const user = userEvent.setup();
      renderBoard(hiddenGroupedBoard(), alice);
      await user.click(await screen.findByRole('button', { name: /Pick up the ticket Too many meetings/ }));
      await screen.findByRole('button', { name: /Selected for grouping/ });

      // Flaky deploys is hers, but its group holds Bob's hidden card: offered,
      // the drop was refused there and the hold put down with nothing said.
      expect(screen.queryByRole('button', { name: /group the selected ticket with Flaky deploys/ })).toBeNull();
      expect(screen.getByRole('button', { name: /Selected for grouping/ })).toBeTruthy();
    });

    it('keeps the hold through a tap on a card it cannot be grouped with', async () => {
      const user = userEvent.setup();
      renderBoard(hiddenGroupedBoard(), alice);
      await user.click(await screen.findByRole('button', { name: /Pick up the ticket Too many meetings/ }));
      await screen.findByRole('button', { name: /Selected for grouping/ });
      const before = await persistedCount();

      // Taken by the card, the tap was refused there and put the hold down.
      fireEvent.touchStart(cardById('t-a'), touch(40, 40));
      fireEvent.touchEnd(cardById('t-a'), touch(40, 40));

      expect(screen.getByRole('button', { name: /Selected for grouping/ })).toBeTruthy();
      expect(await persistedCount()).toBe(before);
    });

    it('tells a phone user which cards they can move', async () => {
      renderBoard(hiddenGroupedBoard(), alice);
      await screen.findByText('Flaky deploys');

      expect(screen.getByText(/tap one of your own cards/)).toBeTruthy();
    });

    // Alice's own group, Planning: two cards of hers, readable whatever the
    // facilitator hides.
    const withOwnGroup = (settings: Partial<RetroSession['settings']> = {}) => groupedBoard({
      settings: { ...createBoard().settings, ...settings },
      tickets: [
        ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
        ticket('t-b', 'Slow rollbacks', { authorId: 'bob', groupId: 'g1' }),
        ticket('t-c', 'Too many meetings'),
        ticket('t-d', 'Sprint goals', { colId: 'doing', groupId: 'g2' }),
        ticket('t-e', 'Backlog grooming', { colId: 'doing', groupId: 'g2' }),
        ticket('t-f', 'Late reviews', { authorId: 'bob', colId: 'doing' }),
      ],
      groups: [
        { id: 'g1', title: 'Delivery', colId: 'todo', votes: [] },
        { id: 'g2', title: 'Planning', colId: 'doing', votes: [] },
      ],
    });
    const hide = () => act(() => sessionUpdateListener?.({ ...withOwnGroup({ revealBrainstorm: false }), _rev: 9 } as RetroSession));

    // Every hold, as the facilitator hides the cards: kept while its holder
    // can still read what is held, put down otherwise.
    it.each([
      { held: 'an own card', pickUp: /Pick up the ticket Too many meetings/, targets: cardTargets, kept: true },
      { held: 'an own card in a group holding another author’s', pickUp: /Pick up the ticket Flaky deploys/, targets: cardTargets, kept: true },
      { held: 'another author’s card in a group', pickUp: /Pick up the ticket Slow rollbacks/, targets: cardTargets, kept: false },
      { held: 'a group of own cards', pickUp: /Move the group Planning to another column/, targets: groupTargets, kept: true },
      { held: 'a group holding another author’s card', pickUp: /Move the group Delivery to another column/, targets: groupTargets, kept: false },
    ])('hides the cards while $held is held: kept $kept', async ({ pickUp, targets, kept }) => {
      const user = userEvent.setup();
      renderBoard(withOwnGroup(), alice);
      await screen.findByText('Too many meetings');
      await user.click(button(pickUp));
      expect(targets().length).toBeGreaterThan(0);
      const before = await persistedCount();

      hide();

      if (kept) {
        await screen.findAllByText('Hidden card');
        expect(targets().length).toBeGreaterThan(0);
      } else {
        await waitFor(() => expect(targets()).toHaveLength(0));
      }
      expect(await persistedCount()).toBe(before);
      // A group holding a hidden card is left as it was.
      expect(cardById('t-a').closest('.group-container')).toBeTruthy();
    });

    it('moves a group of own cards whole to the column of a hidden card it is dropped on, never into it', async () => {
      renderBoard(withOwnGroup({ revealBrainstorm: false }), alice);
      await screen.findByDisplayValue('Planning');
      const transfer = dataTransfer();
      fireEvent.dragStart(groupElement('Planning'), { dataTransfer: transfer });
      // Bob's Slow rollbacks, hidden from her, in To Discuss.
      fireEvent.drop(cardById('t-b'), { dataTransfer: transfer });

      await waitFor(async () => {
        const persisted = await lastPersisted();
        expect(persisted?.groups.find((g) => g.id === 'g2')?.colId).toBe('todo');
        expect(persisted?.tickets.filter((t) => t.groupId === 'g2').map((t) => t.id).sort()).toEqual(['t-d', 't-e']);
        expect(persisted?.tickets.find((t) => t.id === 't-b')?.groupId).toBe('g1');
      });
    });

    it('writes nothing for a group of own cards released over itself', async () => {
      renderBoard(withOwnGroup({ revealBrainstorm: false }), alice);
      await screen.findByDisplayValue('Planning');
      const before = await persistedCount();
      const planning = groupElement('Planning');
      const transfer = dataTransfer();
      fireEvent.dragStart(planning, { dataTransfer: transfer });
      fireEvent.drop(cardById('t-d'), { dataTransfer: transfer });

      expect(await persistedCount()).toBe(before);
    });

    it('takes her own grouped card out of its group to the column of another author’s hidden card', async () => {
      // Released over a hidden card outside its own group: the column takes
      // it, as for any card that cannot be read with its target.
      renderBoard(withOwnGroup({ revealBrainstorm: false }), alice);
      await screen.findByDisplayValue('Planning');

      drag(cardById('t-d'), cardById('t-b'));

      await waitFor(async () => {
        const persisted = await lastPersisted();
        expect(persisted?.tickets.find((t) => t.id === 't-d')).toMatchObject({ colId: 'todo', groupId: null });
        // A pair left with one card hands it its votes, and is gone.
        expect(persisted?.groups.find((g) => g.id === 'g2')).toBeUndefined();
      });
    });
  });

  it('keeps the held card on screen while a search would hide it', async () => {
    const user = userEvent.setup();
    renderBoard(groupedBoard(), alice);
    await screen.findByText('Too many meetings');

    await tabTo(user, /Pick up the ticket Too many meetings/);
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'deploys');

    // Found: Delivery, which holds Flaky deploys. Held: Too many meetings,
    // still there with the control that puts it down, and not counted.
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByText('Too many meetings')).toBeTruthy();
    expect(button(/Selected for grouping: Too many meetings/)).toBeTruthy();
  });

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

  it('keeps the first line clear of the edit control, on every screen', async () => {
    renderBoard(groupedBoard(), alice);
    await screen.findByText('Too many meetings');

    // Alice edits her own cards only, so only they make room for the control.
    // On a computer too: there the control appeared over the end of the first
    // line under the pointer, hiding the words it covered.
    const room = within(cardElement('Too many meetings')).getByTestId('ticket-edit-room');
    expect(room.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(room.className).not.toContain('hover:none');
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
    const settings = await openSettings(userEvent.setup());
    const select = settings.getByRole('combobox', { name: /colou?r/i }) as HTMLSelectElement;
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

/**
 * How a board kept for weeks is read and voted on, as EasyRetro does it: each
 * person's own sort (newest first by default) and search, one vote button per
 * card that carries the total, and the facilitator's settings — hide the
 * cards, turn voting off, hide the totals, lift the limit on votes.
 */
describe('Open board — sort, search, votes and the facilitator’s settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rosterListener = null;
    connectionListener = null;
    sessionUpdateListener = null;
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  // The cards of a column as they are read, top to bottom.
  const columnTexts = (colId: string) =>
    Array.from(columnElement(colId).querySelectorAll<HTMLElement>('div.group .whitespace-pre-wrap'))
      .map((el) => el.textContent);
  const settingsOf = (overrides: Partial<RetroSession['settings']>) =>
    ({ ...createBoard().settings, ...overrides });

  it('shows the newest cards first, and sorts as each person asks', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');

    // The written order is Flaky deploys, Slow rollbacks, Too many meetings.
    expect(columnTexts('todo')).toEqual(['Too many meetings', 'Slow rollbacks', 'Flaky deploys']);
    const before = await persistedCount();

    const sort = screen.getByRole('combobox', { name: 'Sort the cards' });
    await user.selectOptions(sort, 'Oldest first');
    expect(columnTexts('todo')).toEqual(['Flaky deploys', 'Slow rollbacks', 'Too many meetings']);
    await user.selectOptions(sort, 'Most voted first');
    expect(columnTexts('todo')).toEqual(['Slow rollbacks', 'Flaky deploys', 'Too many meetings']);
    // A view, never a write: nobody else's board moves.
    expect(await persistedCount()).toBe(before);
  });

  it('finds cards whatever their accents or case, and says how many', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Équipe pérenne', authorId: 'alice', groupId: null, votes: [] },
        { id: 't-b', colId: 'doing', text: 'Too many meetings', authorId: 'bob', groupId: null, votes: [] },
      ],
    }));
    await screen.findByText('Équipe pérenne');

    const search = screen.getByRole('searchbox', { name: 'Search the cards' });
    await user.type(search, 'EQUIPE');
    expect(screen.queryByText('Too many meetings')).toBeNull();
    expect(screen.getByText('Équipe pérenne')).toBeTruthy();
    // Said by a status region, so a screen reader hears it too.
    expect(screen.getByText('1 result').getAttribute('role')).toBe('status');

    // Escape empties it, as a browser's own field does.
    await user.keyboard('{Escape}');
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Too many meetings')).toBeTruthy();
  });

  it('hides the other authors’ cards when the facilitator hides them, and nothing acts on them', async () => {
    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');

    // Bob's card is blurred; Alice's own stay readable.
    expect(cardById('t-b').querySelector('.ticket-blur')).toBeTruthy();
    expect(screen.getByText('Flaky deploys').className).not.toContain('ticket-blur');
    // No vote on it, its total only, and no way to pick it up.
    const hidden = within(cardById('t-b'));
    expect(hidden.queryByRole('button', { name: /add a vote/ })).toBeNull();
    expect(hidden.getAllByTestId('vote-total')[0].textContent).toContain('2');
    expect(hidden.queryByRole('button', { name: /Pick up/ })).toBeNull();
    // Her own card is voted on as usual.
    expect(within(cardElement('Flaky deploys')).getByRole('button', { name: '1 vote, add a vote to this ticket' })).toBeTruthy();
  });

  it('never finds a card its reader cannot read', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');

    await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'rollbacks');
    expect(screen.queryByText('Slow rollbacks')).toBeNull();
    expect(screen.getByText('0 results')).toBeTruthy();
  });

  it('never groups a card with one its holder cannot read', async () => {
    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');
    const before = await persistedCount();

    const transfer = dataTransfer();
    fireEvent.dragStart(cardElement('Flaky deploys'), { dataTransfer: transfer });
    fireEvent.drop(cardById('t-b'), { dataTransfer: transfer });

    // Dropped on its own column instead: nothing to write.
    expect(await persistedCount()).toBe(before);
  });

  it('keeps the words of a hidden card out of the page, and says it is hidden', async () => {
    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');

    // Not in the page at all: a screen reader read it, and a find in page
    // matched it, while the board's own search refused to.
    expect(document.body.innerHTML).not.toContain('Slow rollbacks');
    expect(within(cardById('t-b')).getByText('Hidden card')).toBeTruthy();
    // Still the blurred shape of a card's text, kept from assistive tech.
    expect(cardById('t-b').querySelector('.ticket-blur')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the words of a hidden card out of the page in a guided Brainstorm too', async () => {
    renderBoard(createBoard({ phase: 'BRAINSTORM', settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');

    expect(document.body.innerHTML).not.toContain('Slow rollbacks');
    expect(within(cardById('t-b')).getByText('Hidden card')).toBeTruthy();
  });

  it('lets a voter take back a vote on a card that became hidden, which still counts', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');

    // Alice gave Bob's card a vote while it was shown.
    const hidden = within(cardById('t-b'));
    expect(hidden.getByText('You gave it 1 vote')).toBeTruthy();
    expect(hidden.queryByRole('button', { name: /add a vote/ })).toBeNull();
    await user.click(hidden.getByRole('button', { name: 'Take back one of your votes on this ticket' }));

    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-b')?.votes).toEqual(['fac']);
    });
  });

  it('closes a card’s comments, and its editor, once the card is hidden from its reader', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard(), alice);
    await screen.findByText('Slow rollbacks');

    await user.click(within(cardElement('Slow rollbacks')).getByTestId('ticket-comment-btn'));
    expect(await screen.findByRole('dialog', { name: /Comments on the ticket/ })).toBeTruthy();

    act(() => sessionUpdateListener?.(createBoard({ settings: settingsOf({ revealBrainstorm: false }), _rev: 9 } as Partial<RetroSession>)));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Comments on the ticket/ })).toBeNull());
  });

  it('closes the facilitator’s editor on a card hidden from them', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard());
    await screen.findByText('Slow rollbacks');

    await user.click(within(cardElement('Slow rollbacks')).getByRole('button', { name: 'Edit ticket' }));
    expect(cardById('t-b').querySelector('textarea')).toBeTruthy();

    act(() => sessionUpdateListener?.(createBoard({ settings: settingsOf({ revealBrainstorm: false }), _rev: 9 } as Partial<RetroSession>)));

    await waitFor(() => expect(cardById('t-b').querySelector('textarea')).toBeNull());
    expect(document.body.innerHTML).not.toContain('Slow rollbacks');
  });

  it('never asks the assistant for a title from hidden cards', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    global.fetch = vi.fn((url: string) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('suggest-group-title') ? { title: 'Leak' } : { enabled: String(url).includes('/api/ai-status') }),
      });
    }) as unknown as typeof fetch;
    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }), alice);
    await screen.findByText('Flaky deploys');
    await waitFor(() => expect(calls.some((u) => u.includes('/api/ai-status'))).toBe(true));

    // Two of her own cards: hers to read, but the title would be everyone's.
    await tabTo(user, /Pick up the ticket Flaky deploys/);
    await user.keyboard('{Enter}');
    await user.click(await waitFor(() => button(/group the selected ticket with Too many meetings/)));
    await waitFor(async () => expect((await lastPersisted())?.groups).toHaveLength(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));

    expect(calls.some((u) => u.includes('suggest-group-title'))).toBe(false);
  });

  it('closes the assistant’s suggestions when the cards are hidden', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(
        String(url).includes('/api/ai/suggest-groups')
          ? { groups: [{ title: 'Delivery', ticketIds: ['t-a', 't-b'] }] }
          : { enabled: String(url).includes('/api/ai-status') },
      ),
    })) as unknown as typeof fetch;
    renderBoard();
    await user.click(await screen.findByRole('button', { name: /Suggest groups with AI/ }));
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy();

    act(() => sessionUpdateListener?.(createBoard({ settings: settingsOf({ revealBrainstorm: false }), _rev: 9 } as Partial<RetroSession>)));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull());
  });

  it('puts a held card down when the facilitator hides it', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard(), alice);
    await screen.findByText('Slow rollbacks');

    await tabTo(user, /Pick up the ticket Slow rollbacks/);
    await user.keyboard('{Enter}');
    await waitFor(() => button(/group the selected ticket with Flaky deploys/));

    act(() => sessionUpdateListener?.(createBoard({ settings: settingsOf({ revealBrainstorm: false }) })));

    await waitFor(() => expect(screen.queryByRole('button', { name: /group the selected ticket/ })).toBeNull());
  });

  it('does not offer the assistant’s groups while the cards are hidden', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: true }) }),
    ) as unknown as typeof fetch;
    const { unmount } = renderBoard();
    expect(await screen.findByRole('button', { name: /Suggest groups with AI/ })).toBeTruthy();
    unmount();

    renderBoard(createBoard({ settings: settingsOf({ revealBrainstorm: false }) }));
    // The facilitator reads none of these cards: each says it is hidden.
    expect(await screen.findAllByText('Hidden card')).toHaveLength(3);
    // Once the assistant's status has answered (it said enabled above).
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('button', { name: /Suggest groups with AI/ })).toBeNull();
  });

  it('writes each setting of the dialog', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);

    await user.click(settings.getByRole('checkbox', { name: 'Hide cards' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.revealBrainstorm).toBe(false));
    await user.click(settings.getByRole('checkbox', { name: 'Disable voting' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.votingDisabled).toBe(true));
    await user.click(settings.getByRole('checkbox', { name: 'Hide vote count' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.voteCountHidden).toBe(true));
    await user.click(settings.getByRole('checkbox', { name: 'One vote per card or group' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.oneVotePerTicket).toBe(true));
    // Each setting explains itself.
    expect(settings.getByRole('checkbox', { name: 'Hide cards' }).getAttribute('aria-describedby')).toBeTruthy();

    await user.click(settings.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Board settings' })).toBeNull();
  });

  it('labels the dialog’s number and colour like its other settings, and shows the keyboard on the number', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);

    const votesLabel = settings.getByText('Votes per person', { selector: 'label' });
    const colourLabel = settings.getByText('Color by:', { selector: 'label' });
    for (const label of [votesLabel, colourLabel]) {
      expect(label.className).toContain('text-sm font-medium text-slate-800');
    }
    // A label like the toggles', which a click reaches the field through.
    await user.click(votesLabel);
    const field = settings.getByRole('textbox', { name: 'Votes per person' });
    expect(document.activeElement).toBe(field);
    // The field draws no outline of its own: its stepper does (2.4.7).
    expect(field.parentElement!.className).toContain('focus-within:ring-2');
  });

  it('closes the settings on Escape, writing nothing', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    await openSettings(user);
    const before = await persistedCount();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Board settings' })).toBeNull();
    expect(await persistedCount()).toBe(before);
  });

  it('closes the settings when the board turns guided, here or in another tab', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    await openSettings(user);

    act(() => sessionUpdateListener?.(createBoard({ phase: 'BRAINSTORM', _rev: 9 } as Partial<RetroSession>)));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Board settings' })).toBeNull());
  });

  it('closes only the show-authors question on Escape, leaving the settings open and nothing written', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ isAnonymous: true }) }));
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    await user.click(settings.getByRole('checkbox', { name: 'Anonymous' }));
    await screen.findByRole('dialog', { name: 'Show who wrote each card?' });
    const before = await persistedCount();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Show who wrote each card?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Board settings' })).toBeTruthy();
    expect(await persistedCount()).toBe(before);
  });

  it('closes the show-authors confirmation with the board, and offers no confirm while reconnecting', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ isAnonymous: true }) }));
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    await user.click(settings.getByRole('checkbox', { name: 'Anonymous' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Show who wrote each card?' }));

    // Reconnecting: a click would close it as if done while the write is dropped.
    act(() => connectionListener?.(false));
    expect((confirm.getByRole('button', { name: 'Show the authors' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => connectionListener?.(true));
    expect((confirm.getByRole('button', { name: 'Show the authors' }) as HTMLButtonElement).disabled).toBe(false);

    // Another facilitator tab turns the board into a guided retro: confirmed
    // there, it would name the authors of the guided retro.
    act(() => sessionUpdateListener?.(createBoard({ phase: 'VOTE', settings: settingsOf({ isAnonymous: true }), _rev: 9 } as Partial<RetroSession>)));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Show who wrote each card?' })).toBeNull());
  });

  it('shows only the totals while voting is off, and says why', async () => {
    renderBoard(createBoard({ settings: settingsOf({ votingDisabled: true }) }), alice);
    await screen.findByText('Flaky deploys');

    expect(screen.queryByRole('button', { name: /add a vote/ })).toBeNull();
    expect(screen.queryByText(/votes remaining/)).toBeNull();
    expect(screen.getByText('Voting is off')).toBeTruthy();
    expect(within(cardElement('Slow rollbacks')).getByTestId('vote-total').textContent).toContain('2');
  });

  it('hides the totals and their ranking while the vote count is hidden', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ voteCountHidden: true }) }), alice);
    await screen.findByText('Flaky deploys');

    // Each card is still voted on, with nothing that counts what it has.
    expect(screen.getAllByRole('button', { name: 'Add a vote to this ticket' })).toHaveLength(3);
    expect(within(cardElement('Slow rollbacks')).queryByText('2')).toBeNull();
    // Her own vote is still hers to see.
    expect(within(cardElement('Slow rollbacks')).getByText('You gave it 1 vote')).toBeTruthy();
    // "Most voted first" would rank them anyway.
    const sort = screen.getByRole('combobox', { name: 'Sort the cards' }) as HTMLSelectElement;
    expect((within(sort).getByRole('option', { name: 'Most voted first' }) as HTMLOptionElement).disabled).toBe(true);
    await user.selectOptions(sort, 'Oldest first');
    expect(columnTexts('todo')).toEqual(['Flaky deploys', 'Slow rollbacks', 'Too many meetings']);
  });

  it('lets one vote per card be taken back, and no second one be added', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ oneVotePerTicket: true }) }), alice);
    await screen.findByText('Flaky deploys');

    const add = within(cardElement('Slow rollbacks')).getByRole('button', { name: '2 votes, add a vote to this ticket' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    const before = await persistedCount();
    await user.click(add);
    expect(await persistedCount()).toBe(before);
    await user.click(within(cardElement('Slow rollbacks')).getByRole('button', { name: 'Take back one of your votes on this ticket' }));
    await waitFor(async () => {
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-b')?.votes).toEqual(['fac']);
    });
  });

  it('keeps the keyboard on the vote button as votes are given and taken back', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ settings: settingsOf({ oneVotePerTicket: true }) }), alice);
    await screen.findByText('Flaky deploys');

    // The vote that uses up one vote per card leaves its button focusable,
    // never disabled under the focus, which would send it to the page.
    const add = within(cardElement('Too many meetings')).getByRole('button', { name: '0 votes, add a vote to this ticket' });
    add.focus();
    await user.keyboard('{Enter}');
    const voted = await within(cardElement('Too many meetings')).findByRole('button', { name: '1 vote, add a vote to this ticket' });
    expect(document.activeElement).toBe(voted);
    expect((voted as HTMLButtonElement).disabled).toBe(false);
    expect(voted.getAttribute('aria-disabled')).toBe('true');

    // Taking back the last vote removes the cross: the focus goes to the vote
    // button first.
    within(cardElement('Too many meetings')).getByRole('button', { name: 'Take back one of your votes on this ticket' }).focus();
    await user.keyboard('{Enter}');
    const again = await within(cardElement('Too many meetings')).findByRole('button', { name: '0 votes, add a vote to this ticket' });
    expect(document.activeElement).toBe(again);
  });

  it('never runs out of votes while they are unlimited, and caps them once they are not', async () => {
    const user = userEvent.setup();
    const busy = createBoard({
      settings: settingsOf({ maxVotes: 1, unlimitedVotes: true }),
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'bob'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: ['fac', 'fac'] },
      ],
    });
    renderBoard(busy);
    await screen.findByText('Flaky deploys');

    // Three votes cast with a maximum of one, and still one more to give.
    expect(screen.queryByText(/votes remaining/)).toBeNull();
    expect(within(cardElement('Flaky deploys')).getByRole('button', { name: /add a vote/ }).getAttribute('aria-disabled')).toBe('false');

    const settings = await openSettings(user);
    // The number can be set first: it caps nothing until unlimited is off.
    expect((settings.getByRole('textbox', { name: 'Votes per person' }) as HTMLInputElement).disabled).toBe(false);
    await user.click(settings.getByRole('checkbox', { name: 'Unlimited votes' }));

    await waitFor(async () => {
      const persisted = await lastPersisted();
      expect(persisted?.settings.unlimitedVotes).toBe(false);
      // The facilitator keeps one vote, the first card's taken back first.
      expect(persisted?.tickets.find((t) => t.id === 't-a')?.votes).toEqual(['bob']);
      expect(persisted?.tickets.find((t) => t.id === 't-b')?.votes).toEqual(['fac']);
    });
  });

  it('offers unlimited votes in the guided Vote phase too', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ phase: 'VOTE', settings: settingsOf({ unlimitedVotes: true }) }));
    await screen.findByText('Flaky deploys');

    expect(screen.queryByText(/votes remaining/)).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Max votes per person' }) as HTMLInputElement).disabled).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: 'Unlimited votes' }));
    await waitFor(async () => expect((await lastPersisted())?.settings.unlimitedVotes).toBe(false));
  });

  it('lets the number be set before unlimited votes are turned off, so only the votes above it go', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      settings: settingsOf({ maxVotes: 1, unlimitedVotes: true }),
      tickets: [{ id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['bob', 'bob'] }],
    }));
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);

    await user.click(settings.getByRole('button', { name: 'Increase max votes' }));
    // Still unlimited: the number takes nothing back yet.
    await waitFor(async () => expect((await lastPersisted())?.settings.maxVotes).toBe(2));
    expect((await lastPersisted())?.tickets[0].votes).toEqual(['bob', 'bob']);
    await user.click(settings.getByRole('checkbox', { name: 'Unlimited votes' }));

    await waitFor(async () => expect((await lastPersisted())?.settings.unlimitedVotes).toBe(false));
    expect((await lastPersisted())?.tickets[0].votes).toEqual(['bob', 'bob']);
  });

  it('takes no vote back while a number is typed, and applies it on Enter', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [{ id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['bob', 'bob'] }],
    }));
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    const field = settings.getByRole('textbox', { name: 'Votes per person' });
    const before = await persistedCount();

    await user.clear(field);
    await user.type(field, '10');
    // Typed, not applied: on its way to 10 the field read 1, which took
    // Bob's second vote back for good.
    expect(await persistedCount()).toBe(before);
    await user.keyboard('{Enter}');

    await waitFor(async () => expect((await lastPersisted())?.settings.maxVotes).toBe(10));
    expect((await lastPersisted())?.tickets[0].votes).toEqual(['bob', 'bob']);
  });

  it('applies a typed number when the field is left, and puts back one that is not a number', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    const field = settings.getByRole('textbox', { name: 'Votes per person' }) as HTMLInputElement;

    await user.clear(field);
    await user.type(field, '3');
    await user.tab();
    await waitFor(async () => expect((await lastPersisted())?.settings.maxVotes).toBe(3));

    const before = await persistedCount();
    await user.clear(field);
    await user.tab();
    expect(field.value).toBe('3');
    expect(await persistedCount()).toBe(before);
  });

  it('turns every setting off while the session reconnects, the colour and the number included', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);

    act(() => connectionListener?.(false));

    expect((settings.getByRole('combobox', { name: 'Color cards by' }) as HTMLSelectElement).disabled).toBe(true);
    expect((settings.getByRole('textbox', { name: 'Votes per person' }) as HTMLInputElement).disabled).toBe(true);
    for (const toggle of settings.getAllByRole('checkbox')) expect((toggle as HTMLInputElement).disabled).toBe(true);
  });

  it('turns the Vote phase’s vote settings off while the session reconnects', async () => {
    renderBoard(createBoard({ phase: 'VOTE' }));
    await screen.findByText('Flaky deploys');

    act(() => connectionListener?.(false));

    expect((screen.getByRole('checkbox', { name: '1 vote/item' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Unlimited votes' }) as HTMLInputElement).disabled).toBe(true);
  });
});
