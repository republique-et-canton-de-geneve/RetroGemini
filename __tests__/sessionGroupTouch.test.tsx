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
    // The group lies elsewhere on the board: a tap at the same place, as
    // quick, is the next of a double tap on the card (doubleGestureGuard).
    const container = groupContainer();
    fireEvent.touchStart(container, touch(50, 300));
    expect(fireEvent.touchEnd(container, touch(50, 300))).toBe(false);
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
  // A browser stamps an event from the page's load (its timeStamp), a clock
  // of its own; jsdom stamps it with Date.now(). Both are held here, from two
  // origins, so that a time read from the wrong clock is seen (pass 14 of
  // 42.1). Nothing that waits on the clock (waitFor) runs while it is held.
  const heldClock = () => {
    const start = Date.now();
    const EVENT_ORIGIN = 1000;
    let eventTime = EVENT_ORIGIN;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const stamp = vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => eventTime);
    return {
      at: (ms: number) => {
        clock.mockReturnValue(start + ms);
        eventTime = EVENT_ORIGIN + ms;
      },
      restore: () => {
        clock.mockRestore();
        stamp.mockRestore();
      },
    };
  };
  const pressOf = (element: HTMLElement, detail: number, x = 50, y = 50) => {
    const pressed = fireEvent.mouseDown(element, { detail, clientX: x, clientY: y });
    fireEvent.mouseUp(element, { detail, clientX: x, clientY: y });
    const clicked = fireEvent.click(element, { detail, clientX: x, clientY: y });
    return { pressed, clicked };
  };
  const nothingPressed = { pressed: false, clicked: false };
  const pressedAndClicked = { pressed: true, clicked: true };
  // A press whose mousedown takes the focus to the control, as a browser's
  // does: the card editor open elsewhere is left for the press, and its text
  // rides the click's write. jsdom moves no focus on a mousedown.
  const pressLeaving = (element: HTMLElement, detail: number, x = 50, y = 50) => {
    const pressed = fireEvent.mouseDown(element, { detail, clientX: x, clientY: y });
    if (pressed) act(() => element.focus());
    fireEvent.mouseUp(element, { detail, clientX: x, clientY: y });
    const clicked = fireEvent.click(element, { detail, clientX: x, clientY: y });
    return { pressed, clicked };
  };

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
    const inGroup = (id: string) => !!card(id).closest('.group-container');

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

    // Review finding (pass 13 of 42.1): the tap is the card's, whatever of
    // the card it reaches — its words, or the card around them — as a press
    // of the mouse is its control's.
    const itself = (element: HTMLElement) => element;
    const wordsOf = (element: HTMLElement) => within(element).getByText('Late release notes');
    it.each([
      ['the card itself, both times', itself, itself],
      ['its words, then the card around them', wordsOf, itself],
      ['the card, then its words', itself, wordsOf],
    ])('is a tap again on the card the first reached, whatever of it each reaches: %s', async (_how, first, second) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      tap(first(card('td')));
      expect(held('td')).toBeTruthy();
      tap(second(card('td')));

      expect(within(card('td')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
    });

    // Review finding (pass 13 of 42.1): half a second, and a fingertip, in
    // any direction. Neither was pinned but at its edge, along an axis.
    it.each([
      ['a little before half a second', 450, 50, 50],
      ['a fingertip away on the diagonal', 0, 63, 62],
    ])('is still the next tap %s', async (_when, ms, x, y) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        tap(card('td'), 50, 50);
        clock.at(ms);
        expect(tap(card('tc'), x, y)).toBe(false);
      } finally {
        clock.restore();
      }

      expect(inGroup('tc')).toBe(false);
      expect(held('td')).toBeTruthy();
    });

    // Review finding (pass 13 of 42.1): measured from the first tap only,
    // the window let the third tap of a triple tap at an ordinary pace, past
    // half a second from the first, group the card that grew back with the
    // one the first picked up, for everyone. A tap that does nothing still
    // belongs to the sequence: the next is measured from it, as a browser
    // counts its taps.
    it.each([120, 300])('does nothing on the card that grew back however many taps follow, each %i ms after the one before', async (gap) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(card('td'))).toBe(false);
        clock.at(gap);
        expect(tap(card('tc'))).toBe(false);
        clock.at(2 * gap);
        expect(tap(card('tc'))).toBe(false);
        expect(inGroup('tc')).toBe(false);
        expect(held('td')).toBeTruthy();
        // Once the sequence has paused for half a second, the tap is the
        // board's.
        clock.at(2 * gap + 501);
        tap(card('tc'));
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(2);
      expect(after[0].tickets.find((t) => t.id === 'tc')?.text).toBe('Too many meetings on Mondays');
      expect(after[0].tickets.find((t) => t.id === 'tc')?.groupId).toBeNull();
      expect(await groupOfTc()).toBeTruthy();
    });

    // Where the sequence aimed stays the first tap's: a finger that walks
    // away from it, a fingertip at a time, reaches what it means to.
    it('is the board’s again a fingertip further than the first, whatever the taps between', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        tap(card('td'), 50, 50);
        clock.at(100);
        expect(tap(card('tc'), 70, 50)).toBe(false);
        expect(inGroup('tc')).toBe(false);
        clock.at(200);
        tap(card('tc'), 90, 50);
      } finally {
        clock.restore();
      }

      await waitFor(async () => expect(await groupOfTc()).toBeTruthy());
    });

    // The rule reads no layout: a quick tap at the same place on another
    // card is the next of a double tap whatever the first did — here it
    // closed no editor and moved nothing. Half a second later it is the
    // board's.
    it('ignores the next tap on another card at the same place, though the first closed no editor', async () => {
      const user = userEvent.setup();
      renderBoard();
      const idea = await screen.findByPlaceholderText('Add an idea...');
      await user.click(idea);
      await user.keyboard('A draft');

      const clock = heldClock();
      try {
        expect(tap(card('td'))).toBe(false);
        clock.at(100);
        expect(tap(card('tc'))).toBe(false);
        expect(inGroup('tc')).toBe(false);
        expect(held('td')).toBeTruthy();
        clock.at(700);
        tap(card('tc'));
      } finally {
        clock.restore();
      }

      await waitFor(async () => expect(await groupOfTc()).toBeTruthy());
    });

    it('is the board’s once the double tap’s time is over', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const clock = heldClock();
      try {
        tap(card('td'));
        clock.at(501);
        tap(card('tc'));
      } finally {
        clock.restore();
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

    // Review finding (pass 13 of 42.1): a browser counts a tap as the next
    // of a double tap only within its own time — about 400 ms in Chromium,
    // 300 on Android — and the mouse it emulates for one tapped later says
    // it is a first (detail 1): the comments of the card that grew back
    // opened, its Delete deleted it for everyone. Within the board's half
    // second the mouse of a tap presses nothing on another control, and the
    // sequence goes on from it.
    it('presses no control with the mouse a browser emulates for it once the browser no longer counts it either', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        tap(card('td'));
        const comments = within(card('tc')).getByTestId('ticket-comment-btn');
        clock.at(450);
        expect(tap(comments)).toBe(true);
        expect(pressOf(comments, 1)).toEqual(nothingPressed);
        // Half a second after this one, not after the first.
        clock.at(900);
        expect(tap(comments)).toBe(true);
        expect(pressOf(comments, 1)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(held('td')).toBeTruthy();
    });

    // Where the sequence aimed stays the first tap's for the mouse of a tap
    // too: a fingertip further than the first, it presses its control —
    // whatever the browser counts. Review finding (pass 14 of 42.1): Chromium
    // counts each tap from the one before (20 px on a computer), so these
    // taps' mice say 2, then 3, and the browser's count alone stopped the
    // third, 40 px from the first. Firefox says 1 each time.
    it.each([
      ['as Firefox counts them, each a first', 1, 1],
      ['as Chromium counts them, from the one before', 2, 3],
    ])('lets the mouse of a tap a fingertip further than the first press its control, whatever the taps between: %s', async (_how, second, third) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        tap(card('td'), 50, 50);
        const comments = within(card('tc')).getByTestId('ticket-comment-btn');
        clock.at(300);
        expect(tap(comments, 70, 50)).toBe(true);
        expect(pressOf(comments, second, 70, 50)).toEqual(nothingPressed);
        expect(screen.queryByRole('dialog')).toBeNull();
        clock.at(600);
        expect(tap(comments, 90, 50)).toBe(true);
        expect(pressOf(comments, third, 90, 50)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(await screen.findByRole('dialog')).toBeTruthy();
    });

    // Review finding (pass 14 of 42.1): Android counts a tap as the next of
    // a double tap up to 100 dp from the one before. One tap on another
    // control, two fingertips from the first, was the next by the browser's
    // count alone, and pressed nothing.
    it('lets the mouse of one tap a fingertip further than the first press its control, though the browser counts it', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        tap(card('td'), 50, 50);
        const comments = within(card('tc')).getByTestId('ticket-comment-btn');
        clock.at(250);
        expect(tap(comments, 110, 50)).toBe(true);
        expect(pressOf(comments, 2, 110, 50)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(await screen.findByRole('dialog')).toBeTruthy();
    });

    // Review finding (pass 15 of 42.1): a browser measures the next tap from
    // the lift before it to the next touch, the board measured from lift to
    // lift: a tap held a moment lifted past the board's half second, and on
    // the card that grew back it grouped that card with the one the first
    // picked up, for everyone. The board measures as the browser does, from
    // the touch: under the finger, a tap that began within the half second
    // is the next, however long it is held — its mouse whatever the browser
    // counts (Firefox, 1; Chromium, within its own time, 2).
    const heldTap = (element: HTMLElement, clock: ReturnType<typeof heldClock>, from: number, to: number, x = 50, y = 50) => {
      clock.at(from);
      fireEvent.touchStart(element, touch(x, y));
      clock.at(to);
      return fireEvent.touchEnd(element, touch(x, y));
    };
    it.each([1, 2])('presses no control with the mouse of a tap that began within the half second and was held past it, counted %i', async (detail) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        tap(card('td'), 50, 50);
        const comments = within(card('tc')).getByTestId('ticket-comment-btn');
        expect(heldTap(comments, clock, 380, 560, 55, 50)).toBe(true);
        expect(pressOf(comments, detail, 55, 50)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(held('td')).toBeTruthy();
    });

    it('does nothing on another card with a tap that began within the half second and was held past it', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        tap(card('td'), 50, 50);
        expect(heldTap(card('tc'), clock, 380, 560)).toBe(false);
      } finally {
        clock.restore();
      }

      expect((await writes()).slice(before)).toHaveLength(1);
      expect(inGroup('tc')).toBe(false);
      expect(held('td')).toBeTruthy();
    });

    // Review finding (pass 15 of 42.1): nothing pinned the half second for
    // the mouse of a tap. Counted as the next a fingertip from the first
    // whatever its time, every later tap there pressed nothing, for good —
    // the comments of the card under the finger never opened again.
    it.each([
      ['a tap on a card', false],
      ['a tap on a group’s title', true],
    ])('lets the mouse of a tap past the half second press its control a fingertip from the first, after %s that closed the editor', async (_how, onTitle) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);

      const clock = heldClock();
      try {
        if (onTitle) {
          const title = screen.getByDisplayValue('Delivery');
          expect(tap(title)).toBe(true);
          fireEvent.mouseDown(title, { detail: 1, clientX: 50, clientY: 50 });
          act(() => title.focus());
          fireEvent.mouseUp(title, { detail: 1 });
          fireEvent.click(title, { detail: 1 });
          await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        } else {
          expect(tap(card('td'))).toBe(false);
        }
        expect(within(card('tc')).queryByRole('textbox')).toBeNull();
        clock.at(1200);
        const comments = within(card('tc')).getByTestId('ticket-comment-btn');
        expect(tap(comments, 52, 50)).toBe(true);
        expect(pressOf(comments, 1, 52, 50)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(await screen.findByRole('dialog')).toBeTruthy();
    });

    it('presses no control either once a tap on a group’s title closed the editor, with the mouse emulated for each', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const title = screen.getByDisplayValue('Delivery');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(title)).toBe(true);
        fireEvent.mouseDown(title, { detail: 1, clientX: 50, clientY: 50 });
        act(() => title.focus());
        fireEvent.mouseUp(title, { detail: 1 });
        fireEvent.click(title, { detail: 1 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(within(card('tc')).queryByRole('textbox')).toBeNull();
        clock.at(450);
        const remove = within(card('tc')).getByRole('button', { name: 'Delete ticket' });
        expect(tap(remove)).toBe(true);
        expect(pressOf(remove, 1)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(document.querySelector('[data-ticket-id="tc"]')).not.toBeNull();
      expect((await writes()).slice(before)).toHaveLength(1);
      expect(document.activeElement).toBe(title);
    });

    // The mouse itself is the mouse: what it presses is a first press unless
    // the browser counts it as the next of a double click (detail) — on a
    // screen touched a moment before too, as a laptop with a touch screen is:
    // only the mouse that follows a touch's end is a tap's.
    it.each([
      ['on a screen never touched', false],
      ['on a screen touched a second before', true],
    ])('leaves a press of the mouse the browser counts as a first to the control it presses, however soon: %s', async (_how, touchedBefore) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const title = screen.getByDisplayValue('Delivery');

      const clock = heldClock();
      try {
        if (touchedBefore) {
          const header = screen.getByRole('heading', { level: 2 });
          expect(tap(header)).toBe(true);
          clock.at(1000);
        }
        fireEvent.mouseDown(title, { detail: 1, clientX: 50, clientY: 50 });
        act(() => title.focus());
        fireEvent.mouseUp(title, { detail: 1 });
        fireEvent.click(title, { detail: 1 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(within(card('tc')).queryByRole('textbox')).toBeNull();
        clock.at(touchedBefore ? 1300 : 300);
        expect(pressOf(within(card('tc')).getByRole('button', { name: 'Delete ticket' }), 1)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(document.querySelector('[data-ticket-id="tc"]')).toBeNull();
    });

    // Review finding (pass 14 of 42.1): every double click above pressed
    // twice in the same instant. A system can be set to count a double click
    // later than half a second (Windows allows 900 ms, an accessibility
    // setting): the browser's count is the rule for the mouse, not the
    // board's half second.
    it('presses nothing on another control with the next press of a double click the browser counts late', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const title = screen.getByDisplayValue('Delivery');

      const clock = heldClock();
      try {
        fireEvent.mouseDown(title, { detail: 1, clientX: 50, clientY: 50 });
        act(() => title.focus());
        fireEvent.mouseUp(title, { detail: 1 });
        fireEvent.click(title, { detail: 1 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(within(card('tc')).queryByRole('textbox')).toBeNull();
        clock.at(700);
        expect(pressOf(within(card('tc')).getByRole('button', { name: 'Delete ticket' }), 2)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(document.querySelector('[data-ticket-id="tc"]')).not.toBeNull();
      expect(document.activeElement).toBe(title);
    });

    // Review finding (pass 16 of 42.1): nothing pinned the half second run on
    // from each tap it stops when the editor closed with its click's write,
    // the third way an editor closes. Run from the first tap alone, the third
    // tap of a triple tap at an ordinary pace deleted the card that grew back.
    it('presses no control with the taps after one whose click’s write closed the editor, at an ordinary pace', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await editTyped(user);
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        const vote = within(card('td')).getByTestId('vote-add');
        expect(tap(vote)).toBe(true);
        expect(pressLeaving(vote, 1)).toEqual(pressedAndClicked);
        expect(within(card('tc')).queryByRole('textbox')).toBeNull();
        const remove = within(card('tc')).getByRole('button', { name: 'Delete ticket' });
        clock.at(300);
        expect(tap(remove)).toBe(true);
        expect(pressOf(remove, 1)).toEqual(nothingPressed);
        clock.at(600);
        expect(tap(remove)).toBe(true);
        expect(pressOf(remove, 1)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(document.querySelector('[data-ticket-id="tc"]')).not.toBeNull();
      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets.find((t) => t.id === 'tc')?.text).toBe('Too many meetings on Mondays');
      expect(after[0].tickets.find((t) => t.id === 'td')?.votes).toContain('facilitator-1');
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

  // Review finding (pass 14 of 42.1): a Delete asks nothing, and the card
  // under the deleted one comes up into its place, its own Delete under the
  // finger or the pointer. A double tap, or a double click, deleted two cards
  // for everyone: only an editor closing marked the board as moved.
  describe('the next press or tap, once the first deleted a card or a group', () => {
    const removeOf = (id: string) => within(card(id)).getByRole('button', { name: 'Delete ticket' });
    const onBoard = (id: string) => document.querySelector(`[data-ticket-id="${id}"]`) !== null;
    const tapPress = (element: HTMLElement, detail: number) => {
      expect(tap(element)).toBe(true);
      return pressOf(element, detail);
    };

    // Taps less than half a second apart are one gesture, each counted from
    // the one before, as a browser counts them: at a steady pace on the
    // Delete that keeps coming up, the first card goes, and the next once
    // the pace pauses (the stated cost of the rule, AGENTS.md).
    it('deletes the next card only after a pause, at a steady pace', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tapPress(removeOf('td'), 1)).toEqual(pressedAndClicked);
        clock.at(450);
        expect(tapPress(removeOf('tc'), 1)).toEqual(nothingPressed);
        clock.at(900);
        expect(tapPress(removeOf('tc'), 1)).toEqual(nothingPressed);
        clock.at(1500);
        expect(tapPress(removeOf('tc'), 1)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(false);
      expect((await writes()).slice(before)).toHaveLength(2);
    });

    it.each([
      ['as Firefox counts them, each a first', 1, 1],
      ['as Chromium counts them, from the one before', 2, 3],
    ])('deletes one card with a triple tap on its Delete: %s', async (_how, second, third) => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tapPress(removeOf('td'), 1)).toEqual(pressedAndClicked);
        clock.at(120);
        expect(tapPress(removeOf('tc'), second)).toEqual(nothingPressed);
        clock.at(240);
        expect(tapPress(removeOf('tc'), third)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(true);
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    // Past the first half second, the gesture goes on for as long as its
    // taps follow each other, counted by the browser or not.
    it('presses nothing with the taps that go on a deletion, and deletes after a pause', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tapPress(removeOf('td'), 1)).toEqual(pressedAndClicked);
        clock.at(300);
        expect(tapPress(removeOf('tc'), 2)).toEqual(nothingPressed);
        clock.at(600);
        expect(tapPress(removeOf('tc'), 3)).toEqual(nothingPressed);
        expect(onBoard('tc')).toBe(true);
        clock.at(1200);
        expect(tapPress(removeOf('tc'), 1)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(false);
      expect((await writes()).slice(before)).toHaveLength(2);
    });

    it('picks up the card that came up only after a pause', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');

      const clock = heldClock();
      try {
        expect(tapPress(removeOf('td'), 1)).toEqual(pressedAndClicked);
        clock.at(450);
        expect(tap(card('tc'))).toBe(false);
        expect(within(card('tc')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
        clock.at(900);
        expect(tap(card('tc'))).toBe(false);
        expect(within(card('tc')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
        clock.at(1500);
        expect(tap(card('tc'))).toBe(false);
      } finally {
        clock.restore();
      }

      expect(held('tc')).toBeTruthy();
    });

    it.each([
      ['as Firefox counts it, a first', 1],
      ['as Chromium counts it, the next', 2],
    ])('deletes one card with a double tap on its Delete: %s', async (_how, detail) => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        const first = removeOf('td');
        expect(tap(first)).toBe(true);
        expect(pressOf(first, 1)).toEqual(pressedAndClicked);
        expect(onBoard('td')).toBe(false);
        clock.at(120);
        const next = removeOf('tc');
        expect(tap(next)).toBe(true);
        expect(pressOf(next, detail)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(true);
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    it('deletes one card with a double click on its Delete, and the next with a click of its own', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(pressOf(removeOf('td'), 1)).toEqual(pressedAndClicked);
        clock.at(120);
        expect(pressOf(removeOf('tc'), 2)).toEqual(nothingPressed);
        expect(onBoard('tc')).toBe(true);
        clock.at(1500);
        expect(pressOf(removeOf('tc'), 1)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(false);
      expect((await writes()).slice(before)).toHaveLength(2);
    });

    it('presses nothing on a card’s Delete with the next press of a double click on Delete group', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(pressOf(screen.getByRole('button', { name: 'Delete group' }), 1)).toEqual(pressedAndClicked);
        expect(document.querySelector('.group-container')).toBeNull();
        clock.at(120);
        expect(pressOf(removeOf('tc'), 2)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(true);
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    // Review finding (pass 15 of 42.1): every Delete that asks nothing moves
    // what lies under the pointer, not a card's and a group's alone. A
    // double tap on a comment's Delete deleted two comments, a double click
    // on a proposal's two proposals and the votes on them, a double tap on a
    // column's remove button two columns, their cards moved for everyone.
    it.each([
      ['as Firefox counts it, a first', 1],
      ['as Chromium counts it, the next', 2],
    ])('deletes one comment with a double tap on its Delete: %s', async (_how, detail) => {
      const user = userEvent.setup();
      const comment = (id: string, text: string) => ({ id, authorId: 'facilitator-1', authorName: 'Facilitator', text, createdAt: '2026-11-01T10:00:00.000Z' });
      renderGroupPhase({
        phase: 'OPEN_BOARD',
        tickets: [{
          id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: [],
          comments: [comment('c1', 'First remark'), comment('c2', 'Second remark'), comment('c3', 'Third remark')],
        }],
        groups: [],
      });
      await user.click(within(card('tc')).getByTestId('ticket-comment-btn'));
      const dialog = await screen.findByRole('dialog');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tapPress(within(dialog).getAllByRole('button', { name: 'Delete comment' })[0], 1)).toEqual(pressedAndClicked);
        expect(within(dialog).queryByText('First remark')).toBeNull();
        clock.at(120);
        expect(tapPress(within(dialog).getAllByRole('button', { name: 'Delete comment' })[0], detail)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(within(dialog).getByText('Second remark')).toBeTruthy();
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    it('deletes one proposal with a double click on its Delete', async () => {
      // The Discuss phase brings its topic into view; jsdom lays nothing out.
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      const proposal = (id: string, text: string) => ({ id, text, assigneeId: null, done: false, type: 'proposal' as const, linkedTicketId: 'tc', proposalVotes: {} });
      renderGroupPhase({
        phase: 'DISCUSS',
        tickets: [{ id: 'tc', colId: 'col-1', text: 'Late release notes', authorId: 'facilitator-1', groupId: null, votes: ['facilitator-1'] }],
        groups: [],
        discussionFocusId: 'tc',
        actions: [
          proposal('p1', 'Write the notes the day before'),
          proposal('p2', 'Ask support to review the notes'),
          proposal('p3', 'Publish the notes on the wiki'),
        ],
      });
      await screen.findByText('Write the notes the day before');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(pressOf(screen.getAllByRole('button', { name: 'Delete proposal' })[0], 1)).toEqual(pressedAndClicked);
        expect(screen.queryByText('Write the notes the day before')).toBeNull();
        clock.at(120);
        expect(pressOf(screen.getAllByRole('button', { name: 'Delete proposal' })[0], 2)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(screen.getByText('Ask support to review the notes')).toBeTruthy();
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    it('removes one column with a double tap on its remove button', async () => {
      const user = userEvent.setup();
      const column = (id: string, title: string) => ({ id, title, color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' });
      renderGroupPhase({
        phase: 'BRAINSTORM',
        columns: [column('start', 'Start'), column('stop', 'Stop'), column('keep', 'Keep')],
        tickets: [],
        groups: [],
      });
      await user.click(await screen.findByRole('button', { name: /Edit Layout/ }));
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tapPress(screen.getByRole('button', { name: 'Remove the Stop column' }), 1)).toEqual(pressedAndClicked);
        clock.at(150);
        expect(tapPress(screen.getByRole('button', { name: 'Remove the Keep column' }), 1)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(screen.getByRole('button', { name: 'Remove the Keep column' })).toBeTruthy();
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    // The press that deleted a card also closed an editor open on another
    // one: the rule is the same, whatever else the first press closed — and
    // the editor's text still rides its write.
    it.each([
      ['its end reached before the next', true],
      ['the next coming before its end', false],
    ])('deletes the next card only after a pause when the first also closed an editor: %s', async (_how, settles) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await user.click(within(card('ta')).getByRole('button', { name: 'Edit ticket' }));
      await user.type(within(card('ta')).getByRole('textbox'), ' in staging');
      const before = (await writes()).length;
      const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      const clock = heldClock();
      try {
        expect(tap(removeOf('td'))).toBe(true);
        expect(pressLeaving(removeOf('td'), 1)).toEqual(pressedAndClicked);
        if (settles) await settle();
        expect(within(card('ta')).queryByRole('textbox')).toBeNull();
        clock.at(450);
        expect(tap(removeOf('tc'))).toBe(true);
        expect(pressLeaving(removeOf('tc'), 1)).toEqual(nothingPressed);
        if (settles) await settle();
        clock.at(900);
        expect(tap(removeOf('tc'))).toBe(true);
        expect(pressLeaving(removeOf('tc'), 1)).toEqual(nothingPressed);
        if (settles) await settle();
        clock.at(1500);
        expect(tap(removeOf('tc'))).toBe(true);
        expect(pressLeaving(removeOf('tc'), 1)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(false);
      const after = (await writes()).slice(before);
      expect(after).toHaveLength(2);
      expect(after[0].tickets.find((t) => t.id === 'ta')?.text).toBe('Flaky deploys in staging');
    });
  });

  // Review finding (pass 16 of 42.1): a Delete is not the only control a
  // press takes off the page with its own click. The picker closes on the
  // emoji it was given, over the card's Delete; a reaction badge goes with
  // the last reaction to it, and the next badge slides into its place; an
  // editor's Cancel goes with its editor, and the row's Delete comes back
  // there; a follow-up's Accept moves it to the list below, and the next
  // follow-up comes up. The next press of a double click, or the next tap of
  // a double tap, pressed what came there, for everyone. So did the next tap
  // after one that dropped a held card: the board is laid out again under the
  // finger, and it deleted the card just dropped.
  describe('the next press or tap, once the first took its own control off the page', () => {
    const removeOf = (id: string) => within(card(id)).getByRole('button', { name: 'Delete ticket' });
    const onBoard = (id: string) => document.querySelector(`[data-ticket-id="${id}"]`) !== null;
    // A tap on a control: the browser emulates the mouse for it.
    const press = (element: HTMLElement, detail: number, touched: boolean) => {
      if (touched) expect(tap(element)).toBe(true);
      return pressOf(element, detail);
    };
    const ways: Array<[string, boolean]> = [['a double tap', true], ['a double click', false]];

    it.each(ways)('deletes nothing with %s on an emoji of the picker, over the card’s Delete', async (_how, touched) => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await user.click(within(card('tc')).getByRole('button', { name: 'Add reaction' }));
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(press(screen.getAllByTestId('emoji-option')[1], 1, touched)).toEqual(pressedAndClicked);
        expect(screen.queryAllByTestId('emoji-option')).toHaveLength(0);
        clock.at(150);
        expect(press(removeOf('tc'), 2, touched)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(true);
      expect((await writes()).slice(before)).toHaveLength(1);
    });

    it.each(ways)('gives no reaction with %s on one’s own badge, the next sliding into its place', async (_how, touched) => {
      renderGroupPhase({
        phase: 'OPEN_BOARD',
        tickets: [{
          id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: [],
          reactions: { '👍': ['facilitator-1'], '🎉': ['bob'] },
        }],
        groups: [],
      });
      await screen.findByText('Too many meetings');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(press(screen.getAllByTestId('ticket-reaction')[0], 1, touched)).toEqual(pressedAndClicked);
        expect(screen.getAllByTestId('ticket-reaction')).toHaveLength(1);
        clock.at(150);
        expect(press(screen.getAllByTestId('ticket-reaction')[0], 2, touched)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets[0].reactions).toEqual({ '🎉': ['bob'] });
    });

    it.each(ways)('deletes no proposal with %s on the Cancel of its editor', async (_how, touched) => {
      const user = userEvent.setup();
      // The Discuss phase brings its topic into view; jsdom lays nothing out.
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      const proposal = (id: string, text: string) => ({ id, text, assigneeId: null, done: false, type: 'proposal' as const, linkedTicketId: 'tc', proposalVotes: {} });
      renderGroupPhase({
        phase: 'DISCUSS',
        tickets: [{ id: 'tc', colId: 'col-1', text: 'Late release notes', authorId: 'facilitator-1', groupId: null, votes: ['facilitator-1'] }],
        groups: [],
        discussionFocusId: 'tc',
        actions: [proposal('p1', 'Write the notes the day before'), proposal('p2', 'Ask support to review the notes')],
      });
      await user.click(await screen.findByText('Write the notes the day before'));
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(press(screen.getByRole('button', { name: 'Cancel the edit' }), 1, touched)).toEqual(pressedAndClicked);
        expect(screen.queryByRole('button', { name: 'Cancel the edit' })).toBeNull();
        clock.at(150);
        expect(press(screen.getAllByRole('button', { name: 'Delete proposal' })[0], 2, touched)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(screen.getByText('Write the notes the day before')).toBeTruthy();
      expect((await writes()).slice(before)).toHaveLength(0);
    });

    // Text that becomes a field is not a control gone: the field comes where
    // the text was, and a double click on a proposal opens its editor and
    // selects a word, as it always did.
    it('leaves the next press of a double click on a proposal’s text to the field that came there', async () => {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      const proposal = (id: string, text: string) => ({ id, text, assigneeId: null, done: false, type: 'proposal' as const, linkedTicketId: 'tc', proposalVotes: {} });
      renderGroupPhase({
        phase: 'DISCUSS',
        tickets: [{ id: 'tc', colId: 'col-1', text: 'Late release notes', authorId: 'facilitator-1', groupId: null, votes: ['facilitator-1'] }],
        groups: [],
        discussionFocusId: 'tc',
        actions: [proposal('p1', 'Write the notes the day before')],
      });
      const text = await screen.findByText('Write the notes the day before');

      const clock = heldClock();
      try {
        expect(pressOf(text, 1)).toEqual(pressedAndClicked);
        const field = screen.getByDisplayValue('Write the notes the day before');
        clock.at(150);
        expect(pressOf(field, 2).pressed).toBe(true);
      } finally {
        clock.restore();
      }
    });

    it.each(ways)('deletes no comment with %s on the Cancel of its editor', async (_how, touched) => {
      const user = userEvent.setup();
      const comment = (id: string, text: string) => ({ id, authorId: 'facilitator-1', authorName: 'Facilitator', text, createdAt: '2026-11-01T10:00:00.000Z' });
      renderGroupPhase({
        phase: 'OPEN_BOARD',
        tickets: [{
          id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: [],
          comments: [comment('c1', 'First remark'), comment('c2', 'Second remark')],
        }],
        groups: [],
      });
      await user.click(within(card('tc')).getByTestId('ticket-comment-btn'));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getAllByRole('button', { name: 'Edit comment' })[0]);
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(press(within(dialog).getByRole('button', { name: 'Cancel editing comment' }), 1, touched)).toEqual(pressedAndClicked);
        clock.at(150);
        expect(press(within(dialog).getAllByRole('button', { name: 'Delete comment' })[0], 2, touched)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(within(dialog).getByText('First remark')).toBeTruthy();
      expect((await writes()).slice(before)).toHaveLength(0);
    });

    it.each(ways)('accepts one follow-up with %s on its Accept, the next coming up into its place', async (_how, touched) => {
      const followUp = (id: string, text: string) => ({ id, text, assigneeId: null, done: false, type: 'proposal' as const, linkedTicketId: '__roti_follow_up__', proposalVotes: {} });
      renderGroupPhase({
        phase: 'CLOSE',
        settings: { ...createSession().settings, revealRoti: true },
        roti: { 'facilitator-1': 4 },
        tickets: [],
        groups: [],
        actions: [followUp('r1', 'Shorter retros'), followUp('r2', 'Start on time'), followUp('r3', 'Rotate the facilitator')],
      });
      await screen.findByText('Shorter retros');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(press(screen.getAllByRole('button', { name: 'Accept' })[0], 1, touched)).toEqual(pressedAndClicked);
        clock.at(150);
        expect(press(screen.getAllByRole('button', { name: 'Accept' })[0], 2, touched)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].actions.map((a) => [a.id, a.type])).toEqual([['r1', 'new'], ['r2', 'proposal'], ['r3', 'proposal']]);
    });

    it.each([
      ['on a card', () => card('tc')],
      ['on a group', () => groupContainer()],
    ])('deletes nothing with the next tap once a tap dropped the held card %s, and deletes after a pause', async (_how, target) => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(card('td'))).toBe(false);
        clock.at(600);
        expect(tap(target())).toBe(false);
        expect(within(card('td')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
        clock.at(750);
        expect(press(removeOf('td'), 2, true)).toEqual(nothingPressed);
        expect(onBoard('td')).toBe(true);
        // Counted from the tap it stopped, the gesture is over after a pause.
        clock.at(1300);
        expect(press(removeOf('td'), 1, true)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      expect(onBoard('td')).toBe(false);
      const after = (await writes()).slice(before);
      expect(after).toHaveLength(2);
      expect(after[0].tickets.find((t) => t.id === 'td')?.groupId).toBeTruthy();
    });

    // A tap that drops what was held while an editor closes keeps the editor
    // as the reason: its half second runs on from every tap it stops, which
    // kept the third tap of a triple tap off the card that grew back (pass
    // 13 of 42.1); an act would have let it through.
    it('presses no control with the taps after a drop that closed an editor, at an ordinary pace', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      expect(tap(card('td'))).toBe(false);
      expect(held('td')).toBeTruthy();
      await user.click(within(card('tc')).getByRole('button', { name: 'Edit ticket' }));
      await user.type(within(card('tc')).getByRole('textbox'), ' on Mondays');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(card('tb'))).toBe(false);
        expect(within(card('tc')).queryByRole('textbox')).toBeNull();
        const remove = removeOf('tc');
        clock.at(300);
        expect(press(remove, 1, true)).toEqual(nothingPressed);
        clock.at(600);
        expect(press(remove, 1, true)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('tc')).toBe(true);
      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets.find((t) => t.id === 'td')?.groupId).toBe('g1');
      expect(after[0].tickets.find((t) => t.id === 'tc')?.text).toBe('Too many meetings on Mondays');
    });

    // The card it drops onto is drawn again in the new group: its element
    // leaves the page. No control went with the tap — a card is none — and
    // the editor the tap closed stays the reason.
    it('presses no control with the taps after a drop that made a group and closed an editor, at an ordinary pace', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      expect(tap(card('td'))).toBe(false);
      await user.click(within(card('ta')).getByRole('button', { name: 'Edit ticket' }));
      await user.type(within(card('ta')).getByRole('textbox'), ' in staging');

      const clock = heldClock();
      try {
        const target = card('tc');
        expect(tap(target)).toBe(false);
        expect(target.isConnected).toBe(false);
        expect(within(card('ta')).queryByRole('textbox')).toBeNull();
        const remove = removeOf('tb');
        clock.at(300);
        expect(press(remove, 1, true)).toEqual(nothingPressed);
        clock.at(600);
        expect(press(remove, 1, true)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('tb')).toBe(true);
    });

    // A tap the board claims right after a drop, on the card the drop put
    // under the finger, picks nothing up: its half second runs from the drop.
    it('picks up nothing with the next tap on the card a tap just dropped, and does past the drop’s half second', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');

      const clock = heldClock();
      try {
        expect(tap(card('td'))).toBe(false);
        clock.at(600);
        expect(tap(card('tc'))).toBe(false);
        expect(within(card('td')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
        clock.at(750);
        expect(tap(card('td'))).toBe(false);
        expect(within(card('td')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
        clock.at(1400);
        expect(tap(card('td'))).toBe(false);
      } finally {
        clock.restore();
      }

      expect(held('td')).toBeTruthy();
    });

    // A group held to move is put down the same way: the targets it offered
    // in every other column go, and the board is laid out again.
    it('deletes nothing with the next tap once a tap put down the group it held', async () => {
      const board = createSession();
      renderGroupPhase({
        phase: 'OPEN_BOARD',
        columns: [...board.columns, { ...board.columns[0], id: 'col-2', title: 'To Improve' }],
        tickets: [
          { id: 'ta', colId: 'col-1', text: 'Flaky deploys', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
          { id: 'tb', colId: 'col-1', text: 'Slow rollbacks', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
        ],
        groups: [{ id: 'g1', title: 'Delivery', colId: 'col-1', votes: [], anchorTicketId: 'ta' }],
      });
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(groupContainer())).toBe(false);
        expect(screen.queryAllByRole('button', { name: /move the selected group to/ }).length).toBeGreaterThan(0);
        clock.at(600);
        expect(tap(groupContainer())).toBe(false);
        expect(screen.queryAllByRole('button', { name: /move the selected group to/ })).toHaveLength(0);
        clock.at(750);
        expect(press(removeOf('ta'), 2, true)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect(onBoard('ta')).toBe(true);
      expect((await writes()).slice(before)).toHaveLength(0);
    });
  });

  // Review finding (pass 17 of 42.1): a control that stays on the page moves,
  // or is covered, as well as one that goes. The votes left came in front of
  // "Unlimited votes" as it was unticked, and "1 vote/item" came under the
  // pointer; a dialog opened over the Comments button, its comment's Delete
  // under the pointer; a dialog's backdrop closed it, the card under it there;
  // a proposal's vote badge shrank, its neutral vote under the thumb; an
  // action accepted directly drew its row where the field was, its Undo under
  // the button. The browser counts the next press of a double click at the
  // point of the first: on another control there, whatever brought it, it
  // presses nothing. And a tap that picks a card up draws the card again
  // around the finger, its banner pushing its content down.
  describe('the next press of a double click on another control, whatever moved it under the pointer', () => {
    const removeOf = (id: string) => within(card(id)).getByRole('button', { name: 'Delete ticket' });
    const onBoard = (id: string) => document.querySelector(`[data-ticket-id="${id}"]`) !== null;
    const lastWrite = async () => (await writes()).at(-1);

    it.each([
      ['a double click on its words', false, () => screen.getByText('1 vote/item')],
      ['a double click on the next box itself, which is no text field', false, () => screen.getByRole('checkbox', { name: '1 vote/item' })],
      ['a double tap as Chromium counts it, the next a fingertip from the first', true, () => screen.getByText('1 vote/item')],
    ])('ticks nothing else on the Vote bar’s Unlimited votes, the next label come under it: %s', async (_how, touched, next) => {
      renderGroupPhase({
        phase: 'VOTE',
        settings: { ...createSession().settings, unlimitedVotes: true },
        tickets: [
          { id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: ['facilitator-1', 'facilitator-1', 'bob'] },
        ],
        groups: [],
      });
      await screen.findByText('Too many meetings');
      const before = (await writes()).length;

      const first = screen.getByText('Unlimited votes');
      if (touched) expect(tap(first)).toBe(true);
      expect(pressOf(first, 1)).toEqual(pressedAndClicked);
      const second = next();
      if (touched) expect(tap(second)).toBe(true);
      expect(pressOf(second, 2)).toEqual(nothingPressed);

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].settings).toMatchObject({ unlimitedVotes: false, oneVotePerTicket: false });
      expect(after[0].tickets[0].votes).toEqual(['facilitator-1', 'facilitator-1', 'bob']);
    });

    it('deletes no comment with a double click on the Comments button, the dialog opened over it', async () => {
      const comment = (id: string, text: string) => ({ id, authorId: 'facilitator-1', authorName: 'Facilitator', text, createdAt: '2026-11-01T10:00:00.000Z' });
      renderGroupPhase({
        phase: 'OPEN_BOARD',
        tickets: [{
          id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: [],
          comments: [comment('c1', 'First remark')],
        }],
        groups: [],
      });
      await screen.findByText('Too many meetings');
      const before = (await writes()).length;

      expect(pressOf(within(card('tc')).getByTestId('ticket-comment-btn'), 1)).toEqual(pressedAndClicked);
      const dialog = await screen.findByRole('dialog');
      expect(pressOf(within(dialog).getByRole('button', { name: 'Delete comment' }), 2)).toEqual(nothingPressed);

      expect(within(dialog).getByText('First remark')).toBeTruthy();
      expect((await writes()).slice(before)).toHaveLength(0);
    });

    it('deletes no card with a double click on a dialog’s backdrop, the card under it there', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await user.click(within(card('tc')).getByTestId('ticket-comment-btn'));
      const backdrop = (await screen.findByRole('dialog')).parentElement as HTMLElement;
      const before = (await writes()).length;

      expect(pressOf(backdrop, 1)).toEqual(pressedAndClicked);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(pressOf(removeOf('td'), 2)).toEqual(nothingPressed);

      expect(onBoard('td')).toBe(true);
      expect((await writes()).slice(before)).toHaveLength(0);
    });

    it('votes up, not neutral, with a double click on a proposal’s thumb, its badge shrunk', async () => {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      renderGroupPhase({
        phase: 'DISCUSS',
        tickets: [{ id: 'tc', colId: 'col-1', text: 'Late release notes', authorId: 'facilitator-1', groupId: null, votes: ['facilitator-1'] }],
        groups: [],
        discussionFocusId: 'tc',
        actions: [{ id: 'p1', text: 'Write the notes the day before', assigneeId: null, done: false, type: 'proposal', linkedTicketId: 'tc', proposalVotes: {} }],
      });
      await screen.findByText('Write the notes the day before');
      const before = (await writes()).length;

      const voteButton = (icon: string) => screen.getAllByText(icon).map((el) => el.closest('button')).filter((b): b is HTMLButtonElement => !!b)[0];
      expect(pressOf(voteButton('thumb_up'), 1)).toEqual(pressedAndClicked);
      expect(pressOf(voteButton('remove'), 2)).toEqual(nothingPressed);

      expect((await writes()).slice(before)).toHaveLength(1);
      expect((await lastWrite())?.actions[0].proposalVotes).toEqual({ 'facilitator-1': 'up' });
    });

    it('keeps an action accepted with a double click on Directly Accept Action, its Undo come under it', async () => {
      const user = userEvent.setup();
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      renderGroupPhase({
        phase: 'DISCUSS',
        tickets: [{ id: 'tc', colId: 'col-1', text: 'Late release notes', authorId: 'facilitator-1', groupId: null, votes: ['facilitator-1'] }],
        groups: [],
        discussionFocusId: 'tc',
        actions: [],
      });
      await user.type(await screen.findByPlaceholderText('Propose an action...'), 'Write the notes the day before');
      const before = (await writes()).length;

      expect(pressOf(screen.getByRole('button', { name: 'Directly Accept Action' }), 1)).toEqual(pressedAndClicked);
      expect(pressOf(screen.getByRole('button', { name: 'Undo accept' }), 2)).toEqual(nothingPressed);

      expect((await writes()).slice(before)).toHaveLength(1);
      expect((await lastWrite())?.actions.map((a) => [a.text, a.type])).toEqual([['Write the notes the day before', 'new']]);
    });

    // The tap's own mouse, past the browser's count: the card it picked up
    // was drawn again under the finger.
    it('votes nothing with the next tap on a card it picked up, the banner having pushed the vote under the finger', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(card('td'))).toBe(false);
        expect(held('td')).toBeTruthy();
        clock.at(150);
        const vote = within(card('td')).getByTestId('vote-add');
        expect(tap(vote)).toBe(true);
        expect(pressOf(vote, 1)).toEqual(nothingPressed);
        // Past the half second, a tap of its own votes.
        clock.at(900);
        expect(tap(vote)).toBe(true);
        expect(pressOf(vote, 1)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets.find((t) => t.id === 'td')?.votes).toEqual(['facilitator-1']);
    });
  });

  // Review finding (pass 18 of 42.1): the rules of the pass before reached too
  // far, or not far enough.
  describe('the next press or tap, as far as what moved reaches', () => {
    const onBoard = (id: string) => document.querySelector(`[data-ticket-id="${id}"]`) !== null;
    const press = (element: HTMLElement, detail: number, touched: boolean) => {
      if (touched) expect(tap(element)).toBe(true);
      return pressOf(element, detail);
    };

    // The card's Edit goes with its click, and its editor comes there: the
    // next press selected the word under it, and the next keystroke replaced
    // it for everyone.
    it.each([['a double click', false], ['a double tap', true]])('selects nothing in the editor with %s on a card’s Edit', async (_how, touched) => {
      renderBoard();
      await screen.findByText('Too many meetings');

      const clock = heldClock();
      try {
        expect(press(within(card('tc')).getByRole('button', { name: 'Edit ticket' }), 1, touched)).toEqual(pressedAndClicked);
        const editor = within(card('tc')).getByRole('textbox');
        clock.at(150);
        expect(press(editor, 2, touched).pressed).toBe(false);
      } finally {
        clock.restore();
      }
    });

    // The stated cost of the rule (AGENTS.md): the next tap of a gesture
    // presses only what its first reached, and a quick retry right beside a
    // missed "+" is one. It adds the vote once the pace pauses.
    it('adds the vote with a tap after a pause, not with the quick retry beside a missed "+"', async () => {
      renderGroupPhase({
        phase: 'VOTE',
        tickets: [{ id: 'tc', colId: 'col-1', text: 'Too many meetings', authorId: 'facilitator-1', groupId: null, votes: [] }],
        groups: [],
      });
      await screen.findByText('Too many meetings');
      const before = (await writes()).length;
      const add = within(card('tc')).getByRole('button', { name: 'Add a vote to this ticket' });
      const count = add.previousElementSibling as HTMLElement;

      const clock = heldClock();
      try {
        expect(press(count, 1, true)).toEqual(pressedAndClicked);
        clock.at(150);
        expect(press(add, 2, true)).toEqual(nothingPressed);
        clock.at(700);
        expect(press(add, 1, true)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].tickets[0].votes).toEqual(['facilitator-1']);
    });

    // A group picked up: its own vote, a fingertip and more from where the
    // pick-up's tap aimed, is the next tap's to press at once — a new
    // gesture. At the same place it is the double tap's (the case above).
    it('votes for a group with a tap on its vote, elsewhere in the group, right after a tap that picked it up', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(groupContainer())).toBe(false);
        clock.at(450);
        const vote = within(groupContainer()).getAllByTestId('vote-add')[0];
        expect(tap(vote, 50, 150)).toBe(true);
        expect(pressOf(vote, 1, 50, 150)).toEqual(pressedAndClicked);
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(1);
      expect(after[0].groups[0].votes).toEqual(['facilitator-1']);
    });

    // The backdrop goes with the dialog its tap closed, and the next tap
    // reached the card under it, which the board claims: it dropped the held
    // card there, for everyone.
    it('drops nothing with the next tap on a card, once a tap on a dialog’s backdrop closed the dialog', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      expect(tap(card('td'))).toBe(false);
      await user.click(within(card('tc')).getByTestId('ticket-comment-btn'));
      const backdrop = (await screen.findByRole('dialog')).parentElement as HTMLElement;
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(press(backdrop, 1, true)).toEqual(pressedAndClicked);
        expect(screen.queryByRole('dialog')).toBeNull();
        clock.at(150);
        expect(tap(card('tc'))).toBe(false);
      } finally {
        clock.restore();
      }

      expect((await writes()).slice(before)).toHaveLength(0);
      expect(held('td')).toBeTruthy();
    });

    // In a browser that lays the page out, a pick-up in the Group phase drew
    // the hint above the board a line longer, and the card above came under
    // the finger: the next tap dropped the held card on it.
    it('drops nothing with the next tap on the card that came under the point the pick-up aimed at', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      // jsdom lays nothing out: the two cards are drawn here, the one above
      // and the one the tap reaches, and the pick-up moves the one above
      // down under the point.
      const boxes = new Map<Element, { left: number; top: number; width: number; height: number }>([
        [card('tc'), { left: 0, top: 0, width: 200, height: 30 }],
        [card('td'), { left: 0, top: 40, width: 200, height: 30 }],
      ]);
      const layout = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const b = boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 };
        return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b } as DOMRect;
      });
      const clock = heldClock();
      try {
        expect(tap(card('td'))).toBe(false);
        boxes.set(card('tc'), { left: 0, top: 36, width: 200, height: 30 });
        clock.at(150);
        expect(tap(card('tc'))).toBe(false);
        expect(within(card('tc')).queryByRole('button', { name: /Selected for grouping/ })).toBeNull();
      } finally {
        layout.mockRestore();
        clock.restore();
      }

      expect((await writes()).slice(before)).toHaveLength(0);
      expect(held('td')).toBeTruthy();
    });

    // Review finding (pass 19 of 42.1): the board acted on the tap before —
    // it picked the group up — and a double tap whose second touch landed a
    // fingertip away, inside the browser's count, dissolved the group for
    // everyone, or voted for it.
    it.each([['its Delete group', 'delete'], ['its vote', 'vote']])('presses nothing with a press the browser counts on %s, right after a tap that picked the group up', async (_name, which) => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(groupContainer())).toBe(false);
        clock.at(150);
        const control = which === 'delete'
          ? within(groupContainer()).getByRole('button', { name: 'Delete group' })
          : within(groupContainer()).getAllByTestId('vote-add')[0];
        expect(press(control, 2, true)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }

      expect((await writes()).slice(before)).toHaveLength(0);
      expect(screen.getByText('Flaky deploys').closest('.group-container')).toBeTruthy();
    });

    // Review finding (pass 19 of 42.1): a field was the next press's own after
    // any press on no control: a double click on a dialog's backdrop selected
    // the word of the group title under it, and the next keystroke renamed
    // the group for everyone.
    it('selects nothing in a group’s title with a double click on a dialog’s backdrop over it', async () => {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Flaky deploys');
      await user.click(within(card('tc')).getByTestId('ticket-comment-btn'));
      const backdrop = (await screen.findByRole('dialog')).parentElement as HTMLElement;

      const clock = heldClock();
      try {
        expect(pressOf(backdrop, 1)).toEqual(pressedAndClicked);
        expect(screen.queryByRole('dialog')).toBeNull();
        const title = document.querySelector('[data-group-title-id="g1"]') as HTMLElement;
        clock.at(150);
        expect(pressOf(title, 2)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }
    });

    // Nor after a tap that picked a card up: the card is drawn again around
    // the finger, and a group's title came under the next touch.
    it('focuses no group title with the next tap the browser counts, right after a tap that picked a card up', async () => {
      renderBoard();
      await screen.findByText('Too many meetings');

      const clock = heldClock();
      try {
        expect(tap(card('tc'))).toBe(false);
        clock.at(150);
        const title = document.querySelector('[data-group-title-id="g1"]') as HTMLElement;
        expect(press(title, 2, true)).toEqual(nothingPressed);
      } finally {
        clock.restore();
      }
    });

    // A pick-up and a drop at an ordinary pace, each card where it lies on
    // the board, a second after an earlier drop.
    it('groups with a pick-up and a drop at an ordinary pace a second after an earlier drop', async () => {
      renderBoard();
      await screen.findByText('Flaky deploys');
      const before = (await writes()).length;

      const clock = heldClock();
      try {
        expect(tap(card('td'), 50, 50)).toBe(false);
        clock.at(300);
        expect(tap(card('tc'), 50, 150)).toBe(false);
        // The new pair's card, picked up and dropped into the other group.
        clock.at(1300);
        expect(tap(card('tc'), 50, 150)).toBe(false);
        clock.at(1600);
        expect(tap(card('ta'), 50, 250)).toBe(false);
      } finally {
        clock.restore();
      }

      const after = (await writes()).slice(before);
      expect(after).toHaveLength(2);
      expect(after[1].tickets.find((t) => t.id === 'tc')?.groupId).toBe('g1');
      expect(onBoard('td')).toBe(true);
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
