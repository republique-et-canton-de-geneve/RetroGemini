import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DiscussPhase from '../components/session/DiscussPhase';
import { RetroSession, User } from '../types';

const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-' + Math.random().toString(36).substr(2, 5),
  name: 'TestUser',
  color: 'bg-indigo-500',
  role: 'participant',
  ...overrides
});

const createMockSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  participants: [],
  icebreakerQuestion: '',
  columns: [
    { id: 'col-1', title: 'What Went Well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' }
  ],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

describe('DiscussPhase - Actions visibility after grouping', () => {
  const facilitator = createMockUser({ id: 'facilitator-1', name: 'Facilitator', role: 'facilitator' });

  const defaultProps = {
    currentUser: facilitator,
    participantsCount: 2,
    isFacilitator: true,
    activeDiscussTicket: null as string | null,
    setActiveDiscussTicket: vi.fn(),
    updateSession: vi.fn(),
    handleToggleNextTopicVote: vi.fn(),
    discussRefs: { current: {} } as React.MutableRefObject<Record<string, HTMLDivElement | null>>,
    editingProposalId: null as string | null,
    editingProposalText: '',
    setEditingProposalText: vi.fn(),
    handleSaveProposalEdit: vi.fn(),
    handleCancelProposalEdit: vi.fn(),
    handleStartEditProposal: vi.fn(),
    handleDeleteProposal: vi.fn(),
    handleVoteProposal: vi.fn(),
    handleAcceptProposal: vi.fn(),
    handleAddProposal: vi.fn(),
    newProposalText: '',
    setNewProposalText: vi.fn(),
    handleDirectAddAction: vi.fn(),
    setPhase: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows accepted actions linked to a ticket that was later grouped', () => {
    // Scenario: An action was created on ticket-1, then ticket-1 and ticket-2 were merged into group-1
    // The action's linkedTicketId still points to ticket-1, but it should be visible under group-1
    const session = createMockSession({
      tickets: [
        { id: 'ticket-1', colId: 'col-1', text: 'Ticket A', authorId: 'facilitator-1', groupId: 'group-1', votes: [] },
        { id: 'ticket-2', colId: 'col-1', text: 'Ticket B', authorId: 'facilitator-1', groupId: 'group-1', votes: [] }
      ],
      groups: [
        { id: 'group-1', title: 'My Group', colId: 'col-1', votes: ['facilitator-1'] }
      ],
      actions: [
        { id: 'action-1', text: 'Do something important', assigneeId: null, done: false, type: 'new', linkedTicketId: 'ticket-1', proposalVotes: {} }
      ],
      participants: [facilitator]
    });

    const sortedItems = [
      { id: 'group-1', text: 'My Group', votes: 1, type: 'group' as const, ref: session.groups[0] }
    ];

    render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="group-1"
      />
    );

    // The action should be visible under the group even though it's linked to ticket-1
    expect(screen.getByText(/Do something important/)).toBeTruthy();
  });

  it('shows proposals linked to a ticket that was later grouped', () => {
    const session = createMockSession({
      tickets: [
        { id: 'ticket-1', colId: 'col-1', text: 'Ticket A', authorId: 'facilitator-1', groupId: 'group-1', votes: [] },
        { id: 'ticket-2', colId: 'col-1', text: 'Ticket B', authorId: 'facilitator-1', groupId: 'group-1', votes: [] }
      ],
      groups: [
        { id: 'group-1', title: 'My Group', colId: 'col-1', votes: [] }
      ],
      actions: [
        { id: 'proposal-1', text: 'Proposed action for ticket', assigneeId: null, done: false, type: 'proposal', linkedTicketId: 'ticket-1', proposalVotes: {} }
      ],
      participants: [facilitator]
    });

    const sortedItems = [
      { id: 'group-1', text: 'My Group', votes: 0, type: 'group' as const, ref: session.groups[0] }
    ];

    render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="group-1"
      />
    );

    // The proposal should be visible under the group
    expect(screen.getByText('Proposed action for ticket')).toBeTruthy();
  });

  it('still shows actions directly linked to a group', () => {
    // Actions linked directly to a group should still work as before
    const session = createMockSession({
      tickets: [
        { id: 'ticket-1', colId: 'col-1', text: 'Ticket A', authorId: 'facilitator-1', groupId: 'group-1', votes: [] }
      ],
      groups: [
        { id: 'group-1', title: 'My Group', colId: 'col-1', votes: [] }
      ],
      actions: [
        { id: 'action-1', text: 'Group-level action', assigneeId: null, done: false, type: 'new', linkedTicketId: 'group-1', proposalVotes: {} }
      ],
      participants: [facilitator]
    });

    const sortedItems = [
      { id: 'group-1', text: 'My Group', votes: 0, type: 'group' as const, ref: session.groups[0] }
    ];

    render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="group-1"
      />
    );

    expect(screen.getByText(/Group-level action/)).toBeTruthy();
  });
});
