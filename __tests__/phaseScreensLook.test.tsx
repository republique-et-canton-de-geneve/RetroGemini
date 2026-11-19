import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import IcebreakerPhase from '../components/session/IcebreakerPhase';
import WelcomePhase from '../components/session/WelcomePhase';
import OpenActionsPhase from '../components/session/OpenActionsPhase';
import DiscussPhase from '../components/session/DiscussPhase';
import ReviewPhase from '../components/session/ReviewPhase';
import ClosePhase from '../components/session/ClosePhase';
import RetroTipsPanel from '../components/session/RetroTipsPanel';
import { Star } from '../components/common/StarRating';
import { ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';
import { dataService } from '../services/dataService';
import { contrastRatio } from '../utils/colorUtils';
import { cardTones } from '../utils/cardTones';
import { columnHue } from '../utils/columnHue';
import type { ActionItem, Column, RetroSession, Team, User } from '../types';
import { effectivePair, themeValue, tokenContrast } from './helpers/tailwindTheme';

/** jsdom reports an inline colour as `rgb(r, g, b)`: back to the hex the code wrote. */
const hexOf = (rgb: string) => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;

/**
 * The phase screens of a retrospective other than the board, in the 45.0 look
 * ("Clarté"): what each one paints, measured.
 *
 * The e2e audit walks the Icebreaker, Open Actions and Close as the
 * facilitator sees them, once; Welcome, Discuss and Review it never audits,
 * and a participant's branch (the stars, "Not concerned", the waiting line),
 * a hover colour or a disabled control it never reaches. Those are measured
 * here with the colour engine the gate uses (helpers/tailwindTheme). Two of
 * these screens are dark (Icebreaker, Close and its ROTI follow-up): a
 * contrast fix is directional, so their muted text is measured on their own
 * slate-800 and slate-900, never assumed from a light screen.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getSessionToken: vi.fn(() => null),
    getAuthenticatedPassword: vi.fn(() => null),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    deleteAction: vi.fn()
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Claire', color: 'bg-indigo-500', role: 'facilitator' };
const participant: User = { id: 'p-1', name: 'Lucas', color: 'bg-emerald-500', role: 'participant' };
const participant2: User = { id: 'p-2', name: 'Inès', color: 'bg-rose-500', role: 'participant' };

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id, text, assigneeId: null, done: false, type: 'new', proposalVotes: {}, ...overrides
});

/** The colours the built-in templates store on their columns, and the extremes. */
const COLUMN_COLOURS = ['#10B981', '#EF4444', '#3B82F6', '#F59E0B', '#8B5CF6', '#64748B', '#EC4899', '#000000', '#FFFF00'];

const column = (id: string, customColor?: string): Column => ({
  id, title: `Column ${id}`, color: 'bg-emerald-50', border: 'border-emerald-300', icon: 'play_arrow',
  text: 'text-emerald-700', ring: 'focus:ring-emerald-200', ...(customColor ? { customColor } : {})
});

const baseSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '2026-11-19',
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  participants: [facilitator, participant, participant2],
  discussionFocusId: null,
  discussionNextTopicVotes: {},
  icebreakerQuestion: 'What made you smile this week?',
  columns: [column('col-1', '#10B981')],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, participant, participant2],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

/** Text at 4.5:1 (WCAG 1.4.3). */
const expectText = (element: Element, what: string) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${what}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
};

/** A meaningful icon or a control's only edge at 3:1 (WCAG 1.4.11). */
const expectGraphic = (element: Element, what: string) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${what}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(3);
};

/**
 * A `hover:` pair, which `effectivePair` does not read (it measures what is
 * painted at rest): the hover text over the hover background, each falling
 * back to the resting one.
 */
const hoverRatio = (element: Element): { label: string; ratio: number } => {
  const tokens = (element.getAttribute('class') ?? '').split(/\s+/);
  const resting = effectivePair(element);
  const hoverOf = (kind: 'text' | 'bg') =>
    tokens.map((token) => new RegExp(`^hover:${kind}-([a-z]+-\\d+|white|black)$`).exec(token)?.[1]).find(Boolean);
  const fg = hoverOf('text') ?? resting.fg;
  const bg = hoverOf('bg') ?? resting.bg;
  expect(bg, 'a hover pair over a translucent background cannot be read here').not.toMatch(/\//);
  return { label: `${fg} on ${bg}`, ratio: tokenContrast(fg, bg) };
};

const expectHoverText = (element: Element, what: string) => {
  const { label, ratio } = hoverRatio(element);
  expect(ratio, `${what} (hover): ${label}`).toBeGreaterThanOrEqual(4.5);
};

/** No muted look made of opacity: it cannot be measured, and it is how 2.6:1 passes review. */
const expectNoOpacity = (container: Element) => {
  for (const element of container.querySelectorAll('[class]')) {
    expect(element.getAttribute('class'), 'opacity-* or grayscale on a phase screen').not.toMatch(/(^|\s)(opacity-\d+|grayscale)(\s|$)/);
  }
};

beforeEach(() => {
  vi.mocked(dataService.getTeam).mockReturnValue(team());
});

describe('the Icebreaker (a dark screen)', () => {
  const renderIcebreaker = (isFacilitator: boolean) =>
    render(
      <IcebreakerPhase
        session={baseSession({ phase: 'ICEBREAKER' })}
        isFacilitator={isFacilitator}
        localIcebreakerQuestion={null}
        onQuestionChange={vi.fn()}
        onRandom={vi.fn()}
        onStart={vi.fn()}
        onSwitchToOpenBoard={isFacilitator ? vi.fn() : undefined}
      />
    );

  it('reads as the facilitator sees it', () => {
    renderIcebreaker(true);
    expectText(screen.getByRole('heading', { name: 'Icebreaker' }), 'title');
    expectText(screen.getByTestId('icebreaker-question-input'), 'question field');
    const random = screen.getByRole('button', { name: /Random/ });
    expectText(random, 'Random');
    expectHoverText(random, 'Random');
    const start = screen.getByRole('button', { name: 'Start Session' });
    expectText(start, 'Start');
    expectHoverText(start, 'Start');
    const board = screen.getByRole('button', { name: /open board/i });
    expectText(board, 'switch to an open board');
    expectHoverText(board, 'switch to an open board');
  });

  it('reads as a participant sees it, the waiting line included, which does not pulse', () => {
    const { container } = renderIcebreaker(false);
    expectText(screen.getByTestId('icebreaker-question-display'), 'question');
    const waiting = screen.getByText(/Waiting for facilitator to start/);
    expectText(waiting, 'waiting line');
    expect(waiting.className).not.toMatch(/animate-pulse/);
    expectNoOpacity(container);
  });
});

describe('the Welcome happiness check', () => {
  const renderWelcome = (overrides: Partial<RetroSession> = {}, user: User = facilitator) =>
    render(
      <WelcomePhase
        session={baseSession({ phase: 'WELCOME', happiness: { 'p-1': 4, 'p-2': 2 }, ...overrides })}
        currentUser={user}
        participantsCount={3}
        isFacilitator={user.role === 'facilitator'}
        updateSession={vi.fn()}
        onNext={vi.fn()}
      />
    );

  it('reads before the reveal, the five choices unfaded and the one chosen marked as pressed', () => {
    const { container } = renderWelcome({}, participant);
    expectText(screen.getByRole('heading', { name: 'Happiness Check' }), 'title');
    expectText(screen.getByText('How are you feeling about the last sprint?'), 'question');
    expectText(screen.getByText('2 / 3 voted'), 'count');
    const choices = container.querySelectorAll('button.text-6xl');
    expect(choices).toHaveLength(5);
    expect(choices[3]).toHaveAttribute('aria-pressed', 'true');
    expect(choices[0]).toHaveAttribute('aria-pressed', 'false');
    expectNoOpacity(container);
  });

  it('reads the facilitator’s buttons and the revealed results', () => {
    renderWelcome();
    expectText(screen.getByRole('button', { name: 'Reveal Results' }), 'Reveal Results');
    const next = screen.getByRole('button', { name: 'Next Phase' });
    expectText(next, 'Next Phase');
    expectHoverText(next, 'Next Phase');
  });

  it('reads the histogram once revealed', () => {
    const { container } = renderWelcome({ settings: { ...baseSession().settings, revealHappiness: true } });
    for (const count of within(container).getAllByText('1')) expectText(count, 'a bar’s count');
    expectText(screen.getByText(/2 \/ 3 participants voted/), 'results line');
  });
});

describe('Open Actions and the impact-rating round', () => {
  const previous = action('prev-1', 'Automate the changelog');
  const closed = action('closed-1', 'Rotate the facilitator', { done: true, closedAt: '2026-11-01' });

  const renderOpen = (user: User, overrides: Partial<RetroSession> = {}, props: { showNotice?: boolean } = {}) => {
    const theTeam = team({ globalActions: [previous] });
    vi.mocked(dataService.getTeam).mockReturnValue(theTeam);
    return render(
      <OpenActionsPhase
        team={theTeam}
        session={baseSession({
          phase: 'OPEN_ACTIONS',
          openActionsSnapshot: [previous],
          closedActionsSnapshot: [closed],
          ...overrides
        })}
        currentUser={user}
        participants={[facilitator, participant, participant2]}
        isFacilitator={user.role === 'facilitator'}
        reviewActionIds={['prev-1']}
        setPhase={vi.fn()}
        applyActionUpdate={vi.fn()}
        assignableMembers={team().members}
        buildActionContext={vi.fn(() => '')}
        setRefreshTick={vi.fn()}
        ratingEnabled
        showRatingNotice={props.showNotice ?? false}
        onRateAction={vi.fn()}
        onToggleDeferRating={vi.fn()}
        onRateNow={vi.fn()}
        onToggleImpactReveal={vi.fn()}
        onDismissRatingNotice={vi.fn()}
      />
    );
  };

  it('reads as the facilitator sees it, the notice and its dismiss control included', () => {
    renderOpen(facilitator, {}, { showNotice: true });
    expectText(screen.getByRole('heading', { name: 'Review Open Actions' }), 'title');
    expectText(screen.getByRole('button', { name: 'Next Phase' }), 'Next Phase');
    expectText(screen.getByRole('combobox', { name: /Automate the changelog/ }), 'assignee');
    expectText(screen.getByTestId('toggle-impact-reveal'), 'Reveal results');
    const later = screen.getByTestId('defer-impact-rating');
    expectText(later, 'Rate later, off');
    expectHoverText(later, 'Rate later, off');
    expectText(screen.getByText(/Your team can now rate/), 'notice');
    expectGraphic(screen.getByRole('button', { name: 'Dismiss the impact rating notice' }), 'dismiss');
    expectText(screen.getByTestId('impact-vote-count'), 'cast count');
  });

  it('reads the postponed state of a row', () => {
    const sessionId = 'retro-1';
    renderOpen(facilitator, { closedActionsSnapshot: [{ ...closed, impactDeferredBy: sessionId }] });
    expectText(screen.getByTestId('defer-impact-rating'), 'Rate later, on');
    expectText(screen.getByTestId('impact-deferred-note'), 'postponed note');
    // The postponed action reads as muted text, not as text under an opacity.
    expectText(screen.getByText('Rotate the facilitator'), 'postponed action');
  });

  it('reads as a participant sees it: a disabled done circle still shows its state, the stars and "Not concerned"', () => {
    const { container } = renderOpen(participant, { actionImpactVotes: { 'closed-1': { 'p-1': 'abstain' } } });
    const toggle = screen.getByRole('button', { name: 'Mark action as done' });
    expect(toggle).toBeDisabled();
    expectGraphic(toggle, 'a disabled done circle');
    const assignee = screen.getByRole('combobox', { name: /Automate the changelog/ });
    expect(assignee).toBeDisabled();
    // Disabled, it paints its `disabled:` pair, not an opacity.
    expect(assignee.className).toMatch(/disabled:bg-slate-50 disabled:text-slate-600/);
    expect(tokenContrast('slate-600', 'slate-50')).toBeGreaterThanOrEqual(4.5);
    const stars = screen.getAllByRole('button', { name: /of 3 —/ });
    expect(stars).toHaveLength(3);
    for (const star of stars) expectGraphic(star.querySelector('path')!, 'an empty star’s outline');
    const pressed = screen.getByRole('button', { name: 'Not concerned' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expectText(pressed, 'Not concerned, pressed');
    expectText(screen.getByTestId('impact-choice-label'), 'choice label');
    expectNoOpacity(container);
  });

  it('reads "Not concerned" unpressed and the revealed results', () => {
    renderOpen(participant, {
      settings: { ...baseSession().settings, revealActionImpact: true },
      actionImpactVotes: { 'closed-1': { 'p-2': 3, 'fac-1': 'abstain' } }
    });
    const notConcerned = screen.getByRole('button', { name: 'Not concerned' });
    expectText(notConcerned, 'Not concerned');
    const result = screen.getByTestId('impact-result');
    for (const text of within(result).getAllByText(/\d/)) expectText(text, 'a result figure');
  });
});

describe('Discuss', () => {
  const topicFor = (colId: string) => ({
    id: 't1', text: 'Reviews wait two days', votes: 3, uniqueVotes: 2, type: 'ticket' as const,
    ref: { id: 't1', colId, text: 'Reviews wait two days', authorId: 'p-1', groupId: null, votes: ['fac-1', 'p-1', 'p-1'] }
  });
  const renderDiscuss = (session: RetroSession, active: string | null, user: User = facilitator, extra: Record<string, unknown> = {}) =>
    render(
      <DiscussPhase
        session={session}
        currentUser={user}
        participantsCount={3}
        isFacilitator={user.role === 'facilitator'}
        sortedItems={[topicFor(session.columns[0].id)]}
        activeDiscussTicket={active}
        setActiveDiscussTicket={vi.fn()}
        updateSession={vi.fn()}
        handleToggleNextTopicVote={vi.fn()}
        discussRefs={{ current: {} }}
        editingProposalId={null}
        editingProposalText=""
        setEditingProposalText={vi.fn()}
        handleSaveProposalEdit={vi.fn()}
        handleCancelProposalEdit={vi.fn()}
        handleStartEditProposal={vi.fn()}
        handleDeleteProposal={vi.fn()}
        handleVoteProposal={vi.fn()}
        handleAcceptProposal={vi.fn()}
        handleUndoAcceptProposal={vi.fn()}
        handleRejectProposal={vi.fn()}
        handleUndoRejectProposal={vi.fn()}
        handleAddProposal={vi.fn()}
        newProposalText=""
        setNewProposalText={vi.fn()}
        handleDirectAddAction={vi.fn()}
        setPhase={vi.fn()}
        {...extra}
      />
    );

  // The bar wraps on a phone: a rule before "Show votes" then opened the
  // label's own line. Its items are spaced with gaps, as the board's bar is.
  it('spaces its bar with gaps, never a rule before "Show votes", and lets it wrap', () => {
    renderDiscuss(baseSession({ columns: [column('col-1', '#10b981')] }), null);
    const label = screen.getByLabelText('Show votes').closest('label') as HTMLElement;
    expect(label.className).not.toMatch(/(^|\s)border-l(-|\s|$)/);
    expect(label.className).not.toMatch(/(^|\s)pl-/);
    for (const box of [label.parentElement!, label.parentElement!.parentElement!]) {
      expect(box).toHaveClass('flex-wrap');
      expect(box.className).toMatch(/(^|\s)gap-x-/);
    }
  });

  it.each(COLUMN_COLOURS)('paints a topic in a soft tint of its column (%s), its words in the dark ink', (hex) => {
    const { container } = renderDiscuss(baseSession({ columns: [column('col-1', hex)] }), null);
    const tones = cardTones(hex)!;
    const card = container.querySelector('[data-topic-id="t1"]') as HTMLElement;
    expect(card.style.backgroundColor).not.toBe('');
    // The tint is an inline style, which effectivePair cannot read: each text
    // token of the card is measured against the tint itself.
    const onTint = (element: Element, token: string, floor: number, what: string) => {
      expect(element.className, what).toMatch(new RegExp(`(^|\\s)text-${token}(\\s|$)`));
      expect(contrastRatio(themeValue(token), tones.tint), `${what} on ${hex}`).toBeGreaterThanOrEqual(floor);
    };
    onTint(screen.getByText('Reviews wait two days'), 'slate-900', 4.5, 'topic');
    onTint(screen.getByTestId('topic-total-votes'), 'indigo-700', 4.5, 'votes');
    onTint(screen.getByTestId('topic-unique-voters'), 'indigo-700', 4.5, 'voters');
    onTint(screen.getByTestId('topic-total-votes').parentElement!, 'slate-600', 4.5, 'meta line');
    onTint(screen.getByText('expand_more'), 'slate-600', 3, 'chevron');
    onTint(screen.getByText('Click to discuss'), 'indigo-700', 4.5, 'click to discuss');
  });

  // A custom template made by an older release stores classes and no hex
  // (decision D15): the topic takes the hue those classes name, as the board's
  // card does (utils/columnHue.ts), and only a column with neither is white.
  it('tints a topic whose column stores classes only, and leaves one with no hue white', () => {
    const classOnly = column('col-1');
    const { container, unmount } = renderDiscuss(baseSession({ columns: [classOnly] }), null);
    const tinted = container.querySelector('[data-topic-id="t1"]') as HTMLElement;
    expect(columnHue(classOnly)).not.toBeNull();
    expect(hexOf(tinted.style.backgroundColor)).toBe(cardTones(columnHue(classOnly))!.tint);
    unmount();

    const noHue = { ...column('col-1'), color: '', border: '', text: '' };
    const plain = renderDiscuss(baseSession({ columns: [noHue] }), null).container.querySelector('[data-topic-id="t1"]') as HTMLElement;
    expect(columnHue(noHue)).toBeNull();
    expect(plain.style.backgroundColor).toBe('');
    expect(plain.className).toMatch(/(^|\s)bg-white(\s|$)/);
  });

  it('draws a stored column icon through the names the font draws', () => {
    renderDiscuss(baseSession({ columns: [{ ...column('col-1', '#10B981'), icon: 'clarity' }] }), null);
    expect(screen.queryByText('clarity')).toBeNull();
  });

  it('reads the bar, my votes, "Move on" in both states and the proposals of the topic in focus', () => {
    const session = baseSession({
      discussionNextTopicVotes: { t1: ['fac-1'] },
      actions: [
        action('a1', 'Freeze merges on Thursday', { type: 'proposal', linkedTicketId: 't1', proposalVotes: { 'p-1': 'up' } }),
        action('a2', 'Pair on reviews', { type: 'new', linkedTicketId: 't1' }),
        action('a3', 'Skip standups', { type: 'proposal', rejected: true, linkedTicketId: 't1' })
      ]
    });
    const { container } = renderDiscuss(session, 't1');
    expectText(screen.getByRole('heading', { name: 'Discuss & Propose Actions' }), 'title');
    expectText(screen.getByText('Show votes'), 'show votes');
    expectText(screen.getByTestId('topic-my-votes'), 'my votes');
    const moveOn = screen.getByRole('button', { name: /Move On/ });
    expectText(moveOn, 'Move On, voted');
    expectText(within(moveOn).getByText('1/3'), 'Move On count');
    expectText(screen.getByText('Proposals'), 'proposals heading');
    expectText(container.querySelector('[data-proposal-state="accepted"]')!, 'accepted');
    expectGraphic(screen.getByRole('button', { name: 'Undo accept' }), 'undo accept');
    expectText(container.querySelector('[data-proposal-state="rejected"]')!, 'rejected');
    expectGraphic(screen.getByRole('button', { name: 'Undo reject' }), 'undo reject');

    const row = container.querySelector('[data-proposal-row="a1"]')!;
    expectText(within(row as HTMLElement).getByText('Freeze merges on Thursday'), 'proposal');
    expectText(row.querySelector('[data-vote-status]')!, 'vote status');
    expectText(within(row as HTMLElement).getByTestId('proposal-vote-progress'), 'vote progress');
    for (const number of screen.getAllByTestId('proposal-number')) expectText(number, 'a proposal number');
    for (const vote of row.querySelectorAll('.bg-slate-100.rounded-lg button')) {
      expectText(vote, 'a vote button');
      expectHoverText(vote, 'a vote button');
    }
    expectGraphic(within(row as HTMLElement).getByRole('button', { name: 'Delete proposal' }), 'delete proposal');
    expectText(within(row as HTMLElement).getByRole('button', { name: 'Reject' }), 'Reject');
    expectText(within(row as HTMLElement).getByRole('button', { name: 'Accept' }), 'Accept');

    expectText(screen.getByRole('textbox'), 'proposal field');
    expectText(screen.getByRole('button', { name: 'Propose' }), 'Propose');
    expectGraphic(screen.getByRole('button', { name: 'Directly Accept Action' }), 'accept directly');
  });

  it('reads "Move On" before the person voted, as a participant sees it', () => {
    renderDiscuss(baseSession(), null, participant);
    const moveOn = screen.getByRole('button', { name: /Move On/ });
    expectText(moveOn, 'Move On');
    expectHoverText(moveOn, 'Move On');
  });

  it('reads the voters’ tooltip', async () => {
    const session = baseSession({
      actions: [action('a1', 'Freeze merges', { type: 'proposal', linkedTicketId: 't1', proposalVotes: { 'p-1': 'up' } })]
    });
    const { container } = renderDiscuss(session, 't1', facilitator, {});
    fireEvent.mouseEnter(screen.getByTestId('proposal-vote-progress').parentElement!);
    const tooltip = container.querySelector('.shadow-lg') as HTMLElement;
    expect(tooltip).toBeTruthy();
    expectText(within(tooltip).getByText(/Not voted/), 'not voted');
    expectText(within(tooltip).getByText(/^Voted/), 'voted');
    expectText(within(tooltip).getByText('Inès'), 'a name');
  });

  it('reads the edit field and its two buttons', () => {
    const session = baseSession({
      actions: [action('a1', 'Freeze merges', { type: 'proposal', linkedTicketId: 't1', proposalVotes: {} })]
    });
    renderDiscuss(session, 't1', facilitator, { editingProposalId: 'a1', editingProposalText: 'Freeze merges' });
    expectGraphic(screen.getByRole('button', { name: 'Save the action' }), 'save');
    expectGraphic(screen.getByRole('button', { name: 'Cancel the edit' }), 'cancel');
  });
});

describe('Review', () => {
  const renderReview = (user: User, overrides: Partial<RetroSession> = {}) => {
    const prev = action('prev-1', 'Automate the changelog');
    const theTeam = team({ globalActions: [prev] });
    vi.mocked(dataService.getTeam).mockReturnValue(theTeam);
    return render(
      <ReviewPhase
        session={baseSession({
          phase: 'REVIEW',
          tickets: [{ id: 'tkt-1', colId: 'col-1', text: 'Releases keep slipping', authorId: 'fac-1', groupId: null, votes: [] }],
          actions: [action('act-1', 'Write the release checklist', { linkedTicketId: 'tkt-1' })],
          historyActionsSnapshot: [prev],
          reviewSummary: 'We release on Tuesdays now.',
          ...overrides
        })}
        team={theTeam}
        currentUser={user}
        isFacilitator={user.role === 'facilitator'}
        historyActionIds={['prev-1']}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        applyActionUpdate={vi.fn()}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team().members}
        setRefreshTick={vi.fn()}
      />
    );
  };

  it('reads as the facilitator sees it', () => {
    renderReview(facilitator);
    expectText(screen.getByRole('heading', { name: 'Review Actions' }), 'title');
    expectText(screen.getByRole('button', { name: 'Next: Close Retro' }), 'Go to Close');
    expectText(screen.getByRole('heading', { name: 'Retro Report Summary' }), 'summary heading');
    expectText(screen.getByRole('heading', { name: 'New Actions from this Session' }), 'new actions heading');
    expectText(screen.getByRole('heading', { name: 'All Previous Actions (Unfinished)' }), 'previous actions heading');
    expectText(screen.getByDisplayValue('We release on Tuesdays now.'), 'summary field');
    expectText(screen.getByText('Releases keep slipping'), 'the topic of a group of actions');
    for (const field of screen.getAllByRole('textbox', { name: 'Action text' })) expectText(field, 'an action');
    for (const select of screen.getAllByRole('combobox')) expectText(select, 'an assignee');
  });

  it('reads the delete confirmation', () => {
    renderReview(facilitator);
    fireEvent.click(screen.getByRole('button', { name: 'Delete action' }));
    expectText(screen.getByText('Confirm?'), 'confirm');
    expectText(screen.getByRole('button', { name: 'Yes' }), 'yes');
    expectText(screen.getByRole('button', { name: 'No' }), 'no');
  });

  it('reads as a participant sees it: the summary as text, a disabled done circle that still shows its state', () => {
    const { container } = renderReview(participant);
    expectText(screen.getByText('We release on Tuesdays now.'), 'summary');
    for (const toggle of screen.getAllByRole('button', { name: 'Mark action as done' })) {
      expect(toggle).toBeDisabled();
      expectGraphic(toggle, 'a disabled done circle');
    }
    for (const select of screen.getAllByRole('combobox')) expectText(select, 'a disabled assignee');
    expectNoOpacity(container);
  });

  it('reads the empty states', () => {
    renderReview(participant, { actions: [], historyActionsSnapshot: [], reviewSummary: '' });
    expectText(screen.getByText('No retrospective summary yet.'), 'no summary');
  });
});

describe('Close and its ROTI follow-up (a dark screen)', () => {
  const renderClose = (user: User, overrides: Partial<RetroSession> = {}) =>
    render(
      <ClosePhase
        session={baseSession({ phase: 'CLOSE', roti: { 'p-1': 4, 'p-2': 2 }, ...overrides })}
        currentUser={user}
        participantsCount={3}
        isFacilitator={user.role === 'facilitator'}
        updateSession={vi.fn()}
        assignableMembers={team().members}
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

  it('reads before the reveal', () => {
    const { container } = renderClose(participant);
    expectText(screen.getByRole('heading', { name: 'Session Closed' }), 'title');
    expectText(screen.getByText(/Thank you/), 'thanks');
    expectText(screen.getByRole('heading', { name: /ROTI/ }), 'ROTI title');
    for (const score of ['1', '2', '3', '4', '5']) {
      const button = screen.getByRole('button', { name: score });
      expectText(button, `ROTI ${score}`);
    }
    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'false');
    expectHoverText(screen.getByRole('button', { name: '3' }), 'a ROTI score');
    expectText(screen.getByText('2 / 3 members have voted'), 'count');
    expectText(screen.getByRole('button', { name: 'Leave Retrospective' }), 'Leave');
    expectHoverText(screen.getByRole('button', { name: 'Leave Retrospective' }), 'Leave');
    expectNoOpacity(container);
  });

  it('reads the revealed results and the follow-up, as the facilitator sees them', () => {
    const { container } = renderClose(facilitator, {
      settings: { ...baseSession().settings, revealRoti: true },
      actions: [
        action('r1', 'Shorter retros', { type: 'proposal', linkedTicketId: ROTI_FOLLOW_UP_LINK_ID, proposalVotes: {} }),
        action('r2', 'Celebrate releases', { type: 'new', linkedTicketId: ROTI_FOLLOW_UP_LINK_ID })
      ]
    });
    expectText(screen.getByText('3.0 / 5'), 'average');
    expectText(screen.getByRole('heading', { name: 'ROTI Follow-up Actions' }), 'follow-up title');
    expectText(screen.getByText('Shorter retros'), 'a proposal');
    expectText(screen.getByText('Celebrate releases'), 'an accepted action');
    expectText(screen.getByRole('combobox', { name: /Celebrate releases/ }), 'assignee');
    const row = container.querySelector('[data-proposal-row="r1"]') as HTMLElement;
    expectText(row.querySelector('[data-vote-status]')!, 'vote status');
    expectText(within(row).getByTestId('proposal-vote-progress'), 'vote progress');
    for (const vote of row.querySelectorAll('button')) {
      if (vote.getAttribute('aria-label') === 'Delete proposal') expectGraphic(vote, 'delete');
      else expectText(vote, `a control of the proposal (${vote.textContent})`);
    }
    expectText(screen.getByRole('button', { name: 'Propose' }), 'Propose');
    expectGraphic(screen.getByRole('button', { name: 'Directly Accept Action' }), 'accept directly');
    expectText(screen.getByRole('textbox'), 'follow-up field');
    // The placeholder of the dark field, on the field's own slate-900.
    expect(screen.getByRole('textbox').className).toMatch(/placeholder:text-slate-400/);
    expect(tokenContrast('slate-400', 'slate-900')).toBeGreaterThanOrEqual(4.5);
    expectText(screen.getByRole('button', { name: 'Return to Dashboard' }), 'Return');
  });

  it('reads a participant’s view of an accepted follow-up action', () => {
    renderClose(participant, {
      settings: { ...baseSession().settings, revealRoti: true },
      actions: [action('r2', 'Celebrate releases', { type: 'new', linkedTicketId: ROTI_FOLLOW_UP_LINK_ID, assigneeId: 'p-2' })]
    });
    expectText(screen.getByText(/Owner: Inès/), 'owner');
  });
});

describe('the tips panel', () => {
  it('reads on white, with no gradient behind it', () => {
    const { container } = render(<RetroTipsPanel currentPhase="BRAINSTORM" onClose={vi.fn()} />);
    expectText(screen.getAllByText('Retro tips')[0], 'eyebrow');
    expectText(screen.getByRole('heading', { name: 'Brainstorm' }), 'title');
    const hide = screen.getByRole('button', { name: 'Hide retro tips' });
    expectText(hide, 'Hide');
    expectHoverText(hide, 'Hide');
    expectText(screen.getByText('Purpose'), 'purpose label');
    expectText(screen.getByText(/write silently/i), 'purpose');
    expect(container.innerHTML).not.toMatch(/bg-linear|bg-gradient/);
  });
});

describe('a star', () => {
  it('draws an empty star’s outline at 3:1 on white and on the results’ amber chip', () => {
    for (const surface of ['white', 'amber-50']) {
      const { container, unmount } = render(<div className={`bg-${surface}`}><Star fill={0} /></div>);
      expectGraphic(container.querySelector('path')!, `outline on ${surface}`);
      unmount();
    }
  });
});
