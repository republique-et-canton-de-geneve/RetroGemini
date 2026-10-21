import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardActionsTab from '../components/dashboard/DashboardActionsTab';
import { Team, User } from '../types';
import { ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';
import LanguageProvider from '../i18n/LanguageProvider';

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

  // Each row's text is an editable field, and it had no name: axe reported a
  // critical `label` violation per row once the tab was audited with actions
  // on it (e2e/jira.spec.ts; the dashboard audit runs before any action
  // exists). The name is fixed text: the value says which action it is.
  const twoActions = [
    { id: 'action-3', text: 'Write the release checklist', assigneeId: null, done: false, type: 'new' as const, proposalVotes: {}, originRetro: 'Sprint 12 Retro', contextText: '' },
    { id: 'action-4', text: 'Archive the old wiki pages', assigneeId: null, done: false, type: 'new' as const, proposalVotes: {}, originRetro: 'Dashboard', contextText: '' }
  ];

  it('names every action text field', () => {
    render(<DashboardActionsTab {...baseProps} filteredActions={twoActions} />);
    expect(screen.getAllByRole('textbox', { name: 'Action text' }).map(field => (field as HTMLInputElement).value))
      .toEqual(['Write the release checklist', 'Archive the old wiki pages']);
  });

  it('names them in French', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <DashboardActionsTab {...baseProps} filteredActions={twoActions} />
      </LanguageProvider>
    );
    expect(screen.getAllByRole('textbox', { name: "Texte de l'action" })).toHaveLength(2);
  });
});
