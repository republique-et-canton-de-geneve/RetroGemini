import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardActionsTab from '../components/dashboard/DashboardActionsTab';
import { Team, User } from '../types';
import { ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const participant: User = {
  id: 'member-1',
  name: 'Alice',
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

const baseProps = {
  team,
  knownMembers: [facilitator, participant],
  actionFilter: 'OPEN' as const,
  onActionFilterChange: vi.fn(),
  newActionText: '',
  onNewActionTextChange: vi.fn(),
  newActionAssignee: '',
  onNewActionAssigneeChange: vi.fn(),
  onCreateAction: vi.fn(),
  onToggleAction: vi.fn(),
  onUpdateActionText: vi.fn(),
  onUpdateAssignee: vi.fn()
};

describe('DashboardActionsTab', () => {
  it('shows a dedicated badge for ROTI follow-up actions', () => {
    render(
      <DashboardActionsTab
        {...baseProps}
        filteredActions={[
          {
            id: 'action-1',
            text: 'Capture facilitation improvements',
            assigneeId: null,
            done: false,
            type: 'new',
            linkedTicketId: ROTI_FOLLOW_UP_LINK_ID,
            proposalVotes: {},
            originRetro: 'Sprint 12 Retro',
            contextText: ''
          }
        ]}
      />
    );

    expect(screen.getByText('Retro improvement')).toBeTruthy();
    expect(screen.getByDisplayValue('Capture facilitation improvements')).toBeTruthy();
  });

  it('does not show the ROTI badge for regular actions', () => {
    render(
      <DashboardActionsTab
        {...baseProps}
        filteredActions={[
          {
            id: 'action-2',
            text: 'Follow up on deployment issue',
            assigneeId: null,
            done: false,
            type: 'new',
            proposalVotes: {},
            originRetro: 'Sprint 12 Retro',
            contextText: 'Deployment topic'
          }
        ]}
      />
    );

    expect(screen.queryByText('Retro improvement')).toBeNull();
  });
});
