import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OpenActionsPhase from '../components/session/OpenActionsPhase';
import { dataService } from '../services/dataService';
import { ActionItem, RetroSession, Team, User } from '../types';

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn()
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const makeAction = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const openActions = [
  makeAction('act-1', 'Add a DOR compliance filter'),
  makeAction('act-2', 'Observe BAs once per release'),
  makeAction('act-3', 'Allow marking sprint review topics as interesting')
];

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: openActions
};

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'OPEN_ACTIONS',
  participants: [facilitator],
  discussionFocusId: null,
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 180,
    timerRunning: false,
    timerInitial: 180
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const renderPhase = (
  session: RetroSession,
  reviewActionIds: string[],
  props: Partial<React.ComponentProps<typeof OpenActionsPhase>> = {}
) =>
  render(
    <OpenActionsPhase
      team={team}
      session={session}
      isFacilitator
      reviewActionIds={reviewActionIds}
      setPhase={vi.fn()}
      applyActionUpdate={vi.fn()}
      assignableMembers={team.members}
      buildActionContext={vi.fn(() => '')}
      setRefreshTick={vi.fn()}
      {...props}
    />
  );

beforeEach(() => {
  vi.mocked(dataService.getTeam).mockReturnValue(team);
});

describe('OpenActionsPhase action list', () => {
  it('shows every open action when the snapshot and review ids agree', () => {
    const session = createSession({ openActionsSnapshot: openActions });
    renderPhase(session, openActions.map(a => a.id));

    openActions.forEach(action => {
      expect(screen.getByText(action.text)).toBeInTheDocument();
    });
  });

  it('keeps showing the other actions when the snapshot degenerated to only the toggled action', () => {
    // Regression: a lost write race at phase entry can leave the session with
    // no snapshot; toggling "done" then seeds the snapshot with only the
    // toggled action. The other open actions of the review must NOT disappear.
    const degenerateSnapshot = [{ ...openActions[0], done: true }];
    const session = createSession({ openActionsSnapshot: degenerateSnapshot });
    renderPhase(session, openActions.map(a => a.id));

    openActions.forEach(action => {
      expect(screen.getByText(action.text)).toBeInTheDocument();
    });
    // The toggled action reflects the snapshot's done state.
    expect(screen.getByText(openActions[0].text)).toHaveClass('line-through');
    // The others stay open (no strikethrough).
    expect(screen.getByText(openActions[1].text)).not.toHaveClass('line-through');
    expect(screen.getByText(openActions[2].text)).not.toHaveClass('line-through');
  });

  it('still renders snapshot-only actions when review ids are empty (participant fallback)', () => {
    const session = createSession({ openActionsSnapshot: openActions });
    renderPhase(session, []);

    openActions.forEach(action => {
      expect(screen.getByText(action.text)).toBeInTheDocument();
    });
  });

  it('marks an action done through the toggle without losing the other rows', () => {
    const session = createSession({ openActionsSnapshot: openActions });
    const applyActionUpdate = vi.fn();
    renderPhase(session, openActions.map(a => a.id), { applyActionUpdate });

    const toggles = screen.getAllByTestId('toggle-open-action-done');
    expect(toggles).toHaveLength(3);
    fireEvent.click(toggles[0]);

    expect(dataService.toggleGlobalAction).toHaveBeenCalledWith('team-1', 'act-1');
    expect(applyActionUpdate).toHaveBeenCalledWith(
      'act-1',
      expect.any(Function),
      expect.objectContaining({ id: 'act-1' })
    );
  });
});
