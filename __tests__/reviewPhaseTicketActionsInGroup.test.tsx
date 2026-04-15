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

describe('ReviewPhase - Actions linked to tickets inside groups', () => {
  it('displays action linked to a ticket under its parent group', () => {
    // An action was created on ticket-1 before ticket-1 was grouped into group-1
    // The action should appear under the group heading, not as a standalone ticket
    const session = createSession({
      groups: [{ id: 'grp-1', title: 'Meetings', colId: 'col-1', votes: [] }],
      tickets: [
        { id: 'tkt-1', colId: 'col-1', text: 'Long meetings', authorId: 'fac-1', groupId: 'grp-1', votes: [] },
        { id: 'tkt-2', colId: 'col-1', text: 'Too many meetings', authorId: 'fac-1', groupId: 'grp-1', votes: [] }
      ],
      actions: [
        { id: 'act-1', text: 'Limit meetings to 30 min', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-1', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // The action should be grouped under "Meetings" group, not under "Long meetings" ticket
    expect(screen.getByText('Meetings')).toBeTruthy();
    // Sub-ticket texts should be displayed as bullets under the group
    expect(screen.getByText('• Long meetings')).toBeTruthy();
    expect(screen.getByText('• Too many meetings')).toBeTruthy();
    // The group should use the 'layers' icon
    const meetingsHeader = screen.getByText('Meetings').closest('div');
    expect(meetingsHeader?.textContent).toContain('layers');
  });

  it('groups actions from multiple tickets in the same group together', () => {
    const session = createSession({
      groups: [{ id: 'grp-1', title: 'Communication', colId: 'col-1', votes: [] }],
      tickets: [
        { id: 'tkt-1', colId: 'col-1', text: 'Need better docs', authorId: 'fac-1', groupId: 'grp-1', votes: [] },
        { id: 'tkt-2', colId: 'col-1', text: 'Unclear requirements', authorId: 'fac-1', groupId: 'grp-1', votes: [] }
      ],
      actions: [
        { id: 'act-1', text: 'Write documentation', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-1', proposalVotes: {} },
        { id: 'act-2', text: 'Create requirement template', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-2', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // Both actions should be under the "Communication" group
    expect(screen.getByText('Communication')).toBeTruthy();
    // The group should appear only once (not split into separate ticket sections)
    const communicationElements = screen.getAllByText('Communication');
    expect(communicationElements).toHaveLength(1);
  });

  it('mixes group-linked and ticket-linked actions under the same group', () => {
    // An action was linked directly to the group AND another was linked to a member ticket
    const session = createSession({
      groups: [{ id: 'grp-1', title: 'Processes', colId: 'col-1', votes: [] }],
      tickets: [
        { id: 'tkt-1', colId: 'col-1', text: 'Slow CI', authorId: 'fac-1', groupId: 'grp-1', votes: [] },
        { id: 'tkt-2', colId: 'col-1', text: 'No tests', authorId: 'fac-1', groupId: 'grp-1', votes: [] }
      ],
      actions: [
        { id: 'act-1', text: 'Speed up CI pipeline', assigneeId: null, done: false, type: 'new', linkedTicketId: 'grp-1', proposalVotes: {} },
        { id: 'act-2', text: 'Add unit tests', assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-2', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // Both actions should appear under the same "Processes" group
    expect(screen.getByText('Processes')).toBeTruthy();
    const processesElements = screen.getAllByText('Processes');
    expect(processesElements).toHaveLength(1);
  });
});

describe('ReviewPhase - Action text readability (multiline)', () => {
  it('displays long action text fully visible without truncation', () => {
    const longText = 'This is a very long action item text that should be fully readable in the review phase without being cut off or truncated by the input field';
    const session = createSession({
      tickets: [
        { id: 'tkt-1', colId: 'col-1', text: 'Some ticket', authorId: 'fac-1', groupId: null, votes: [] }
      ],
      actions: [
        { id: 'act-1', text: longText, assigneeId: null, done: false, type: 'new', linkedTicketId: 'tkt-1', proposalVotes: {} }
      ]
    });

    renderReview(session);

    // The action text should be fully visible (rendered as a textarea or element that wraps text)
    const actionElement = screen.getByDisplayValue(longText);
    expect(actionElement).toBeTruthy();
    // It should be a textarea (multiline) instead of an input (single line)
    expect(actionElement.tagName.toLowerCase()).toBe('textarea');
  });
});
