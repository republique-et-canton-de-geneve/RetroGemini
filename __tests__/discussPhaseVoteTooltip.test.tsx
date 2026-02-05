import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
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

describe('DiscussPhase - Vote Status Tooltip', () => {
  const facilitator = createMockUser({ id: 'facilitator-1', name: 'Facilitator', role: 'facilitator' });
  const participant1 = createMockUser({ id: 'p1', name: 'Alice', color: 'bg-red-500' });
  const participant2 = createMockUser({ id: 'p2', name: 'Bob', color: 'bg-blue-500' });
  const participant3 = createMockUser({ id: 'p3', name: 'Charlie', color: 'bg-green-500' });

  const defaultProps = {
    currentUser: facilitator,
    participantsCount: 4,
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

  it('should render vote total for a proposal', () => {
    const session = createMockSession({
      participants: [facilitator, participant1, participant2, participant3],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Fix the build',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { p1: 'up', p2: 'down' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalElement = container.querySelector('.cursor-help');
    expect(totalElement).toBeTruthy();
    expect(totalElement?.textContent).toContain('Total: 2');
  });

  it('should show tooltip with voted and not voted participants on hover', async () => {
    const session = createMockSession({
      participants: [facilitator, participant1, participant2, participant3],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Fix the build',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { p1: 'up', p2: 'neutral' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalElement = container.querySelector('.cursor-help');
    expect(totalElement).toBeTruthy();
    fireEvent.mouseEnter(totalElement!.parentElement!);

    await waitFor(() => {
      const tooltip = container.querySelector('.shadow-lg');
      expect(tooltip).toBeTruthy();
    });

    const tooltipText = container.querySelector('.shadow-lg')?.textContent || '';

    expect(tooltipText).toContain('Voted (2)');
    expect(tooltipText).toContain('Alice');
    expect(tooltipText).toContain('Bob');
    expect(tooltipText).toContain('Not voted (2)');
    expect(tooltipText).toContain('Facilitator');
    expect(tooltipText).toContain('Charlie');
  });

  it('should show "Everyone voted" when all participants have voted', async () => {
    const session = createMockSession({
      participants: [facilitator, participant1],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Fix the build',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { 'facilitator-1': 'up', p1: 'down' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalElement = container.querySelector('.cursor-help');
    fireEvent.mouseEnter(totalElement!.parentElement!);

    await waitFor(() => {
      const tooltip = container.querySelector('.shadow-lg');
      expect(tooltip).toBeTruthy();
      expect(tooltip?.textContent).toContain('Everyone voted');
    });
  });

  it('should show "No one yet" when no participants have voted', async () => {
    const session = createMockSession({
      participants: [facilitator, participant1],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Empty proposal',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: {}
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalBadge = container.querySelector('.cursor-help');
    expect(totalBadge?.textContent).toContain('Total: 0');
    fireEvent.mouseEnter(totalBadge!.parentElement!);

    await waitFor(() => {
      const tooltip = container.querySelector('.shadow-lg');
      expect(tooltip).toBeTruthy();
      expect(tooltip?.textContent).toContain('No one yet');
    });
  });

  it('should hide tooltip on mouse leave', async () => {
    const session = createMockSession({
      participants: [facilitator, participant1],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Fix the build',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { p1: 'up' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalWrapper = container.querySelector('.cursor-help')!.parentElement!;

    fireEvent.mouseEnter(totalWrapper);
    await waitFor(() => {
      expect(container.querySelector('.shadow-lg')).toBeTruthy();
    });

    fireEvent.mouseLeave(totalWrapper);
    await waitFor(() => {
      expect(container.querySelector('.shadow-lg')).toBeFalsy();
    });
  });

  it('should not show individual vote types when showParticipantVotes is off', async () => {
    const session = createMockSession({
      participants: [facilitator, participant1],
      settings: {
        isAnonymous: false,
        maxVotes: 5,
        oneVotePerTicket: false,
        revealBrainstorm: true,
        revealHappiness: false,
        revealRoti: false,
        timerSeconds: 0,
        timerRunning: false,
        timerInitial: 0,
        showParticipantVotes: false
      },
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Fix the build',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { p1: 'up' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalElement = container.querySelector('.cursor-help');
    fireEvent.mouseEnter(totalElement!.parentElement!);

    await waitFor(() => {
      const tooltip = container.querySelector('.shadow-lg');
      expect(tooltip).toBeTruthy();
      // Should show the generic "how_to_reg" icon instead of thumb_up/thumb_down
      expect(tooltip?.textContent).toContain('how_to_reg');
      expect(tooltip?.textContent).not.toContain('thumb_up');
    });
  });

  it('should show individual vote types when showParticipantVotes is on', async () => {
    const session = createMockSession({
      participants: [facilitator, participant1],
      settings: {
        isAnonymous: false,
        maxVotes: 5,
        oneVotePerTicket: false,
        revealBrainstorm: true,
        revealHappiness: false,
        revealRoti: false,
        timerSeconds: 0,
        timerRunning: false,
        timerInitial: 0,
        showParticipantVotes: true
      },
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Fix the build',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { p1: 'up' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    const totalElement = container.querySelector('.cursor-help');
    fireEvent.mouseEnter(totalElement!.parentElement!);

    await waitFor(() => {
      const tooltip = container.querySelector('.shadow-lg');
      expect(tooltip).toBeTruthy();
      // Should show the specific vote type icon
      expect(tooltip?.textContent).toContain('thumb_up');
      expect(tooltip?.textContent).not.toContain('how_to_reg');
    });
  });

  it('should render "Show votes" checkbox for facilitator', () => {
    const session = createMockSession({
      participants: [facilitator, participant1],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: []
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        isFacilitator={true}
      />
    );

    const labels = container.querySelectorAll('label');
    const showVotesLabel = Array.from(labels).find(l => l.textContent?.includes('Show votes'));
    expect(showVotesLabel).toBeTruthy();
  });

  it('should apply color gradient to proposal rows based on votes', () => {
    const session = createMockSession({
      participants: [facilitator, participant1, participant2],
      tickets: [{ id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] }],
      actions: [
        {
          id: 'a1',
          text: 'Mostly positive',
          assigneeId: null,
          done: false,
          type: 'proposal',
          linkedTicketId: 't1',
          proposalVotes: { 'facilitator-1': 'up', p1: 'up', p2: 'down' }
        }
      ]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: session.tickets[0] }];

    const { container } = render(
      <DiscussPhase
        {...defaultProps}
        session={session}
        sortedItems={sortedItems}
        activeDiscussTicket="t1"
      />
    );

    // Find the proposal row (it should have an inline style with a gradient)
    const proposalRows = container.querySelectorAll('[style]');
    const rowWithGradient = Array.from(proposalRows).find(el =>
      (el as HTMLElement).style.background?.includes('linear-gradient')
    );
    expect(rowWithGradient).toBeTruthy();
  });
});
