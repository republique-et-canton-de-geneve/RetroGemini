import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import LanguageProvider from '../i18n/LanguageProvider';
import { syncService } from '../services/syncService';
import { RetroSession, Team, User } from '../types';

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

  it('flies nothing past ten votes a person: the dot springs in place', async () => {
    allowMotion();
    await renderSession(createSession({}, { maxVotes: 12 }));
    pastTheQuietSeconds();
    await userEvent.click(within(card('t1')).getByRole('button', { name: 'Add a vote to this ticket' }));
    expect(document.querySelector('[data-vote-tokens]')).toBeNull();
    expect(document.querySelector('.fx-layer')).toBeNull();
    expect(within(card('t1')).getByTestId('my-guided-votes').lastElementChild!.classList.contains('fx-pop')).toBe(true);
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

describe('Session — the bar’s motion', () => {
  it('slides the phase title in at a phase change, never on the first paint', async () => {
    allowMotion();
    await renderSession(createSession({ phase: 'BRAINSTORM' }));
    expect(effects()).toEqual([]);
    pastTheQuietSeconds();
    await userEvent.click(screen.getByRole('button', { name: 'Next Phase' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Group Ideas' });
    expect(title.querySelector('[data-phase-title]')!.classList.contains('fx-title-in')).toBe(true);
    // The heading clips it, so the slide never spills over the bar.
    expect(title.classList.contains('overflow-hidden')).toBe(true);
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
