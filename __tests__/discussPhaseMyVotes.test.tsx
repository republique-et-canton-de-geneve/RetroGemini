import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import DiscussPhase from '../components/session/DiscussPhase';
import { Group, RetroSession, RetroSettings, Ticket, User } from '../types';

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

const buildProps = (
  session: RetroSession,
  items: { id: string; text: string; votes: number; uniqueVotes?: number; type: 'ticket' | 'group'; ref: Ticket | Group }[],
  overrides: Record<string, unknown> = {}
) => ({
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
  setPhase: vi.fn(),
  ...overrides
});

/** Three topics: I put 2 votes on the top one, 1 on a topic only I backed. */
const buildScenario = () => {
  const flaky = makeTicket('t-flaky', 'Flaky CI pipeline', ['me', 'me', 'bob', 'carol']);
  const standup = makeTicket('t-standup', 'Standup runs long', ['bob', 'carol']);
  const docs = makeTicket('t-docs', 'Docs are stale', ['me']);

  const session = createMockSession({ tickets: [flaky, standup, docs] });
  const items = [
    { id: flaky.id, text: flaky.text, votes: 4, uniqueVotes: 3, type: 'ticket' as const, ref: flaky },
    { id: standup.id, text: standup.text, votes: 2, uniqueVotes: 2, type: 'ticket' as const, ref: standup },
    { id: docs.id, text: docs.text, votes: 1, uniqueVotes: 1, type: 'ticket' as const, ref: docs }
  ];

  return { session, items };
};

describe('DiscussPhase - personal vote recap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sums up how many votes the current user placed and on how many topics', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    const recap = screen.getByTestId('my-votes-recap');
    expect(recap.textContent).toContain('3 votes');
    expect(recap.textContent).toContain('2 topics');
  });

  it('lists the topics the current user voted for, strongest first, and nothing else', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    const rows = screen.getAllByTestId('my-votes-recap-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Flaky CI pipeline');
    expect(rows[1].textContent).toContain('Docs are stale');
    expect(screen.getByTestId('my-votes-recap').textContent).not.toContain('Standup runs long');
  });

  it('shows, per topic, the votes the user placed, the total and the rank', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    const [strongest] = screen.getAllByTestId('my-votes-recap-row');
    expect(strongest.textContent).toContain('#1');
    expect(strongest.textContent).toContain('2');
    expect(strongest.textContent).toContain('4 votes');
  });

  it('warns about a topic the user backed alone, both in the recap and on the card', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    const lonelyRow = screen.getAllByTestId('my-votes-recap-row')[1];
    expect(within(lonelyRow).getByTestId('my-votes-recap-only-mine')).toBeTruthy();
    expect(screen.getByTestId('my-votes-recap').textContent).toContain('1 topic');

    const cardMarkers = screen.getAllByTestId('topic-only-mine');
    expect(cardMarkers).toHaveLength(1);
  });

  it('badges every topic card the user voted for with their own vote count', () => {
    const { session, items } = buildScenario();

    render(<DiscussPhase {...buildProps(session, items)} />);

    const badges = screen.getAllByTestId('topic-my-votes');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toContain('2');
    expect(badges[1].textContent).toContain('1');
  });

  it('leaves topics the user did not vote for unbadged', () => {
    const standup = makeTicket('t-standup', 'Standup runs long', ['bob', 'carol']);
    const session = createMockSession({ tickets: [standup] });
    const items = [{ id: standup.id, text: standup.text, votes: 2, uniqueVotes: 2, type: 'ticket' as const, ref: standup }];

    render(<DiscussPhase {...buildProps(session, items)} />);

    expect(screen.queryByTestId('topic-my-votes')).toBeNull();
    expect(screen.queryByTestId('topic-only-mine')).toBeNull();
  });

  it('tells the user plainly when they placed no vote at all', () => {
    const standup = makeTicket('t-standup', 'Standup runs long', ['bob']);
    const session = createMockSession({ tickets: [standup] });
    const items = [{ id: standup.id, text: standup.text, votes: 1, uniqueVotes: 1, type: 'ticket' as const, ref: standup }];

    render(<DiscussPhase {...buildProps(session, items)} />);

    expect(screen.getByTestId('my-votes-recap-empty')).toBeTruthy();
    expect(screen.queryAllByTestId('my-votes-recap-row')).toHaveLength(0);
  });

  it('does not render the recap when the discuss list is empty', () => {
    const session = createMockSession();

    render(<DiscussPhase {...buildProps(session, [])} />);

    expect(screen.queryByTestId('my-votes-recap')).toBeNull();
  });

  it('counts the votes the user placed on a group, not only on loose tickets', () => {
    const group: Group = { id: 'g1', title: 'Release process', colId: 'col-1', votes: ['me', 'me', 'me', 'bob'] };
    const session = createMockSession({ groups: [group] });
    const items = [{ id: group.id, text: group.title, votes: 4, uniqueVotes: 2, type: 'group' as const, ref: group }];

    render(<DiscussPhase {...buildProps(session, items)} />);

    expect(screen.getByTestId('topic-my-votes').textContent).toContain('3');
    expect(screen.getByTestId('my-votes-recap').textContent).toContain('Release process');
  });

  describe('interaction', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>;
    let original: unknown;

    beforeEach(() => {
      original = (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      scrollIntoView = vi.fn();
      (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = original;
    });

    it('jumps to the topic card when a recap row is activated', () => {
      const { session, items } = buildScenario();

      render(<DiscussPhase {...buildProps(session, items)} />);

      fireEvent.click(screen.getAllByTestId('my-votes-recap-row')[1]);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('can be collapsed to give the topic list the whole screen, then reopened', () => {
      const { session, items } = buildScenario();

      render(<DiscussPhase {...buildProps(session, items)} />);

      const toggle = screen.getByTestId('my-votes-recap-toggle');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      fireEvent.click(toggle);
      expect(screen.queryAllByTestId('my-votes-recap-row')).toHaveLength(0);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      // The headline stays readable while collapsed
      expect(screen.getByTestId('my-votes-recap').textContent).toContain('3 votes');

      fireEvent.click(toggle);
      expect(screen.getAllByTestId('my-votes-recap-row')).toHaveLength(2);
    });
  });
});
