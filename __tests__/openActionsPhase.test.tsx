import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OpenActionsPhase from '../components/session/OpenActionsPhase';
import { dataService } from '../services/dataService';
import { ActionItem, RetroSession, Team, User } from '../types';

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn()
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const makeAction = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const openActions = [
  makeAction('act-1', 'Add a DOR compliance filter'),
  makeAction('act-2', 'Observe BAs once per release'),
  makeAction('act-3', 'Allow marking sprint review topics as interesting')
];

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: openActions
};

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'OPEN_ACTIONS',
  participants: [facilitator],
  discussionFocusId: null,
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 180,
    timerRunning: false,
    timerInitial: 180
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const renderPhase = (
  session: RetroSession,
  reviewActionIds: string[],
  props: Partial<React.ComponentProps<typeof OpenActionsPhase>> = {}
) =>
  render(
    <OpenActionsPhase
      team={team}
      session={session}
      currentUser={facilitator}
      participants={team.members}
      isFacilitator
      reviewActionIds={reviewActionIds}
      setPhase={vi.fn()}
      applyActionUpdate={vi.fn()}
      assignableMembers={team.members}
      buildActionContext={vi.fn(() => '')}
      setRefreshTick={vi.fn()}
      ratingEnabled
      showRatingNotice={false}
      onRateAction={vi.fn()}
      onDeferRating={vi.fn()}
      onRateNow={vi.fn()}
      onToggleImpactReveal={vi.fn()}
      onDismissRatingNotice={vi.fn()}
      {...props}
    />
  );

beforeEach(() => {
  vi.mocked(dataService.getTeam).mockReturnValue(team);
});

describe('OpenActionsPhase action list', () => {
  it('shows every open action when the snapshot and review ids agree', () => {
    const session = createSession({ openActionsSnapshot: openActions });
    renderPhase(session, openActions.map(a => a.id));

    openActions.forEach(action => {
      expect(screen.getByText(action.text)).toBeInTheDocument();
    });
  });

  it('keeps showing the other actions when the snapshot degenerated to only the toggled action', () => {
    // Regression: a lost write race at phase entry can leave the session with
    // no snapshot; toggling "done" then seeds the snapshot with only the
    // toggled action. The other open actions of the review must NOT disappear.
    const degenerateSnapshot = [{ ...openActions[0], done: true }];
    const session = createSession({ openActionsSnapshot: degenerateSnapshot });
    renderPhase(session, openActions.map(a => a.id));

    openActions.forEach(action => {
      expect(screen.getByText(action.text)).toBeInTheDocument();
    });
    // The toggled action reflects the snapshot's done state.
    expect(screen.getByText(openActions[0].text)).toHaveClass('line-through');
    // The others stay open (no strikethrough).
    expect(screen.getByText(openActions[1].text)).not.toHaveClass('line-through');
    expect(screen.getByText(openActions[2].text)).not.toHaveClass('line-through');
  });

  it('still renders snapshot-only actions when review ids are empty (participant fallback)', () => {
    const session = createSession({ openActionsSnapshot: openActions });
    renderPhase(session, []);

    openActions.forEach(action => {
      expect(screen.getByText(action.text)).toBeInTheDocument();
    });
  });

  it('marks an action done through the toggle without losing the other rows', () => {
    const session = createSession({ openActionsSnapshot: openActions });
    const applyActionUpdate = vi.fn();
    renderPhase(session, openActions.map(a => a.id), { applyActionUpdate });

    const toggles = screen.getAllByTestId('toggle-open-action-done');
    expect(toggles).toHaveLength(3);
    fireEvent.click(toggles[0]);

    expect(dataService.toggleGlobalAction).toHaveBeenCalledWith('team-1', 'act-1');
    expect(applyActionUpdate).toHaveBeenCalledWith(
      'act-1',
      expect.any(Function),
      expect.objectContaining({ id: 'act-1' })
    );
  });
});

// Block (b): the closed actions this retro puts to the team. It must be
// invisible for a team that is not rating anything — the phase then renders
// exactly as it did before this feature existed.
describe('OpenActionsPhase - impact rating block', () => {
  const participant: User = { id: 'p-1', name: 'Pat', color: 'bg-rose-500', role: 'participant' };

  const closed = (id: string, text: string) =>
    makeAction(id, text, { done: true, closedAt: '2026-05-01T00:00:00.000Z' });

  const withRound = (overrides: Partial<RetroSession> = {}) =>
    createSession({
      closedActionsSnapshot: [closed('c-1', 'Pair on deploys')],
      ...overrides
    });

  it('renders nothing about ratings when no action is up for rating', () => {
    renderPhase(createSession({ closedActionsSnapshot: [] }), ['act-1']);

    expect(screen.queryByTestId('closed-actions-rating')).toBeNull();
  });

  it('renders nothing when the team turned the rating off', () => {
    renderPhase(withRound(), ['act-1'], { ratingEnabled: false });

    expect(screen.queryByTestId('closed-actions-rating')).toBeNull();
  });

  it('offers a participant the three scores and an abstention', () => {
    renderPhase(withRound(), [], { isFacilitator: false, currentUser: participant });

    expect(screen.getByRole('button', { name: 'No real impact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Some impact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear impact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not concerned' })).toBeTruthy();
  });

  // The facilitator seat is a driving identity; the human behind it already
  // votes under their participant identity. Showing the buttons here would
  // collect a second vote from the same person.
  it('offers the facilitator no vote buttons at all', () => {
    renderPhase(withRound(), []);

    expect(screen.queryByRole('button', { name: 'Clear impact' })).toBeNull();
  });

  it('records a vote, and clears it when the same choice is clicked again', () => {
    const onRateAction = vi.fn();

    const { rerender } = renderPhase(withRound(), [], {
      isFacilitator: false,
      currentUser: participant,
      onRateAction
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear impact' }));
    expect(onRateAction).toHaveBeenCalledWith('c-1', 3);

    rerender(
      <OpenActionsPhase
        team={team}
        session={withRound({ actionImpactVotes: { 'c-1': { 'p-1': 3 } } })}
        currentUser={participant}
        participants={[participant]}
        isFacilitator={false}
        reviewActionIds={[]}
        setPhase={vi.fn()}
        applyActionUpdate={vi.fn()}
        assignableMembers={team.members}
        buildActionContext={vi.fn(() => '')}
        setRefreshTick={vi.fn()}
        ratingEnabled
        showRatingNotice={false}
        onRateAction={onRateAction}
        onDeferRating={vi.fn()}
        onRateNow={vi.fn()}
        onToggleImpactReveal={vi.fn()}
        onDismissRatingNotice={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear impact' }));
    expect(onRateAction).toHaveBeenLastCalledWith('c-1', null);
  });

  // Actions carry a named assignee. An open vote would be uniformly flattering
  // and therefore worthless, so before reveal only the count is visible.
  it('shows how many have answered but never what they said, until reveal', () => {
    renderPhase(
      withRound({ actionImpactVotes: { 'c-1': { 'p-1': 1, 'p-2': 3 } } }),
      [],
      { participants: [participant, { ...participant, id: 'p-2', name: 'Sam' }] }
    );

    expect(screen.getByTestId('impact-vote-count').textContent).toBe('2 of 2 rated');
    expect(screen.queryByTestId('impact-result')).toBeNull();
  });

  it('shows the score and the spread once the facilitator reveals', () => {
    renderPhase(
      withRound({
        actionImpactVotes: { 'c-1': { 'p-1': 1, 'p-2': 3, 'p-3': 'abstain' } },
        settings: { ...createSession().settings, revealActionImpact: true }
      }),
      []
    );

    const result = screen.getByTestId('impact-result').textContent ?? '';
    expect(result).toContain('2/3');
    expect(result).toContain('1 clear impact');
    expect(result).toContain('1 no real impact');
    expect(result).toContain('1 not concerned');
  });

  it('reports no rating rather than a zero when nobody gave a score', () => {
    renderPhase(
      withRound({
        actionImpactVotes: { 'c-1': { 'p-1': 'abstain' } },
        settings: { ...createSession().settings, revealActionImpact: true }
      }),
      []
    );

    expect(screen.getByTestId('impact-result').textContent).toBe('No rating yet');
  });

  it('lets the facilitator defer an action to the next retrospective', () => {
    const onDeferRating = vi.fn();
    renderPhase(withRound(), [], { onDeferRating });

    fireEvent.click(screen.getByTestId('defer-impact-rating'));

    expect(onDeferRating).toHaveBeenCalledWith('c-1');
  });

  it('lets the facilitator pull a just-closed action into this round', () => {
    const onRateNow = vi.fn();
    (dataService.getTeam as ReturnType<typeof vi.fn>).mockReturnValue({
      ...team,
      globalActions: [makeAction('act-1', 'Add a DOR compliance filter', { done: true })]
    });

    renderPhase(createSession(), ['act-1'], { onRateNow });
    fireEvent.click(screen.getByTestId('rate-now'));

    expect(onRateNow).toHaveBeenCalledWith(expect.objectContaining({ id: 'act-1' }));
  });

  it('explains where the off switch is, once, to the facilitator only', () => {
    const onDismissRatingNotice = vi.fn();
    renderPhase(withRound(), [], { showRatingNotice: true, onDismissRatingNotice });

    expect(screen.getByTestId('impact-rating-notice').textContent).toContain('Team Settings');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the impact rating notice' }));
    expect(onDismissRatingNotice).toHaveBeenCalled();
  });

  it('never shows the notice to a participant, who cannot act on it', () => {
    renderPhase(withRound(), [], {
      showRatingNotice: true,
      isFacilitator: false,
      currentUser: participant
    });

    expect(screen.queryByTestId('impact-rating-notice')).toBeNull();
  });
});

// Codex review finding: `cast` counted every key in the vote map while the
// denominator excluded participants marked as having left, so a row could
// report an impossible "2 of 1 rated".
describe('OpenActionsPhase - progress count after a participant leaves', () => {
  const pat: User = { id: 'p-1', name: 'Pat', color: 'bg-rose-500', role: 'participant' };
  const sam: User = { id: 'p-2', name: 'Sam', color: 'bg-cyan-500', role: 'participant' };

  it('counts only the participants the round is still waiting for', () => {
    const session = createSession({
      closedActionsSnapshot: [
        makeAction('c-1', 'Pair on deploys', { done: true, closedAt: '2026-05-01T00:00:00.000Z' })
      ],
      actionImpactVotes: { 'c-1': { 'p-1': 3, 'p-2': 1 } },
      leftUsers: ['p-2']
    });

    renderPhase(session, [], { participants: [facilitator, pat, sam] });

    expect(screen.getByTestId('impact-vote-count').textContent).toBe('1 of 1 rated');
  });
});
