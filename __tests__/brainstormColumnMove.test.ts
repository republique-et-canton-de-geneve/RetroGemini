import { describe, it, expect } from 'vitest';
import type { Column, Group, RetroSession, Ticket } from '../types';
import { moveGroupToColumn, moveTicketToColumn } from '../utils/brainstormColumnMove';
import { getTicketOriginColumn } from '../utils/retroGrouping';

/**
 * Brainstorm: moving a card between columns **without** grouping it.
 *
 * The distinction from the Group phase is the whole feature, so these tests
 * assert the negative as loudly as the positive: after a move there is no new
 * group, no dissolved group and no membership change — only a different column.
 */

const makeTicket = (overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket => ({
  colId: 'col1',
  text: 'ticket',
  authorId: 'u1',
  groupId: null,
  votes: [],
  ...overrides,
});

const makeGroup = (overrides: Partial<Group> & Pick<Group, 'id'>): Group => ({
  title: '',
  colId: 'col1',
  votes: [],
  ...overrides,
});

const makeColumn = (id: string, title: string): Column => ({
  id,
  title,
  color: 'bg-slate-500',
  border: 'border-slate-500',
  icon: 'star',
  text: 'text-slate-700',
  ring: 'ring-slate-300',
});

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  icebreakerQuestion: '',
  columns: [makeColumn('col1', 'Went well'), makeColumn('col2', 'Went wrong')],
  tickets: [],
  groups: [],
  actions: [],
  participants: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  settings: {
    isAnonymous: false,
    maxVotes: 3,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: true,
    revealRoti: true,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  ...overrides,
});

describe('moveTicketToColumn', () => {
  it('moves the card to the target column and creates no group', () => {
    const session = makeSession({ tickets: [makeTicket({ id: 'A' })] });

    expect(moveTicketToColumn(session, 'A', 'col2')).toBe(true);
    expect(session.tickets[0].colId).toBe('col2');
    expect(session.tickets[0].groupId).toBeNull();
    expect(session.groups).toHaveLength(0);
  });

  it('keeps the card independent: votes, text and author are untouched', () => {
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', votes: ['u1', 'u2'], text: 'Deploys are scary' })],
    });

    moveTicketToColumn(session, 'A', 'col2');

    expect(session.tickets[0].votes).toEqual(['u1', 'u2']);
    expect(session.tickets[0].text).toBe('Deploys are scary');
    expect(session.tickets[0].authorId).toBe('u1');
  });

  it('clears the origin marker — a hand-placed card belongs where it was put', () => {
    // Same rule as dropping a card straight onto a column in the Group phase:
    // this is an explicit re-homing, so a "from ..." chip would be a lie.
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', colId: 'col2', originColId: 'col1' })],
    });

    moveTicketToColumn(session, 'A', 'col1');

    expect(session.tickets[0].originColId).toBeUndefined();
    expect(getTicketOriginColumn(session.tickets[0], session.columns)).toBeNull();
  });

  it('refuses to move a card that belongs to a group', () => {
    // Pulling one member out is a composition change, which Brainstorm must
    // not make — the group travels as a unit instead.
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', groupId: 'g1' }), makeTicket({ id: 'B', groupId: 'g1' })],
      groups: [makeGroup({ id: 'g1' })],
    });

    expect(moveTicketToColumn(session, 'A', 'col2')).toBe(false);
    expect(session.tickets[0].colId).toBe('col1');
    expect(session.tickets[0].groupId).toBe('g1');
    expect(session.groups).toHaveLength(1);
  });

  it('answers false for an unknown card, an unknown column, or a move to the same column', () => {
    const session = makeSession({ tickets: [makeTicket({ id: 'A' })] });

    expect(moveTicketToColumn(session, 'missing', 'col2')).toBe(false);
    expect(moveTicketToColumn(session, 'A', 'no-such-column')).toBe(false);
    expect(moveTicketToColumn(session, 'A', 'col1')).toBe(false);
    expect(session.tickets[0].colId).toBe('col1');
  });
});

describe('moveGroupToColumn', () => {
  const groupedSession = () =>
    makeSession({
      tickets: [
        makeTicket({ id: 'A', groupId: 'g1', votes: ['u1'] }),
        makeTicket({ id: 'B', groupId: 'g1' }),
        makeTicket({ id: 'C' }),
      ],
      groups: [makeGroup({ id: 'g1', title: 'Deploys', anchorTicketId: 'A' })],
    });

  it('carries the group and every card in it to the target column', () => {
    const session = groupedSession();

    expect(moveGroupToColumn(session, 'g1', 'col2')).toBe(true);
    expect(session.groups[0].colId).toBe('col2');
    expect(session.tickets.find(t => t.id === 'A')?.colId).toBe('col2');
    expect(session.tickets.find(t => t.id === 'B')?.colId).toBe('col2');
  });

  it('leaves the composition, the title and the votes exactly as they were', () => {
    const session = groupedSession();

    moveGroupToColumn(session, 'g1', 'col2');

    expect(session.groups).toHaveLength(1);
    expect(session.groups[0].title).toBe('Deploys');
    expect(session.groups[0].anchorTicketId).toBe('A');
    expect(session.tickets.filter(t => t.groupId === 'g1').map(t => t.id)).toEqual(['A', 'B']);
    expect(session.tickets.find(t => t.id === 'A')?.votes).toEqual(['u1']);
  });

  it('never touches a card outside the group', () => {
    const session = groupedSession();

    moveGroupToColumn(session, 'g1', 'col2');

    expect(session.tickets.find(t => t.id === 'C')?.colId).toBe('col1');
  });

  it('keeps naming the column each card was written in', () => {
    // A card displaced by its group is not re-homed by hand, so the "from ..."
    // chip stays true — unlike a single card moved on its own.
    const session = groupedSession();

    moveGroupToColumn(session, 'g1', 'col2');

    const moved = session.tickets.find(t => t.id === 'A')!;
    expect(getTicketOriginColumn(moved, session.columns)?.id).toBe('col1');
  });

  it('drops the chip again when a card comes home', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 'A', colId: 'col1', groupId: 'g1', originColId: 'col2' }),
        makeTicket({ id: 'B', colId: 'col1', groupId: 'g1' }),
      ],
      groups: [makeGroup({ id: 'g1' })],
    });

    moveGroupToColumn(session, 'g1', 'col2');

    const home = session.tickets.find(t => t.id === 'A')!;
    expect(getTicketOriginColumn(home, session.columns)).toBeNull();
    // The card that really did move away now names where it came from.
    const displaced = session.tickets.find(t => t.id === 'B')!;
    expect(getTicketOriginColumn(displaced, session.columns)?.id).toBe('col1');
  });

  it('answers false for an unknown group, an unknown column, or a move to the same column', () => {
    const session = groupedSession();

    expect(moveGroupToColumn(session, 'missing', 'col2')).toBe(false);
    expect(moveGroupToColumn(session, 'g1', 'no-such-column')).toBe(false);
    expect(moveGroupToColumn(session, 'g1', 'col1')).toBe(false);
    expect(session.groups[0].colId).toBe('col1');
  });
});
