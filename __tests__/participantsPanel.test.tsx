import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import ParticipantsPanel from '../components/session/ParticipantsPanel';
import { ParticipantActivity, RetroSession, Ticket, User } from '../types';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'u-' + Math.random().toString(36).slice(2, 7),
  name: 'User',
  color: 'bg-indigo-500',
  role: 'participant',
  ...overrides
});

const facilitator = makeUser({ id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' });
const alice = makeUser({ id: 'a', name: 'Alice', color: 'bg-rose-500' });
const bob = makeUser({ id: 'b', name: 'Bob', color: 'bg-emerald-500' });
const carol = makeUser({ id: 'c', name: 'Carol', color: 'bg-amber-500' });
const dave = makeUser({ id: 'd', name: 'Dave' });

// The row whose name is `name`: the name is the element's own text, so a
// sentence that mentions someone (the typing line) never matches.
const rowOf = (name: string) => {
  const row = screen.getAllByTestId('participant-row').find((candidate) => within(candidate).queryByText(name));
  if (!row) throw new Error(`no participant row for ${name}`);
  return row;
};

const ticket = (authorId: string): Ticket => ({
  id: 't-' + Math.random().toString(36).slice(2, 7),
  colId: 'col-1',
  text: 'idea',
  authorId,
  groupId: null,
  votes: []
});

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 's1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [],
  icebreakerQuestion: '',
  columns: [
    { id: 'col-1', title: 'Went well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'thumb_up', text: 'text-emerald-700', ring: 'ring-emerald-300' }
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

const baseProps = {
  connectedUsers: new Set<string>(['fac', 'a', 'b', 'c']),
  currentUser: facilitator,
  isFacilitator: true,
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  onInvite: vi.fn(),
  getMemberDisplay: (member: User) => ({
    displayName: member.name,
    initials: member.name.slice(0, 2).toUpperCase()
  })
};

describe('ParticipantsPanel - contribution counts', () => {
  it('renders one coloured dot per ticket authored, and a "no tickets" cue for non-contributors', () => {
    const session = makeSession({
      participants: [facilitator, alice, bob, carol],
      tickets: [ticket('a'), ticket('a'), ticket('a'), ticket('b')]
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice, bob, carol]}
        activityUsers={{}}
      />
    );

    // Footer summarises the total tickets gathered so far
    expect(container.textContent).toContain('4 tickets added so far');

    // Alice authored 3 tickets -> three dots, no overflow chip
    const aliceGauge = container.querySelector('[title="3 tickets added"]');
    expect(aliceGauge).toBeTruthy();
    expect(aliceGauge!.querySelectorAll('span').length).toBe(3);

    // Bob authored a single ticket -> one dot, singular label
    const bobGauge = container.querySelector('[title="1 ticket added"]');
    expect(bobGauge).toBeTruthy();
    expect(bobGauge!.querySelectorAll('span').length).toBe(1);

    // Facilitator and Carol authored nothing -> explicit "no tickets" indicator
    expect(container.querySelectorAll('[title="No tickets added yet"]').length).toBe(2);
  });

  it('collapses a large contribution into a "+N" overflow chip with the exact total on hover', () => {
    const session = makeSession({
      participants: [alice],
      tickets: Array.from({ length: 15 }, () => ticket('a'))
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        currentUser={alice}
        session={session}
        participants={[alice]}
        activityUsers={{}}
      />
    );

    const gauge = container.querySelector('[title="15 tickets added"]');
    expect(gauge).toBeTruthy();
    // 8 dots + a "+7" chip == 15 represented, without overflowing the row
    expect(gauge!.textContent).toContain('+7');
  });

  it('never renders a ranking marker such as a "top contributor" star', () => {
    const session = makeSession({
      participants: [alice, bob],
      tickets: [ticket('a'), ticket('a'), ticket('a'), ticket('b')]
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        currentUser={alice}
        session={session}
        participants={[alice, bob]}
        activityUsers={{}}
      />
    );

    const star = Array.from(container.querySelectorAll('.material-symbols-outlined')).find(
      (el) => el.textContent === 'star'
    );
    expect(star).toBeFalsy();
  });

  it('does not render contribution gauges before any ticket exists', () => {
    const session = makeSession({ phase: 'WELCOME', participants: [alice, bob], tickets: [] });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[alice, bob]}
        activityUsers={{}}
      />
    );

    expect(container.querySelector('[title$="added"]')).toBeFalsy();
    expect(container.querySelector('[title="No tickets added yet"]')).toBeFalsy();
  });
});

describe('ParticipantsPanel - participants who left the session', () => {
  it('keeps a departed participant visible with a "Left the session" badge', () => {
    const session = makeSession({
      phase: 'DISCUSS',
      participants: [facilitator, alice, bob],
      leftUsers: ['b']
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice, bob]}
        activityUsers={{}}
      />
    );

    // Bob is still listed, but flagged as having left
    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('Left the session');
    const leftRows = container.querySelectorAll('[data-participant-left="true"]');
    expect(leftRows.length).toBe(1);
    expect(leftRows[0].textContent).toContain('Bob');
  });

  it('excludes departed participants from the header and footer counters', () => {
    const session = makeSession({
      phase: 'VOTE',
      participants: [facilitator, alice, bob, carol],
      leftUsers: ['c'],
      finishedUsers: ['a', 'c'] // Carol finished before leaving: not counted anymore
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice, bob, carol]}
        activityUsers={{}}
      />
    );

    expect(container.textContent).toContain('Participants (3)');
    expect(container.textContent).toContain('1 / 3 finished');
  });

  it('excludes departed participants from the happiness counter in WELCOME', () => {
    const session = makeSession({
      phase: 'WELCOME',
      participants: [facilitator, alice, bob],
      leftUsers: ['b'],
      happiness: { a: 4, b: 5 }, // Bob voted then left
      tickets: []
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice, bob]}
        activityUsers={{}}
      />
    );

    expect(container.textContent).toContain('1 / 2 submitted happiness');
  });

  it('lets the facilitator mark a participant as left and back, but never themselves', () => {
    const onToggleLeft = vi.fn();
    const session = makeSession({
      participants: [facilitator, alice, bob],
      leftUsers: ['b'],
      tickets: []
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice, bob]}
        activityUsers={{}}
        onToggleLeft={onToggleLeft}
      />
    );

    // One toggle per other participant (Alice + Bob), none for the facilitator themselves
    expect(container.querySelector('[title="Mark Fran as having left the session"]')).toBeFalsy();

    const markAliceLeft = container.querySelector('[title="Mark Alice as having left the session"]');
    expect(markAliceLeft).toBeTruthy();
    fireEvent.click(markAliceLeft!);
    expect(onToggleLeft).toHaveBeenCalledWith('a');

    const markBobBack = container.querySelector('[title="Mark Bob as returned"]');
    expect(markBobBack).toBeTruthy();
    fireEvent.click(markBobBack!);
    expect(onToggleLeft).toHaveBeenCalledWith('b');
  });

  it('does not show the left toggle to plain participants', () => {
    const session = makeSession({ participants: [facilitator, alice], tickets: [] });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        currentUser={alice}
        isFacilitator={false}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{}}
        onToggleLeft={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="toggle-left-btn"]')).toBeFalsy();
  });
});

describe('ParticipantsPanel - invited teammates waiting to join', () => {
  it('lists invitees who have not joined yet in a dedicated section', () => {
    const session = makeSession({
      participants: [facilitator, alice],
      invitedUsers: [
        { id: 'a', name: 'Alice', email: 'alice@example.com' }, // already joined
        { id: 'z', name: 'Zoé', email: 'zoe@example.com' } // still expected
      ],
      tickets: []
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{}}
      />
    );

    const section = container.querySelector('[data-testid="invited-section"]');
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain('waiting to join (1)');
    const rows = container.querySelectorAll('[data-testid="invited-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Zoé');
    expect(rows[0].textContent).toContain('Invited');
  });

  it('counts invitees without naming them in an anonymous retro', () => {
    const session = makeSession({
      participants: [facilitator, alice],
      invitedUsers: [{ id: 'z', name: 'Zoé', email: 'zoe@example.com' }],
      tickets: []
    });
    session.settings.isAnonymous = true;

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{}}
      />
    );

    const section = container.querySelector('[data-testid="invited-section"]');
    expect(section!.textContent).toContain('waiting to join (1)');
    expect(container.querySelectorAll('[data-testid="invited-row"]')).toHaveLength(0);
    expect(section!.innerHTML).not.toContain('zoe@example.com');
  });

  it('hides the section entirely once every invitee has joined', () => {
    const session = makeSession({
      participants: [facilitator, alice],
      invitedUsers: [{ id: 'a', name: 'Alice', email: 'alice@example.com' }],
      tickets: []
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{}}
      />
    );

    expect(container.querySelector('[data-testid="invited-section"]')).toBeFalsy();
  });

  it('matches a joined participant by email even when ids differ', () => {
    const aliceViaLink = makeUser({ id: 'other-id', name: 'Alice L.', email: 'alice@example.com' });
    const session = makeSession({
      participants: [facilitator, aliceViaLink],
      invitedUsers: [{ id: 'invite-id', name: 'Alice', email: 'alice@example.com' }],
      tickets: []
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, aliceViaLink]}
        activityUsers={{}}
      />
    );

    expect(container.querySelector('[data-testid="invited-section"]')).toBeFalsy();
  });
});

describe('ParticipantsPanel - typing activity', () => {
  it('shows a typing cue next to a participant writing a ticket', () => {
    const session = makeSession({ participants: [facilitator, alice], tickets: [] });

    const activityUsers: Record<string, ParticipantActivity> = { a: 'brainstorm' };
    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={activityUsers}
      />
    );

    expect(container.textContent).toContain('writing a ticket');
    // Animated dots are present
    expect(container.querySelectorAll('.typing-dot').length).toBe(3);
  });

  it('shows a proposing cue during the discuss phase', () => {
    const session = makeSession({ phase: 'DISCUSS', participants: [facilitator, alice] });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{ a: 'proposal' }}
      />
    );

    expect(container.textContent).toContain('proposing action');
  });

  it('falls back to the role label when a participant is not typing', () => {
    const session = makeSession({ participants: [facilitator, alice] });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{}}
      />
    );

    expect(container.textContent).not.toContain('writing a ticket');
    expect(container.textContent).toContain('participant');
  });
});

// The Open Actions phase used to fall into the generic "x / y finished"
// branch. During a rating round the useful number is a different one, and it
// must not appear at all for a team that is not rating anything.
describe('ParticipantsPanel - impact rating round', () => {
  const closedAction = (id: string) => ({
    id,
    text: 'Pair on deploys',
    assigneeId: null,
    done: true,
    type: 'new' as const,
    proposalVotes: {}
  });

  const ratingSession = (overrides: Partial<RetroSession> = {}) =>
    makeSession({
      phase: 'OPEN_ACTIONS',
      participants: [facilitator, alice, bob],
      closedActionsSnapshot: [closedAction('a1'), closedAction('a2')],
      ...overrides
    });

  const renderPanel = (session: RetroSession, participants: User[]) =>
    render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={participants}
        activityUsers={{}}
      />
    );

  it('counts how many participants have answered every action', () => {
    const session = ratingSession({
      actionImpactVotes: { a1: { a: 3, b: 1 }, a2: { a: 'abstain' } }
    });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    // Alice answered both, Bob only one. The facilitator is not counted.
    expect(container.textContent).toContain('1 / 2 rated all actions');
  });

  // Regression, PR #460 second round. "Rate later" became a toggle that keeps
  // the row in `closedActionsSnapshot`, marked — and this panel still counted
  // the whole snapshot. A round of 9 with 2 postponed reported 7/9 forever and
  // nobody could reach the green tick.
  it('leaves a postponed action out of the round entirely', () => {
    const session = ratingSession({
      closedActionsSnapshot: [
        closedAction('a1'),
        { ...closedAction('a2'), impactDeferredBy: 's1' }
      ],
      // Alice answered the one that is still being asked about. Bob answered
      // the one that has since been postponed, and nothing else.
      actionImpactVotes: { a1: { a: 3 }, a2: { b: 3 } }
    });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    expect(container.textContent).toContain('1 / 2 rated all actions');
  });

  // With nothing left to answer the round is not "0 / 2 waiting", it is over.
  it('reports no round at all when every action is postponed', () => {
    const session = ratingSession({
      closedActionsSnapshot: [
        { ...closedAction('a1'), impactDeferredBy: 's1' },
        { ...closedAction('a2'), impactDeferredBy: 's1' }
      ]
    });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    expect(container.textContent).not.toContain('rated all actions');
  });

  // The facilitator seat is a driving identity; the person behind it votes
  // under their participant identity. Counting the seat would make the
  // denominator larger than the number of humans in the room.
  it('leaves the facilitator out of the denominator', () => {
    const session = ratingSession({ actionImpactVotes: {} });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    expect(container.textContent).toContain('0 / 2 rated all actions');
  });

  it('excludes participants marked as having left', () => {
    const session = ratingSession({ actionImpactVotes: {}, leftUsers: ['b'] });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    expect(container.textContent).toContain('0 / 1 rated all actions');
  });

  // A team that is not rating anything must see the phase exactly as before.
  it('shows nothing about ratings when the round is empty', () => {
    const session = ratingSession({ closedActionsSnapshot: [] });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    expect(container.textContent).not.toContain('rated all actions');
    expect(container.textContent).toContain('finished');
  });

  it('shows nothing when every participant holds the facilitator role', () => {
    const session = ratingSession({ participants: [facilitator] });

    const { container } = renderPanel(session, [facilitator]);

    expect(container.textContent).not.toContain('rated all actions');
  });

  it('shows partial progress next to a participant, and a check once they are done', () => {
    const session = ratingSession({
      actionImpactVotes: { a1: { a: 3, b: 2 }, a2: { a: 1 } }
    });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    // Bob has answered one of two; Alice is done and gets the check instead.
    expect(container.textContent).toContain('1/2');
    const rows = container.querySelectorAll('[data-testid="participant-row"]');
    const aliceRow = Array.from(rows).find((row) => row.textContent?.includes('Alice'));
    expect(aliceRow?.textContent).not.toContain('1/2');
    expect(aliceRow?.querySelector('[title="Rated every action"]')).not.toBeNull();
  });

  it('shows neither a check nor progress on the facilitator row', () => {
    const session = ratingSession({ actionImpactVotes: { a1: { a: 3 }, a2: { a: 3 } } });

    const { container } = renderPanel(session, [facilitator, alice, bob]);

    const rows = container.querySelectorAll('[data-testid="participant-row"]');
    const facilitatorRow = Array.from(rows).find((row) => row.textContent?.includes('Fran'));
    expect(facilitatorRow?.textContent).not.toContain('/2');
    expect(facilitatorRow?.querySelector('[title="Rated every action"]')).toBeNull();
  });
});

// Codex review finding: a team can switch the feature off while a session that
// already built a round is still open. The phase hides the block; the panel
// must go quiet with it rather than keep reporting progress on something
// nobody can see.
describe('ParticipantsPanel - rating switched off mid-session', () => {
  it('reports no rating progress when the team disabled the feature', () => {
    const session = makeSession({
      phase: 'OPEN_ACTIONS',
      participants: [facilitator, alice],
      closedActionsSnapshot: [
        { id: 'a1', text: 'x', assigneeId: null, done: true, type: 'new', proposalVotes: {} }
      ]
    });

    const { container } = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={[facilitator, alice]}
        activityUsers={{}}
        ratingEnabled={false}
      />
    );

    expect(container.textContent).not.toContain('rated all actions');
  });
});

// "Participant N", the way an anonymous session names the people on its roster.
const anonymousDisplay = (roster: User[]) => (member: User) => {
  const index = roster.findIndex((candidate) => candidate.id === member.id) + 1;
  return { displayName: `Participant ${index}`, initials: `P${index}` };
};

// 43.0: in the Vote phase each row says, in place of the role, the votes its
// person still has to cast, so the facilitator can follow the vote without
// asking. It is the number the person's own "N votes remaining" shows them.
describe('ParticipantsPanel - votes left in the Vote phase', () => {
  const everyone = [facilitator, alice, bob, carol];

  const voteSession = (overrides: Partial<RetroSession> = {}, settings: Partial<RetroSession['settings']> = {}) => {
    const session = makeSession({ phase: 'VOTE', participants: everyone, ...overrides });
    session.settings = { ...session.settings, ...settings };
    return session;
  };

  const renderVote = (session: RetroSession, props: Partial<React.ComponentProps<typeof ParticipantsPanel>> = {}) =>
    render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={everyone}
        activityUsers={{}}
        {...props}
      />
    );

  it('counts in words the votes each person still has to cast, cards and groups together, the facilitator included', () => {
    renderVote(voteSession({
      tickets: [
        { ...ticket('a'), votes: ['a', 'a', 'b'] },
        { ...ticket('b'), groupId: 'g1', votes: ['fac'] }
      ],
      groups: [{ id: 'g1', title: 'Topic', colId: 'col-1', votes: ['a'] }]
    }));

    expect(within(rowOf('Alice')).getByText('2 votes left')).toBeTruthy();
    expect(within(rowOf('Bob')).getByText('4 votes left')).toBeTruthy();
    expect(within(rowOf('Carol')).getByText('5 votes left')).toBeTruthy();
    // The Vote phase counts the facilitator as a voter, and so does the footer.
    expect(within(rowOf('Fran')).getByText('4 votes left')).toBeTruthy();
  });

  it('says one vote in the singular, and 0 until the person is finished', () => {
    renderVote(voteSession({ tickets: [{ ...ticket('a'), votes: ['a', 'b', 'b'] }] }, { maxVotes: 2 }));

    expect(within(rowOf('Alice')).getByText('1 vote left')).toBeTruthy();
    expect(within(rowOf('Bob')).getByText('0 votes left')).toBeTruthy();
  });

  it("turns a finished row back to its role and today's check", () => {
    // Alice finished with two votes left.
    renderVote(voteSession({ tickets: [{ ...ticket('a'), votes: ['a', 'a', 'a'] }], finishedUsers: ['a'] }));

    const row = rowOf('Alice');
    expect(within(row).getByRole('img', { name: 'Finished' })).toBeTruthy();
    expect(within(row).queryByTestId('votes-left')).toBeNull();
    expect(within(row).getByText('participant')).toBeTruthy();
  });

  it('never counts below 0', () => {
    // The number was lowered under what Alice had cast.
    renderVote(voteSession({ tickets: [{ ...ticket('a'), votes: ['a', 'a', 'a'] }] }, { maxVotes: 1 }));

    expect(within(rowOf('Alice')).getByText('0 votes left')).toBeTruthy();
  });

  it('counts nothing while votes are unlimited, and keeps the role line', () => {
    renderVote(
      voteSession({ tickets: [{ ...ticket('a'), votes: ['a'] }], finishedUsers: ['b'] }, { unlimitedVotes: true })
    );

    expect(screen.queryAllByTestId('votes-left')).toHaveLength(0);
    expect(within(rowOf('Alice')).getByText('participant')).toBeTruthy();
    expect(within(rowOf('Bob')).getByRole('img', { name: 'Finished' })).toBeTruthy();
  });

  it('shows nothing on a row marked as having left, and leaves the footer as it was', () => {
    const { container } = renderVote(voteSession({ leftUsers: ['c'] }));

    const carolRow = rowOf('Carol');
    expect(within(carolRow).getByText('Left the session')).toBeTruthy();
    expect(within(carolRow).queryByTestId('votes-left')).toBeNull();
    expect(container.textContent).toContain('0 / 3 finished');
  });

  it('shows no count outside the Vote phase, nor on an open board', () => {
    const voted = { tickets: [{ ...ticket('a'), votes: ['a', 'b'] }] };
    for (const phase of ['GROUP', 'DISCUSS', 'OPEN_BOARD']) {
      const { unmount } = renderVote(voteSession({ ...voted, phase }));
      expect(screen.queryAllByTestId('votes-left'), phase).toHaveLength(0);
      unmount();
    }
  });

  it('says a number and names no one in an anonymous retro', () => {
    const session = voteSession({ tickets: [{ ...ticket('a'), votes: ['a'] }] });
    session.settings.isAnonymous = true;

    const { container } = renderVote(session, { getMemberDisplay: anonymousDisplay(everyone) });

    expect(screen.getAllByTestId('votes-left')).toHaveLength(4);
    expect(within(rowOf('Participant 2')).getByText('4 votes left')).toBeTruthy();
    expect(container.textContent).not.toContain('Alice');
  });

  it('says it in words, with no ARIA and nothing to hover', () => {
    renderVote(voteSession());

    const chips = screen.getAllByTestId('votes-left');
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      expect(chip.getAttribute('role')).toBeNull();
      expect(chip.getAttribute('aria-label')).toBeNull();
      expect(chip.getAttribute('title')).toBeNull();
      expect(chip.querySelector('[role], [aria-label], [title]')).toBeNull();
      expect(chip.querySelector(':scope > span:not(.material-symbols-outlined)')?.textContent).toMatch(/^\d+ votes? left$/);
      expect(chip.querySelector('.material-symbols-outlined')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps the line the height of the role line', () => {
    renderVote(voteSession());

    const chip = screen.getAllByTestId('votes-left')[0];
    const classes = chip.className.split(/\s+/);
    expect(classes).toContain('leading-4');
    expect(classes.filter((token) => /^(py-|border$|border-)/.test(token))).toEqual([]);
    const icon = chip.querySelector('.material-symbols-outlined');
    expect(icon?.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-xs!', 'leading-none']));
  });

  it('follows the number when it is lowered', () => {
    const before = voteSession({ tickets: [{ ...ticket('a'), votes: ['a', 'a', 'a', 'a'] }] });
    const { rerender } = renderVote(before);
    expect(within(rowOf('Alice')).getByText('1 vote left')).toBeTruthy();
    expect(within(rowOf('Bob')).getByText('5 votes left')).toBeTruthy();

    // The facilitator lowers the number to 3, which takes Alice's fourth vote back.
    const lowered = voteSession({ tickets: [{ ...before.tickets[0], votes: ['a', 'a', 'a'] }] }, { maxVotes: 3 });
    rerender(
      <ParticipantsPanel
        {...baseProps}
        session={lowered}
        participants={everyone}
        activityUsers={{}}
      />
    );

    expect(within(rowOf('Alice')).getByText('0 votes left')).toBeTruthy();
    expect(within(rowOf('Bob')).getByText('3 votes left')).toBeTruthy();
  });
});

// 43.0: a line pinned above the list says who is typing, so a long list need
// not be scrolled to find them; the rows keep their cue and their order.
describe('ParticipantsPanel - who is typing, above the list', () => {
  const everyone = [facilitator, alice, bob, carol];

  const renderTyping = (
    activityUsers: Record<string, ParticipantActivity>,
    overrides: Partial<RetroSession> = {},
    props: Partial<React.ComponentProps<typeof ParticipantsPanel>> = {}
  ) => {
    const participants = props.participants ?? everyone;
    return render(
      <ParticipantsPanel
        {...baseProps}
        session={makeSession({ participants, ...overrides })}
        participants={participants}
        activityUsers={activityUsers}
        {...props}
      />
    );
  };

  const line = () => screen.getByTestId('typing-now');

  // The name each row shows, in the order the rows are drawn.
  const rowNames = (names: string[]) =>
    screen.getAllByTestId('participant-row').map((row) => names.find((name) => within(row).queryByText(name)));

  const classesOf = (element: Element | null | undefined) => element?.className.split(/\s+/) ?? [];

  it("names who is writing in the list's order, not the order the signals came in", () => {
    renderTyping({ c: 'brainstorm', a: 'brainstorm' });

    expect(line().textContent).toBe('Writing now (2): Alice and Carol');
    expect(rowNames(['Fran', 'Alice', 'Bob', 'Carol'])).toEqual(['Fran', 'Alice', 'Bob', 'Carol']);
  });

  it('sits above the list, outside its scroll', () => {
    renderTyping({ a: 'brainstorm' });

    expect(line().closest('.overflow-y-auto')).toBeNull();
    const firstRow = screen.getAllByTestId('participant-row')[0];
    expect(line().compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps its place, saying nobody is writing, when nobody is', () => {
    renderTyping({});

    expect(line().textContent).toBe('Nobody is writing');
  });

  it('counts exactly the rows that show the cue', () => {
    renderTyping(
      // The reader, a kind of another phase, a value no release draws, someone
      // marked as having left and an id the list does not hold.
      { fac: 'brainstorm', a: 'brainstorm', b: 'proposal', c: '__proto__', d: 'brainstorm', zz: 'brainstorm' } as unknown as Record<string, ParticipantActivity>,
      { leftUsers: ['d'] },
      { participants: [facilitator, alice, bob, carol, dave] }
    );

    expect(line().textContent).toBe('Writing now (1): Alice');
    const cued = screen.getAllByTestId('participant-row').filter((row) => row.textContent?.includes('writing a ticket'));
    expect(cued).toHaveLength(1);
    expect(within(cued[0]).queryByText('Alice')).toBeTruthy();
  });

  it('names everyone up to three, then two and the number of others', () => {
    const three = renderTyping({ a: 'brainstorm', b: 'brainstorm', c: 'brainstorm' });
    expect(line().textContent).toMatch(/^Writing now \(3\): Alice, Bob,? and Carol$/);
    three.unmount();

    const four = renderTyping(
      { a: 'brainstorm', b: 'brainstorm', c: 'brainstorm', d: 'brainstorm' },
      {},
      { participants: [...everyone, dave] }
    );
    expect(line().textContent).toMatch(/^Writing now \(4\): Alice, Bob,? and 2 others$/);
    four.unmount();

    const crowd = Array.from({ length: 30 }, (_, index) => {
      const name = `P${String(index + 1).padStart(2, '0')}`;
      return makeUser({ id: name.toLowerCase(), name });
    });
    renderTyping(
      Object.fromEntries(crowd.map((member) => [member.id, 'brainstorm' as const])),
      {},
      { participants: [facilitator, ...crowd] }
    );
    expect(line().textContent).toMatch(/^Writing now \(30\): P01, P02,? and 28 others$/);
    // Two lines can cut the end of the names; the hover has every one.
    expect(line().getAttribute('title')).toContain('P30');
    const roster = ['Fran', ...crowd.map((member) => member.name)];
    expect(rowNames(roster)).toEqual(roster);
  });

  it('is shown in Brainstorm, in Discuss and on an open board, and in no other phase', () => {
    let view = renderTyping({ a: 'proposal' }, { phase: 'DISCUSS' });
    expect(line().textContent).toBe('Proposing an action (1): Alice');
    view.unmount();

    view = renderTyping({}, { phase: 'DISCUSS' });
    expect(line().textContent).toBe('Nobody is proposing an action');
    view.unmount();

    view = renderTyping({ a: 'brainstorm' }, { phase: 'OPEN_BOARD' });
    expect(line().textContent).toBe('Writing now (1): Alice');
    view.unmount();

    for (const phase of ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'GROUP', 'VOTE', 'REVIEW', 'CLOSE']) {
      view = renderTyping({ a: 'brainstorm' }, { phase });
      expect(screen.queryByTestId('typing-now'), phase).toBeNull();
      view.unmount();
    }
  });

  it('shows no cue of a kind its phase cannot produce', () => {
    const brainstorm = renderTyping({ a: 'proposal' });
    expect(brainstorm.container.textContent).not.toContain('proposing action');
    expect(line().textContent).toBe('Nobody is writing');
    brainstorm.unmount();

    // The receiver keeps a cue up to 4 s, so one can outlive its phase.
    const vote = renderTyping({ a: 'brainstorm' }, { phase: 'VOTE' });
    expect(vote.container.textContent).not.toContain('writing a ticket');
  });

  it('counts and never names in an anonymous retro', () => {
    const session = makeSession({ participants: everyone });
    session.settings.isAnonymous = true;
    render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={everyone}
        activityUsers={{ a: 'brainstorm' }}
        getMemberDisplay={anonymousDisplay(everyone)}
      />
    );

    expect(line().textContent).toBe('Writing now (1)');
    expect(line().textContent).not.toContain('Participant');
    expect(line().getAttribute('title')).toBeNull();
  });

  it('reserves two lines named, anonymous or nobody', () => {
    const named = renderTyping({ a: 'brainstorm' });
    expect(classesOf(line())).toEqual(expect.arrayContaining(['min-h-8', 'line-clamp-2']));
    named.unmount();

    const session = makeSession({ participants: everyone });
    session.settings.isAnonymous = true;
    const anonymous = render(
      <ParticipantsPanel
        {...baseProps}
        session={session}
        participants={everyone}
        activityUsers={{ a: 'brainstorm' }}
        getMemberDisplay={anonymousDisplay(everyone)}
      />
    );
    expect(classesOf(line())).toEqual(expect.arrayContaining(['min-h-8', 'line-clamp-2']));
    anonymous.unmount();

    renderTyping({});
    expect(classesOf(line())).toEqual(expect.arrayContaining(['min-h-8', 'line-clamp-2']));
  });

  it('counts on the collapsed rail', () => {
    let view = renderTyping({ a: 'brainstorm', c: 'brainstorm' }, {}, { isCollapsed: true });
    const rail = screen.getByRole('img', { name: 'Writing now (2)' });
    expect(within(rail).getByText('2')).toBeTruthy();
    view.unmount();

    view = renderTyping({}, {}, { isCollapsed: true });
    expect(screen.queryByTestId('typing-now-rail')).toBeNull();
    view.unmount();

    view = renderTyping({ a: 'brainstorm' }, { phase: 'VOTE' }, { isCollapsed: true });
    expect(screen.queryByTestId('typing-now-rail')).toBeNull();
    view.unmount();

    renderTyping({ a: 'brainstorm' });
    expect(screen.queryByTestId('typing-now-rail')).toBeNull();
  });

  it('announces nothing on its own', () => {
    const live = '[aria-live], [role="status"], [role="alert"], [role="log"]';

    let view = renderTyping({ a: 'brainstorm' });
    expect(view.container.querySelector(live)).toBeNull();
    view.unmount();

    view = renderTyping({ a: 'brainstorm' }, { phase: 'VOTE' });
    expect(view.container.querySelector(live)).toBeNull();
    view.unmount();

    view = renderTyping({ a: 'brainstorm' }, {}, { isCollapsed: true });
    expect(view.container.querySelector(live)).toBeNull();
  });

  it('hides the icons of the line, the rail, the cue and the chip', () => {
    const expectHidden = (icon: Element | null | undefined, what: string) => {
      expect(icon, what).toBeTruthy();
      expect(icon?.getAttribute('aria-hidden'), what).toBe('true');
    };

    let view = renderTyping({ a: 'brainstorm' });
    expectHidden(line().parentElement?.querySelector('.material-symbols-outlined'), 'the line');
    expectHidden(screen.getByTitle('writing a ticket').querySelector('.material-symbols-outlined'), 'the cue');
    view.unmount();

    view = renderTyping({ a: 'brainstorm' }, {}, { isCollapsed: true });
    expectHidden(screen.getByTestId('typing-now-rail').querySelector('.material-symbols-outlined'), 'the rail');
    view.unmount();

    renderTyping({}, { phase: 'VOTE' });
    expectHidden(screen.getAllByTestId('votes-left')[0]?.querySelector('.material-symbols-outlined'), 'the chip');
  });

  it('survives a typing signal it does not know (a "__proto__" used to blank the panel)', () => {
    renderTyping(
      { a: '__proto__', b: 'constructor', c: 'toString', d: {} } as unknown as Record<string, ParticipantActivity>,
      {},
      { participants: [...everyone, dave] }
    );

    expect(within(rowOf('Fran')).getByText('facilitator')).toBeTruthy();
    for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
      expect(within(rowOf(name)).getByText('participant')).toBeTruthy();
    }
    expect(line().textContent).toBe('Nobody is writing');
  });

  it('reads a role it does not know as data, without crashing', () => {
    // Every client writes its own role into the session.
    const protoRole = makeUser({ id: 'x', name: 'Xena', role: '__proto__' as unknown as User['role'] });
    const objectRole = makeUser({ id: 'y', name: 'Yann', role: {} as unknown as User['role'] });
    renderTyping({}, {}, { participants: [facilitator, alice, protoRole, objectRole] });

    expect(within(rowOf('Xena')).getByText('__proto__')).toBeTruthy();
    expect(rowOf('Yann').querySelector('.capitalize')?.textContent).toBe('');
    expect(within(rowOf('Fran')).getByText('facilitator')).toBeTruthy();
    expect(within(rowOf('Alice')).getByText('participant')).toBeTruthy();
  });

  it("draws the row cue at the role line's height, its icon hidden", () => {
    renderTyping({ a: 'brainstorm' });

    const cue = screen.getByTitle('writing a ticket');
    expect(classesOf(cue)).toContain('leading-4');
    const icon = within(cue).getByText('stylus_note');
    expect(classesOf(icon)).toEqual(expect.arrayContaining(['text-sm!', 'leading-none']));
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the contribution line at one height, with or without cards', () => {
    const { container } = renderTyping({}, { tickets: [ticket('a'), ticket('a')] });

    const noTickets = screen.getAllByText('no tickets')[0];
    expect(classesOf(noTickets)).toContain('leading-none');
    expect(classesOf(noTickets.closest('[title="No tickets added yet"]'))).toContain('min-h-2.5');
    expect(classesOf(container.querySelector('[title="2 tickets added"]'))).toContain('min-h-2.5');
  });

  it('keeps the typing dots still for a reader who asked for less motion', () => {
    const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.typing-dot\s*\{\s*animation:\s*none;?\s*\}/);
  });
});
