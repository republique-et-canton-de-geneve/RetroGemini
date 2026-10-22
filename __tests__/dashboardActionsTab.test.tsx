import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import DashboardActionsTab from '../components/dashboard/DashboardActionsTab';
import { Team, User } from '../types';
import { ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';
import LanguageProvider from '../i18n/LanguageProvider';
import { statusWith } from './helpers/jiraClientFetch';

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

  // Maintainer, on this tab: "améliorer l'affichage de ce texte qui décale
  // tout et c'est moche". The filters and "Create in Jira" share one toolbar
  // row; the reason hangs under the button and never moves it. jsdom cannot
  // measure: e2e/jira.spec.ts measures the boxes at 1280 and 320px.
  describe('the Jira button on the filters’ row', () => {
    const blocked = statusWith({ token: { configured: false, usable: false } });
    const follows = (first: Element, second: Element) =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    it('puts the button on the filters’ row, the reason under it, before the list', () => {
      render(<DashboardActionsTab {...baseProps} filteredActions={twoActions} jiraStatus={blocked} isFacilitator requestedBy="Facilitator" />);
      const open = screen.getByRole('button', { name: 'Open' });
      const toolbar = open.parentElement!.parentElement!;
      const button = screen.getByRole('button', { name: 'Create in Jira (2)' });
      expect(button.parentElement!.parentElement).toBe(toolbar);
      expect(toolbar).toHaveClass('flex', 'flex-wrap', 'justify-between');
      expect(open.parentElement).toHaveClass('flex', 'flex-wrap', 'gap-2');

      const note = screen.getByText(/Jira is not connected for this team/).closest('p')!;
      const order = [open, screen.getByRole('button', { name: 'Closed' }), screen.getByRole('button', { name: 'All' }), button, note, screen.getAllByRole('textbox', { name: 'Action text' })[0]];
      for (let i = 1; i < order.length; i += 1) expect(follows(order[i - 1], order[i])).toBe(true);
      expect(button).toHaveAccessibleDescription('Jira is not connected for this team: add an access token in Settings → Jira.');
    });

    it.each([
      ['a participant', { jiraStatus: blocked, isFacilitator: false }],
      ['a deployment without Jira', { jiraStatus: { ...blocked, enabled: false }, isFacilitator: true }],
      ['no Jira status read yet', { jiraStatus: null, isFacilitator: true }]
    ])('leaves the filters alone on their row for %s, with no empty wrapper', (_label, jira) => {
      render(<DashboardActionsTab {...baseProps} filteredActions={twoActions} {...jira} requestedBy="Facilitator" />);
      const toolbar = screen.getByRole('button', { name: 'Open' }).parentElement!.parentElement!;
      expect(toolbar.children).toHaveLength(1);
      expect(within(toolbar).getAllByRole('button').map((pill) => pill.textContent)).toEqual(['Open', 'Closed', 'All']);
    });

    it('says it in French', () => {
      render(
        <LanguageProvider initialLanguage="fr">
          <DashboardActionsTab {...baseProps} filteredActions={twoActions} jiraStatus={blocked} isFacilitator requestedBy="Facilitator" />
        </LanguageProvider>
      );
      const toolbar = screen.getByRole('button', { name: 'Ouvertes' }).parentElement!.parentElement!;
      const button = within(toolbar).getByRole('button', { name: 'Créer dans Jira (2)' });
      expect(button).toHaveAccessibleDescription('Jira n’est pas connecté pour cette équipe\u00a0: ajoutez un jeton d’accès dans Paramètres → Jira.');
      expect(within(toolbar).getAllByRole('button').map((pill) => pill.textContent)).toEqual(['Ouvertes', 'Clôturées', 'Toutes', expect.stringContaining('Créer dans Jira (2)')]);
    });
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
