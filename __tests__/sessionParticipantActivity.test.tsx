import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Session from '../components/Session';
import { syncService } from '../services/syncService';
import type { ParticipantActivity, RetroSession, Team, User } from '../types';

/**
 * The live "is typing" signal and the Vote phase's votes left, as the whole
 * retrospective screen receives, sends and draws them (43.0).
 *
 * A peer's signal reaches the screen as data: any team credential can send
 * one, and a pod from before 43.0 relays whatever it was sent. A '__proto__'
 * used to reach the participants panel, whose label lookup handed React an
 * object, and the whole session screen went blank (there is no error
 * boundary). syncService is mocked here, so the screen gets the raw value,
 * which is exactly what the panel must survive on its own.
 */

type ActivityEvent = { userId: string; userName: string; activity: ParticipantActivity | null };

const handlers: {
  activity: ((event: ActivityEvent) => void) | null;
  left: ((member: { userId: string; userName?: string }) => void) | null;
  session: ((state: RetroSession) => void) | null;
} = { activity: null, left: null, session: null };

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    getHealthCheck: vi.fn(() => null),
    updateSession: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => null),
    onSessionUpdate: vi.fn((callback: (state: RetroSession) => void) => {
      handlers.session = callback;
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn((callback: (member: { userId: string; userName?: string }) => void) => {
      handlers.left = callback;
      return () => {};
    }),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn((callback: (event: ActivityEvent) => void) => {
      handlers.activity = callback;
      return () => {};
    }),
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

const me: User = { id: 'me', name: 'Mine', color: 'bg-indigo-500', role: 'participant' };
const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-rose-500', role: 'facilitator' };

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [me, facilitator],
  icebreakerQuestion: '',
  columns: [{
    id: 'col-1',
    title: 'What Went Well',
    color: 'bg-emerald-500',
    border: 'border-emerald-500',
    icon: 'sentiment_satisfied',
    text: 'text-emerald-700',
    ring: 'ring-emerald-300',
  }],
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
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 1,
  ...overrides,
});

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [me, facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [],
  ...overrides,
});

const renderRetroAs = (user: User, local: RetroSession) => {
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(local.id);
  return render(
    <Session team={team({ retrospectives: [local] })} sessionId={local.id} currentUser={user} onExit={() => {}} />
  );
};

// As the facilitator, whose participants panel opens expanded.
const renderRetro = (local: RetroSession) => renderRetroAs(facilitator, local);

const signal = (activity: ParticipantActivity | null) =>
  act(() => { handlers.activity?.({ userId: 'me', userName: 'Mine', activity }); });

// A state another client wrote, as the server broadcasts it.
const receive = (state: RetroSession) => act(() => { handlers.session?.(state); });

// What this screen sent last as its own typing signal.
const lastSent = () => vi.mocked(syncService.sendActivity).mock.calls.at(-1)?.[0];

const ticketIn = (id: string, colId: string, votes: string[] = [], groupId: string | null = null) => ({
  id, colId, text: `Card ${id}`, authorId: 'me', groupId, votes,
});

const secondColumn = {
  id: 'col-2',
  title: 'To Improve',
  color: 'bg-rose-500',
  border: 'border-rose-500',
  icon: 'sentiment_dissatisfied',
  text: 'text-rose-700',
  ring: 'ring-rose-300',
};

// The Vote bar's own chip and the reader's row in their panel.
const barChip = () => screen.getByText(/^\d+ votes? remaining$/).textContent;
const ownRow = () => {
  const row = screen.getAllByTestId('participant-row').find((candidate) => within(candidate).queryByText('(you)'));
  if (!row) throw new Error('no row for the reader');
  return row;
};
const numberIn = (text: string | null | undefined) => Number(/^(\d+)/.exec(text ?? '')?.[1]);

describe('the session screen and its participants panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.activity = null;
    handlers.left = null;
    handlers.session = null;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the session on screen when a peer signals a kind it does not know ("__proto__" used to blank it)', () => {
    renderRetro(retro());
    expect(screen.getByRole('heading', { name: 'Brainstorm' })).toBeTruthy();

    signal('__proto__' as never);

    expect(screen.getByRole('heading', { name: 'Brainstorm' })).toBeTruthy();
    expect(screen.getByTestId('typing-now').textContent).toBe('Nobody is writing');
  });

  it('names a peer who is writing, and forgets them on a stop and when they leave', () => {
    renderRetro(retro());

    signal('brainstorm');
    expect(screen.getByTestId('typing-now').textContent).toBe('Writing now (1): Mine');

    signal(null);
    expect(screen.getByTestId('typing-now').textContent).toBe('Nobody is writing');

    signal('brainstorm');
    expect(screen.getByTestId('typing-now').textContent).toBe('Writing now (1): Mine');
    act(() => { handlers.left?.({ userId: 'me' }); });
    expect(screen.getByTestId('typing-now').textContent).toBe('Nobody is writing');
  });

  it("counts the reader's own votes left as the bar does", () => {
    renderRetro(retro({
      phase: 'VOTE',
      tickets: [{ id: 't1', colId: 'col-1', text: 'Ship smaller', authorId: 'me', groupId: null, votes: ['fac', 'fac'] }],
    }));

    expect(screen.getByText('3 votes remaining')).toBeTruthy();
    expect(within(ownRow()).getByText('3 votes left')).toBeTruthy();
  });

  // One count, read by the bar and by the panel alike (review of 43.0: they
  // were two copies, and a change to one would have left every suite green).
  it('says the same number in the bar and in the reader\'s row: a group, a grouped card\'s own votes, stacked votes', () => {
    renderRetro(retro({
      phase: 'VOTE',
      tickets: [
        ticketIn('t1', 'col-1', ['fac', 'fac']),
        // A card that carries the reader's vote into its group (votes cast
        // before it was grouped, a retro back from an open board).
        ticketIn('t2', 'col-1', ['fac'], 'g1'),
      ],
      groups: [{ id: 'g1', title: 'Topic', colId: 'col-1', votes: ['fac'] }],
    }));

    expect(barChip()).toBe('1 vote remaining');
    expect(within(ownRow()).getByTestId('votes-left').textContent).toContain('1 vote left');
    expect(numberIn(barChip())).toBe(numberIn(within(ownRow()).getByText(/votes? left$/).textContent));
  });

  // With one vote per item, a reader who voted on every item has nothing left to
  // place, whatever the number leaves them: the bar and the row say 0, and the
  // Vote phase finishes them on its own, as it does when the number runs out.
  it('finishes the reader once no item takes their vote, with one vote per item', () => {
    vi.useFakeTimers();
    const local = retro({
      phase: 'VOTE',
      tickets: [ticketIn('t1', 'col-1', ['fac']), ticketIn('t2', 'col-1', [], 'g1')],
      groups: [{ id: 'g1', title: 'Topic', colId: 'col-1', votes: ['fac'] }],
    });
    local.settings = { ...local.settings, oneVotePerTicket: true };
    renderRetro(local);

    expect(barChip()).toBe('0 votes remaining');
    expect(within(ownRow()).getByText('0 votes left')).toBeTruthy();

    const finishedWrites = () => vi.mocked(syncService.updateSession).mock.calls
      .map(([state]) => state as RetroSession)
      .filter((state) => state.finishedUsers?.includes('fac'));
    act(() => { vi.advanceTimersByTime(799); });
    expect(finishedWrites()).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(finishedWrites()).toHaveLength(1);
    expect(finishedWrites()[0].autoFinishedUsers).toContain('fac');
    expect(within(ownRow()).getByRole('img', { name: 'Finished' })).toBeTruthy();
  });

  // The receiver forgets a signal 4 s after it came, unless another comes: it is
  // the only thing that takes someone off the line when their stop never
  // arrives (a laptop lid closed mid-card: no blur, and member-left comes with
  // the socket's ping timeout, about 45 s later).
  it('forgets a peer whose stop never arrives, 4 s after their last signal', () => {
    vi.useFakeTimers();
    renderRetro(retro());

    signal('brainstorm');
    act(() => { vi.advanceTimersByTime(3_900); });
    expect(screen.getByTestId('typing-now').textContent).toBe('Writing now (1): Mine');

    // The sender's 2 s keepalive re-arms the expiry.
    signal('brainstorm');
    act(() => { vi.advanceTimersByTime(3_900); });
    expect(screen.getByTestId('typing-now').textContent).toBe('Writing now (1): Mine');

    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('typing-now').textContent).toBe('Nobody is writing');
  });
});

// What this screen tells the others about its own typing: "writing" while a
// focused field holds a draft, from the focus on, and nothing once that field is
// left or gone. A field React removes runs no blur (react-dom ignores events
// during a commit), so the keepalive checks the field before it re-sends.
describe('the typing signal the screen sends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.activity = null;
    handlers.left = null;
    handlers.session = null;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says writing while a draft is typed, stops on a blur, and says it again when the field holding the draft is focused', () => {
    renderRetroAs(me, retro());
    const field = screen.getByPlaceholderText('Add an idea...') as HTMLTextAreaElement;

    act(() => { field.focus(); });
    fireEvent.input(field, { target: { value: 'Ship smaller' } });
    expect(lastSent()).toBe('brainstorm');

    act(() => { field.blur(); });
    expect(lastSent()).toBeNull();

    // Back into the field, its draft kept, and no key pressed yet.
    vi.mocked(syncService.sendActivity).mockClear();
    act(() => { field.focus(); });
    expect(syncService.sendActivity).toHaveBeenCalledWith('brainstorm');

    // An empty field focused says nothing.
    act(() => { field.blur(); });
    fireEvent.input(field, { target: { value: '' } });
    vi.mocked(syncService.sendActivity).mockClear();
    act(() => { field.focus(); });
    expect(syncService.sendActivity).not.toHaveBeenCalled();
  });

  it('stops within one keepalive once the facilitator moves the Discuss focus away from the proposal being typed', () => {
    const discuss = retro({
      phase: 'DISCUSS',
      discussionFocusId: 't1',
      tickets: [ticketIn('t1', 'col-1', ['fac', 'me']), ticketIn('t2', 'col-1', ['fac'])],
    });
    renderRetroAs(me, discuss);
    const input = screen.getByPlaceholderText('Propose an action...') as HTMLInputElement;

    act(() => { input.focus(); });
    fireEvent.change(input, { target: { value: 'Add a checklist' } });
    expect(lastSent()).toBe('proposal');

    receive({ ...discuss, discussionFocusId: 't2', _rev: 2 });
    // The input under the first topic is gone; the draft is under the second, unfocused.
    expect(input.isConnected).toBe(false);
    expect((screen.getByPlaceholderText('Propose an action...') as HTMLInputElement).value).toBe('Add a checklist');

    vi.mocked(syncService.sendActivity).mockClear();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(vi.mocked(syncService.sendActivity).mock.calls).toEqual([[null]]);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(vi.mocked(syncService.sendActivity).mock.calls).toEqual([[null]]);
  });

  it('stops within one keepalive once the column being written in is removed', () => {
    const brainstorm = retro({ columns: [...retro().columns, secondColumn] });
    renderRetroAs(me, brainstorm);
    const field = document.querySelector('textarea[data-brainstorm-input="col-2"]') as HTMLTextAreaElement;

    act(() => { field.focus(); });
    fireEvent.input(field, { target: { value: 'Fewer meetings' } });
    expect(lastSent()).toBe('brainstorm');

    // The facilitator removes the column in Edit Layout.
    receive({ ...brainstorm, columns: retro().columns, _rev: 2 });
    expect(field.isConnected).toBe(false);

    vi.mocked(syncService.sendActivity).mockClear();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(vi.mocked(syncService.sendActivity).mock.calls).toEqual([[null]]);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(vi.mocked(syncService.sendActivity).mock.calls).toEqual([[null]]);
  });

  it('keeps saying writing while the field keeps the focus and its draft', () => {
    renderRetroAs(me, retro());
    const field = screen.getByPlaceholderText('Add an idea...') as HTMLTextAreaElement;

    act(() => { field.focus(); });
    fireEvent.input(field, { target: { value: 'Ship smaller' } });
    vi.mocked(syncService.sendActivity).mockClear();
    act(() => { vi.advanceTimersByTime(6_000); });

    expect(vi.mocked(syncService.sendActivity).mock.calls).toEqual([['brainstorm'], ['brainstorm'], ['brainstorm']]);
  });
});
