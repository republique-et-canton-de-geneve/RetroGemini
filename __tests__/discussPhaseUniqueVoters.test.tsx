import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import DiscussPhase from '../components/session/DiscussPhase';
import { RetroSession, RetroSettings, User } from '../types';

const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-' + Math.random().toString(36).substr(2, 5),
  name: 'TestUser',
  color: 'bg-indigo-500',
  role: 'participant',
  ...overrides
});

const createSettings = (overrides: Partial<RetroSettings> = {}): RetroSettings => ({
  isAnonymous: false,
  maxVotes: 5,
  oneVotePerTicket: false,
  revealBrainstorm: true,
  revealHappiness: false,
  revealRoti: false,
  timerSeconds: 0,
  timerRunning: false,
  timerInitial: 0,
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
  settings: createSettings(),
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

describe('DiscussPhase - Unique voters count', () => {
  const facilitator = createMockUser({ id: 'facilitator-1', name: 'Facilitator', role: 'facilitator' });
  const participant1 = createMockUser({ id: 'p1', name: 'Alice', color: 'bg-red-500' });

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
    handleUndoAcceptProposal: vi.fn(),
    handleRejectProposal: vi.fn(),
    handleUndoRejectProposal: vi.fn(),
    handleAddProposal: vi.fn(),
    newProposalText: '',
    setNewProposalText: vi.fn(),
    handleDirectAddAction: vi.fn(),
    setPhase: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows total votes and unique voters when multiple votes per item are allowed', () => {
    // p1 voted twice, facilitator voted once -> 3 votes, 2 unique voters
    const ticket = { id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1', 'p1', 'facilitator-1'] };
    const session = createMockSession({
      participants: [facilitator, participant1],
      settings: createSettings({ oneVotePerTicket: false }),
      tickets: [ticket]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 3, uniqueVotes: 2, type: 'ticket' as const, ref: ticket }];

    const { container } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('3 votes');
    expect(container.textContent).toContain('2 voters');
  });

  it('does not show the unique voters count when one vote per item is enforced', () => {
    const ticket = { id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1', 'facilitator-1'] };
    const session = createMockSession({
      participants: [facilitator, participant1],
      settings: createSettings({ oneVotePerTicket: true }),
      tickets: [ticket]
    });

    const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 2, uniqueVotes: 2, type: 'ticket' as const, ref: ticket }];

    const { container } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('2 votes');
    expect(container.textContent).not.toContain('voters');
  });

  it('shows unique voters for groups too', () => {
    const group = { id: 'g1', title: 'My Group', colId: 'col-1', votes: ['p1', 'p1', 'p1'] };
    const session = createMockSession({
      participants: [facilitator, participant1],
      settings: createSettings({ oneVotePerTicket: false }),
      groups: [group]
    });

    const sortedItems = [{ id: 'g1', text: 'My Group', votes: 3, uniqueVotes: 1, type: 'group' as const, ref: group }];

    const { container } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('3 votes');
    expect(container.textContent).toContain('1 voter');
  });
});
