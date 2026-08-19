import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DiscussPhase from '../components/session/DiscussPhase';
import { Group, RetroSession, RetroSettings, Ticket, User } from '../types';

/**
 * The Discuss phase marks the topics the reader voted for with their own vote
 * count, so the votes they spent in the Vote phase stay visible while the team
 * works down the list. Nothing about the badge is stored on the session: it is
 * read off the topic the card already renders.
 */

const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-' + Math.random().toString(36).slice(2, 7),
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

const makeTicket = (id: string, text: string, votes: string[]): Ticket => ({
  id,
  colId: 'col-1',
  text,
  authorId: 'p1',
  groupId: null,
  votes
});

const me = createMockUser({ id: 'me', name: 'Me' });

type Item = { id: string; text: string; votes: number; uniqueVotes?: number; type: 'ticket' | 'group'; ref: Ticket | Group };

const buildProps = (session: RetroSession, items: Item[]) => ({
  session,
  currentUser: me,
  participantsCount: 3,
  isFacilitator: false,
  sortedItems: items,
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
});

/** Three topics: I stacked 2 votes on one, 1 on another, none on the third. */
const buildScenario = () => {
  const flaky = makeTicket('t-flaky', 'Flaky CI pipeline', ['me', 'me', 'bob', 'carol']);
  const standup = makeTicket('t-standup', 'Standup runs long', ['bob', 'carol']);
  const docs = makeTicket('t-docs', 'Docs are stale', ['me']);

  const session = createMockSession({ tickets: [flaky, standup, docs] });
  const items: Item[] = [
    { id: flaky.id, text: flaky.text, votes: 4, uniqueVotes: 3, type: 'ticket', ref: flaky },
    { id: standup.id, text: standup.text, votes: 2, uniqueVotes: 2, type: 'ticket', ref: standup },
    { id: docs.id, text: docs.text, votes: 1, uniqueVotes: 1, type: 'ticket', ref: docs }
  ];

  return { session, items };
};

describe('DiscussPhase - "your votes" badge on a topic card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('badges only the topics the current user voted for', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    expect(screen.getAllByTestId('topic-my-votes')).toHaveLength(2);
  });

  it('counts stacked votes on one topic, not just the fact that the user voted', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    const [strongest, weakest] = screen.getAllByTestId('topic-my-votes');
    expect(strongest.textContent).toContain('Your 2 votes');
    expect(weakest.textContent).toContain('Your 1 vote');
  });

  it('leaves a topic the user did not vote for unbadged', () => {
    const standup = makeTicket('t-standup', 'Standup runs long', ['bob', 'carol']);
    const session = createMockSession({ tickets: [standup] });

    render(
      <DiscussPhase
        {...buildProps(session, [{ id: standup.id, text: standup.text, votes: 2, uniqueVotes: 2, type: 'ticket', ref: standup }])}
      />
    );

    expect(screen.queryByTestId('topic-my-votes')).toBeNull();
  });

  it('counts the votes the user placed on a group, not only on loose tickets', () => {
    const group: Group = { id: 'g1', title: 'Release process', colId: 'col-1', votes: ['me', 'me', 'me', 'bob'] };
    const session = createMockSession({ groups: [group] });

    render(
      <DiscussPhase
        {...buildProps(session, [{ id: group.id, text: group.title, votes: 4, uniqueVotes: 2, type: 'group', ref: group }])}
      />
    );

    expect(screen.getByTestId('topic-my-votes').textContent).toContain('Your 3 votes');
  });

  it('shows no badge to a reader who spent no vote at all', () => {
    const { session, items } = buildScenario();
    const props = buildProps(session, items);

    render(<DiscussPhase {...props} currentUser={createMockUser({ id: 'nobody', name: 'Late joiner' })} />);

    expect(screen.queryByTestId('topic-my-votes')).toBeNull();
  });

  it('survives a topic whose reference carries no vote list', () => {
    const session = createMockSession();
    const bare = { id: 'x1', text: 'Imported topic', votes: 0, type: 'ticket' as const, ref: {} as Ticket };

    render(<DiscussPhase {...buildProps(session, [bare])} />);

    expect(screen.queryByTestId('topic-my-votes')).toBeNull();
  });

  it('adds nothing to the session: rendering the badge never writes state', () => {
    const { session, items } = buildScenario();
    const props = buildProps(session, items);

    render(<DiscussPhase {...props} />);

    expect(props.updateSession).not.toHaveBeenCalled();
  });
});
