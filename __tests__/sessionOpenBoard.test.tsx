import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
let memberJoinedListener: ((member: { userId: string; userName: string }) => void) | null = null;

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
    onMemberJoined: vi.fn((listener: (member: { userId: string; userName: string }) => void) => {
      memberJoinedListener = listener;
      return () => {};
    }),
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

// A drag leaves a clone of the card on the page until the next frame
// (Session.tsx → setOpaqueDragImage), and a test starting within that frame
// found two cards by their text ("Found multiple elements"): every test waits
// it out (review finding, pass 2 of 42.1).
afterEach(() => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))));

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

  // Review finding (pass 2 of 42.1): a group's title field that went away while
  // it had the focus — out of a search, or with the cards hidden — never ran
  // its blur. Its group stayed "being typed" here for good: this screen kept
  // its own title over every later rename, and its next write of any kind sent
  // that title back to everyone. And the field took the focus again the next
  // time it appeared.
  describe('a group title being typed', () => {
    const titleField = () => document.querySelector<HTMLInputElement>('input[placeholder="Name this group..."]');
    const voteOnMeetings = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(within(cardElement('Too many meetings')).getByRole('button', { name: /add a vote/ }));
    };

    // Review finding (pass 3 of 42.1): kept only while its field had the
    // focus, the group left the view at the first blur — the press of a click
    // on its own vote button, or the Tab to its next control — and took that
    // control with it: nothing was voted, and the focus fell to the page.
    it('stays in view while it is typed out of a search, and until the search changes', async () => {
      const user = userEvent.setup();
      renderBoard(groupedBoard(), alice);
      await screen.findByDisplayValue('Delivery');
      const search = screen.getByRole('searchbox', { name: 'Search the cards' });
      await user.type(search, 'delivery');
      expect(screen.getByText('1 result')).toBeTruthy();

      const field = screen.getByDisplayValue('Delivery') as HTMLInputElement;
      await user.click(field);
      field.select();
      await user.keyboard('Infra');

      // Every keystroke landed in the field, which kept the focus.
      expect(titleField()?.value).toBe('Infra');
      expect(document.activeElement).toBe(titleField());
      expect((await lastPersisted())?.groups[0].title).toBe('Infra');

      // The keyboard goes on to the group's next control, and a click on its
      // vote button votes.
      await user.tab();
      const group = titleField()!.closest('.group-container') as HTMLElement;
      expect(group.contains(document.activeElement)).toBe(true);
      expect(screen.getByText('0 results')).toBeTruthy();
      await user.click(within(group).getByRole('button', { name: /add a vote to this group/ }));
      expect((await lastPersisted())?.groups[0].votes).toEqual(['bob', 'alice']);

      // Another search finds what it finds.
      await user.clear(search);
      await user.type(search, 'meetings');
      expect(screen.getByText('1 result')).toBeTruthy();
      expect(titleField()).toBeNull();
    });

    // Review finding (pass 3 of 42.1): a title field React removes runs no
    // blur, so its group stayed "being typed" — and in view whatever any later
    // search found — once its field went with a move or a change of phase.
    it.each([
      ['moved whole to another column', 'OPEN_BOARD'],
      ['shown again on the board after the Group phase', 'GROUP'],
    ])('keeps no group in a later search once its typed title was %s', async (_how, startPhase) => {
      const user = userEvent.setup();
      renderBoard(groupedBoard({ phase: startPhase, _rev: 5 }), alice);
      await user.click(await screen.findByDisplayValue('Delivery'));
      expect(document.activeElement).toBe(titleField());

      const next = groupedBoard({ _rev: 6 });
      if (startPhase === 'OPEN_BOARD') {
        next.groups = next.groups.map((g) => ({ ...g, colId: 'doing' }));
        next.tickets = next.tickets.map((t) => (t.groupId === 'g1' ? { ...t, colId: 'doing' } : t));
      }
      act(() => sessionUpdateListener?.(next));
      await waitFor(() => expect(document.activeElement).not.toBe(titleField()));

      await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'meetings');
      expect(screen.getByText('1 result')).toBeTruthy();
      expect(titleField()).toBeNull();
    });

    // Review finding (pass 4 of 42.1): only the group last focused was kept,
    // so a group renamed out of the search left as soon as another group's
    // title was focused, the search unchanged; and the rule kept a group
    // whose title was only focused, not typed, which the docs did not say.
    it('keeps every group whose title was focused during the search, whoever made it stop matching', async () => {
      const user = userEvent.setup();
      const twoGroups = (rev: number, titles: [string, string] = ['Delivery', 'Delivery speed']) => groupedBoard({
        _rev: rev,
        tickets: [
          ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
          ticket('t-b', 'Slow rollbacks', { authorId: 'bob', groupId: 'g1' }),
          ticket('t-c', 'Too many meetings', { groupId: 'g2' }),
          ticket('t-d', 'No focus time', { authorId: 'bob', groupId: 'g2' }),
        ],
        groups: [
          { id: 'g1', title: titles[0], colId: 'todo', votes: [], anchorTicketId: 't-a' },
          { id: 'g2', title: titles[1], colId: 'todo', votes: [], anchorTicketId: 't-c' },
        ],
      });
      renderBoard(twoGroups(5), alice);
      await screen.findByDisplayValue('Delivery');
      const search = screen.getByRole('searchbox', { name: 'Search the cards' });
      await user.type(search, 'delivery');
      expect(screen.getByText('2 results')).toBeTruthy();

      // Alice renames the first out of the search, then only clicks into the
      // second's title: Bob renames that one.
      const first = screen.getByDisplayValue('Delivery') as HTMLInputElement;
      await user.click(first);
      first.select();
      await user.keyboard('Infra');
      await user.click(screen.getByDisplayValue('Delivery speed'));
      await user.tab();
      act(() => sessionUpdateListener?.(twoGroups(6, ['Infra', 'Focus time'])));

      expect(await screen.findByText('0 results')).toBeTruthy();
      expect(screen.getByDisplayValue('Infra')).toBeTruthy();
      expect(screen.getByDisplayValue('Focus time')).toBeTruthy();

      // Another search finds what it finds.
      await user.type(search, 'x');
      expect(document.querySelector('.group-container')).toBeNull();
    });

    it('keeps no group focused in the Group phase in a board search left on through it', async () => {
      const user = userEvent.setup();
      renderBoard(groupedBoard({ _rev: 5 }), alice);
      await screen.findByDisplayValue('Delivery');
      await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'meetings');
      expect(titleField()).toBeNull();

      // The facilitator turns the board into a guided retro, where Alice
      // clicks into the title, and back into a board: the search is still on.
      act(() => sessionUpdateListener?.(groupedBoard({ _rev: 6, phase: 'GROUP' })));
      await user.click(await screen.findByDisplayValue('Delivery'));
      await user.tab();
      act(() => sessionUpdateListener?.(groupedBoard({ _rev: 7 })));

      await waitFor(() => expect((screen.getByRole('searchbox', { name: 'Search the cards' }) as HTMLInputElement).value).toBe('meetings'));
      expect(screen.getByText('1 result')).toBeTruthy();
      expect(titleField()).toBeNull();
    });

    it('lets a group renamed out of a search go once its cards are hidden', async () => {
      const user = userEvent.setup();
      renderBoard(groupedBoard({ _rev: 5 }), alice);
      await screen.findByDisplayValue('Delivery');
      await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'delivery');
      const field = titleField()!;
      await user.click(field);
      field.select();
      await user.keyboard('Infra');

      // Delivery holds Bob's card: hidden, it is no longer Alice's to read.
      const hidden = groupedBoard({ _rev: 6, settings: { ...createBoard().settings, revealBrainstorm: false } });
      hidden.groups = hidden.groups.map((g) => ({ ...g, title: 'Infra' }));
      act(() => sessionUpdateListener?.(hidden));

      await waitFor(() => expect(document.querySelector('.group-container')).toBeNull());
      expect(screen.getByText('0 results')).toBeTruthy();
    });

    it('takes a later rename once its field went away with the cards hidden', async () => {
      const user = userEvent.setup();
      renderBoard(groupedBoard({ _rev: 5 }), alice);
      await user.click(await screen.findByDisplayValue('Delivery'));

      // The facilitator hides the cards: Delivery holds Bob's card, so Alice
      // reads its title and no longer types it.
      act(() => sessionUpdateListener?.(groupedBoard({ _rev: 6, settings: { ...createBoard().settings, revealBrainstorm: false } })));
      await waitFor(() => expect(titleField()).toBeNull());

      // Shown again, renamed meanwhile by Bob.
      const renamed = groupedBoard({ _rev: 7 });
      renamed.groups = renamed.groups.map((g) => ({ ...g, title: 'Release train' }));
      act(() => sessionUpdateListener?.(renamed));
      await waitFor(() => expect(titleField()?.value).toBe('Release train'));

      await voteOnMeetings(user);
      expect((await lastPersisted())?.groups[0].title).toBe('Release train');
    });

    // Review finding (pass 5 of 42.1): a title was "being typed" from the
    // moment it had the focus. A new group's title takes it to be named, and
    // a name a teammate gave it meanwhile was kept off this screen — and in
    // the state its next write of any kind sent to everyone, erasing it.
    it('takes a teammate\u2019s name for a title it only focused, and keeps one it types', async () => {
      const user = userEvent.setup();
      const named = (rev: number, title: string) => {
        const session = groupedBoard({ _rev: rev });
        session.groups = session.groups.map((g) => ({ ...g, title }));
        return session;
      };
      renderBoard(named(5, ''), alice);
      await screen.findByText('Flaky deploys');
      await user.click(titleField()!);

      act(() => sessionUpdateListener?.(named(6, 'Calendar')));
      await waitFor(() => expect(titleField()?.value).toBe('Calendar'));
      expect(document.activeElement).toBe(titleField());
      await voteOnMeetings(user);
      expect((await lastPersisted())?.groups[0].title).toBe('Calendar');

      // Typed, it is the typist's until the field is left.
      await user.click(titleField()!);
      await user.keyboard(' team');
      act(() => sessionUpdateListener?.(named(8, 'Meetings')));
      expect(titleField()?.value).toBe('Calendar team');
    });

    // Review finding (pass 5 of 42.1): the same for a card's editor, which
    // kept the card's old text from the moment it opened, and wrote it back
    // as it was left, typed in or not.
    it('takes a teammate\u2019s edit of a card whose editor it only opened, and keeps one it types', async () => {
      const user = userEvent.setup();
      const worded = (rev: number, text: string) => {
        const session = groupedBoard({ _rev: rev });
        session.tickets = session.tickets.map((t) => (t.id === 't-c' ? { ...t, text } : t));
        return session;
      };
      renderBoard(worded(5, 'Too many meetings'), alice);
      await screen.findByText('Too many meetings');
      await user.click(within(cardElement('Too many meetings')).getByRole('button', { name: 'Edit ticket' }));
      const before = await persistedCount();

      act(() => sessionUpdateListener?.(worded(6, 'Too many meetings on Tuesdays')));
      await user.keyboard('{Enter}');
      expect(await persistedCount()).toBe(before);
      await user.click(within(cardElement('Too many meetings on Tuesdays')).getByRole('button', { name: /add a vote/ }));
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Tuesdays');

      // Typed, it is the typist's.
      await user.click(within(cardElement('Too many meetings on Tuesdays')).getByRole('button', { name: 'Edit ticket' }));
      await user.type(within(cardElement('Too many meetings on Tuesdays')).getByRole('textbox'), '!');
      act(() => sessionUpdateListener?.(worded(8, 'Meetings')));
      await user.keyboard('{Enter}');
      expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Tuesdays!');
    });

    // Review findings (pass 6 of 42.1): the card editor is a field React
    // fills once, as it mounts, and its draft lives in the field alone.
    describe('the card editor', () => {
      const editor = () => document.querySelector<HTMLTextAreaElement>('[data-ticket-id] textarea');
      const worded = (rev: number, text: string, overrides: Partial<RetroSession> = {}) => {
        const session = groupedBoard({ _rev: rev, ...overrides });
        session.tickets = session.tickets.map((t) => (t.id === 't-c' ? { ...t, text } : t));
        return session;
      };
      const openEditor = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
        await user.click(within(cardElement(text)).getByRole('button', { name: 'Edit ticket' }));
        expect(document.activeElement).toBe(editor());
      };

      // An editor only opened took the teammate's edit out of a search: the
      // card left the view, the focus fell to the page, and when the card
      // came back its editor took the focus from the search box and wrote
      // what was typed there into the card.
      it('stays in view, with the focus, when a teammate\u2019s edit takes its card out of a search', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'meetings');
        await openEditor(user, 'Too many meetings');

        act(() => sessionUpdateListener?.(worded(6, 'Too many standups')));

        expect(document.activeElement).toBe(editor());
        // Nothing typed yet: the field shows the teammate's words.
        expect(editor()?.value).toBe('Too many standups');
      });

      // Review finding (pass 7 of 42.1): kept only while its editor was open,
      // the card went as it was left — the Tab to its Delete, the press of
      // its own vote — and took that control with it.
      it('stays in view once left, until the search changes, with the control the keyboard goes to', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        const searchbox = screen.getByRole('searchbox', { name: 'Search the cards' });
        await user.type(searchbox, 'meetings');
        await openEditor(user, 'Too many meetings');
        act(() => sessionUpdateListener?.(worded(6, 'Too many standups')));

        await user.tab();

        expect(screen.getByText('Too many standups')).toBeTruthy();
        const card = cardElement('Too many standups');
        expect(card.contains(document.activeElement)).toBe(true);
        await user.click(within(card).getByRole('button', { name: /add a vote/ }));
        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.votes).toEqual(['alice', 'alice']);

        // A new search finds what it finds.
        await user.type(searchbox, 's');
        expect(screen.queryByText('Too many standups')).toBeNull();
      });

      it('keeps no card its reader can no longer read in a search\u2019s view', async () => {
        const user = userEvent.setup();
        const board = (rev: number, reveal: boolean) => {
          const next = createBoard({ _rev: rev });
          return { ...next, settings: { ...next.settings, revealBrainstorm: reveal } };
        };
        renderBoard(board(5, true), facilitator);
        await screen.findByText('Slow rollbacks');
        await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'slow');
        await openEditor(user, 'Slow rollbacks');
        await user.keyboard('{Enter}');

        act(() => sessionUpdateListener?.(board(6, false)));

        expect(document.querySelector('[data-ticket-id="t-b"]')).toBeNull();
      });

      it('keeps in view the group a search found only through the card being edited', async () => {
        const user = userEvent.setup();
        renderBoard(groupedBoard({ _rev: 5 }), alice);
        await screen.findByText('Flaky deploys');
        await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'flaky');
        await openEditor(user, 'Flaky deploys');

        const reworded = groupedBoard({ _rev: 6 });
        reworded.tickets = reworded.tickets.map((t) => (t.id === 't-a' ? { ...t, text: 'Deploys that fail' } : t));
        act(() => sessionUpdateListener?.(reworded));

        expect(document.activeElement).toBe(editor());
        expect(screen.getByText('Slow rollbacks')).toBeTruthy();
      });

      // Review findings (pass 8 of 42.1): only the editor still open pinned
      // the group, and only a board's editor is kept by a search.
      it('keeps that group in view once the editor is left, with the control the keyboard goes to', async () => {
        const user = userEvent.setup();
        renderBoard(groupedBoard({ _rev: 5 }), alice);
        await screen.findByText('Flaky deploys');
        await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'flaky');
        await openEditor(user, 'Flaky deploys');
        const reworded = groupedBoard({ _rev: 6 });
        reworded.tickets = reworded.tickets.map((t) => (t.id === 't-a' ? { ...t, text: 'Deploys that fail' } : t));
        act(() => sessionUpdateListener?.(reworded));

        await user.tab();

        expect(screen.getByText('Deploys that fail')).toBeTruthy();
        expect(groupElement('Delivery').contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(document.body);
      });

      it('keeps no card edited in a guided phase in a board search left on through it', async () => {
        const user = userEvent.setup();
        renderBoard(createBoard({ _rev: 5 }), alice);
        await screen.findByText('Flaky deploys');
        await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'meetings');
        expect(screen.queryByText('Flaky deploys')).toBeNull();

        // The board turned into a guided Brainstorm, where Alice opens and
        // leaves the editor of a card the search does not find, and back.
        act(() => sessionUpdateListener?.(createBoard({ _rev: 6, phase: 'BRAINSTORM' })));
        await user.click(within(await waitFor(() => cardElement('Flaky deploys'))).getByRole('button', { name: 'Edit ticket' }));
        await user.keyboard('{Enter}');
        act(() => sessionUpdateListener?.(createBoard({ _rev: 7 })));

        await waitFor(() => expect((screen.getByRole('searchbox', { name: 'Search the cards' }) as HTMLInputElement).value).toBe('meetings'));
        expect(screen.getByText('1 result')).toBeTruthy();
        expect(screen.queryByText('Flaky deploys')).toBeNull();
      });

      it('takes a teammate\u2019s edit into the field until something is typed, then keeps the typing', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');

        act(() => sessionUpdateListener?.(worded(6, 'Too many meetings on Tuesdays')));
        expect(editor()?.value).toBe('Too many meetings on Tuesdays');
        await user.keyboard('{End}!');
        act(() => sessionUpdateListener?.(worded(7, 'Meetings')));
        expect(editor()?.value).toBe('Too many meetings on Tuesdays!');

        await user.keyboard('{Enter}');
        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Tuesdays!');
      });

      // Typed in, then put back as it was opened: nothing was written as it
      // was left, and the old text kept in this screen's state went out with
      // its next write, over the teammate's edit.
      it('sends nothing old back once its typing was undone', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.keyboard('{End}x{Backspace}');
        const before = await persistedCount();

        act(() => sessionUpdateListener?.(worded(6, 'Too many meetings on Tuesdays')));
        await user.keyboard('{Enter}');

        expect(await persistedCount()).toBe(before);
        expect(screen.getByText('Too many meetings on Tuesdays')).toBeTruthy();
        await user.click(within(screen.getByDisplayValue('Delivery').closest('.group-container') as HTMLElement).getByRole('button', { name: /add a vote to this group/ }));
        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Tuesdays');
      });

      // Bob put the card in a group while it was typed: the card moved, React
      // drew its editor again from the stored text, and the typing was gone.
      it.each([
        ['put in a group', (session: RetroSession) => {
          session.tickets = session.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        }],
        ['moved with its group to another column', (session: RetroSession) => {
          session.tickets = session.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t.groupId === 'g1' ? { ...t, colId: 'doing' } : t));
          session.groups = session.groups.map((g) => ({ ...g, colId: 'doing' }));
        }],
      ])('keeps what was typed when another person\u2019s write draws its card again: %s', async (_how, change) => {
        const user = userEvent.setup();
        const start = worded(5, 'Too many meetings');
        if (_how.startsWith('moved')) start.tickets = start.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        renderBoard(start, alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.keyboard('{End} on Mondays');

        const next = worded(6, 'Too many meetings');
        if (_how.startsWith('moved')) next.tickets = next.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        change(next);
        act(() => sessionUpdateListener?.(next));

        expect(editor()?.value).toBe('Too many meetings on Mondays');
        expect(document.activeElement).toBe(editor());
        await user.keyboard('!{Enter}');
        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays!');
      });

      // Review findings (pass 7 of 42.1): the text an editor leaves for a
      // press of the mouse rides that press's click, or goes alone as the
      // press ends — never later, and never with a write nobody asked for.
      describe('left for a press of the mouse', () => {
        const search = () => screen.getByRole('searchbox', { name: 'Search the cards' });

        it('writes the text as the press ends, not a moment later, and draws the editor until then', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: search() });
          // Pressed: the editor is still drawn, so the release and the click
          // land on what was pressed.
          expect(editor()).not.toBeNull();
          expect(await persistedCount()).toBe(before);
          await user.pointer({ keys: '[/MouseLeft]', target: search() });

          expect(await persistedCount()).toBe(before + 1);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          expect(editor()).toBeNull();
        });

        it('lets no write nobody asked for take the text: a teammate joining during the press', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: search() });
          act(() => memberJoinedListener?.({ userId: 'carol', userName: 'Carol Dupont' }));
          const joined = (await persistedCount()) - before;
          expect(joined).toBe(1);
          // Every client writes the join from the same revision, and all but
          // one lose: the text must not be in the one that may lose.
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings');
          await user.pointer({ keys: '[/MouseLeft]', target: search() });

          expect(await persistedCount()).toBe(before + 2);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
        });

        it('drops the text, and shows the stored one, when the session drops before the press ends', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: search() });
          act(() => connectionListener?.(false));
          await user.pointer({ keys: '[/MouseLeft]', target: search() });

          expect(await persistedCount()).toBe(before);
          expect(editor()).toBeNull();
          expect(screen.getByText('Too many meetings')).toBeTruthy();
          expect(screen.queryByText('Too many meetings on Mondays')).toBeNull();
          act(() => connectionListener?.(true));
          await user.click(within(screen.getByDisplayValue('Delivery').closest('.group-container') as HTMLElement).getByRole('button', { name: /add a vote to this group/ }));
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings');
        });

        it('casts the vote on its own card with the text, in one write', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.click(within(cardElement('Too many meetings')).getByRole('button', { name: /add a vote/ }));

          expect(await persistedCount()).toBe(before + 1);
          const written = (await lastPersisted())!.tickets.find((t) => t.id === 't-c')!;
          expect(written.text).toBe('Too many meetings on Mondays');
          expect(written.votes).toEqual(['alice', 'alice']);
        });

        // Review finding (pass 8 of 42.1): Chromium sends no mouseup after a
        // drag, and the dragend goes to the element dragged — which the drop
        // removed when it moved its card, so nothing on the window heard it.
        // The press went on for 10 s: the editor stayed drawn, typing in it
        // was dropped when it closed, and an editor left by the keyboard
        // meanwhile wrote nothing.
        const dropAway = (from: HTMLElement, to: HTMLElement) => {
          const transfer = dataTransfer();
          fireEvent.dragStart(from, { dataTransfer: transfer });
          fireEvent.dragOver(to, { dataTransfer: transfer });
          fireEvent.drop(to, { dataTransfer: transfer });
          expect(from.isConnected).toBe(false);
          // The drop that takes the text closes the editor, before the drag
          // has ended.
          expect(editor()).toBeNull();
          fireEvent.dragEnd(from, { dataTransfer: transfer });
        };

        it('ends with the drag of another card, when the drop removed that card\u2019s element', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          // Bob's card leaves its group for the other column.
          await user.pointer({ keys: '[MouseLeft>]', target: cardById('t-b') });
          dropAway(cardById('t-b'), columnElement('doing'));

          expect(await persistedCount()).toBe(before + 1);
          const written = (await lastPersisted())!;
          expect(written.tickets.find((t) => t.id === 't-b')?.colId).toBe('doing');
          expect(written.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          expect(editor()).toBeNull();

          // Nothing is read as a press any more: an editor the keyboard
          // opens and leaves writes as it is left.
          within(cardElement('Too many meetings on Mondays')).getByRole('button', { name: 'Edit ticket' }).focus();
          await user.keyboard('{Enter}');
          await user.keyboard('{End}!');
          await user.tab();
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays!');
          expect(editor()).toBeNull();
        });

        it('leaves the focus to the new group\u2019s title when a card dropped on its own card groups them', async () => {
          const user = userEvent.setup();
          renderBoard(createBoard({ _rev: 5 }), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');

          await user.pointer({ keys: '[MouseLeft>]', target: cardById('t-a') });
          dropAway(cardById('t-a'), cardById('t-c'));

          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          expect(editor()).toBeNull();
          // Drawn again in the group with the focus, the editor took it from
          // the title the new group is named in, and what was typed there
          // was dropped when the press ran out.
          const title = document.activeElement as HTMLInputElement;
          expect(title.getAttribute('data-group-title-id')).toBeTruthy();
          await user.keyboard('Planning');
          expect((await lastPersisted())?.groups[0]?.title).toContain('Planning');
        });

        it('ends with the drag of a card another person\u2019s write moved meanwhile, dropped nowhere', async () => {
          const user = userEvent.setup();
          renderBoard(createBoard({ _rev: 5 }), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: cardById('t-a') });
          const dragged = cardById('t-a');
          const transfer = dataTransfer();
          fireEvent.dragStart(dragged, { dataTransfer: transfer });
          const moved = createBoard({ _rev: 6 });
          moved.tickets = moved.tickets.map((t) => (t.id === 't-a' ? { ...t, colId: 'doing' } : t));
          act(() => sessionUpdateListener?.(moved));
          expect(dragged.isConnected).toBe(false);
          fireEvent.dragEnd(dragged, { dataTransfer: transfer });

          await waitFor(() => expect(editor()).toBeNull());
          expect(await persistedCount()).toBe(before + 1);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
        });

        it('lets no write after a drop that wrote nothing take the text: a teammate joining before the drag ends', async () => {
          const user = userEvent.setup();
          renderBoard(createBoard({ _rev: 5 }), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          // Released over itself: put down, nothing written.
          await user.pointer({ keys: '[MouseLeft>]', target: cardById('t-a') });
          const transfer = dataTransfer();
          fireEvent.dragStart(cardById('t-a'), { dataTransfer: transfer });
          fireEvent.drop(cardById('t-a'), { dataTransfer: transfer });
          expect(await persistedCount()).toBe(before);
          act(() => memberJoinedListener?.({ userId: 'carol', userName: 'Carol Dupont' }));
          expect(await persistedCount()).toBe(before + 1);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings');
          fireEvent.dragEnd(cardById('t-a'), { dataTransfer: transfer });

          await waitFor(() => expect(editor()).toBeNull());
          expect(await persistedCount()).toBe(before + 2);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
        });

        it('writes at once what a blur of the keyboard leaves during a press', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          // Pressed on its own field, which keeps the focus; then Tab.
          await user.pointer({ keys: '[MouseLeft>]', target: editor()! });
          await user.tab();

          expect(await persistedCount()).toBe(before + 1);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          expect(editor()).toBeNull();
          await user.pointer({ keys: '[/MouseLeft]' });
        });

        it('writes the text once when its card leaves the screen during the press', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: search() });
          act(() => sessionUpdateListener?.(worded(6, 'Too many meetings', { phase: 'ICEBREAKER' })));
          await waitFor(() => expect(editor()).toBeNull());
          expect(await persistedCount()).toBe(before);
          // Released over what the pointer is on now: the field pressed went
          // with the board.
          await user.pointer({ keys: '[/MouseLeft]', target: document.body });

          await waitFor(async () => expect(await persistedCount()).toBe(before + 1));
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(await persistedCount()).toBe(before + 1);
        });

        // A press whose release never came (the browser lost it) ends at the
        // next press, which would otherwise leave its text waiting 10 s.
        it('ends a press whose release was lost at the next press', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: search() });
          expect(editor()).not.toBeNull();
          fireEvent.mouseDown(document.body);

          expect(await persistedCount()).toBe(before + 1);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          await waitFor(() => expect(editor()).toBeNull());
        });

        it('lets the end one press schedules end that press only, not the next', async () => {
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          const voteOnMeetings = () => within(cardById('t-c')).getByRole('button', { name: /add a vote/ });
          const press = (target: HTMLElement) => {
            fireEvent.mouseDown(target);
            act(() => target.focus());
          };
          // A press on a pencil leaves the first editor and opens the next.
          const firstPencil = within(cardElement('Too many meetings')).getByRole('button', { name: 'Edit ticket' });
          fireEvent.click(firstPencil);
          fireEvent.input(editor()!, { target: { value: 'Too many meetings on Mondays' } });
          const pencil = within(cardElement('Flaky deploys')).getByRole('button', { name: 'Edit ticket' });
          press(pencil);
          fireEvent.mouseUp(pencil);
          fireEvent.click(pencil);
          fireEvent.input(editor()!, { target: { value: 'Flaky deploys!' } });
          const before = await persistedCount();

          // The next press comes before the end the first one scheduled.
          press(voteOnMeetings());
          expect(await persistedCount()).toBe(before + 1);
          await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
          expect(await persistedCount()).toBe(before + 1);
          fireEvent.mouseUp(voteOnMeetings());
          fireEvent.click(voteOnMeetings());

          expect(await persistedCount()).toBe(before + 2);
          const written = (await lastPersisted())!;
          expect(written.tickets.find((t) => t.id === 't-a')?.text).toBe('Flaky deploys!');
          expect(written.tickets.find((t) => t.id === 't-c')?.votes).toEqual(['alice', 'alice']);
        });

        // Review finding (pass 8 of 42.1): the press kept the card "being
        // edited", and a card being edited is not draggable — so the press
        // that took the focus out of the editor could not become a drag of
        // its card, or of its group: it selected text across the board.
        it.each(['OPEN_BOARD', 'BRAINSTORM'])('lets the press drag its card, and its group, while the editor stays drawn: %s', async (phase) => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings', { phase }), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');

          await user.pointer({ keys: '[MouseLeft>]', target: cardById('t-c') });
          expect(editor()).not.toBeNull();
          expect(cardById('t-c').getAttribute('draggable')).toBe('true');
          await user.pointer({ keys: '[/MouseLeft]', target: cardById('t-c') });
          await waitFor(() => expect(editor()).toBeNull());

          // A Brainstorm group shows its title as text, a board's in a field.
          const group = () => document.querySelector<HTMLElement>('.group-container')!;
          await openEditor(user, 'Flaky deploys');
          await user.pointer({ keys: '[MouseLeft>]', target: group() });
          expect(editor()).not.toBeNull();
          expect(group().getAttribute('draggable')).toBe('true');
          await user.pointer({ keys: '[/MouseLeft]', target: group() });
          await waitFor(() => expect(editor()).toBeNull());
        });

        // Review finding (pass 8 of 42.1): drawn again by a teammate's write
        // during the press, the editor came back with the stored text and
        // took the focus from the field pressed; at the release it closed
        // with the focus, which fell to the page.
        it('keeps the focus where it was pressed, and the typing, when another person\u2019s write draws its card again', async () => {
          const user = userEvent.setup();
          renderBoard(worded(5, 'Too many meetings'), alice);
          await screen.findByText('Too many meetings');
          await openEditor(user, 'Too many meetings');
          await user.keyboard('{End} on Mondays');
          const before = await persistedCount();

          await user.pointer({ keys: '[MouseLeft>]', target: search() });
          const grouped = worded(6, 'Too many meetings');
          grouped.tickets = grouped.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
          act(() => sessionUpdateListener?.(grouped));
          expect(document.activeElement).toBe(search());
          expect(editor()?.value).toBe('Too many meetings on Mondays');
          await user.pointer({ keys: '[/MouseLeft]', target: search() });

          await waitFor(() => expect(editor()).toBeNull());
          expect(await persistedCount()).toBe(before + 1);
          expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
          expect(document.activeElement).toBe(search());
        });

        // Review finding (pass 8 of 42.1): a label's click ended the press
        // before its box was clicked, so "Reveal cards" and the text were two
        // writes from one revision, and the server refused the reveal.
        it('rides the write of the box a label\u2019s click ticks: the words \u201cReveal cards\u201d', async () => {
          const user = userEvent.setup();
          const brainstorm = createBoard({ _rev: 5, phase: 'BRAINSTORM', settings: { ...createBoard().settings, revealBrainstorm: false } });
          brainstorm.tickets = [...brainstorm.tickets, { id: 't-f', colId: 'todo', text: 'Ship on Fridays', authorId: 'fac', groupId: null, votes: [] }];
          renderBoard(brainstorm, facilitator);
          await screen.findByText('Ship on Fridays');
          await user.click(within(cardElement('Ship on Fridays')).getByRole('button', { name: 'Edit ticket' }));
          await user.keyboard('{End} only');
          const before = await persistedCount();

          await user.click(screen.getByText('Reveal cards', { exact: true }));

          await waitFor(() => expect(editor()).toBeNull());
          expect(await persistedCount()).toBe(before + 1);
          const written = (await lastPersisted())!;
          expect(written.settings.revealBrainstorm).toBe(true);
          expect(written.tickets.find((t) => t.id === 't-f')?.text).toBe('Ship on Fridays only');
        });
      });

      it('writes nothing when a teammate deletes the card being typed', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.keyboard('{End} on Mondays');
        const before = await persistedCount();

        const deleted = worded(6, 'Too many meetings');
        deleted.tickets = deleted.tickets.filter((t) => t.id !== 't-c');
        act(() => sessionUpdateListener?.(deleted));

        await waitFor(() => expect(editor()).toBeNull());
        expect(await persistedCount()).toBe(before);
      });

      // What was typed in an editor closed under it (its card hidden from its
      // reader) is forgotten: opened again, it shows the stored text.
      it('opens on the stored text after an editor closed under its typing', async () => {
        const user = userEvent.setup();
        const shown = (rev: number, reveal: boolean) => {
          const board = createBoard({ _rev: rev });
          return { ...board, settings: { ...board.settings, revealBrainstorm: reveal } };
        };
        renderBoard(shown(5, true), facilitator);
        await screen.findByText('Slow rollbacks');
        await openEditor(user, 'Slow rollbacks');
        await user.keyboard('{End} in prod');

        act(() => sessionUpdateListener?.(shown(6, false)));
        await waitFor(() => expect(editor()).toBeNull());
        act(() => sessionUpdateListener?.(shown(7, true)));
        await openEditor(user, 'Slow rollbacks');

        expect(editor()?.value).toBe('Slow rollbacks');
      });

      // Review findings (pass 7 of 42.1): the redrawn editor put the caret at
      // the end, so a fix in the middle of the text went on after its last
      // word; and nothing pinned that it is written when left at once.
      it('keeps the caret where it was when another person\u2019s write draws its card again', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        editor()!.setSelectionRange(8, 8);
        await user.keyboard(' lon');

        const grouped = worded(6, 'Too many meetings');
        grouped.tickets = grouped.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        act(() => sessionUpdateListener?.(grouped));
        await user.keyboard('g{Enter}');

        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many long meetings');
      });

      it('writes what was typed when it is left at once after another person\u2019s write drew its card again', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.keyboard('{End} on Mondays');

        const grouped = worded(6, 'Too many meetings');
        grouped.tickets = grouped.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        act(() => sessionUpdateListener?.(grouped));
        await user.keyboard('{Enter}');

        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays');
      });

      it('keeps the caret where it was moved after the typing when its card is drawn again', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.keyboard('{End} on Mondays{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');

        const grouped = worded(6, 'Too many meetings');
        grouped.tickets = grouped.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        act(() => sessionUpdateListener?.(grouped));
        await user.keyboard(' long{Enter}');

        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings long on Mondays');
      });

      it('keeps the caret where it was put when it takes a teammate\u2019s edit', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        editor()!.setSelectionRange(8, 8);

        act(() => sessionUpdateListener?.(worded(6, 'Too many meetings on Tuesdays')));
        expect(editor()?.selectionStart).toBe(8);
        await user.keyboard(' long{Enter}');

        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many long meetings on Tuesdays');
      });

      // Review findings (pass 8 of 42.1): the caret was kept only once
      // something was typed, so a caret put mid-text and not typed at yet went
      // to the start when the card was drawn again; and only a collapsed caret
      // was pinned, though a word selected to be typed over is kept too.
      it('keeps the caret where it was put, nothing typed yet, when another person\u2019s write draws its card again', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.pointer({ target: editor()!, offset: 9, keys: '[MouseLeft]' });
        expect(editor()?.selectionStart).toBe(9);

        const grouped = worded(6, 'Too many meetings');
        grouped.tickets = grouped.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        act(() => sessionUpdateListener?.(grouped));
        expect(document.activeElement).toBe(editor());
        await user.keyboard('long {Enter}');

        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many long meetings');
      });

      it.each([
        ['nothing typed, taking a teammate\u2019s edit', false],
        ['typed in, drawn again by another person\u2019s write', true],
      ])('keeps a selection made to be typed over: %s', async (_how, typed) => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        if (typed) await user.keyboard('{End} on Mondays');
        await user.pointer([{ target: editor()!, offset: 9, keys: '[MouseLeft>]' }, { offset: 17 }, { keys: '[/MouseLeft]' }]);
        expect([editor()?.selectionStart, editor()?.selectionEnd]).toEqual([9, 17]);

        const next = worded(6, typed ? 'Too many meetings' : 'Too many meetings!');
        if (typed) next.tickets = next.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        act(() => sessionUpdateListener?.(next));
        expect([editor()?.selectionStart, editor()?.selectionEnd]).toEqual([9, 17]);
        await user.keyboard('standups{Enter}');

        expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe(typed ? 'Too many standups on Mondays' : 'Too many standups!');
      });

      it.each([
        ['typed in, drawn again', true],
        ['nothing typed, taking a teammate\u2019s edit', false],
      ])('keeps the direction of a selection: %s', async (_how, typed) => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        if (typed) await user.keyboard('{End} on Mondays');
        editor()!.setSelectionRange(9, 17, 'backward');
        fireEvent.keyUp(editor()!, { key: 'ArrowLeft' });

        const next = worded(6, typed ? 'Too many meetings' : 'Too many meetings!');
        if (typed) next.tickets = next.tickets.map((t) => (t.id === 't-c' ? { ...t, groupId: 'g1' } : t));
        act(() => sessionUpdateListener?.(next));

        expect([editor()?.selectionStart, editor()?.selectionEnd, editor()?.selectionDirection]).toEqual([9, 17, 'backward']);
      });

      // A field React removes runs no blur: an editor whose card left the
      // screen (the board turned into a guided retro) stayed "open", and came
      // back with its card, taking the focus from whatever was being typed.
      it('stores its text and closes when its card leaves the screen, and never takes the focus back', async () => {
        const user = userEvent.setup();
        renderBoard(worded(5, 'Too many meetings'), alice);
        await screen.findByText('Too many meetings');
        await openEditor(user, 'Too many meetings');
        await user.keyboard('{End} on Mondays');

        act(() => sessionUpdateListener?.(worded(6, 'Too many meetings', { phase: 'ICEBREAKER' })));

        await waitFor(async () => expect((await lastPersisted())?.tickets.find((t) => t.id === 't-c')?.text).toBe('Too many meetings on Mondays'));
        expect((await lastPersisted())?.phase).toBe('ICEBREAKER');
        act(() => sessionUpdateListener?.(worded(8, 'Too many meetings on Mondays')));
        await screen.findByText('Too many meetings on Mondays');
        expect(editor()).toBeNull();
      });
    });

    it('takes a later rename once a phase change took its field away', async () => {
      const user = userEvent.setup();
      const group = (phase: string, rev: number, title = 'Delivery') => {
        const session = groupedBoard({ phase, _rev: rev });
        session.groups = session.groups.map((g) => ({ ...g, title }));
        return session;
      };
      renderBoard(group('GROUP', 5), alice);
      await user.click(await screen.findByDisplayValue('Delivery'));

      // The facilitator opens the Vote phase, where no title is typed, and
      // comes back to Group after Bob renamed the group from another tab.
      act(() => sessionUpdateListener?.(group('VOTE', 6)));
      await waitFor(() => expect(titleField()).toBeNull());
      act(() => sessionUpdateListener?.(group('GROUP', 7, 'Release train')));

      await waitFor(() => expect(titleField()?.value).toBe('Release train'));
    });

    // Review finding (pass 6 of 42.1): a title typed in, then taken away with
    // no blur, came back "being typed": focused again and nothing typed, it
    // kept its old title over a teammate's rename and sent it back.
    it('takes a later rename once it is only focused again, after its typed field was taken away', async () => {
      const user = userEvent.setup();
      const group = (phase: string, rev: number, title: string) => {
        const session = groupedBoard({ phase, _rev: rev });
        session.groups = session.groups.map((g) => ({ ...g, title }));
        return session;
      };
      renderBoard(group('GROUP', 5, 'Delivery'), alice);
      await user.click(await screen.findByDisplayValue('Delivery'));
      await user.keyboard('{End} team');
      const typed = (await lastPersisted())!;
      expect(typed.groups[0].title).toBe('Delivery team');

      act(() => sessionUpdateListener?.({ ...group('VOTE', 6, 'Delivery team') }));
      await waitFor(() => expect(titleField()).toBeNull());
      act(() => sessionUpdateListener?.(group('GROUP', 7, 'Delivery team')));
      await user.click(await waitFor(() => titleField()!));
      act(() => sessionUpdateListener?.(group('GROUP', 8, 'Release train')));

      await waitFor(() => expect(titleField()?.value).toBe('Release train'));
    });

    // Review finding (pass 7 of 42.1): leaving the field ends its typing,
    // and nothing pinned it: typed, left, then only focused again, the title
    // kept its old text over a teammate's rename.
    it('takes a later rename once it is focused again, without typing, after its typing was left', async () => {
      const user = userEvent.setup();
      const group = (rev: number, title: string) => {
        const session = groupedBoard({ _rev: rev });
        session.groups = session.groups.map((g) => ({ ...g, title }));
        return session;
      };
      renderBoard(group(5, 'Delivery'), alice);
      const field = await screen.findByDisplayValue('Delivery') as HTMLInputElement;
      await user.click(field);
      await user.keyboard('{End} team');
      await voteOnMeetings(user);
      act(() => sessionUpdateListener?.(group(7, 'Delivery team')));

      await user.click(titleField()!);
      expect(titleField()).toBe(field);
      act(() => sessionUpdateListener?.(group(8, 'Release train')));

      expect(titleField()?.value).toBe('Release train');
      await voteOnMeetings(user);
      expect((await lastPersisted())?.groups[0].title).toBe('Release train');
    });

    // The same with the field drawn again where the group went: Bob moved it
    // to another column while its title was typed (the review's case in
    // Chromium).
    it('takes a later rename once it is only focused again, after its group moved under the typing', async () => {
      const user = userEvent.setup();
      const group = (rev: number, title: string, colId = 'todo') => {
        const session = groupedBoard({ _rev: rev });
        session.groups = session.groups.map((g) => ({ ...g, title, colId }));
        session.tickets = session.tickets.map((t) => (t.groupId === 'g1' ? { ...t, colId } : t));
        return session;
      };
      renderBoard(group(5, 'Delivery'), alice);
      await user.click(await screen.findByDisplayValue('Delivery'));
      await user.keyboard('{End} team');

      act(() => sessionUpdateListener?.(group(6, 'Delivery team', 'doing')));
      await user.click(await waitFor(() => titleField()!));
      act(() => sessionUpdateListener?.(group(7, 'Release train', 'doing')));

      await waitFor(() => expect(titleField()?.value).toBe('Release train'));
    });

    // React only moves a field whose group a re-sort moves, and gives it the
    // focus back: the same field, still being typed.
    it('keeps its typing over a teammate\u2019s rename when a re-sort moves the group under it', async () => {
      const user = userEvent.setup();
      const board = (rev: number, delivery: string, deliveryVotes: string[], calendarVotes: string[]) => createBoard({
        _rev: rev,
        tickets: [
          ticket('t-a', 'Flaky deploys', { groupId: 'g1' }),
          ticket('t-b', 'Slow rollbacks', { authorId: 'bob', groupId: 'g1' }),
          ticket('t-c', 'Too many meetings', { groupId: 'g2' }),
          ticket('t-d', 'No focus time', { authorId: 'bob', groupId: 'g2' }),
        ],
        groups: [
          { id: 'g1', title: delivery, colId: 'todo', votes: deliveryVotes, anchorTicketId: 't-a' },
          { id: 'g2', title: 'Calendar', colId: 'todo', votes: calendarVotes, anchorTicketId: 't-c' },
        ],
      });
      renderBoard(board(5, 'Delivery', ['bob', 'fac'], []), alice);
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Sort the cards' }), 'Most voted first');
      const field = screen.getByDisplayValue('Delivery') as HTMLInputElement;
      await user.click(field);
      await user.keyboard('{End} team');

      // Calendar takes the lead: Delivery moves below it, its field with it.
      act(() => sessionUpdateListener?.(board(6, 'Delivery team', ['bob', 'fac'], ['bob', 'fac', 'alice'])));
      act(() => sessionUpdateListener?.(board(7, 'Release train', ['bob', 'fac'], ['bob', 'fac', 'alice'])));

      expect([...document.querySelectorAll<HTMLInputElement>('input[data-group-title-id]')].map((i) => i.value))
        .toEqual(['Calendar', 'Delivery team']);
      expect(screen.getByDisplayValue('Delivery team')).toBe(document.activeElement);
    });

    it('never takes the focus back when the field of a group it named comes back', async () => {
      const user = userEvent.setup();
      renderBoard(createBoard({ _rev: 5 }), alice);
      await screen.findByText('Slow rollbacks');

      // A new group's title takes the focus once, to be named.
      drag(cardElement('Too many meetings'), cardElement('Slow rollbacks'));
      await waitFor(() => expect(document.activeElement).toBe(titleField()));
      const grouped = (await lastPersisted())!;
      act(() => sessionUpdateListener?.({ ...grouped, _rev: 6 }));
      act(() => sessionUpdateListener?.({ ...grouped, _rev: 7, settings: { ...grouped.settings, revealBrainstorm: false } }));
      await waitFor(() => expect(titleField()).toBeNull());

      // Alice is writing a card when the cards are shown again.
      const idea = screen.getAllByPlaceholderText('Add an idea...')[0];
      await user.click(idea);
      await user.keyboard('Retro ');
      act(() => sessionUpdateListener?.({ ...grouped, _rev: 8 }));
      await waitFor(() => expect(titleField()).not.toBeNull());
      await user.keyboard('notes');

      expect(document.activeElement).toBe(idea);
      expect((idea as HTMLTextAreaElement).value).toBe('Retro notes');
      expect(titleField()?.value).toBe('');
    });

    // Review finding (pass 3 of 42.1): only a test with the cards hidden held
    // this rule, where a second guard also held it.
    it('never takes the focus back when a phase change brings the field of a group it named back', async () => {
      const user = userEvent.setup();
      renderBoard(createBoard({ phase: 'GROUP', _rev: 5 }), alice);
      await screen.findByText('Slow rollbacks');

      drag(cardElement('Too many meetings'), cardElement('Slow rollbacks'));
      await waitFor(() => expect(document.activeElement).toBe(titleField()));
      const grouped = (await lastPersisted())!;
      act(() => sessionUpdateListener?.({ ...grouped, _rev: 6 }));
      act(() => sessionUpdateListener?.({ ...grouped, _rev: 7, phase: 'VOTE' }));
      await waitFor(() => expect(titleField()).toBeNull());

      // Alice is writing a comment when the facilitator goes back to Group.
      await user.click(within(cardElement('Flaky deploys')).getByTestId('ticket-comment-btn'));
      const comment = await screen.findByTestId('add-comment-input');
      await user.click(comment);
      await user.keyboard('Good ');
      act(() => sessionUpdateListener?.({ ...grouped, _rev: 8, phase: 'GROUP' }));
      await waitFor(() => expect(titleField()).not.toBeNull());
      await user.keyboard('point');

      expect(document.activeElement).toBe(comment);
      expect((comment as HTMLInputElement).value).toBe('Good point');
    });
  });

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

  // Review finding (pass 2 of 42.1): only the held card was pinned; the held
  // group, and the group of a held card, are the two other kinds of hold.
  it('keeps a held group, and the group of a held card, on screen while a search would hide them', async () => {
    const user = userEvent.setup();
    const { unmount } = renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');

    await user.click(within(groupElement('Delivery')).getByRole('button', { name: /Move the group Delivery/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'meetings');
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByDisplayValue('Delivery')).toBeTruthy();
    unmount();

    renderBoard(groupedBoard());
    await screen.findByText('Too many meetings');
    await tabTo(user, /Pick up the ticket Flaky deploys/);
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('searchbox', { name: 'Search the cards' }), 'meetings');
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByText('Flaky deploys')).toBeTruthy();
    expect(screen.getByDisplayValue('Delivery')).toBeTruthy();
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

  // Found while pinning that a search sends nothing: a facilitator's screen
  // sends its state half a second after it opens, and a screen left within
  // that half second sent it after the leave — here, into the next test.
  it('sends nothing for a session left before its first state went out', async () => {
    const { syncService } = await import('../services/syncService');
    const sent = () => (syncService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    // The clock is held, so the leave really comes within the half second: on
    // real time, a run slow enough to leave after the send passed without the
    // fix (review finding, pass 3 of 42.1).
    vi.useFakeTimers();
    try {
      const { unmount } = renderBoard();
      expect(screen.getByText('Flaky deploys')).toBeTruthy();
      const sentWhileOpen = sent();
      unmount();
      await vi.advanceTimersByTimeAsync(1000);
      expect(sent()).toBe(sentWhileOpen);
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds cards whatever their accents or case, and says how many', async () => {
    const user = userEvent.setup();
    // A participant's screen: a facilitator's sends its state half a second
    // after it opens, and a slow run counted that send as the search's
    // (review finding, pass 3 of 42.1).
    renderBoard(createBoard({
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Équipe pérenne', authorId: 'alice', groupId: null, votes: [] },
        { id: 't-b', colId: 'doing', text: 'Too many meetings', authorId: 'bob', groupId: null, votes: [] },
      ],
    }), alice);
    await screen.findByText('Équipe pérenne');
    const before = await persistedCount();
    const { syncService } = await import('../services/syncService');
    const sentBefore = (syncService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

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
    // The search is this reader's alone: nothing was written or sent.
    expect(await persistedCount()).toBe(before);
    expect((syncService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sentBefore);
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
    // Named by the words it shows (WCAG 2.5.3), like the number: "Color cards
    // by" did not hold "Color by".
    expect(settings.getByRole('combobox', { name: 'Color by:' })).toBeTruthy();
  });

  // Review finding (pass 3 of 42.1): the guided Brainstorm bar renders the
  // same select, and only the dialog's name was pinned.
  it('names the guided Brainstorm bar’s colour by the words it shows', async () => {
    renderBoard(createBoard({ phase: 'BRAINSTORM' }));

    expect(await screen.findByRole('combobox', { name: 'Color by:' })).toBeTruthy();
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
    // And it stays closed when the board comes back: the settings are opened
    // by the facilitator, never by a round trip.
    act(() => sessionUpdateListener?.(createBoard({ _rev: 10 } as Partial<RetroSession>)));
    await screen.findByRole('heading', { level: 2, name: 'Open board' });
    expect(screen.queryByRole('dialog', { name: 'Board settings' })).toBeNull();
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

  // Review finding (pass 2 of 42.1): the test above starts with the count
  // hidden, so the sort was never "most voted" — the fallback itself, the
  // ranking that would show the hidden totals as an order, was unpinned.
  it('stops ranking by votes when the count is hidden after a reader chose it', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard(), alice);
    await screen.findByText('Flaky deploys');
    const sort = screen.getByRole('combobox', { name: 'Sort the cards' }) as HTMLSelectElement;
    await user.selectOptions(sort, 'Most voted first');
    expect(columnTexts('todo')).toEqual(['Slow rollbacks', 'Flaky deploys', 'Too many meetings']);

    act(() => sessionUpdateListener?.(createBoard({ settings: settingsOf({ voteCountHidden: true }), _rev: 9 } as Partial<RetroSession>)));

    await waitFor(() => expect(columnTexts('todo')).toEqual(['Too many meetings', 'Slow rollbacks', 'Flaky deploys']));
    expect(sort.value).toBe('newest');
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

  // Review finding (pass 2 of 42.1): a card or group its viewer cannot read
  // offers no vote button, only the cross taking back a vote given while it
  // was shown — and taking back the last one sent the focus to the page.
  it('keeps the keyboard on a hidden card or group as one’s last vote on it is taken back', async () => {
    const user = userEvent.setup();
    const hiddenBoard = (voteCountHidden: boolean) => createBoard({
      settings: settingsOf({ revealBrainstorm: false, voteCountHidden }),
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: 'g1', votes: [] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-c', colId: 'doing', text: 'Bob’s idea', authorId: 'bob', groupId: null, votes: ['alice', 'fac'] },
      ],
      groups: [{ id: 'g1', title: 'Delivery', colId: 'todo', votes: ['alice', 'bob'] }],
    });
    const groupContainer = () => document.querySelector<HTMLElement>('.group-container')!;

    for (const voteCountHidden of [false, true]) {
      const { unmount } = renderBoard(hiddenBoard(voteCountHidden), alice);
      await screen.findByText('Flaky deploys');

      within(cardById('t-c')).getByRole('button', { name: 'Take back one of your votes on this ticket' }).focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(within(cardById('t-c')).queryByRole('button', { name: /Take back/ })).toBeNull());
      expect(document.activeElement).toBe(cardById('t-c'));

      // A group read whole: it holds Bob's hidden card, so it takes no vote
      // from Alice, and gives back the one she gave it.
      expect(within(groupContainer()).queryByRole('button', { name: /add a vote/ })).toBeNull();
      within(groupContainer()).getByRole('button', { name: 'Take back one of your votes on this group' }).focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(within(groupContainer()).queryByRole('button', { name: /Take back/ })).toBeNull());
      expect(document.activeElement).toBe(groupContainer());
      expect((await lastPersisted())?.groups[0].votes).toEqual(['bob']);
      unmount();
    }
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

  // Review finding (pass 2 of 42.1): Escape closes the dialog without leaving
  // the field, so the typed number was neither applied nor dropped. It came
  // back in the field next time, and the first Tab through applied it, taking
  // the votes above it back.
  it('drops a number abandoned with Escape, and never applies it later', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [{ id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['bob', 'bob', 'bob'] }],
    }));
    await screen.findByText('Flaky deploys');
    let settings = await openSettings(user);
    const before = await persistedCount();

    await user.clear(settings.getByRole('textbox', { name: 'Votes per person' }));
    await user.type(settings.getByRole('textbox', { name: 'Votes per person' }), '1');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Board settings' })).toBeNull();

    settings = await openSettings(user);
    const field = settings.getByRole('textbox', { name: 'Votes per person' }) as HTMLInputElement;
    expect(field.value).toBe('5');
    field.focus();
    await user.tab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(await persistedCount()).toBe(before);
  });

  // Review finding (pass 2 of 42.1): a number left by a click on another
  // control was applied by the field's blur, and the click wrote next — two
  // writes from one revision, the second refused. Next Phase or the timer's
  // start, never claimed, then snapped back. A gesture is one write.
  it('applies a number left for Next Phase in the phase change’s own write', async () => {
    const user = userEvent.setup();
    // Discuss scrolls its topic into view; jsdom has no scrollIntoView.
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    renderBoard(createBoard({ phase: 'VOTE' }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '3');
    const before = await persistedCount();

    await user.click(screen.getByRole('button', { name: /Next Phase/ }));
    // Past the wait of a number left with no write to join (Session.tsx).
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));

    expect(await persistedCount()).toBe(before + 1);
    expect((await lastPersisted())?.settings.maxVotes).toBe(3);
    expect((await lastPersisted())?.phase).toBe('DISCUSS');
  });

  it('applies a number left for one of its arrows before the arrow moves it', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ phase: 'VOTE' }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '8');

    await user.click(screen.getByRole('button', { name: 'Increase max votes' }));

    await waitFor(async () => expect((await lastPersisted())?.settings.maxVotes).toBe(9));
  });

  const sentStates = async () => {
    const { syncService } = await import('../services/syncService');
    return (syncService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls;
  };
  const votesOf = (session: RetroSession, userId: string) =>
    [...session.tickets, ...session.groups].reduce((sum, item) => sum + item.votes.filter((v) => v === userId).length, 0);

  // Review finding (pass 3 of 42.1): folded into the phase change's write, the
  // number was claimed by nobody — a phase change claims none of the settings
  // it writes — while the votes it took back from the facilitator were. A
  // participant's vote landing first healed the number back to 5 and kept the
  // facilitator's own votes cut, and the next Next Phase opened Discuss with
  // every vote the facilitator meant to take back.
  it('keeps a number left for Next Phase through a lost race, and the votes it takes back', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const voted = (rev: number, late: string[] = []) => createBoard({
      phase: 'VOTE',
      _rev: rev,
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac', 'fac', 'bob', 'bob', 'bob'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: late },
      ],
    });
    renderBoard(voted(5));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '1');
    await user.click(screen.getByRole('button', { name: /Next Phase/ }));
    expect((await lastPersisted())?.phase).toBe('DISCUSS');

    // Alice's vote reached the server first: the phase change is healed away.
    act(() => sessionUpdateListener?.(voted(6, ['alice'])));

    await waitFor(async () => expect((await sentStates()).some(([, options]) => options?.resend)).toBe(true));
    const resent = (await sentStates()).filter(([, options]) => options?.resend).at(-1)![0] as RetroSession;
    expect(resent.phase).toBe('VOTE');
    expect(resent.settings.maxVotes).toBe(1);
    expect([votesOf(resent, 'fac'), votesOf(resent, 'bob'), votesOf(resent, 'alice')]).toEqual([1, 1, 1]);
    expect((screen.getByRole('textbox', { name: 'Max votes per person' }) as HTMLInputElement).value).toBe('1');
  });

  // Review finding (pass 4 of 42.1): the second claim, of what the click
  // itself changed, compares with a copy of the state the number was folded
  // into; nothing held it, and comparing with that state itself claimed
  // nothing — a vote cast with a number left for it was healed away after a
  // lost race, with the number kept.
  it('keeps the vote cast with a number left for it through a lost race, and the number', async () => {
    const user = userEvent.setup();
    const voted = (rev: number, late: string[] = []) => createBoard({
      phase: 'VOTE',
      _rev: rev,
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac', 'fac'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: late },
      ],
    });
    renderBoard(voted(5));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '7');
    await user.click(within(cardElement('Slow rollbacks')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect((await lastPersisted())?.settings.maxVotes).toBe(7);

    // Alice's vote reached the server first.
    act(() => sessionUpdateListener?.(voted(6, ['alice'])));

    await waitFor(async () => expect((await sentStates()).some(([, options]) => options?.resend)).toBe(true));
    const resent = (await sentStates()).filter(([, options]) => options?.resend).at(-1)![0] as RetroSession;
    expect(resent.settings.maxVotes).toBe(7);
    expect(resent.tickets.find((t) => t.id === 't-b')?.votes).toEqual(['alice', 'fac']);
  });

  // Review finding (pass 3 of 42.1): left for a vote button, the number joins
  // the vote's own write — but the button was enabled under the old number,
  // and the vote went in on top of it, past the new one.
  it.each([
    ['a card', 'Add a vote to this ticket'],
    ['a group', 'Add a vote to this group'],
  ])('adds no vote on %s past a number left for its vote button', async (_kind, buttonName) => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      phase: 'VOTE',
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac', 'fac'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: [] },
        { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-d', colId: 'todo', text: 'No focus time', authorId: 'bob', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Calendar', colId: 'todo', votes: [], anchorTicketId: 't-c' }],
    }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '3');
    const target = buttonName.endsWith('group')
      ? screen.getByRole('button', { name: buttonName })
      : within(cardElement('Slow rollbacks')).getByRole('button', { name: buttonName });
    await user.click(target);

    // The button goes off as the field is left, under the new number, and the
    // number is written alone a moment later.
    await waitFor(async () => expect((await lastPersisted())?.settings.maxVotes).toBe(3));
    expect(votesOf((await lastPersisted())!, 'fac')).toBe(3);
    expect(target.getAttribute('aria-disabled')).toBe('true');
  });

  // Review finding (pass 5 of 42.1): since the button reads the number left
  // for it, the click above is refused before it reaches the vote's own
  // write, and nothing held that write to the rule any more. A click handled
  // before the field's blur is drawn reaches it: the vote's write judges the
  // vote again (mayAddVote), on the state it is built on.
  it.each([
    ['a card', 'Add a vote to this ticket'],
    ['a group', 'Add a vote to this group'],
  ])('judges a vote on %s again as it is written, under the number folded into it', async (_kind, buttonName) => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      phase: 'VOTE',
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac', 'fac'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: [] },
        { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-d', colId: 'todo', text: 'No focus time', authorId: 'bob', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Calendar', colId: 'todo', votes: [], anchorTicketId: 't-c' }],
    }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '3');
    const target = buttonName.endsWith('group')
      ? screen.getByRole('button', { name: buttonName })
      : within(cardElement('Slow rollbacks')).getByRole('button', { name: buttonName });
    const before = await persistedCount();

    act(() => {
      fireEvent.blur(field);
      fireEvent.click(target);
    });

    const written = (await lastPersisted())!;
    expect(await persistedCount()).toBe(before + 1);
    expect(written.settings.maxVotes).toBe(3);
    expect(votesOf(written, 'fac')).toBe(3);
  });

  // Review finding (pass 4 of 42.1): raised over a spent budget and left for
  // a vote button, the number only waited for that button's write — and the
  // button, off under the old number, was still off at the release: the click
  // cast nothing, and the button lit up a moment later.
  it.each([
    ['a card', 'Add a vote to this ticket'],
    ['a group', 'Add a vote to this group'],
  ])('casts the vote on %s a number raised over a spent budget was left for', async (_kind, buttonName) => {
    const user = userEvent.setup();
    const { dataService } = await import('../services/dataService');
    renderBoard(createBoard({
      phase: 'VOTE',
      settings: settingsOf({ maxVotes: 3 }),
      // Spent, and finished by the Vote phase for it already.
      finishedUsers: ['fac'],
      autoFinishedUsers: ['fac'],
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac', 'fac'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: [] },
        { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-d', colId: 'todo', text: 'No focus time', authorId: 'bob', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Calendar', colId: 'todo', votes: [], anchorTicketId: 't-c' }],
    }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    const plus = buttonName.endsWith('group')
      ? screen.getByRole('button', { name: buttonName })
      : within(cardElement('Slow rollbacks')).getByRole('button', { name: buttonName });
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    await user.clear(field);
    await user.type(field, '5');
    const before = await persistedCount();

    await user.click(plus);

    // One gesture, one write: the number and the vote together.
    const writes = (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(before).map(([, s]) => s as RetroSession);
    expect(writes[0]?.settings.maxVotes).toBe(5);
    expect(votesOf(writes[0]!, 'fac')).toBe(4);
    expect(buttonName.endsWith('group')
      ? writes[0]?.groups[0].votes
      : writes[0]?.tickets.find((t) => t.id === 't-b')?.votes).toEqual(['fac']);
  });

  // Review finding (pass 5 of 42.1): the number the vote buttons read is put
  // down with the one the writes read, in one place, and nothing held that:
  // without it, a number left and then typed back stayed on the buttons, lit
  // over a spent budget, and their click cast nothing.
  it('puts the buttons back under the stored number once a number left is dropped', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      phase: 'VOTE',
      settings: settingsOf({ maxVotes: 3 }),
      finishedUsers: ['fac'],
      autoFinishedUsers: ['fac'],
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac', 'fac'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: [] },
      ],
    }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    const plus = within(cardElement('Slow rollbacks')).getByRole('button', { name: 'Add a vote to this ticket' });
    await user.clear(field);
    await user.type(field, '5');
    await user.tab();
    expect(plus.getAttribute('aria-disabled')).toBe('false');

    // Back into the field, which drops the number left, and out again with
    // the stored one.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(field);
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    await user.clear(field);
    await user.type(field, '3');
    await user.tab();
    expect(plus.getAttribute('aria-disabled')).toBe('true');
  });

  // Review finding (pass 5 of 42.1): the guided Vote phase's buttons were
  // `disabled`, so the vote cast with the keyboard that used the last one
  // turned off the button under the focus, which fell to the page (2.4.3) —
  // and so did taking back one's last vote with the minus.
  it.each([
    ['a card', 'ticket'],
    ['a group', 'group'],
  ])('keeps the keyboard on the vote buttons of %s that turn off under it', async (_kind, kind) => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      phase: 'VOTE',
      settings: settingsOf({ maxVotes: 3 }),
      tickets: [
        { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['fac', 'fac'] },
        { id: 't-b', colId: 'todo', text: 'Slow rollbacks', authorId: 'bob', groupId: null, votes: [] },
        { id: 't-c', colId: 'todo', text: 'Too many meetings', authorId: 'bob', groupId: 'g1', votes: [] },
        { id: 't-d', colId: 'todo', text: 'No focus time', authorId: 'bob', groupId: 'g1', votes: [] },
      ],
      groups: [{ id: 'g1', title: 'Calendar', colId: 'todo', votes: [], anchorTicketId: 't-c' }],
    }));
    await screen.findByText('Slow rollbacks');
    const scope = () => (kind === 'group' ? screen.getByText('Calendar').closest('.group-container') as HTMLElement : cardElement('Slow rollbacks'));
    const plus = within(scope()).getByRole('button', { name: `Add a vote to this ${kind}` });
    plus.focus();

    await user.keyboard(' ');

    expect(votesOf((await lastPersisted())!, 'fac')).toBe(3);
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    // jsdom keeps the focus on a button turned disabled, a browser does not:
    // the attribute is what tells (review finding, pass 6 of 42.1).
    expect((plus as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(plus);
    // Pressed again, it adds nothing.
    const before = await persistedCount();
    await user.keyboard(' ');
    expect(await persistedCount()).toBe(before);

    const minus = within(scope()).getByRole('button', { name: `Remove a vote from this ${kind}` });
    minus.focus();
    await user.keyboard(' ');
    expect(votesOf((await lastPersisted())!, 'fac')).toBe(2);
    expect(minus.getAttribute('aria-disabled')).toBe('true');
    expect((minus as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(minus);
    const after = await persistedCount();
    await user.keyboard(' ');
    expect(await persistedCount()).toBe(after);
  });

  // Review finding (pass 3 of 42.1): a number left while the session dropped
  // was never written — writes are refused offline — and stayed waiting,
  // unseen: the field showed the stored number again, and the next write of
  // any kind, a teammate joining included, applied it and took the votes
  // above it back.
  // The second case comes back within the wait of a number left (400 ms): its
  // blur's own guard is what drops it there, not the timer's write refused
  // offline (review finding, pass 4 of 42.1).
  it.each([
    ['left just before the connection dropped', true, 700],
    ['still being typed when the connection dropped', false, 100],
  ])('drops a number %s', async (_when, leftFirst, offlineMs) => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [{ id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['bob', 'bob', 'bob', 'bob'] }],
    }));
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    const field = settings.getByRole('textbox', { name: 'Votes per person' }) as HTMLInputElement;
    await user.clear(field);
    await user.type(field, '2');
    if (leftFirst) await user.tab();
    act(() => connectionListener?.(false));
    // A browser takes the focus off a field as it is disabled, and runs its
    // blur; jsdom keeps the focus there, so the blur is sent as Chromium sends it.
    if (!leftFirst) fireEvent.blur(field);
    await act(() => new Promise((resolve) => setTimeout(resolve, offlineMs)));
    act(() => connectionListener?.(true));
    // Past the wait, whenever the connection came back.
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));

    expect(field.value).toBe('5');
    await user.keyboard('{Escape}');
    await user.click(within(cardElement('Flaky deploys')).getByRole('button', { name: /add a vote/ }));
    const written = (await lastPersisted())!;
    expect(written.settings.maxVotes).toBe(5);
    expect(votesOf(written, 'bob')).toBe(4);
  });

  // Review finding (pass 3 of 42.1): a number left and typed again within the
  // wait still went out as it had been left: put back to the stored number,
  // the field was overruled a moment later, and a new number being typed was
  // replaced under the cursor.
  it('forgets a number left once the field is typed in again', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({
      tickets: [{ id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: ['bob', 'bob', 'bob'] }],
    }));
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);
    const field = settings.getByRole('textbox', { name: 'Votes per person' }) as HTMLInputElement;
    const before = await persistedCount();

    await user.clear(field);
    await user.type(field, '2');
    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(field);
    await user.clear(field);
    await user.type(field, '5');
    await user.keyboard('{Enter}');
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(field.value).toBe('5');
    expect(await persistedCount()).toBe(before);

    // Typed further instead: the draft stays as typed, under the cursor.
    await user.clear(field);
    await user.type(field, '2');
    await user.tab();
    await user.tab({ shift: true });
    await user.type(field, '0');
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(field.value).toBe('20');
    expect(document.activeElement).toBe(field);
    expect(await persistedCount()).toBe(before);
  });

  // Review finding (pass 3 of 42.1): two rules of the pending number had no
  // test — a draft whose field a phase change takes away is dropped, and a
  // number left for the Back arrow is in the exit's save.
  it('drops a Vote bar draft whose field a phase change took away', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    renderBoard(createBoard({ phase: 'VOTE', _rev: 5 }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '1');
    const before = await persistedCount();

    // Another tab of the facilitator moves on, and back.
    act(() => sessionUpdateListener?.(createBoard({ phase: 'DISCUSS', _rev: 6 })));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Max votes per person' })).toBeNull());
    act(() => sessionUpdateListener?.(createBoard({ phase: 'VOTE', _rev: 7 })));

    const back = await screen.findByRole('textbox', { name: 'Max votes per person' }) as HTMLInputElement;
    expect(back.value).toBe('5');
    back.focus();
    await user.tab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(await persistedCount()).toBe(before);
  });

  it('writes a number left for the Back arrow with the exit’s save', async () => {
    const user = userEvent.setup();
    renderBoard(createBoard({ phase: 'VOTE' }));
    const field = await screen.findByRole('textbox', { name: 'Max votes per person' });
    await user.clear(field);
    await user.type(field, '3');

    await user.click(screen.getByRole('button', { name: 'Leave the retrospective' }));

    expect((await lastPersisted())?.settings.maxVotes).toBe(3);
  });

  it('turns every setting off while the session reconnects, the colour and the number included', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    const settings = await openSettings(user);

    act(() => connectionListener?.(false));

    expect((settings.getByRole('combobox', { name: 'Color by:' }) as HTMLSelectElement).disabled).toBe(true);
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
