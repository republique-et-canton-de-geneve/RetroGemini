import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

// Mock the persistence/sync services so the Session can mount without a backend.
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
  },
}));

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const participant: User = { id: 'p1', name: 'Alice', color: 'bg-red-500', role: 'participant' };

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
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
  },
  tickets: [
    { id: 't1', colId: 'col-1', text: 'Great teamwork', authorId: 'p1', groupId: null, votes: [], reactions: { '👍': ['p1'] } },
  ],
  groups: [],
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

describe('Session - emoji reactions visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('keeps ticket emoji reactions visible during the VOTE phase', async () => {
    const session = createSession();
    const team = createTeam(session);

    const { container } = render(
      <Session team={team} currentUser={facilitator} sessionId="session-1" onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain('Great teamwork');
    });

    const reactionButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('👍'),
    );
    expect(reactionButton).toBeTruthy();
    // The reaction button shows the emoji together with its voter count.
    expect(reactionButton?.textContent).toContain('1');
  });
});
