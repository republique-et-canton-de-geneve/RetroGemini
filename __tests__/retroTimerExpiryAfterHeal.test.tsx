import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { syncService } from '../services/syncService';
import { RetroSession, Team, User } from '../types';

/**
 * The retro's timer writes through `Session.updateSession`, which builds every
 * write on `sessionRef`. The countdown moved into a child component
 * (`SessionTimer`), and React runs a child's effects before its parent's: with
 * the ref synced in a passive effect, an expiry written from the countdown's
 * effect was built on the previous render's session. After the server healed a
 * refused expiry, the retry was built on the refused write itself — stale again,
 * refused again — so a retro reopened on a run that ran out unattended never
 * stopped. The ref is now synced in a layout effect, which runs before any
 * passive effect of the same commit.
 */

let deliver: ((session: unknown) => void) | null = null;

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
    onSessionUpdate: vi.fn((callback: (session: unknown) => void) => {
      deliver = callback;
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    isConnected: vi.fn(() => true),
  },
}));

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

// A run started ten minutes ago with five on the clock, that nobody stopped:
// the team record still holds it as running, one revision behind the server.
const ranOutUnattended = (rev: number): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'CLOSE',
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerRunning: true,
    timerStartedAt: Date.now() - 600_000,
    timerInitial: 300,
    timerSeconds: 300,
    timerAcknowledged: false,
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: rev,
});

const team = (session: RetroSession): Team => ({
  id: 'team-1',
  name: 'Test Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [session],
  globalActions: [],
});

const expiryWrites = (): RetroSession[] =>
  vi.mocked(syncService.updateSession).mock.calls
    .map(([blob]) => blob as RetroSession)
    .filter((blob) => blob.settings.timerRunning === false && blob.settings.timerSeconds === 0);

describe('retro timer: an expiry written after a heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliver = null;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is built on the healed state, not on the write the server refused', () => {
    const stored = ranOutUnattended(4);
    render(<Session team={team(stored)} sessionId={stored.id} currentUser={facilitator} onExit={() => {}} />);

    // Opening on a run that is over closes it at once — built on the team
    // record's copy, which the server refuses as one revision behind.
    expect(expiryWrites().length).toBeGreaterThan(0);
    expect(expiryWrites()[0]._rev).toBe(4);
    expect(deliver).not.toBeNull();

    // The server heals this client with its own state: the run, still running.
    const before = expiryWrites().length;
    act(() => {
      deliver!(ranOutUnattended(5));
    });

    // The retry must carry the healed revision, or it is refused again — for
    // ever, since every heal restores the same run.
    const retries = expiryWrites().slice(before);
    expect(retries.length).toBeGreaterThan(0);
    expect(retries[retries.length - 1]._rev).toBe(5);
  });
});
