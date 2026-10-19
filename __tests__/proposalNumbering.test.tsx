import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import DiscussPhase from '../components/session/DiscussPhase';
import HealthCheckSession from '../components/HealthCheckSession';
import { numberTopicProposals } from '../components/session/proposalNumbering';
import LanguageProvider from '../i18n/LanguageProvider';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import {
  ActionItem,
  HealthCheckSession as HealthCheckSessionType,
  RetroSession,
  Team,
  User
} from '../types';

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn()
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(),
    leaveSession: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true)
  }
}));

const action = (overrides: Partial<ActionItem> & Pick<ActionItem, 'id'>): ActionItem => ({
  text: `Action ${overrides.id}`,
  assigneeId: null,
  done: false,
  type: 'proposal',
  linkedTicketId: 't1',
  proposalVotes: {},
  ...overrides
});

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'p1', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const numbersOnScreen = (container: HTMLElement = document.body) =>
  within(container).queryAllByTestId('proposal-number').map((badge) => badge.getAttribute('data-proposal-number'));

describe('numberTopicProposals', () => {
  const inTopic = (id: string) => id === 't1' || id === 't2';

  it('numbers the proposals of one topic from 1, in creation order', () => {
    const numbers = numberTopicProposals(
      [action({ id: 'a' }), action({ id: 'b' }), action({ id: 'c' })],
      inTopic
    );
    expect([...numbers.entries()]).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  it('keeps a number when the proposal is accepted or rejected, so nobody else is renumbered', () => {
    const before = numberTopicProposals(
      [action({ id: 'a' }), action({ id: 'b' }), action({ id: 'c' })],
      inTopic
    );
    const after = numberTopicProposals(
      [action({ id: 'a' }), action({ id: 'b', type: 'new' }), action({ id: 'c', rejected: true })],
      inTopic
    );
    expect(after).toEqual(before);
  });

  it('spans every ticket of a discussed group, and ignores other topics and other action kinds', () => {
    const numbers = numberTopicProposals(
      [
        action({ id: 'other-topic', linkedTicketId: 't9' }),
        action({ id: 'a', linkedTicketId: 't1' }),
        action({ id: 'carried', type: 'prev' }),
        action({ id: 'unlinked', linkedTicketId: undefined }),
        action({ id: 'b', linkedTicketId: 't2' })
      ],
      inTopic
    );
    expect([...numbers.entries()]).toEqual([['a', 1], ['b', 2]]);
  });
});

describe('Discuss phase shows a number on every action proposal', () => {
  const ticket = { id: 't1', colId: 'col-1', text: 'Slow builds', authorId: 'p1', groupId: null, votes: ['p1'] };
  const otherTicket = { id: 't2', colId: 'col-1', text: 'Flaky tests', authorId: 'p1', groupId: null, votes: [] };

  const session = (actions: ActionItem[]): RetroSession => ({
    id: 'session-1',
    teamId: 'team-1',
    name: 'Retro',
    date: new Date().toISOString(),
    status: 'IN_PROGRESS',
    phase: 'DISCUSS',
    participants: [facilitator, alice],
    icebreakerQuestion: '',
    columns: [{ id: 'col-1', title: 'Went well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' }],
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
    tickets: [ticket, otherTicket],
    groups: [],
    actions,
    happiness: {},
    roti: {},
    finishedUsers: []
  });

  const sortedItems = [
    { id: 't1', text: 'Slow builds', votes: 1, uniqueVotes: 1, type: 'ticket' as const, ref: ticket },
    { id: 't2', text: 'Flaky tests', votes: 0, uniqueVotes: 0, type: 'ticket' as const, ref: otherTicket }
  ];

  const props = {
    currentUser: alice,
    participantsCount: 2,
    isFacilitator: false,
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
    setPhase: vi.fn(),
    sortedItems
  };

  const proposals = [
    action({ id: 'a1', text: 'Cache dependencies' }),
    action({ id: 'other', text: 'Quarantine nothing', linkedTicketId: 't2' }),
    action({ id: 'a2', text: 'Split the pipeline', type: 'new' }),
    action({ id: 'a3', text: 'Buy faster runners', rejected: true }),
    action({ id: 'a4', text: 'Measure every stage' })
  ];

  it('numbers open, accepted and rejected proposals of the discussed topic in creation order', () => {
    render(<DiscussPhase {...props} session={session(proposals)} />);

    expect(numbersOnScreen()).toEqual(['1', '2', '3', '4']);
    // A screen reader hears the number as a phrase, not as a bare digit.
    expect(screen.getByText('Proposal 4')).toBeTruthy();
    // Each number sits on the row of the proposal it names.
    const fourth = screen.getByText('Measure every stage').closest('[data-proposal-row]') as HTMLElement;
    expect(numbersOnScreen(fourth)).toEqual(['4']);
    const accepted = screen.getByText(/Split the pipeline/).closest('[data-proposal-state]') as HTMLElement;
    expect(numbersOnScreen(accepted)).toEqual(['2']);
    const rejected = screen.getByText('Buy faster runners').closest('[data-proposal-state]') as HTMLElement;
    expect(numbersOnScreen(rejected)).toEqual(['3']);
  });

  it('starts again from 1 on the next topic', () => {
    render(<DiscussPhase {...props} activeDiscussTicket="t2" session={session(proposals)} />);
    expect(numbersOnScreen()).toEqual(['1']);
  });

  it('keeps the number while the facilitator edits the proposal', () => {
    render(
      <DiscussPhase
        {...props}
        currentUser={facilitator}
        isFacilitator
        editingProposalId="a4"
        editingProposalText="Measure every stage"
        session={session(proposals)}
      />
    );
    expect(numbersOnScreen()).toEqual(['1', '2', '3', '4']);
  });

  it('reads the number in French', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <DiscussPhase {...props} session={session(proposals)} />
      </LanguageProvider>
    );
    expect(screen.getByText('Proposition 4')).toBeTruthy();
  });
});

describe('Health check Discuss phase numbers its action proposals too', () => {
  const hcSession = (): HealthCheckSessionType => ({
    id: 'hc-1',
    teamId: 'team-1',
    name: 'Team Health',
    date: new Date().toISOString(),
    status: 'IN_PROGRESS',
    phase: 'DISCUSS',
    templateId: 'template-1',
    templateName: 'Team Health',
    dimensions: [{ id: 'dim-1', name: 'Communication', goodDescription: 'Good', badDescription: 'Bad' }],
    participants: [facilitator, alice],
    settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
    ratings: { p1: { 'dim-1': { rating: 3 } } },
    actions: [
      action({ id: 'h1', text: 'Write meeting notes', linkedTicketId: 'dim-1' }),
      action({ id: 'h2', text: 'Weekly demo', linkedTicketId: 'dim-1', type: 'new' }),
      action({ id: 'h3', text: 'Shared channel', linkedTicketId: 'dim-1' })
    ],
    discussionFocusId: 'dim-1',
    roti: {},
    finishedUsers: []
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  it('keeps an accepted action under the number it was proposed with', async () => {
    const session = hcSession();
    const team: Team = {
      id: 'team-1',
      name: 'Team',
      passwordHash: 'hash',
      members: [facilitator, alice],
      customTemplates: [],
      retrospectives: [],
      globalActions: [],
      healthChecks: [session]
    };
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
    vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);

    render(<HealthCheckSession team={team} currentUser={alice} sessionId={session.id} onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Write meeting notes')).toBeTruthy());
    // Open proposals render first and accepted actions below them, so the
    // numbers read 1, 3, 2: each stays on the action it was proposed as.
    expect(numbersOnScreen()).toEqual(['1', '3', '2']);
    const accepted = screen.getByText('Weekly demo').closest('[data-proposal-state]') as HTMLElement;
    expect(numbersOnScreen(accepted)).toEqual(['2']);
  });
});
