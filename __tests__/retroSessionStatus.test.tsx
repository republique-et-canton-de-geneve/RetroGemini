import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { syncService } from '../services/syncService';
import { dataService } from '../services/dataService';
import { RetroSession, Team, User } from '../types';

/**
 * The retro half of the shared status rule (utils/sessionStatus.ts): opening
 * Close ends the session, and nothing reopens it as a side effect — exactly as
 * in a health check. Before, leaving a retro at any phase other than Close
 * wrote it back to IN_PROGRESS, so reading a finished retro's summary through
 * its phases put it back in progress.
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

  it('stays closed while the facilitator reads the summary back through the phases', () => {
    renderRetro('CLOSE', 'CLOSED');

    fireEvent.click(screen.getByRole('button', { name: 'REVIEW' }));

    expect(lastSynced().phase).toBe('REVIEW');
    expect(lastSynced().status).toBe('CLOSED');
  });

  it('is not reopened by the facilitator leaving from an earlier phase', () => {
    // The previous exit rule set IN_PROGRESS whenever the retro was left at a
    // phase other than Close — "View Summary" plus one click back was enough.
    renderRetro('REVIEW', 'CLOSED');

    fireEvent.click(screen.getByRole('button', { name: 'Leave the retrospective' }));

    const persisted = vi.mocked(dataService.updateSession).mock.calls.map(([, s]) => s.status);
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted).not.toContain('IN_PROGRESS');
  });
});
