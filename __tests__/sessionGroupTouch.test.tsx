import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
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
    { id: 'loose', colId: 'col-1', text: 'Loose card', authorId: 'facilitator-1', groupId: null, votes: [] },
    { id: 'inside', colId: 'col-1', text: 'Grouped card', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
  ],
  groups: [{ id: 'g1', title: 'Deploys', colId: 'col-1', votes: [] }],
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

const renderGroupPhase = (overrides: Partial<RetroSession> = {}) => {
  const session = createSession(overrides);
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

  // Review finding (pass 4 of 42.1): a tap the board acts on lays the board
  // out again under the finger, and the browser then sends the mouse events it
  // emulates for a tap — a mousedown, a click — to whatever control came
  // there. In Chromium a grouping tap on the open board deleted a card with no
  // confirmation, and took the focus from the new group's title. A tap that
  // was acted on cancels them; a scroll, or a tap on a control, keeps them.
  it('cancels the browser’s emulated click for a tap it acted on, and only for that one', async () => {
    const user = userEvent.setup();
    renderGroupPhase();
    await screen.findByText('Loose card');

    // Picking a card up by touch, then dropping it on a group by touch.
    const loose = screen.getByText('Loose card').closest('div.group') as HTMLElement;
    fireEvent.touchStart(loose, touch(50, 50));
    expect(fireEvent.touchEnd(loose, touch(50, 50))).toBe(false);
    await waitFor(() => screen.getByRole('button', { name: /Selected for grouping: Loose card/ }));
    const container = groupContainer();
    fireEvent.touchStart(container, touch(50, 50));
    expect(fireEvent.touchEnd(container, touch(50, 50))).toBe(false);
    await waitFor(async () => expect(await persistedGroupOf('loose')).toBe('g1'));

    // A scroll is the browser's, and so is a tap on a control.
    await holdLooseCard(user);
    fireEvent.touchStart(groupContainer(), touch(50, 200));
    fireEvent.touchMove(groupContainer(), touch(52, 60));
    expect(fireEvent.touchEnd(groupContainer(), touch(52, 60))).toBe(true);
    const control = screen.getAllByRole('button', { name: /Selected for grouping|Pick up the ticket/ })[0];
    fireEvent.touchStart(control, touch(50, 50));
    expect(fireEvent.touchEnd(control, touch(50, 50))).toBe(true);
  });
});

/**
 * Review finding (pass 5 of 42.1): a tap the board acts on cancels the mouse
 * events a browser emulates for it (above), and the mousedown it cancels did
 * more than lead to a click: it took the focus out of the field being typed,
 * and closed the reaction picker. Without it an open card editor stayed open
 * through the taps, and lost what was typed when one broke up its card's
 * group; a group title stayed "being typed", and a teammate's rename was sent
 * back; the phone's keyboard stayed over the board; the picker stayed open
 * over the next card to tap.
 */
describe('a tap the board acts on, and the field it leaves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  const renderBoard = () => renderGroupPhase({
    phase: 'OPEN_BOARD',
    tickets: [
      { id: 'ta', colId: 'col-1', text: 'Flaky deploys', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
      { id: 'tb', colId: 'col-1', text: 'Slow rollbacks', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
      { id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: [] },
      { id: 'td', colId: 'col-1', text: 'Late release notes', authorId: 'facilitator-1', groupId: null, votes: [] },
    ],
    groups: [{ id: 'g1', title: 'Delivery', colId: 'col-1', votes: [], anchorTicketId: 'ta' }],
  });

  const card = (id: string) => {
    const element = document.querySelector(`[data-ticket-id="${id}"]`);
    if (!element) throw new Error(`no card ${id}`);
    return element as HTMLElement;
  };
  const tap = (element: HTMLElement) => {
    fireEvent.touchStart(element, touch(50, 50));
    return fireEvent.touchEnd(element, touch(50, 50));
  };
  const writes = async () => {
    const { dataService } = await import('../services/dataService');
    return (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, s]) => s as RetroSession);
  };
  const held = (id: string) => within(card(id)).getByRole('button', { name: /Selected for grouping/ });

  it('takes the focus out of the field being typed, as the mousedown it cancels did', async () => {
    const user = userEvent.setup();
    renderBoard();
    const idea = await screen.findByPlaceholderText('Add an idea...');
    await user.click(idea);
    await user.keyboard('A draft');
    expect(document.activeElement).toBe(idea);

    expect(tap(card('td'))).toBe(false);

    expect(document.activeElement).not.toBe(idea);
    expect(held('td')).toBeTruthy();
    // Nothing is written for a hold, and the draft stays in its field.
    expect((idea as HTMLTextAreaElement).value).toBe('A draft');
  });

  it('stores what an open card editor holds before the tap breaks up its group', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    await user.click(within(card('ta')).getByRole('button', { name: 'Edit ticket' }));
    await user.type(within(card('ta')).getByRole('textbox'), ' in staging');

    // Hold its partner: a hold writes nothing, so the text goes alone, now.
    tap(card('tb'));
    expect((await writes()).at(-1)?.tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
    // Then drop it on a loose card: the group dissolves.
    tap(card('tc'));

    await waitFor(async () => {
      const last = (await writes()).at(-1)!;
      expect(last.tickets.find((t) => t.id === 'tb')?.groupId).toBe(last.tickets.find((t) => t.id === 'tc')?.groupId);
    });
    const last = (await writes()).at(-1)!;
    expect(last.tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
    // The editor is closed: what it held is stored, not waiting.
    expect(within(card('ta')).queryByRole('textbox')).toBeNull();
  });

  it('sends the field it leaves with its own write: one gesture, one write', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    // A card held first, then an editor opened on another one.
    tap(card('td'));
    held('td');
    await user.click(within(card('ta')).getByRole('button', { name: 'Edit ticket' }));
    await user.type(within(card('ta')).getByRole('textbox'), ' in staging');
    const before = (await writes()).length;

    tap(card('tc'));

    // Two writes from one revision: the server keeps the first and refuses
    // the second, and either the drop or the text was lost.
    const after = (await writes()).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
    expect(after[0].tickets.find((t) => t.id === 'td')?.groupId).toBeTruthy();
    expect(after[0].tickets.find((t) => t.id === 'td')?.groupId).toBe(after[0].tickets.find((t) => t.id === 'tc')?.groupId);
  });

  it('closes the reaction picker, as the mousedown it cancels did', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Flaky deploys');
    await user.click(within(card('ta')).getByRole('button', { name: 'Add reaction' }));
    expect(screen.getAllByTestId('emoji-option').length).toBeGreaterThan(0);

    tap(card('tc'));

    expect(screen.queryAllByTestId('emoji-option')).toHaveLength(0);
    expect(held('tc')).toBeTruthy();
  });

  // Review finding (pass 5 of 42.1): no test held the pick-up of a group by
  // touch to the rule above.
  it.each([
    ['on the open board, with nothing held', 'OPEN_BOARD' as const],
    ['in Brainstorm', 'BRAINSTORM' as const],
  ])('cancels the emulated click of a tap that picks a group up %s', async (_where, phase) => {
    renderGroupPhase({ phase });
    await screen.findByText('Grouped card');

    expect(fireEvent.touchStart(groupContainer(), touch(50, 50))).toBe(true);
    expect(fireEvent.touchEnd(groupContainer(), touch(50, 50))).toBe(false);
    await waitFor(() => expect(groupContainer().querySelector('button[aria-pressed="true"]')).toBeTruthy());
  });
});
