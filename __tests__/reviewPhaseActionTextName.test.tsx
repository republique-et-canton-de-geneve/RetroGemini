import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewPhase from '../components/session/ReviewPhase';
import LanguageProvider from '../i18n/LanguageProvider';
import type { RetroSession, Team, User } from '../types';

/**
 * Every action row of the Review step holds its text in a textarea, and that
 * textarea had no name: axe reported it as a critical `label` violation (one
 * per row) the first time the step was audited, by `e2e/jira.spec.ts`, which
 * walks the Review step because the Jira controls live in these rows. A screen
 * reader announced each one as an unnamed edit field.
 *
 * The name is fixed text, not the action: it must not change while the
 * facilitator types, and the field's value already says which action it is.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getSessionToken: vi.fn(() => null),
    getAuthenticatedPassword: vi.fn(() => null),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    deleteAction: vi.fn()
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const participant: User = { id: 'mem-1', name: 'Alice', color: 'bg-emerald-500', role: 'participant' };

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [],
  globalActions: [
    { id: 'prev-1', text: 'Automate the changelog', assigneeId: null, done: false, type: 'new', proposalVotes: {} }
  ]
};

const session: RetroSession = {
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '2026-10-20',
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
  tickets: [{ id: 'tkt-1', colId: 'col-1', text: 'Releases keep slipping', authorId: 'fac-1', groupId: null, votes: [] }],
  groups: [],
  actions: [
    { id: 'act-1', text: 'Write the release checklist', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-1', proposalVotes: {} }
  ],
  happiness: {},
  roti: {},
  finishedUsers: []
};

const renderReview = (user: User, isFacilitator: boolean) => (
  <ReviewPhase
    session={session}
    team={team}
    currentUser={user}
    isFacilitator={isFacilitator}
    historyActionIds={['prev-1']}
    setPhase={vi.fn()}
    updateSession={vi.fn()}
    applyActionUpdate={vi.fn()}
    buildActionContext={vi.fn(() => '')}
    assignableMembers={team.members}
    setRefreshTick={vi.fn()}
  />
);

describe('ReviewPhase action text fields', () => {
  it.each([
    ['the facilitator', facilitator, true],
    ['a participant (read-only)', participant, false]
  ])('names every action text field for %s, new and previous actions alike', (_who, user, isFacilitator) => {
    render(renderReview(user, isFacilitator));
    const fields = screen.getAllByRole('textbox', { name: 'Action text' });
    expect(fields.map(field => (field as HTMLTextAreaElement).value)).toEqual([
      'Write the release checklist',
      'Automate the changelog'
    ]);
  });

  it('names them in French', () => {
    render(<LanguageProvider initialLanguage="fr">{renderReview(facilitator, true)}</LanguageProvider>);
    expect(screen.getAllByRole('textbox', { name: "Texte de l'action" })).toHaveLength(2);
  });
});
