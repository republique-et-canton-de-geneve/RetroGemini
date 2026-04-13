import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewPhase from '../components/session/ReviewPhase';
import { RetroSession, Team, User } from '../types';

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn()
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const participant: User = {
  id: 'member-1',
  name: 'Member',
  color: 'bg-emerald-500',
  role: 'participant'
};

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  participants: [facilitator, participant],
  discussionFocusId: null,
  discussionNextTopicVotes: {},
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

describe('ReviewPhase AI summary button', () => {
  it('shows AI generate button for facilitator when AI is enabled', () => {
    render(
      <ReviewPhase
        session={createSession()}
        team={team}
        currentUser={facilitator}
        isFacilitator
        historyActionIds={[]}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        applyActionUpdate={vi.fn()}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team.members}
        setRefreshTick={vi.fn()}
        aiEnabled
      />
    );

    expect(screen.getByText('Generate with AI')).toBeTruthy();
  });

  it('does not show AI button when AI is disabled', () => {
    render(
      <ReviewPhase
        session={createSession()}
        team={team}
        currentUser={facilitator}
        isFacilitator
        historyActionIds={[]}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        applyActionUpdate={vi.fn()}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team.members}
        setRefreshTick={vi.fn()}
        aiEnabled={false}
      />
    );

    expect(screen.queryByText('Generate with AI')).toBeNull();
  });

  it('does not show AI button for participants', () => {
    render(
      <ReviewPhase
        session={createSession()}
        team={team}
        currentUser={participant}
        isFacilitator={false}
        historyActionIds={[]}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        applyActionUpdate={vi.fn()}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team.members}
        setRefreshTick={vi.fn()}
        aiEnabled
      />
    );

    expect(screen.queryByText('Generate with AI')).toBeNull();
  });
});
