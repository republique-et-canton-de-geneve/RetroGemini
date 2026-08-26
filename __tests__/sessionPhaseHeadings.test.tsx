import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

// `RetroSession.phase` is a plain string in `types.ts`, so the phases this spec
// walks are named here rather than imported.
type RetroPhase = 'BRAINSTORM' | 'GROUP' | 'VOTE';

/**
 * Phase titles are headings, and icon-only controls have names (H42).
 *
 * Two of the manual accessibility pass's four findings, neither of which axe
 * can see. A screen-reader user gets no document outline when the phase title
 * is a bare `<span>` — there is nothing to jump to and nothing announcing which
 * phase the session is in. And the header's exit control was a `<button>` whose
 * only content was the icon font's ligature, so it announced itself as
 * "arrow_back".
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

const createSession = (phase: RetroPhase): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
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

const renderPhase = (phase: RetroPhase) => {
  const session = createSession(phase);
  return render(
    <Session
      team={createTeam(session)}
      sessionId={session.id}
      currentUser={facilitator}
      onExit={() => {}}
    />
  );
};

describe('Session phases — the document outline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it.each([
    ['BRAINSTORM' as const, 'Brainstorm'],
    ['GROUP' as const, 'Group Ideas'],
    ['VOTE' as const, 'Vote'],
  ])('announces the %s phase with a heading, not a bare span', async (phase, title) => {
    renderPhase(phase);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    });
  });

  it('names the exit control instead of leaking the icon ligature', async () => {
    renderPhase('BRAINSTORM');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Leave the retrospective' })).toBeTruthy();
    });
    // The old accessible name came from the glyph's own text node.
    expect(screen.queryByRole('button', { name: 'arrow_back' })).toBeNull();
  });
});
