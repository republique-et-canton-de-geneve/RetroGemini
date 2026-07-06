import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import DiscussPhase from '../components/session/DiscussPhase';
import ReviewPhase from '../components/session/ReviewPhase';
import WelcomePhase from '../components/session/WelcomePhase';
import ClosePhase from '../components/session/ClosePhase';
import { Column, RetroSession, RetroSettings, Team, User } from '../types';

const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-' + Math.random().toString(36).substr(2, 5),
  name: 'TestUser',
  color: 'bg-indigo-500',
  role: 'participant',
  ...overrides
});

const columns: Column[] = [
  { id: 'col-good', title: 'Went well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  { id: 'col-bad', title: 'Went wrong', color: 'bg-rose-500', border: 'border-rose-500', icon: 'sentiment_dissatisfied', text: 'text-rose-700', ring: 'ring-rose-300' }
];

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
  columns,
  settings: createSettings(),
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const facilitator = createMockUser({ id: 'fac-1', name: 'Fran', role: 'facilitator' });
const alice = createMockUser({ id: 'p1', name: 'Alice', color: 'bg-red-500' });
const bob = createMockUser({ id: 'p2', name: 'Bob', color: 'bg-blue-500' });

const discussDefaultProps = {
  currentUser: facilitator,
  participantsCount: 3,
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

describe('DiscussPhase - ticket origin column badge', () => {
  it('shows the origin column on a grouped ticket coming from another column', () => {
    // "Slow reviews" was written in "Went wrong" then grouped under a
    // "Went well" topic: its origin must stay visible.
    const goodTicket = { id: 't1', colId: 'col-good', text: 'Fast releases', authorId: 'p1', groupId: 'g1', votes: [] };
    const movedTicket = { id: 't2', colId: 'col-good', text: 'Slow reviews', authorId: 'p2', groupId: 'g1', votes: [], originColId: 'col-bad' };
    const group = { id: 'g1', title: 'Delivery', colId: 'col-good', votes: ['p1'] };
    const session = createMockSession({
      participants: [facilitator, alice, bob],
      tickets: [goodTicket, movedTicket],
      groups: [group]
    });

    const sortedItems = [{ id: 'g1', text: 'Delivery', votes: 1, uniqueVotes: 1, type: 'group' as const, ref: group }];

    const { container } = render(
      <DiscussPhase {...discussDefaultProps} session={session} sortedItems={sortedItems} />
    );

    const badges = container.querySelectorAll('[data-testid="ticket-origin-badge"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain('from Went wrong');
    // The badge is attached to the moved ticket, not the native one
    expect(badges[0].closest('div')!.textContent).toContain('Slow reviews');
  });

  it('shows no origin badge for tickets discussed in their own column', () => {
    const ticket = { id: 't1', colId: 'col-good', text: 'Fast releases', authorId: 'p1', groupId: null, votes: [] };
    const session = createMockSession({
      participants: [facilitator, alice],
      tickets: [ticket]
    });

    const sortedItems = [{ id: 't1', text: 'Fast releases', votes: 0, uniqueVotes: 0, type: 'ticket' as const, ref: ticket }];

    const { container } = render(
      <DiscussPhase {...discussDefaultProps} session={session} sortedItems={sortedItems} />
    );

    expect(container.querySelector('[data-testid="ticket-origin-badge"]')).toBeFalsy();
  });

  it('excludes departed participants from the move-on vote counter', () => {
    const ticket = { id: 't1', colId: 'col-good', text: 'Fast releases', authorId: 'p1', groupId: null, votes: [] };
    const session = createMockSession({
      participants: [facilitator, alice, bob],
      leftUsers: ['p2'],
      discussionNextTopicVotes: { t1: ['p1', 'p2'] }, // Bob voted then left
      tickets: [ticket]
    });

    const sortedItems = [{ id: 't1', text: 'Fast releases', votes: 0, uniqueVotes: 0, type: 'ticket' as const, ref: ticket }];

    const { container } = render(
      <DiscussPhase {...discussDefaultProps} participantsCount={2} session={session} sortedItems={sortedItems} />
    );

    expect(container.textContent).toContain('1/2');
  });
});

describe('ReviewPhase - ticket origin column badge', () => {
  it('keeps the origin column visible on grouped tickets in the review report', () => {
    const movedTicket = { id: 't2', colId: 'col-good', text: 'Slow reviews', authorId: 'p2', groupId: 'g1', votes: [], originColId: 'col-bad' };
    const nativeTicket = { id: 't1', colId: 'col-good', text: 'Fast releases', authorId: 'p1', groupId: 'g1', votes: [] };
    const group = { id: 'g1', title: 'Delivery', colId: 'col-good', votes: [] };
    const session = createMockSession({
      phase: 'REVIEW',
      participants: [facilitator, alice, bob],
      tickets: [nativeTicket, movedTicket],
      groups: [group],
      actions: [
        { id: 'a1', text: 'Improve review SLAs', assigneeId: null, done: false, type: 'new', linkedTicketId: 'g1', proposalVotes: {} }
      ]
    });

    const team: Team = {
      id: 'team-1',
      name: 'Team',
      passwordHash: '',
      members: [facilitator, alice, bob],
      customTemplates: [],
      retrospectives: [session],
      globalActions: []
    };

    const { container } = render(
      <ReviewPhase
        session={session}
        team={team}
        currentUser={facilitator}
        isFacilitator
        historyActionIds={[]}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        applyActionUpdate={vi.fn()}
        buildActionContext={() => ''}
        assignableMembers={[facilitator, alice, bob]}
        setRefreshTick={vi.fn()}
      />
    );

    const badges = container.querySelectorAll('[data-testid="ticket-origin-badge"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain('from Went wrong');
  });
});

describe('WelcomePhase - departed participants excluded from happiness counters', () => {
  it('does not count a vote cast by someone who later left', () => {
    const session = createMockSession({
      phase: 'WELCOME',
      participants: [facilitator, alice, bob],
      leftUsers: ['p2'],
      happiness: { p1: 4, p2: 5 }
    });

    const { container } = render(
      <WelcomePhase
        session={session}
        currentUser={facilitator}
        participantsCount={2}
        isFacilitator
        updateSession={vi.fn()}
        onNext={vi.fn()}
      />
    );

    expect(container.textContent).toContain('1 / 2 voted');
  });
});

describe('ClosePhase - departed participants excluded from ROTI counters', () => {
  it('does not count a ROTI vote cast by someone who left', () => {
    const session = createMockSession({
      phase: 'CLOSE',
      participants: [facilitator, alice, bob],
      leftUsers: ['p2'],
      roti: { p1: 4, p2: 2 }
    });

    const { container } = render(
      <ClosePhase
        session={session}
        currentUser={facilitator}
        participantsCount={2}
        isFacilitator
        updateSession={vi.fn()}
        assignableMembers={[facilitator, alice, bob]}
        handleVoteProposal={vi.fn()}
        handleAcceptProposal={vi.fn()}
        handleDeleteProposal={vi.fn()}
        handleAddProposal={vi.fn()}
        handleDirectAddAction={vi.fn()}
        handleAssignAction={vi.fn()}
        closeProposalText=""
        setCloseProposalText={vi.fn()}
        handleExit={vi.fn()}
      />
    );

    expect(container.textContent).toContain('1 / 2 members have voted');
    // The average ignores the departed vote too: only Alice's 4 counts
    expect(container.textContent).not.toContain('3.0 / 5');
  });
});
