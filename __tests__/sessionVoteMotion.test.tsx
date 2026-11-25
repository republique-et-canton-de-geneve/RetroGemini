import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup as cleanupView, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import LanguageProvider from '../i18n/LanguageProvider';
import { syncService } from '../services/syncService';
import { RetroSession, Team, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The session screen with the vote pieces and the board's motion mounted: the
 * guided pill on a card and on a group, the budget in the Vote bar, the data
 * attributes the motion hook finds its elements by, and the vote's flight —
 * decoration that follows what the vote did, never decides it, and leaves the
 * write, the focus and the words as they were.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
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
const participant: User = { id: 'p1', name: 'Alice', color: 'bg-red-500', role: 'participant' };

const createSession = (overrides: Partial<RetroSession> = {}, settings: Partial<RetroSession['settings']> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'VOTE',
  participants: [facilitator, participant],
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
    ...settings,
  },
  tickets: [
    { id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: [], reactions: { '👍': ['p1'] } },
    { id: 't2', colId: 'col-1', text: 'Pairing', authorId: 'p1', groupId: 'g1', votes: [] },
    { id: 't3', colId: 'col-1', text: 'Mobbing', authorId: 'p1', groupId: 'g1', votes: [] },
  ],
  groups: [{ id: 'g1', title: 'Working together', colId: 'col-1', votes: [], anchorTicketId: 't2' }],
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
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [session],
  globalActions: [],
});

const renderSession = async (session: RetroSession, { language, user = facilitator }: { language?: 'en' | 'fr'; user?: User } = {}) => {
  const screenOf = <Session team={createTeam(session)} currentUser={user} sessionId="session-1" onExit={vi.fn()} />;
  const view = render(language ? <LanguageProvider initialLanguage={language}>{screenOf}</LanguageProvider> : screenOf);
  await waitFor(() => expect(view.container.textContent).toContain('Great teamwork'));
  return view;
};

const card = (id: string) => document.querySelector(`[data-ticket-id="${id}"]`) as HTMLElement;
const lastWrite = () => vi.mocked(syncService.updateSession).mock.calls.at(-1)?.[0] as RetroSession | undefined;
const effects = () => [...document.querySelectorAll('[class*="fx-"]')].flatMap((el) => [...el.classList].filter((c) => c.startsWith('fx-')));

// What a browser gives the motion: a reader who did not ask for less of it,
// elements with a size, and the Web Animations API. jsdom has none of them.
const originalMatchMedia = window.matchMedia;
const originalAnimate = Element.prototype.animate;
const animations: Array<{ onfinish: (() => void) | null; oncancel: (() => void) | null }> = [];
const allowMotion = (reduced = false) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('no-preference') ? !reduced : query.includes('reduce') ? reduced : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  Element.prototype.animate = vi.fn(() => {
    const animation = { onfinish: null, oncancel: null, cancel: vi.fn() };
    animations.push(animation);
    return animation;
  }) as unknown as typeof Element.prototype.animate;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100, top: 100, width: 10, height: 10, right: 110, bottom: 110, x: 100, y: 100, toJSON: () => ({}),
  } as DOMRect);
};
/** Past the quiet seconds that follow the viewer's own connection. */
const pastTheQuietSeconds = () => {
  const start = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(start + 5_000);
};
/** Hands the screen the states the server sends, as syncService would. */
const captureServerStates = () => {
  let listener: ((state: RetroSession) => void) | null = null;
  vi.mocked(syncService.onSessionUpdate).mockImplementation((callback) => {
    listener = callback as (state: RetroSession) => void;
    return () => {};
  });
  return (state: RetroSession) => listener?.(state);
};
const land = () => act(() => { animations.splice(0).forEach((animation) => animation.onfinish?.()); });

beforeEach(() => {
  vi.clearAllMocks();
  animations.length = 0;
  global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
  Element.prototype.animate = originalAnimate;
  document.querySelectorAll('.fx-layer').forEach((layer) => layer.remove());
});

describe('Session — the vote pieces, mounted', () => {
  it('draws the guided pill on a card and on a group, with their names and test ids', async () => {
    await renderSession(createSession());
    const cardPill = within(card('t1')).getByTestId('guided-vote-control');
    expect(within(cardPill).getByRole('button', { name: 'Add a vote to this ticket' })).toBeTruthy();
    expect(within(cardPill).getByRole('button', { name: 'Remove a vote from this ticket' }).getAttribute('aria-disabled')).toBe('true');
    // e2e/retro-full-flow finds the plus by its ligature.
    expect(within(cardPill).getByText('add').className).toContain('material-symbols-outlined');

    const group = document.querySelector('[data-group-id="g1"]') as HTMLElement;
    const groupPill = within(group).getByTestId('guided-vote-control');
    expect(within(groupPill).getByRole('button', { name: 'Add a vote to this group' })).toBeTruthy();
    // A grouped card takes no vote of its own: the group carries them.
    expect(within(card('t2')).queryByTestId('guided-vote-control')).toBeNull();
  });

  it('votes through the pill, says the viewer’s votes in words, and keeps the focus on the plus', async () => {
    await renderSession(createSession());
    const plus = within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
    await userEvent.click(plus);
    expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual(['facilitator-1']);
    expect(within(card('t1')).getByText('You gave it 1 vote')).toBeTruthy();
    expect(document.activeElement).toBe(plus);
    const minus = within(card('t1')).getByRole('button', { name: 'Remove a vote from this ticket' });
    expect(minus.getAttribute('aria-disabled')).toBe('false');
    await userEvent.click(minus);
    expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual([]);
    // At zero the minus stays where it was, aria-disabled under the focus.
    expect(document.activeElement).toBe(minus);
    expect(minus.getAttribute('aria-disabled')).toBe('true');
  });

  it('turns every plus off, never disabled, once the budget is spent', async () => {
    await renderSession(createSession({}, { maxVotes: 1 }));
    const plus = within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
    await userEvent.click(plus);
    expect(screen.getByText('0 votes remaining')).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: /^Add a vote to this/ })) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
    }
    expect(document.activeElement).toBe(plus);
  });

  it.each([
    ['en', '5 votes remaining'],
    ['fr', 'Votes restants : 5'],
  ] as const)('keeps the budget sentence in %s, with one token per vote beside it', async (language, sentence) => {
    await renderSession(createSession(), { language });
    const chip = document.querySelector('[data-vote-budget]') as HTMLElement;
    expect(chip.textContent).toBe(sentence);
    expect(chip.querySelectorAll('[data-vote-token]')).toHaveLength(5);
    expect(chip.querySelector('[data-vote-tokens]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws as cast only the votes the viewer gave, under one vote per item', async () => {
    // Five votes, three items to give them to: two can never be placed.
    await renderSession(createSession({
      tickets: [
        { id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: [] },
        { id: 't2', colId: 'col-1', text: 'Pairing', authorId: 'p1', groupId: 'g1', votes: [] },
        { id: 't3', colId: 'col-1', text: 'Mobbing', authorId: 'p1', groupId: 'g1', votes: [] },
        { id: 't4', colId: 'col-1', text: 'Demos', authorId: 'p1', groupId: null, votes: [] },
      ],
    }, { oneVotePerTicket: true }));
    const chip = () => document.querySelector('[data-vote-budget]') as HTMLElement;
    const drawn = (kind: string) => chip().querySelectorAll(`[data-vote-token="${kind}"]`).length;
    expect(chip().textContent).toBe('3 votes remaining');
    expect([drawn('left'), drawn('cast')]).toEqual([3, 0]);

    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect([drawn('left'), drawn('cast')]).toEqual([2, 1]);
    await userEvent.click(within(card('t4')).getByRole('button', { name: 'Add a vote to this ticket' }));
    const group = document.querySelector('[data-group-id="g1"]') as HTMLElement;
    await userEvent.click(within(group).getByRole('button', { name: 'Add a vote to this group' }));
    expect(chip().textContent).toBe('0 votes remaining');
    expect([drawn('left'), drawn('cast')]).toEqual([0, 3]);
  });

  it('says nothing to count with unlimited votes', async () => {
    await renderSession(createSession({}, { unlimitedVotes: true }));
    expect(document.querySelector('[data-vote-budget]')).toBeNull();
  });

  it('carries the attributes the board’s motion finds its elements by', async () => {
    await renderSession(createSession());
    expect(card('t1').classList.contains('relative')).toBe(true);
    const group = document.querySelector('[data-group-id="g1"]') as HTMLElement;
    expect(group.classList.contains('group-container')).toBe(true);
    // The ring is drawn on `::after`, absolutely: the container is its box.
    expect(group.classList.contains('relative')).toBe(true);
    expect(document.querySelector('[data-column-count="col-1"]')!.textContent).toBe('2');
    const chip = within(card('t1')).getByTestId('ticket-reaction');
    expect(chip.getAttribute('data-reaction')).toBe('👍');
    expect(within(card('t1')).getByTestId('my-guided-votes').hasAttribute('data-vote-count')).toBe(true);
  });

  it('separates the settings of a guided bar with space, never with a rule that would open a wrapped line', async () => {
    await renderSession(createSession({ phase: 'BRAINSTORM' }));
    const bar = screen.getByTestId('phase-action-bar');
    expect(bar.querySelectorAll('.border-l')).toHaveLength(0);
  });
});

describe('Session — the vote’s flight', () => {
  // Past three dots the pill draws one dot and the number, and a vote's token
  // lands on the number, which bumps, never on a dot. A card the viewer already
  // gave four votes or more keeps the number drawn before and after each vote.
  const pastThreeDots = (mine = 4, settings: Partial<RetroSession['settings']> = {}) => createSession({
    tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: Array.from({ length: mine }, () => 'facilitator-1') }],
    groups: [],
  }, { maxVotes: 8, ...settings });
  const theCount = () => within(card('t1')).getByTestId('my-guided-votes');
  const countBumped = () => theCount().classList.contains('fx-bump');
  const plusOf = () => within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
  const minusOf = () => within(card('t1')).getByRole('button', { name: 'Remove a vote from this ticket' });
  const myVotesOn = (state: RetroSession | undefined) => state?.tickets.find((t) => t.id === 't1')?.votes.length;

  it('sends a token from the budget to the card once the vote is written, and marks the card where it lands', async () => {
    allowMotion();
    await renderSession(createSession());
    pastTheQuietSeconds();
    const plus = within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
    await userEvent.click(plus);
    // The write is not held for the flight.
    expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual(['facilitator-1']);
    const layers = document.querySelectorAll('.fx-layer');
    expect(layers).toHaveLength(1);
    expect(layers[0].getAttribute('aria-hidden')).toBe('true');
    expect(layers[0].querySelectorAll('.fx-token')).toHaveLength(1);
    expect(document.activeElement).toBe(plus);
    // The ring waits for the token; the dot it brings is drawn, unseen until then.
    expect(card('t1').classList.contains('fx-ring')).toBe(false);
    const dot = within(card('t1')).getByTestId('my-guided-votes').lastElementChild as HTMLElement;
    expect(dot.style.visibility).toBe('hidden');
    // Its own spring waits for the token too: from no size at all, the dot
    // would give the token nowhere to land.
    expect(dot.classList.contains('fx-pop')).toBe(false);
    expect(within(card('t1')).getByText('You gave it 1 vote')).toBeTruthy();

    land();
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(dot.style.visibility).toBe('');
    expect(dot.classList.contains('fx-pop')).toBe(true);
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
    expect(document.activeElement).toBe(plus);
  });

  it('flies a vote taken back home, and a group’s vote the same way', async () => {
    allowMotion();
    await renderSession(createSession({ groups: [{ id: 'g1', title: 'Working together', colId: 'col-1', votes: ['facilitator-1'], anchorTicketId: 't2' }] }));
    pastTheQuietSeconds();
    const group = document.querySelector('[data-group-id="g1"]') as HTMLElement;
    await userEvent.click(within(group).getByRole('button', { name: 'Remove a vote from this group' }));
    expect(lastWrite()?.groups[0].votes).toEqual([]);
    expect(document.querySelectorAll('.fx-layer .fx-token')).toHaveLength(1);
    land();
    expect(document.querySelector('.fx-layer')).toBeNull();
    // Nothing rings for a vote taken back.
    expect(group.classList.contains('fx-ring')).toBe(false);

    await userEvent.click(within(group).getByRole('button', { name: 'Add a vote to this group' }));
    expect(document.querySelectorAll('.fx-layer .fx-token')).toHaveLength(1);
    land();
    expect(group.classList.contains('fx-ring')).toBe(true);
  });

  // A write made while the session reconnects is dropped, as every edit made
  // offline is. The motion follows the write: a vote that was not taken back
  // sends no token home and holds no mark. (It read "no session written" as
  // "no vote of mine left", and flew the token of a vote still there.)
  it('flies nothing for a vote taken back while the session reconnects: nothing was written', async () => {
    allowMotion();
    let setConnected: ((connected: boolean) => void) | null = null;
    vi.mocked(syncService.onConnectionChange).mockImplementation((callback) => {
      setConnected = callback as (connected: boolean) => void;
      return () => {};
    });
    const fromServer = captureServerStates();
    const voted = createSession({ groups: [{ id: 'g1', title: 'Working together', colId: 'col-1', votes: ['facilitator-1'], anchorTicketId: 't2' }] });
    await renderSession(voted);
    pastTheQuietSeconds();
    const group = document.querySelector('[data-group-id="g1"]') as HTMLElement;
    const minus = within(group).getByRole('button', { name: 'Remove a vote from this group' });
    const writes = vi.mocked(syncService.updateSession).mock.calls.length;
    expect(setConnected).not.toBeNull();

    // The connection drops and the click lands before the screen is drawn
    // again: the control is still the live one, the write is already refused.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      setConnected!(false);
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    fireEvent.click(minus);
    expect(vi.mocked(syncService.updateSession).mock.calls.length).toBe(writes);
    expect(document.querySelector('.fx-layer')).toBeNull();

    // Back online, the server's state still holds the vote, and nothing that
    // click queued plays on it: no token, and the vote's marks are not held.
    act(() => { setConnected!(true); });
    act(() => { fromServer({ ...JSON.parse(JSON.stringify(voted)), _rev: 7, finishedUsers: ['p1'] }); });
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(within(document.querySelector('[data-group-id="g1"]') as HTMLElement).getByText('You gave it 1 vote')).toBeTruthy();
    land();
    expect(document.querySelector('.fx-layer')).toBeNull();
  });

  it('sends nothing flying, shakes nothing and holds nothing for a vote added while the session reconnects', async () => {
    allowMotion();
    let setConnected: ((connected: boolean) => void) | null = null;
    vi.mocked(syncService.onConnectionChange).mockImplementation((callback) => {
      setConnected = callback as (connected: boolean) => void;
      return () => {};
    });
    const fromServer = captureServerStates();
    // One vote left: a refusal for lack of votes would shake the budget.
    const start = createSession({
      tickets: [
        { id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: [] },
        { id: 't4', colId: 'col-1', text: 'Spent', authorId: 'p1', groupId: null, votes: ['facilitator-1'] },
      ],
      groups: [],
    }, { maxVotes: 2 });
    await renderSession(start);
    pastTheQuietSeconds();
    const plus = within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
    const writes = vi.mocked(syncService.updateSession).mock.calls.length;

    // The connection drops and the click lands before the screen is drawn again.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      setConnected!(false);
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    fireEvent.click(plus);
    expect(vi.mocked(syncService.updateSession).mock.calls.length).toBe(writes);
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(document.querySelector('[data-vote-budget]')!.classList.contains('fx-nope')).toBe(false);
    expect(within(card('t1')).getByText('You gave it 0 votes')).toBeTruthy();

    // Back online, nothing that click queued plays on the server's state.
    act(() => { setConnected!(true); });
    act(() => { fromServer({ ...JSON.parse(JSON.stringify(start)), _rev: 7, finishedUsers: ['p1'] }); });
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(card('t1').classList.contains('fx-ring')).toBe(false);
    land();
    expect(document.querySelector('.fx-layer')).toBeNull();
  });

  // The same past three dots: the number the vote would have raised neither
  // moves nor bumps, and nothing holds the card, so the board marks its next
  // news once the quiet seconds after the reconnection are over.
  it('sends nothing flying, bumps nothing and holds nothing past three dots for a vote added while the session reconnects', async () => {
    allowMotion();
    let setConnected: ((connected: boolean) => void) | null = null;
    vi.mocked(syncService.onConnectionChange).mockImplementation((callback) => {
      setConnected = callback as (connected: boolean) => void;
      return () => {};
    });
    const fromServer = captureServerStates();
    const start = pastThreeDots();
    await renderSession(start);
    pastTheQuietSeconds();
    const writes = vi.mocked(syncService.updateSession).mock.calls.length;

    // The connection drops and the click lands before the screen is drawn again.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      setConnected!(false);
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    fireEvent.click(plusOf());
    expect(vi.mocked(syncService.updateSession).mock.calls.length).toBe(writes);
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(theCount().textContent).toBe('4');
    expect(countBumped()).toBe(false);

    act(() => { setConnected!(true); });
    act(() => { fromServer({ ...JSON.parse(JSON.stringify(start)), _rev: 7, finishedUsers: ['p1'] }); });
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(theCount().textContent).toBe('4');
    expect(countBumped()).toBe(false);
    expect(card('t1').classList.contains('fx-ring')).toBe(false);

    // Past the quiet seconds, the viewer takes a vote back from their other
    // browser: news the board marks, since no flight holds the card.
    vi.mocked(Date.now).mockReturnValue(Date.now() + 5_000);
    const tookOneBack = JSON.parse(JSON.stringify(start)) as RetroSession;
    tookOneBack.tickets[0].votes = ['facilitator-1', 'facilitator-1', 'facilitator-1'];
    act(() => { fromServer({ ...tookOneBack, _rev: 8, finishedUsers: ['p1'] }); });
    expect(within(card('t1')).getByText('You gave it 3 votes')).toBeTruthy();
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
  });

  // A flight that cannot be drawn (an end outside the window, a browser that
  // cannot animate) arrives at once: nothing waits for a token that will
  // never land. The vote's marks play where they stand and its hold is let
  // go, so what the hook plays for that item later is not skipped for good.
  describe('a token that cannot fly', () => {
    /** Every box far below the window: no flight has a path. */
    const offScreen = () =>
      vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({
        left: 100, top: 5000, width: 10, height: 10, right: 110, bottom: 5010, x: 100, y: 5000, toJSON: () => ({}),
      } as DOMRect);
    /** The server's word that votes are now unlimited: the budget draws no token, and no vote flies. */
    const withoutBudget = (fromServer: (state: RetroSession) => void, rev: number) => {
      const current = lastWrite()!;
      act(() => {
        fromServer({ ...JSON.parse(JSON.stringify(current)), _rev: rev, settings: { ...current.settings, unlimitedVotes: true } });
      });
      expect(document.querySelector('[data-vote-tokens]')).toBeNull();
      // The board is quiet for three seconds after the server's first state: past them.
      vi.mocked(Date.now).mockReturnValue(Date.now() + 5_000);
    };

    it('plays a vote\'s marks at once, shows its dot, and holds nothing', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(createSession());
      pastTheQuietSeconds();
      offScreen();

      await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
      expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual(['facilitator-1']);
      expect(document.querySelector('.fx-layer')).toBeNull();
      const dot = within(card('t1')).getByTestId('my-guided-votes').lastElementChild as HTMLElement;
      expect(dot.style.visibility).toBe('');
      expect(card('t1').classList.contains('fx-ring')).toBe(true);

      // Nothing is held: a later vote on this card that does not fly is marked by the board itself.
      card('t1').classList.remove('fx-ring');
      withoutBudget(fromServer, 5);
      await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
      expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual(['facilitator-1', 'facilitator-1']);
      expect(card('t1').classList.contains('fx-ring')).toBe(true);
    });

    it('bumps the count and rings the card at once past three dots, and holds nothing', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(pastThreeDots());
      pastTheQuietSeconds();
      offScreen();

      await userEvent.click(plusOf());
      expect(myVotesOn(lastWrite())).toBe(5);
      expect(theCount().textContent).toBe('5');
      expect(animations).toHaveLength(0);
      expect(document.querySelector('.fx-layer')).toBeNull();
      expect(countBumped()).toBe(true);
      expect(card('t1').classList.contains('fx-ring')).toBe(true);

      // Nothing is held: a later vote on this card that does not fly is marked by the board itself.
      card('t1').classList.remove('fx-ring');
      withoutBudget(fromServer, 5);
      await userEvent.click(plusOf());
      expect(myVotesOn(lastWrite())).toBe(6);
      expect(card('t1').classList.contains('fx-ring')).toBe(true);
    });

    it('lets go of a vote taken back at once, with no token left on the page', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(createSession({ groups: [{ id: 'g1', title: 'Working together', colId: 'col-1', votes: ['facilitator-1'], anchorTicketId: 't2' }] }));
      pastTheQuietSeconds();
      offScreen();
      const group = () => document.querySelector('[data-group-id="g1"]') as HTMLElement;

      await userEvent.click(within(group()).getByRole('button', { name: 'Remove a vote from this group' }));
      expect(lastWrite()?.groups[0].votes).toEqual([]);
      expect(document.querySelector('.fx-layer')).toBeNull();
      expect(animations).toHaveLength(0);

      withoutBudget(fromServer, 5);
      await userEvent.click(within(group()).getByRole('button', { name: 'Add a vote to this group' }));
      expect(lastWrite()?.groups[0].votes).toEqual(['facilitator-1']);
      // Held, the group would be skipped by the board's own marks.
      expect(group().classList.contains('fx-ring')).toBe(true);
    });
  });

  // The hold is counted: two quick votes on one card each keep it held until
  // their own token has landed. Let go at the first landing, the card took the
  // board's own marks for whatever its second token was still carrying.
  describe('two tokens on one card', () => {
    /** The server's word on the viewer's votes for the card, past the quiet seconds that follow its first state. */
    const serverSays = (fromServer: (state: RetroSession) => void, rev: number, mine: number) => {
      const current = lastWrite()!;
      act(() => {
        fromServer({
          ...JSON.parse(JSON.stringify(current)),
          _rev: rev,
          tickets: current.tickets.map((t) => (t.id === 't1' ? { ...t, votes: Array.from({ length: mine }, () => 'facilitator-1') } : t)),
        });
      });
      vi.mocked(Date.now).mockReturnValue(Date.now() + 5_000);
    };
    const landOne = () => act(() => { animations.shift()?.onfinish?.(); });
    const ring = () => card('t1').classList.contains('fx-ring');
    const clearRing = () => card('t1').classList.remove('fx-ring');

    it('keeps the card held until the second of two quick votes has landed', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(createSession({}, { maxVotes: 6 }));
      pastTheQuietSeconds();
      const plus = within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
      await userEvent.click(plus);
      await userEvent.click(plus);
      expect(animations).toHaveLength(2);

      // The first token lands and plays its own marks; the second is still flying.
      landOne();
      expect(ring()).toBe(true);
      clearRing();
      // The server agrees with both votes, then says the viewer has a third
      // (cast from their other browser): news the board would mark, if the
      // card were not held for the token on its way.
      serverSays(fromServer, 5, 2);
      serverSays(fromServer, 6, 3);
      expect(within(card('t1')).getByText('You gave it 3 votes')).toBeTruthy();
      expect(ring()).toBe(false);

      // The second lands: the card is let go, and the next news is marked.
      landOne();
      expect(ring()).toBe(true);
      clearRing();
      serverSays(fromServer, 7, 4);
      expect(within(card('t1')).getByText('You gave it 4 votes')).toBeTruthy();
      expect(ring()).toBe(true);
    });

    // Past three dots both tokens land on the number: it bumps, with a ring,
    // where each token lands and never before the first.
    it('bumps the count where each of two quick votes past three dots lands, and keeps the card held until the second', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(pastThreeDots());
      pastTheQuietSeconds();
      await userEvent.click(plusOf());
      await userEvent.click(plusOf());
      expect(theCount().textContent).toBe('6');
      expect(animations).toHaveLength(2);
      expect(countBumped()).toBe(false);
      expect(ring()).toBe(false);

      landOne();
      expect(countBumped()).toBe(true);
      expect(ring()).toBe(true);
      clearRing();
      theCount().classList.remove('fx-bump');
      // The server agrees with both votes, then says the viewer took one back
      // from their other browser: news the board would mark, if the card were
      // not held for the token still on its way.
      serverSays(fromServer, 5, 6);
      serverSays(fromServer, 6, 5);
      expect(theCount().textContent).toBe('5');
      expect(ring()).toBe(false);
      expect(countBumped()).toBe(false);

      landOne();
      expect(countBumped()).toBe(true);
      expect(ring()).toBe(true);
    });

    it('keeps the card held until the second of two votes taken back is home', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(createSession({
        tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1', 'facilitator-1', 'facilitator-1'] }],
        groups: [],
      }, { maxVotes: 6 }));
      pastTheQuietSeconds();
      const minus = within(card('t1')).getByRole('button', { name: 'Remove a vote from this ticket' });
      await userEvent.click(minus);
      await userEvent.click(minus);
      expect(animations).toHaveLength(2);

      // One token is home (a vote taken back rings nothing), the other still flies.
      landOne();
      expect(ring()).toBe(false);
      serverSays(fromServer, 5, 1);
      serverSays(fromServer, 6, 2);
      expect(within(card('t1')).getByText('You gave it 2 votes')).toBeTruthy();
      expect(ring()).toBe(false);

      landOne();
      serverSays(fromServer, 7, 3);
      expect(within(card('t1')).getByText('You gave it 3 votes')).toBeTruthy();
      expect(ring()).toBe(true);
    });

    // A vote added, then taken back before its token lands: the take-back
    // takes back the vote that token carries, whose dot it removes. That token
    // lands on nothing, and nothing marks it — a vote taken back flies home,
    // and nothing rings for it. Read as landed, the add's token (500 ms, the
    // other one home in 340) rang the card for a vote that was gone.
    it('plays no landing marks for a vote taken back before its token lands, and holds the card until both tokens are in', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(createSession({}, { maxVotes: 6 }));
      pastTheQuietSeconds();
      await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
      await userEvent.click(within(card('t1')).getByRole('button', { name: 'Remove a vote from this ticket' }));
      expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual([]);
      expect(animations).toHaveLength(2);
      const [out, home] = animations.splice(0);

      // Home first, as in a browser. The token of the vote added still flies:
      // the card stays held, and a vote the viewer casts from their other
      // browser is not marked by the board meanwhile.
      act(() => { home.onfinish?.(); });
      serverSays(fromServer, 5, 0);
      serverSays(fromServer, 6, 1);
      expect(ring()).toBe(false);

      // It lands on nothing: no ring, no bump.
      act(() => { out.onfinish?.(); });
      expect(document.querySelector('.fx-layer')).toBeNull();
      expect(ring()).toBe(false);
      expect(within(card('t1')).getByTestId('my-guided-votes').classList.contains('fx-bump')).toBe(false);

      // Both tokens are in: the card is let go, and the next news is marked.
      serverSays(fromServer, 7, 2);
      expect(within(card('t1')).getByText('You gave it 2 votes')).toBeTruthy();
      expect(ring()).toBe(true);
    });

    // The same past three dots, where the add's token would land on the
    // number: it lands on nothing, so the number does not bump for it.
    it('bumps and rings nothing past three dots for a vote taken back before its token lands, and holds the card until both tokens are in', async () => {
      allowMotion();
      const fromServer = captureServerStates();
      await renderSession(pastThreeDots(5));
      pastTheQuietSeconds();
      await userEvent.click(plusOf());
      await userEvent.click(minusOf());
      expect(myVotesOn(lastWrite())).toBe(5);
      expect(theCount().textContent).toBe('5');
      expect(animations).toHaveLength(2);
      const [out, home] = animations.splice(0);

      // Home first. The add's token still flies: the card stays held, and a
      // vote the viewer takes back from their other browser is not marked.
      act(() => { home.onfinish?.(); });
      serverSays(fromServer, 5, 5);
      serverSays(fromServer, 6, 4);
      expect(theCount().textContent).toBe('4');
      expect(ring()).toBe(false);
      expect(countBumped()).toBe(false);

      // It lands on nothing, on a number still drawn: no bump, no ring.
      act(() => { out.onfinish?.(); });
      expect(document.querySelector('.fx-layer')).toBeNull();
      expect(countBumped()).toBe(false);
      expect(ring()).toBe(false);

      // Both tokens are in: the card is let go, and the next news is marked.
      serverSays(fromServer, 7, 5);
      expect(ring()).toBe(true);
    });

    // The cell beside it: a vote taken back, then added again before the
    // first token is home. The add's own token carries a vote that stays, and
    // lands with its marks.
    it('marks the vote added again while the one taken back flies home, where its own token lands', async () => {
      allowMotion();
      await renderSession(createSession({
        tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1'] }],
        groups: [],
      }, { maxVotes: 6 }));
      pastTheQuietSeconds();
      await userEvent.click(within(card('t1')).getByRole('button', { name: 'Remove a vote from this ticket' }));
      await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
      expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual(['facilitator-1']);
      expect(animations).toHaveLength(2);
      const [home, out] = animations.splice(0);
      act(() => { home.onfinish?.(); });
      expect(ring()).toBe(false);
      act(() => { out.onfinish?.(); });
      expect(ring()).toBe(true);
    });
  });

  it('shakes the budget when a vote is refused for lack of votes, and sends nothing flying', async () => {
    allowMotion();
    await renderSession(createSession({
      tickets: [
        { id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: [] },
        { id: 't4', colId: 'col-1', text: 'Spent', authorId: 'p1', groupId: null, votes: ['facilitator-1'] },
      ],
      groups: [],
    }, { maxVotes: 1 }));
    pastTheQuietSeconds();
    const writes = vi.mocked(syncService.updateSession).mock.calls.length;
    const plus = within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' });
    await userEvent.click(plus);
    expect(vi.mocked(syncService.updateSession).mock.calls.length).toBe(writes);
    expect(document.querySelector('[data-vote-budget]')!.classList.contains('fx-nope')).toBe(true);
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(document.activeElement).toBe(plus);
  });

  it('does not shake for "one vote per item": the budget is not the reason', async () => {
    allowMotion();
    await renderSession(createSession({
      tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1'] }],
      groups: [],
    }, { oneVotePerTicket: true }));
    pastTheQuietSeconds();
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect(document.querySelector('[data-vote-budget]')!.classList.contains('fx-nope')).toBe(false);
  });

  // Past three dots the pill draws one dot and the number, and the token
  // lands on the number: it bumps there, once, with the ring. Its control
  // bumped it in the vote's own commit too, as the token left, and the landing
  // bumped it again; the dot's own spring always waited for the token.
  it('bumps the count once, where the token lands, past three dots', async () => {
    allowMotion();
    await renderSession(createSession({
      tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1', 'facilitator-1', 'facilitator-1'] }],
      groups: [],
    }, { maxVotes: 6 }));
    pastTheQuietSeconds();
    const count = () => within(card('t1')).getByTestId('my-guided-votes');
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect(within(card('t1')).getByText('You gave it 4 votes')).toBeTruthy();
    expect(count().textContent).toBe('4');
    expect(animations).toHaveLength(1);
    // Nothing plays before the landing.
    expect(count().classList.contains('fx-bump')).toBe(false);
    expect(card('t1').classList.contains('fx-ring')).toBe(false);

    land();
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(count().classList.contains('fx-bump')).toBe(true);
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
  });

  it('flies nothing past ten votes a person: the dot springs in place', async () => {
    allowMotion();
    await renderSession(createSession({}, { maxVotes: 12 }));
    pastTheQuietSeconds();
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect(document.querySelector('[data-vote-tokens]')).toBeNull();
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(within(card('t1')).getByTestId('my-guided-votes').lastElementChild!.classList.contains('fx-pop')).toBe(true);
  });

  // Past three dots the same: no token and no hold, and the number bumps in
  // place, answered by its own plus. Nothing lands on it, so nothing rings
  // for the click: before the server's first state the board marks nothing,
  // and a ring there could only be a landing's.
  it('flies nothing past ten votes a person past three dots: the count bumps in place, and nothing holds the card', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    await renderSession(pastThreeDots(4, { maxVotes: 12 }));
    pastTheQuietSeconds();
    await userEvent.click(plusOf());
    expect(document.querySelector('[data-vote-tokens]')).toBeNull();
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(animations).toHaveLength(0);
    expect(theCount().textContent).toBe('5');
    expect(countBumped()).toBe(true);
    expect(card('t1').classList.contains('fx-ring')).toBe(false);

    // Nothing holds the card: once the server's state is drawn and its quiet
    // seconds are over, the board marks the vote the viewer takes back from
    // their other browser.
    const drawn = JSON.parse(JSON.stringify(lastWrite())) as RetroSession;
    act(() => { fromServer({ ...drawn, _rev: 3 }); });
    vi.mocked(Date.now).mockReturnValue(Date.now() + 5_000);
    const tookOneBack = JSON.parse(JSON.stringify(drawn)) as RetroSession;
    tookOneBack.tickets[0].votes = tookOneBack.tickets[0].votes.slice(1);
    act(() => { fromServer({ ...tookOneBack, _rev: 4 }); });
    expect(theCount().textContent).toBe('4');
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
  });

  // A vote taken back where no token flies is left to the board: once it is
  // live, the board marks the total that moved, as it marks any (a bump and
  // a ring), and nothing holds the card for a flight that never starts.
  it('leaves a vote taken back where no token flies to the board, which marks the total that moved', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    const start = createSession({
      tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1', 'facilitator-1'] }],
      groups: [],
    }, { maxVotes: 12 });
    await renderSession(start);
    act(() => { fromServer({ ...JSON.parse(JSON.stringify(start)), _rev: 3 }); });
    // Past the quiet seconds that follow the server's first state.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);

    await userEvent.click(minusOf());
    expect(myVotesOn(lastWrite())).toBe(1);
    expect(document.querySelector('[data-vote-tokens]')).toBeNull();
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(animations).toHaveLength(0);
    // The count changes in place: one dot left.
    expect(theCount().children).toHaveLength(1);
    expect(within(card('t1')).getByText('You gave it 1 vote')).toBeTruthy();
    expect(countBumped()).toBe(true);
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
  });

  it('plays nothing at all for a reader who asked for less motion', async () => {
    allowMotion(true);
    await renderSession(createSession());
    pastTheQuietSeconds();
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect(lastWrite()?.tickets.find((t) => t.id === 't1')?.votes).toEqual(['facilitator-1']);
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(effects()).toEqual([]);
  });
});

// A rolling update reconnects everybody, and a pod that starts with a cold
// cache can answer the re-join seconds later. The quiet seconds open when the
// state the reconnection brings back is drawn, not when the socket comes back:
// counted from the socket, a snapshot four seconds late was compared with the
// state from before the outage and played as news (review finding F60).
describe('Session — the quiet after a reconnection', () => {
  /** A clock the test moves by hand: the motion reads Date.now(). */
  const handClock = () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    return (ms: number) => { now += ms; };
  };
  /** Hands the screen the connection's state, as syncService would. */
  const captureConnection = () => {
    let listener: ((connected: boolean) => void) | null = null;
    vi.mocked(syncService.onConnectionChange).mockImplementation((callback) => {
      listener = callback as (connected: boolean) => void;
      return () => {};
    });
    return (connected: boolean) => act(() => { listener?.(connected); });
  };
  /** Hands the screen the rosters the server sends. */
  const captureRoster = () => {
    let listener: ((roster: Array<{ id: string; name: string }>) => void) | null = null;
    vi.mocked(syncService.onRoster).mockImplementation((callback) => {
      listener = callback as (roster: Array<{ id: string; name: string }>) => void;
      return () => {};
    });
    return (roster: Array<{ id: string; name: string }>) => act(() => { listener?.(roster); });
  };
  const brainstorm = createSession({ phase: 'BRAINSTORM' });
  /** The server's state, at `rev`, with a card of a teammate's for each id. */
  const withCards = (rev: number, ...ids: string[]): RetroSession => ({
    ...JSON.parse(JSON.stringify(brainstorm)),
    _rev: rev,
    tickets: [...brainstorm.tickets, ...ids.map((id) => ({ id, colId: 'col-1', text: `News ${id}`, authorId: 'p1', groupId: null, votes: [] }))],
  });
  const rowOf = (name: string) => {
    const row = screen.getAllByTestId('participant-row').find((candidate) => within(candidate).queryByText(name));
    if (!row) throw new Error(`no participant row for ${name}`);
    return row;
  };

  it('plays nothing on the board for the snapshot a reconnection brings back, however late, and plays what follows its quiet seconds', async () => {
    allowMotion();
    const connect = captureConnection();
    const fromServer = captureServerStates();
    await renderSession(brainstorm);
    const tick = handClock();
    act(() => fromServer(withCards(2)));
    tick(5_000);
    connect(false);
    connect(true);
    // The re-join is answered four seconds later.
    tick(4_000);
    act(() => fromServer(withCards(9, 'late')));
    expect(card('late').classList.contains('fx-card-in')).toBe(false);
    // The quiet seconds open there, not at the reconnection.
    tick(2_000);
    act(() => fromServer(withCards(10, 'late', 'soon')));
    expect(card('soon').classList.contains('fx-card-in')).toBe(false);
    tick(2_000);
    act(() => fromServer(withCards(11, 'late', 'soon', 'news')));
    expect(card('news').classList.contains('fx-card-in')).toBe(true);
  });

  it('slides no phase title in for the phase the late snapshot brings back, and slides the next one', async () => {
    allowMotion();
    const connect = captureConnection();
    const fromServer = captureServerStates();
    await renderSession(brainstorm);
    const tick = handClock();
    act(() => fromServer(withCards(2)));
    tick(5_000);
    connect(false);
    connect(true);
    tick(4_000);
    act(() => fromServer({ ...withCards(9), phase: 'GROUP' }));
    const group = await screen.findByRole('heading', { level: 2, name: 'Group Ideas' });
    expect(group.querySelector('[data-phase-title]')!.classList.contains('fx-title-in')).toBe(false);
    tick(4_000);
    act(() => fromServer({ ...withCards(10), phase: 'VOTE' }));
    const vote = await screen.findByRole('heading', { level: 2, name: 'Vote' });
    expect(vote.querySelector('[data-phase-title]')!.classList.contains('fx-title-in')).toBe(true);
  });

  it('lets nobody arrive in the panel with the roster a reconnection brings back, however late, and lets the next guest in', async () => {
    allowMotion();
    const connect = captureConnection();
    const roster = captureRoster();
    const bob: User = { id: 'p2', name: 'Bob', color: 'bg-emerald-500', role: 'participant' };
    await renderSession(createSession({ phase: 'BRAINSTORM', participants: [facilitator, participant, bob] }));
    const tick = handClock();
    roster([{ id: 'facilitator-1', name: 'Facilitator' }]);
    tick(5_000);
    connect(false);
    connect(true);
    tick(4_000);
    // Alice came back during the outage: the roster that comes back lists her.
    roster([{ id: 'facilitator-1', name: 'Facilitator' }, { id: 'p1', name: 'Alice' }]);
    expect(rowOf('Alice').classList.contains('fx-person-in')).toBe(false);
    tick(4_000);
    roster([{ id: 'facilitator-1', name: 'Facilitator' }, { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }]);
    expect(rowOf('Bob').classList.contains('fx-person-in')).toBe(true);
  });
});

// The vote controls draw the viewer's own votes, and spring the dot a vote
// adds, compared with what they drew last. They keep the board's quiet
// (Session.tsx → motionQuiet): the server's first state after the cached
// seed, or the snapshot a reconnection brings back, carries votes the seed
// lacked, and drawing them is no news — unless the control was just pressed,
// which a click in those seconds still answers (review finding F07).
describe('Session — the vote controls keep the board’s quiet', () => {
  const handClock = () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    return (ms: number) => { now += ms; };
  };
  const captureConnection = () => {
    let listener: ((connected: boolean) => void) | null = null;
    vi.mocked(syncService.onConnectionChange).mockImplementation((callback) => {
      listener = callback as (connected: boolean) => void;
      return () => {};
    });
    return (connected: boolean) => act(() => { listener?.(connected); });
  };
  const clone = (state: RetroSession, rev: number): RetroSession => ({ ...JSON.parse(JSON.stringify(state)), _rev: rev });
  /** `state` with the viewer's votes on the card or group `id`. */
  const withMyVotes = (state: RetroSession, rev: number, id: string, mine: number): RetroSession => {
    const next = clone(state, rev);
    const votes = Array.from({ length: mine }, () => 'facilitator-1');
    next.tickets = next.tickets.map((t) => (t.id === id ? { ...t, votes } : t));
    next.groups = next.groups.map((g) => (g.id === id ? { ...g, votes } : g));
    return next;
  };
  const guidedDot = (root: HTMLElement) => within(root).getByTestId('my-guided-votes').lastElementChild as HTMLElement;
  const group = () => document.querySelector('[data-group-id="g1"]') as HTMLElement;

  it('pops none of the viewer’s dots on the server’s first state after the cached seed', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    // The team cache lacks the vote the viewer cast just before reloading.
    const seed = createSession();
    await renderSession(seed);
    act(() => fromServer(withMyVotes(seed, 3, 't1', 1)));
    expect(within(card('t1')).getByText('You gave it 1 vote')).toBeTruthy();
    expect(guidedDot(card('t1')).classList.contains('fx-pop')).toBe(false);
    expect(effects()).toEqual([]);
  });

  it('pops no token of the budget for a number the server’s first state raises', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    const seed = createSession({}, { maxVotes: 3 });
    await renderSession(seed);
    const first = clone(seed, 3);
    first.settings = { ...first.settings, maxVotes: 5 };
    act(() => fromServer(first));
    expect(screen.getByText('5 votes remaining')).toBeTruthy();
    expect(document.querySelector('[data-vote-budget] [data-vote-next]')!.classList.contains('fx-pop')).toBe(false);
  });

  it('pops none of the viewer’s dots on an open board’s first state after the seed', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    const seed = createSession({ phase: 'OPEN_BOARD' });
    await renderSession(seed);
    act(() => fromServer(withMyVotes(seed, 3, 't1', 1)));
    const dots = within(card('t1')).getByTestId('my-votes');
    expect(dots.children).toHaveLength(1);
    expect(dots.lastElementChild!.classList.contains('fx-pop')).toBe(false);
  });

  it('pops none of a group’s dots for the snapshot a reconnection brings back', async () => {
    allowMotion();
    const connect = captureConnection();
    const fromServer = captureServerStates();
    const seed = createSession();
    await renderSession(seed);
    const tick = handClock();
    act(() => fromServer(clone(seed, 2)));
    tick(5_000);
    connect(false);
    connect(true);
    // The viewer voted from their other browser meanwhile.
    tick(500);
    act(() => fromServer(withMyVotes(seed, 9, 'g1', 1)));
    expect(within(group()).getByText('You gave it 1 vote')).toBeTruthy();
    expect(guidedDot(group()).classList.contains('fx-pop')).toBe(false);
  });

  it('still answers a click in those seconds: the dot it adds springs in', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    // Past ten votes no token flies: the dot springs in place.
    const seed = createSession({}, { maxVotes: 12 });
    await renderSession(seed);
    act(() => fromServer(clone(seed, 3)));
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect(guidedDot(card('t1')).classList.contains('fx-pop')).toBe(true);
  });

  it('still answers a vote taken back in those seconds: the token it refills springs in', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    const seed = withMyVotes(createSession(), 1, 't1', 1);
    await renderSession(seed);
    act(() => fromServer(clone(seed, 3)));
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Remove a vote from this ticket' }));
    expect(screen.getByText('5 votes remaining')).toBeTruthy();
    expect(document.querySelector('[data-vote-budget] [data-vote-next]')!.classList.contains('fx-pop')).toBe(true);
  });

  it('pops the dot of a vote from the viewer’s other browser once the quiet seconds are over', async () => {
    allowMotion();
    const fromServer = captureServerStates();
    const seed = createSession({}, { maxVotes: 12 });
    await renderSession(seed);
    const tick = handClock();
    act(() => fromServer(clone(seed, 3)));
    tick(4_000);
    act(() => fromServer(withMyVotes(seed, 4, 't1', 1)));
    expect(guidedDot(card('t1')).classList.contains('fx-pop')).toBe(true);
  });
});

describe('Session — the bar’s motion', () => {
  it('slides the phase title in at a phase change, never on the first paint', async () => {
    allowMotion();
    const deliver = captureServerStates();
    await renderSession(createSession({ phase: 'BRAINSTORM' }));
    expect(effects()).toEqual([]);
    act(() => deliver(createSession({ phase: 'BRAINSTORM' })));
    pastTheQuietSeconds();
    await userEvent.click(screen.getByRole('button', { name: 'Next Phase' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Group Ideas' });
    expect(title.querySelector('[data-phase-title]')!.classList.contains('fx-title-in')).toBe(true);
    // The heading clips it, so the slide never spills over the bar.
    expect(title.classList.contains('overflow-hidden')).toBe(true);
  });

  it('draws the Finished button that cannot be pressed as off, by its colours and never by an opacity', async () => {
    // Every vote spent: the Vote phase finished the viewer and will not let
    // them take it back. On a phone no cursor says so; the colours must.
    await renderSession(createSession({
      tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1'] }],
      groups: [],
      finishedUsers: ['facilitator-1'],
    }, { maxVotes: 1 }));
    const off = screen.getByRole('button', { name: /Finished!/ });
    expect(off.hasAttribute('disabled')).toBe(true);
    expect(off.className).not.toMatch(/(^|\s)(disabled:)?opacity-/);
    // Not the look of the Finished button that can be pressed.
    expect(off.className).not.toContain('bg-emerald-50');
    expect(effectivePair(off).ratio).toBeGreaterThanOrEqual(4.5);
    expect(effectivePair(off).bg).toBe('slate-100');

    // With a vote left, the same button can be pressed and keeps its green.
    cleanupView();
    await renderSession(createSession({
      tickets: [{ id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: ['facilitator-1'] }],
      groups: [],
      finishedUsers: ['facilitator-1'],
    }, { maxVotes: 2 }));
    const on = screen.getByRole('button', { name: /Finished!/ });
    expect(on.hasAttribute('disabled')).toBe(false);
    expect(on.className).toContain('bg-emerald-50');
    expect(effectivePair(on).ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('never slides the title in from the cached seed to the server’s first state, however late it lands', async () => {
    allowMotion();
    const deliver = captureServerStates();
    // The cache still says Brainstorm; the server, seconds later, says Group.
    await renderSession(createSession({ phase: 'BRAINSTORM' }));
    pastTheQuietSeconds();
    act(() => deliver(createSession({ phase: 'GROUP' })));
    await screen.findByRole('heading', { level: 2, name: 'Group Ideas' });
    expect(effects()).toEqual([]);
  });

  it('answers a press of “I’m Finished”', async () => {
    allowMotion();
    await renderSession(createSession({ phase: 'BRAINSTORM' }));
    const button = screen.getByRole('button', { name: "I'm Finished" });
    await userEvent.click(button);
    expect(lastWrite()?.finishedUsers).toEqual(['facilitator-1']);
    expect(button.classList.contains('fx-press')).toBe(true);
  });
});
