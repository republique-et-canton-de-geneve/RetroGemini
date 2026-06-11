import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import DiscussPhase from '../components/session/DiscussPhase';
import { ActionItem, RetroSession, User } from '../types';

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

const ticket = { id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] };

const buildSession = (actions: ActionItem[], participants: User[]) =>
  createMockSession({ participants, tickets: [ticket], actions });

const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, uniqueVotes: 1, type: 'ticket' as const, ref: ticket }];

describe('DiscussPhase - Proposal accept/reject decisions', () => {
  const facilitator = createMockUser({ id: 'facilitator-1', name: 'Facilitator', role: 'facilitator' });
  const participant1 = createMockUser({ id: 'p1', name: 'Alice', color: 'bg-red-500' });

  const defaultProps = {
    currentUser: facilitator,
    participantsCount: 2,
    isFacilitator: true,
    activeDiscussTicket: 't1' as string | null,
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
    handleUndoAcceptProposal: vi.fn(),
    handleRejectProposal: vi.fn(),
    handleUndoRejectProposal: vi.fn(),
    handleAddProposal: vi.fn(),
    newProposalText: '',
    setNewProposalText: vi.fn(),
    handleDirectAddAction: vi.fn(),
    setPhase: vi.fn()
  };

  const proposal: ActionItem = {
    id: 'a1',
    text: 'Fix the build',
    assigneeId: null,
    done: false,
    type: 'proposal',
    linkedTicketId: 't1',
    proposalVotes: { p1: 'up' }
  };

  const acceptedAction: ActionItem = {
    id: 'a2',
    text: 'Pair on reviews',
    assigneeId: null,
    done: false,
    type: 'new',
    linkedTicketId: 't1',
    proposalVotes: {}
  };

  const rejectedProposal: ActionItem = {
    id: 'a3',
    text: 'Skip standups',
    assigneeId: null,
    done: false,
    type: 'proposal',
    rejected: true,
    linkedTicketId: 't1',
    proposalVotes: { p1: 'down' }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets the facilitator reject an active proposal', () => {
    const session = buildSession([proposal], [facilitator, participant1]);
    const { getByTitle } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    fireEvent.click(getByTitle('Reject proposal (can be undone)'));
    expect(defaultProps.handleRejectProposal).toHaveBeenCalledWith('a1');
  });

  it('does not show the reject button to participants', () => {
    const session = buildSession([proposal], [facilitator, participant1]);
    const { queryByTitle } = render(
      <DiscussPhase
        {...defaultProps}
        currentUser={participant1}
        isFacilitator={false}
        session={session}
        sortedItems={sortedItems}
      />
    );

    expect(queryByTitle('Reject proposal (can be undone)')).toBeNull();
  });

  it('renders a rejected proposal with strikethrough text and no vote controls', () => {
    const session = buildSession([rejectedProposal], [facilitator, participant1]);
    const { container, queryByText } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('Rejected:');
    const struck = container.querySelector('.line-through');
    expect(struck?.textContent).toContain('Skip standups');
    // No vote reminder/buttons for a rejected proposal
    expect(container.querySelector('[data-vote-status]')).toBeNull();
    expect(queryByText('Accept')).toBeNull();
  });

  it('lets the facilitator undo a rejection', () => {
    const session = buildSession([rejectedProposal], [facilitator, participant1]);
    const { getByTitle } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    fireEvent.click(getByTitle('Undo reject (back to proposals)'));
    expect(defaultProps.handleUndoRejectProposal).toHaveBeenCalledWith('a3');
  });

  it('lets the facilitator undo an accepted proposal', () => {
    const session = buildSession([acceptedAction], [facilitator, participant1]);
    const { container, getByTitle } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('Accepted:');
    fireEvent.click(getByTitle('Undo accept (back to proposals)'));
    expect(defaultProps.handleUndoAcceptProposal).toHaveBeenCalledWith('a2');
  });

  it('hides undo controls from participants', () => {
    const session = buildSession([acceptedAction, rejectedProposal], [facilitator, participant1]);
    const { container, queryByTitle } = render(
      <DiscussPhase
        {...defaultProps}
        currentUser={participant1}
        isFacilitator={false}
        session={session}
        sortedItems={sortedItems}
      />
    );

    // Rows are visible to everyone...
    expect(container.textContent).toContain('Accepted:');
    expect(container.textContent).toContain('Rejected:');
    // ...but undo stays facilitator-only
    expect(queryByTitle('Undo accept (back to proposals)')).toBeNull();
    expect(queryByTitle('Undo reject (back to proposals)')).toBeNull();
  });

  it('keeps decided proposals at their original position in the list', () => {
    // Array order: accepted (a2), active proposal (a1), rejected (a3).
    // Accepting or rejecting must not regroup rows into separate sections.
    const session = buildSession([acceptedAction, proposal, rejectedProposal], [facilitator, participant1]);
    const { container, getByText } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    const accepted = container.querySelector('[data-proposal-state="accepted"]');
    const rejected = container.querySelector('[data-proposal-state="rejected"]');
    const activeText = getByText('Fix the build');
    expect(accepted).toBeTruthy();
    expect(rejected).toBeTruthy();

    expect(accepted!.compareDocumentPosition(activeText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(activeText.compareDocumentPosition(rejected!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
