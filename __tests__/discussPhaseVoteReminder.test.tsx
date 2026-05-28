import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

describe('DiscussPhase - Vote Reminder (not-voted indicator)', () => {
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
    handleAddProposal: vi.fn(),
    newProposalText: '',
    setNewProposalText: vi.fn(),
    handleDirectAddAction: vi.fn(),
    setPhase: vi.fn()
  };

  const sortedItems = [{ id: 't1', text: 'Test ticket', votes: 1, type: 'ticket' as const, ref: { id: 't1', colId: 'col-1', text: 'Test ticket', authorId: 'p1', groupId: null, votes: ['p1'] } }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a clear "Vote needed" indicator when the current user has not voted', () => {
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

    const { container } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('Vote needed');
    expect(container.textContent).not.toContain('Voted');
    // The whole proposal row should be visually emphasized with an amber ring
    const ring = container.querySelector('[data-vote-status="pending"]');
    expect(ring).toBeTruthy();
  });

  it('shows a "Voted" confirmation and no reminder once the current user has voted', () => {
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
          proposalVotes: { 'facilitator-1': 'up', p1: 'up' }
        }
      ]
    });

    const { container } = render(
      <DiscussPhase {...defaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('Voted');
    expect(container.textContent).not.toContain('Vote needed');
    const pending = container.querySelector('[data-vote-status="pending"]');
    expect(pending).toBeFalsy();
    const voted = container.querySelector('[data-vote-status="voted"]');
    expect(voted).toBeTruthy();
  });
});
