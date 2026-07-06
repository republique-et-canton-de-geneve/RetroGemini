import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
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
    expect(container.querySelector('[title="Mark Fran as having left the retro"]')).toBeFalsy();

    const markAliceLeft = container.querySelector('[title="Mark Alice as having left the retro"]');
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
