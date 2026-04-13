import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReviewPhase from '../components/session/ReviewPhase';
import { ActionItem, RetroSession, Team, User } from '../types';

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

const member1: User = {
  id: 'mem-1',
  name: 'Alice',
  color: 'bg-blue-500',
  role: 'participant'
};

const member2: User = {
  id: 'mem-2',
  name: 'Bob',
  color: 'bg-green-500',
  role: 'participant'
};

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, member1, member2],
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
  participants: [facilitator, member1, member2],
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
  tickets: [
    { id: 'tkt-1', colId: 'col-1', text: 'Some ticket', authorId: 'fac-1', groupId: null, votes: [] }
  ],
  groups: [],
  actions: [
    { id: 'act-1', text: 'Fix the build', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-1', proposalVotes: {} }
  ],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

/**
 * Wrapper that simulates Session.tsx behavior: a parent with timer state
 * that re-renders ReviewPhase as a child when the timer ticks.
 * This reproduces the bug where ActionRow (defined inside ReviewPhase)
 * gets a new function identity on each render, causing React to unmount
 * and remount ActionRow components, which destroys local state (e.g.
 * the open state of a <select> dropdown, or text being edited in an input).
 */
let triggerTimerTick: () => void;

const TimerWrapper: React.FC<{
  session: RetroSession;
  applyActionUpdate: (actionId: string, updater: (action: ActionItem) => void, actionOverride?: ActionItem) => void;
  updateSession: (updater: (session: RetroSession) => void) => void;
  setRefreshTick: React.Dispatch<React.SetStateAction<number>>;
}> = ({ session, applyActionUpdate, updateSession, setRefreshTick }) => {
  const [timerSeconds, setTimerSeconds] = useState(300);

  // Expose the trigger so tests can simulate a timer tick
  triggerTimerTick = () => setTimerSeconds((s) => s - 1);

  return (
    <div>
      <span data-testid="timer">{timerSeconds}</span>
      <ReviewPhase
        session={session}
        team={team}
        currentUser={facilitator}
        isFacilitator
        historyActionIds={[]}
        setPhase={vi.fn()}
        updateSession={updateSession}
        applyActionUpdate={applyActionUpdate}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team.members}
        setRefreshTick={setRefreshTick}
      />
    </div>
  );
};

describe('ReviewPhase assignee dropdown during timer', () => {
  it('preserves ActionRow local state when parent re-renders due to timer tick', () => {
    const session = createSession();

    render(
      <TimerWrapper
        session={session}
        applyActionUpdate={vi.fn()}
        updateSession={vi.fn()}
        setRefreshTick={vi.fn()}
      />
    );

    // Type into the action text input to create local state in ActionRow
    const actionInput = screen.getByDisplayValue('Fix the build');
    fireEvent.change(actionInput, { target: { value: 'Fix the build process' } });
    expect(actionInput).toHaveValue('Fix the build process');

    // Simulate a timer tick: parent state changes, causing ReviewPhase to re-render.
    // If ActionRow is defined inside ReviewPhase, its function identity changes on
    // each render, causing React to unmount/remount it and lose local state.
    act(() => {
      triggerTimerTick();
    });

    // After parent re-render, ActionRow local state should be preserved.
    // BUG: If ActionRow is defined inside ReviewPhase, this will fail because
    // pendingText state resets to action.text ("Fix the build") on remount.
    expect(screen.getByDisplayValue('Fix the build process')).toBeInTheDocument();
  });

  it('allows assigning an action after timer-triggered re-renders', () => {
    const applyActionUpdate = vi.fn();
    const session = createSession();

    render(
      <TimerWrapper
        session={session}
        applyActionUpdate={applyActionUpdate}
        updateSession={vi.fn()}
        setRefreshTick={vi.fn()}
      />
    );

    // Simulate multiple timer ticks (as happens every second when timer is running)
    act(() => { triggerTimerTick(); });
    act(() => { triggerTimerTick(); });

    // Now try to change the assignee - this should still work
    const dropdown = screen.getByDisplayValue('Unassigned');
    fireEvent.change(dropdown, { target: { value: 'mem-1' } });

    expect(applyActionUpdate).toHaveBeenCalledWith(
      'act-1',
      expect.any(Function),
      expect.objectContaining({ id: 'act-1' })
    );
  });
});
