import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('ReviewPhase summary note', () => {
  it('lets facilitator update retro report summary', () => {
    const updateSession = vi.fn();
    const session = createSession({ reviewSummary: '' });

    render(
      <ReviewPhase
        session={session}
        team={team}
        currentUser={facilitator}
        isFacilitator
        historyActionIds={[]}
        setPhase={vi.fn()}
        updateSession={updateSession}
        applyActionUpdate={vi.fn()}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team.members}
        setRefreshTick={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText('Write the retrospective report summary here...');
    fireEvent.change(textarea, { target: { value: 'Sprint remained stable overall.' } });

    expect(updateSession).toHaveBeenCalledTimes(1);
    const updater = updateSession.mock.calls[0][0] as (draft: RetroSession) => void;
    const draft = createSession({ reviewSummary: '' });
    updater(draft);
    expect(draft.reviewSummary).toBe('Sprint remained stable overall.');
  });

  it('shows read-only summary to participants', () => {
    const session = createSession({ reviewSummary: 'Final report text.' });

    render(
      <ReviewPhase
        session={session}
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
      />
    );

    expect(screen.queryByPlaceholderText('Write the retrospective report summary here...')).toBeNull();
    expect(screen.getByText('Final report text.')).toBeTruthy();
  });
});
