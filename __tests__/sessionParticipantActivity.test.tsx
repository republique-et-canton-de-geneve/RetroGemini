import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import Session from '../components/Session';
import { syncService } from '../services/syncService';
import type { ParticipantActivity, RetroSession, Team, User } from '../types';

/**
 * The live "is typing" signal and the Vote phase's votes left, as the whole
 * retrospective screen receives and draws them (43.0).
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
} = { activity: null, left: null };

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
    onSessionUpdate: vi.fn(() => () => {}),
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

// As the facilitator, whose participants panel opens expanded.
const renderRetro = (local: RetroSession) => {
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(local.id);
  return render(
    <Session team={team({ retrospectives: [local] })} sessionId={local.id} currentUser={facilitator} onExit={() => {}} />
  );
};

const signal = (activity: ParticipantActivity | null) =>
  act(() => { handlers.activity?.({ userId: 'me', userName: 'Mine', activity }); });

describe('the session screen and its participants panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.activity = null;
    handlers.left = null;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
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
    const ownRow = screen.getAllByTestId('participant-row').find((row) => within(row).queryByText('(you)'));
    expect(ownRow).toBeTruthy();
    expect(within(ownRow as HTMLElement).getByText('3 votes left')).toBeTruthy();
  });
});
