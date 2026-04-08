import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator],
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
  participants: [facilitator],
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

const renderReview = (session: RetroSession) =>
  render(
    <ReviewPhase
      session={session}
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
    />
  );

describe('ReviewPhase group and ticket display', () => {
  it('displays group title and sub-ticket texts for actions linked to a group', () => {
    const session = createSession({
      groups: [{ id: 'grp-1', title: 'Meetings', colId: 'col-1', votes: [] }],
      tickets: [
        { id: 'tkt-1', colId: 'col-1', text: 'Long meetings', authorId: 'fac-1', groupId: 'grp-1', votes: [] },
        { id: 'tkt-2', colId: 'col-1', text: 'Too many people in meetings', authorId: 'fac-1', groupId: 'grp-1', votes: [] }
      ],
      actions: [
        { id: 'act-1', text: 'All meetings default to 30 min', assigneeId: null, done: false, type: 'new', linkedTicketId: 'grp-1', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // Group title should be displayed (not "Untitled")
    expect(screen.getByText('Meetings')).toBeTruthy();
    expect(screen.queryByText('Untitled')).toBeNull();

    // Sub-ticket texts should be displayed
    expect(screen.getByText('• Long meetings')).toBeTruthy();
    expect(screen.getByText('• Too many people in meetings')).toBeTruthy();
  });

  it('displays ticket text without repetition for actions linked to a single ticket', () => {
    const session = createSession({
      groups: [],
      tickets: [
        { id: 'tkt-3', colId: 'col-1', text: 'Hard work', authorId: 'fac-1', groupId: null, votes: [] }
      ],
      actions: [
        { id: 'act-2', text: 'Organize afterwork', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-3', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // Ticket title should appear exactly once as the header
    const hardWorkElements = screen.getAllByText('Hard work');
    expect(hardWorkElements).toHaveLength(1);

    // Should NOT show sub-ticket bullet for a single ticket
    expect(screen.queryByText('• Hard work')).toBeNull();
  });

  it('uses different icons for groups vs single tickets', () => {
    const session = createSession({
      groups: [{ id: 'grp-1', title: 'Meetings', colId: 'col-1', votes: [] }],
      tickets: [
        { id: 'tkt-1', colId: 'col-1', text: 'Long meetings', authorId: 'fac-1', groupId: 'grp-1', votes: [] },
        { id: 'tkt-4', colId: 'col-1', text: 'Solo ticket', authorId: 'fac-1', groupId: null, votes: [] }
      ],
      actions: [
        { id: 'act-1', text: 'Group action', assigneeId: null, done: false, type: 'new', linkedTicketId: 'grp-1', proposalVotes: {} },
        { id: 'act-3', text: 'Solo action', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-4', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // Find the action group headers
    const meetingsHeader = screen.getByText('Meetings').closest('div');
    const soloHeader = screen.getByText('Solo ticket').closest('div');

    // Group should use 'layers' icon, single ticket should use 'topic' icon
    expect(meetingsHeader?.textContent).toContain('layers');
    expect(soloHeader?.textContent).toContain('topic');
  });
});
