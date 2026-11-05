import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // Every tap lands at one point unless told otherwise: what matters there
  // is which element it reaches.
  const tap = (element: HTMLElement, x = 50, y = 50) => {
    fireEvent.touchStart(element, touch(x, y));
    return fireEvent.touchEnd(element, touch(x, y));
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
    const before = (await writes()).length;

    // Hold its partner: a hold writes nothing, so the text goes alone, now —
    // never held for a later write. Review finding (pass 7 of 42.1): held, it
    // rode whatever write came next, the ones every client sends from the
    // same revision included, and was lost with it.
    tap(card('tb'));
    expect((await writes()).slice(before)).toHaveLength(1);
    expect((await writes()).at(-1)?.tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
    expect(held('tb')).toBeTruthy();
    // Then drop it on a loose card, further down: the group dissolves.
    tap(card('tc'), 50, 200);

    await waitFor(async () => {
      const last = (await writes()).at(-1)!;
      expect(last.tickets.find((t) => t.id === 'tb')?.groupId).toBe(last.tickets.find((t) => t.id === 'tc')?.groupId);
    });
    const last = (await writes()).at(-1)!;
    expect(last.tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
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

  // Review finding (pass 12 of 42.1): a double tap whose first tap closed an
  // editor. The card grew back under the finger, and the next tap acted on
  // what came there: it grouped that card with the one the first tap picked
  // up, for everyone, or opened its comments.
  describe('the next tap of a double tap, once the first closed an editor', () => {
    const editTyped = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(within(card('tc')).getByRole('button', { name: 'Edit ticket' }));
      await user.type(within(card('tc')).getByRole('textbox'), ' on Mondays');
    };
    const groupOfTc = async () => (await writes()).at(-1)?.tickets.find((t) => t.id === 'tc')?.groupId ?? null;

    it('does nothing on another card', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const before = (await writes()).length;

      expect(tap(card('td'))).toBe(false);
      expect(held('td')).toBeTruthy();
      expect(tap(card('tc'))).toBe(false);

      // The text, stored as the first tap left its editor, and nothing else.
      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets.find((t) => t.id === 'tc')?.text).toBe('Too many meetings on Mondays');
      expect(await groupOfTc()).toBeNull();
      expect(held('td')).toBeTruthy();
      // Further from the first, the tap is the board's.
      tap(card('tc'), 50, 200);
      await waitFor(async () => expect(await groupOfTc()).toBeTruthy());
    });

    it('is a tap again on the card the first reached', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      tap(card('td'));
      expect(held('td')).toBeTruthy();
      tap(card('td'));

      expect(within(card('td')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
    });

    it('is the board’s once the double tap’s time is over', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        tap(card('td'));
        clock.mockReturnValue(now + 501);
        tap(card('tc'));
      } finally {
        clock.mockRestore();
      }

      await waitFor(async () => expect(await groupOfTc()).toBeTruthy());
    });

    it('presses no control with the mouse a browser emulates for it', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      tap(card('td'));
      const comments = within(card('tc')).getByTestId('ticket-comment-btn');
      // A tap on a control is the control's: the board does not claim it.
      expect(tap(comments)).toBe(true);
      expect(fireEvent.mouseDown(comments, { detail: 2, clientX: 50, clientY: 50 })).toBe(false);
      fireEvent.mouseUp(comments, { detail: 2 });
      expect(fireEvent.click(comments, { detail: 2 })).toBe(false);

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(held('td')).toBeTruthy();
    });

    it('does nothing on a card once the first, on a group’s title, closed the editor', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const title = screen.getByDisplayValue('Delivery');

      // Not the board's: the browser emulates the mouse for it.
      expect(tap(title)).toBe(true);
      fireEvent.mouseDown(title, { detail: 1, clientX: 50, clientY: 50 });
      act(() => title.focus());
      fireEvent.mouseUp(title, { detail: 1 });
      fireEvent.click(title, { detail: 1 });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(within(card('tc')).queryByRole('textbox')).toBeNull();

      expect(tap(card('tc'))).toBe(false);

      expect(within(card('tc')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
      expect(document.activeElement).toBe(title);
    });
  });

  // Review finding (pass 6 of 42.1): every case above taps a card. The group
  // container claims its taps through the same helper, and put back to a bare
  // preventDefault it kept every test green while an open editor lost its
  // text to the drop that broke its card's group up.
  describe('on a group container', () => {
    const renderTwoGroups = (phase: RetroSession['phase'] = 'OPEN_BOARD') => renderGroupPhase({
      phase,
      tickets: [
        { id: 'ta', colId: 'col-1', text: 'Flaky deploys', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
        { id: 'tb', colId: 'col-1', text: 'Slow rollbacks', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
        { id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: 'g2', votes: [] },
        { id: 'td', colId: 'col-1', text: 'Standups', authorId: 'facilitator-1', groupId: 'g2', votes: [] },
        { id: 'te', colId: 'col-1', text: 'Loose card', authorId: 'facilitator-1', groupId: null, votes: [] },
      ],
      groups: [
        { id: 'g1', title: 'Delivery', colId: 'col-1', votes: [], anchorTicketId: 'ta' },
        { id: 'g2', title: 'Meetings', colId: 'col-1', votes: [], anchorTicketId: 'tc' },
      ],
    });
    const containerOf = (ticketId: string) => card(ticketId).closest('.group-container') as HTMLElement;
    const editTyped = async (user: ReturnType<typeof userEvent.setup>, id: string, typed: string) => {
      await user.click(within(card(id)).getByRole('button', { name: 'Edit ticket' }));
      const field = within(card(id)).getByRole('textbox');
      await user.type(field, typed);
      return field;
    };

    it('stores an open editor\u2019s text with the drop into the group, in one write', async () => {
      const user = userEvent.setup();
      renderTwoGroups();
      await screen.findByText('Flaky deploys');
      tap(card('tb'));
      held('tb');
      const field = await editTyped(user, 'ta', ' in staging');
      const before = (await writes()).length;

      expect(tap(containerOf('tc'))).toBe(false);

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets.find((t) => t.id === 'tb')?.groupId).toBe('g2');
      expect(after[0].tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
      expect(document.activeElement).not.toBe(field);
      expect(within(card('ta')).queryByRole('textbox')).toBeNull();
    });

    it.each([
      ['on the open board, with nothing held', 'OPEN_BOARD' as const],
      ['in Brainstorm', 'BRAINSTORM' as const],
    ])('takes the focus out of an open editor and stores its text as it picks a group up %s', async (_where, phase) => {
      const user = userEvent.setup();
      renderTwoGroups(phase);
      await screen.findByText('Loose card');
      const field = await editTyped(user, 'te', ' again');

      expect(tap(containerOf('tc'))).toBe(false);

      expect(document.activeElement).not.toBe(field);
      await waitFor(async () => expect((await writes()).at(-1)?.tickets.find((t) => t.id === 'te')?.text).toBe('Loose card again'));
    });

    it('closes the reaction picker', async () => {
      const user = userEvent.setup();
      renderTwoGroups();
      await screen.findByText('Loose card');
      await user.click(within(card('te')).getByRole('button', { name: 'Add reaction' }));
      expect(screen.getAllByTestId('emoji-option').length).toBeGreaterThan(0);

      tap(containerOf('tc'));

      expect(screen.queryAllByTestId('emoji-option')).toHaveLength(0);
    });
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

// Review finding (pass 6 of 42.1, the critic): a click on a control is not a
// tap the board claims, so the browser's own mousedown takes the focus out of
// an open card editor. Its text went out at once and the click's write came
// a moment later from the same revision: the server refused it, and the move
// or the phase change was undone with nothing said. Held for the click's own
// write, the gesture is one write.
describe('a click on a control right after typing in a card\u2019s editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  const writes = async () => {
    const { dataService } = await import('../services/dataService');
    return (dataService.updateSession as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, s]) => s as RetroSession);
  };
  const card = (id: string) => document.querySelector(`[data-ticket-id="${id}"]`) as HTMLElement;
  const editTyped = async (user: ReturnType<typeof userEvent.setup>, id: string, typed: string) => {
    await user.click(within(card(id)).getByRole('button', { name: 'Edit ticket' }));
    await user.type(within(card(id)).getByRole('textbox'), typed);
  };

  it('moves a held card with the text in one write', async () => {
    const user = userEvent.setup();
    renderGroupPhase({
      phase: 'OPEN_BOARD',
      columns: [
        { id: 'col-1', title: 'What Went Well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' },
        { id: 'col-2', title: 'To Improve', color: 'bg-rose-500', border: 'border-rose-500', icon: 'sentiment_dissatisfied', text: 'text-rose-700', ring: 'ring-rose-300' },
      ],
    });
    await screen.findByText('Loose card');
    fireEvent.touchStart(card('loose'), touch(50, 50));
    fireEvent.touchEnd(card('loose'), touch(50, 50));
    await screen.findByRole('button', { name: /Selected for grouping: Loose card/ });
    await editTyped(user, 'inside', ' again');
    const before = (await writes()).length;

    await user.click(screen.getByRole('button', { name: /Move selected card here: out of its group, into To Improve/ }));

    const after = (await writes()).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].tickets.find((t) => t.id === 'loose')?.colId).toBe('col-2');
    expect(after[0].tickets.find((t) => t.id === 'inside')?.text).toBe('Grouped card again');
  });

  it('opens the next phase with the text in one write', async () => {
    const user = userEvent.setup();
    renderGroupPhase({ phase: 'BRAINSTORM' });
    await screen.findByText('Loose card');
    await editTyped(user, 'loose', ' again');
    const before = (await writes()).length;

    await user.click(screen.getByRole('button', { name: 'Next Phase' }));

    const after = (await writes()).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].phase).toBe('GROUP');
    expect(after[0].tickets.find((t) => t.id === 'loose')?.text).toBe('Loose card again');
  });

  it('leaves the session with the text in its last save', async () => {
    const user = userEvent.setup();
    // Left for real: the session goes from the page, and nothing it waited
    // for is written after.
    const session = createSession({ phase: 'BRAINSTORM' });
    let leave = () => {};
    const rendered = render(
      <Session team={createTeam(session)} sessionId={session.id} currentUser={facilitator} onExit={() => leave()} />
    );
    leave = () => rendered.unmount();
    await screen.findByText('Loose card');
    await editTyped(user, 'loose', ' again');

    await user.click(screen.getByRole('button', { name: /Leave/ }));

    // The save and the live session alike, before the session is left:
    // written after, it would reach a room this screen is no longer in.
    expect((await writes()).at(-1)?.tickets.find((t) => t.id === 'loose')?.text).toBe('Loose card again');
    const { syncService } = await import('../services/syncService');
    const update = syncService.updateSession as unknown as ReturnType<typeof vi.fn>;
    const leaveOrder = (syncService.leaveSession as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder.at(-1)!;
    const carrying = update.mock.calls
      .map(([s], i) => ({ s: s as RetroSession, order: update.mock.invocationCallOrder[i] }))
      .filter(({ s }) => s.tickets.find((t) => t.id === 'loose')?.text === 'Loose card again');
    expect(carrying.length).toBeGreaterThan(0);
    expect(carrying[0].order).toBeLessThan(leaveOrder);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(update.mock.invocationCallOrder.every((order) => order < leaveOrder)).toBe(true);
  });

  it('writes nothing once the session is gone from the page during the press', async () => {
    const user = userEvent.setup();
    const { unmount } = renderGroupPhase({ phase: 'BRAINSTORM' });
    await screen.findByText('Loose card');
    await editTyped(user, 'loose', ' again');
    const { syncService } = await import('../services/syncService');
    const update = syncService.updateSession as unknown as ReturnType<typeof vi.fn>;
    const before = update.mock.calls.length;

    // A click that takes the session off the page and writes nothing (a
    // sign-out): the press's end, after its release, comes too late.
    document.body.addEventListener('click', () => unmount(), { once: true });
    await user.click(screen.getByText('What Went Well'));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(update.mock.calls.length).toBe(before);
  });

  it('opens the editor of the card whose pencil leaves the other one', async () => {
    const user = userEvent.setup();
    renderGroupPhase({ phase: 'BRAINSTORM' });
    await screen.findByText('Loose card');
    await editTyped(user, 'loose', ' again');

    await user.click(within(card('inside')).getByRole('button', { name: 'Edit ticket' }));

    expect(within(card('inside')).getByRole('textbox')).toBe(document.activeElement);
    expect((await writes()).at(-1)?.tickets.find((t) => t.id === 'loose')?.text).toBe('Loose card again');

    // The editor that press left is no longer "left": opened again, it
    // takes the focus.
    await user.keyboard('{Enter}');
    await user.click(within(card('loose')).getByRole('button', { name: 'Edit ticket' }));
    expect(within(card('loose')).getByRole('textbox')).toBe(document.activeElement);
  });

  it('writes the text at once on Enter, which no click follows', async () => {
    const user = userEvent.setup();
    renderGroupPhase({ phase: 'BRAINSTORM' });
    await screen.findByText('Loose card');
    await editTyped(user, 'loose', ' again');
    const before = (await writes()).length;

    await user.keyboard('{Enter}');

    const after = (await writes()).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].tickets.find((t) => t.id === 'loose')?.text).toBe('Loose card again');
  });
});
