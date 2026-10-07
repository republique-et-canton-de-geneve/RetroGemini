import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { syncService } from '../services/syncService';
import { RetroSession, Team, User } from '../types';

/**
 * The retro half of the shared status rule (utils/sessionStatus.ts): opening
 * Close ends the session and going back from it reopens it, exactly as in a
 * health check. Before, a retro taken back from Close stayed CLOSED until its
 * facilitator left the session.
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
    isConnected: vi.fn(() => true),
  },
}));

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const createSession = (phase: string, status: RetroSession['status']): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status,
  phase,
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
    { id: 't1', colId: 'col-1', text: 'Deploys are scary', authorId: 'facilitator-1', groupId: null, votes: [] },
  ],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
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

const lastSynced = (): RetroSession => {
  const calls = vi.mocked(syncService.updateSession).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as RetroSession;
};

const renderRetro = (phase: string, status: RetroSession['status']) => {
  const session = createSession(phase, status);
  return render(
    <Session team={createTeam(session)} sessionId={session.id} currentUser={facilitator} onExit={() => {}} />
  );
};

describe('Retrospective status follows the phase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('is closed when the facilitator opens Close', () => {
    renderRetro('REVIEW', 'IN_PROGRESS');

    fireEvent.click(screen.getByRole('button', { name: 'CLOSE' }));

    expect(lastSynced().phase).toBe('CLOSE');
    expect(lastSynced().status).toBe('CLOSED');
  });

  it('reopens when the facilitator goes back from Close', () => {
    renderRetro('CLOSE', 'CLOSED');

    fireEvent.click(screen.getByRole('button', { name: 'REVIEW' }));

    expect(lastSynced().phase).toBe('REVIEW');
    expect(lastSynced().status).toBe('IN_PROGRESS');
  });
});
