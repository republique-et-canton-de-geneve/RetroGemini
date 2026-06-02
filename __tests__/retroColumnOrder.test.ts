import { describe, it, expect } from 'vitest';
import type { RetroSession, Ticket, Group } from '../types';
import { getColumnEntries } from '../utils/retroColumnOrder';

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

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'GROUP',
  icebreakerQuestion: '',
  columns: [],
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

// Compact representation of the rendered order, e.g. "ticket:t2", "group:g".
const describeOrder = (session: RetroSession, colId: string): string[] =>
  getColumnEntries(session, colId).map((e) =>
    e.kind === 'group' ? `group:${e.group.id}` : `ticket:${e.ticket.id}`,
  );

describe('getColumnEntries', () => {
  it('orders ungrouped tickets by their creation order', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 't1' }),
        makeTicket({ id: 't2' }),
        makeTicket({ id: 't3' }),
      ],
    });

    expect(describeOrder(session, 'col1')).toEqual([
      'ticket:t1',
      'ticket:t2',
      'ticket:t3',
    ]);
  });

  it('keeps a new group at its anchor (drop-target) position instead of the top', () => {
    // Tickets created in order t1, t2, t3, t4. The user dragged t1 onto t3,
    // so a group anchored at t3 now contains t1 and t3. The group must stay
    // where t3 was (between t2 and t4), NOT jump to the top of the column.
    const session = makeSession({
      tickets: [
        makeTicket({ id: 't1', groupId: 'g' }),
        makeTicket({ id: 't2' }),
        makeTicket({ id: 't3', groupId: 'g' }),
        makeTicket({ id: 't4' }),
      ],
      groups: [makeGroup({ id: 'g', anchorTicketId: 't3' })],
    });

    expect(describeOrder(session, 'col1')).toEqual([
      'ticket:t2',
      'group:g',
      'ticket:t4',
    ]);
  });

  it('falls back to the earliest member ticket when the group has no anchor', () => {
    // Legacy groups and AI-suggested clusters have no anchorTicketId; the
    // group should sit where its earliest-created member lives.
    const session = makeSession({
      tickets: [
        makeTicket({ id: 't1' }),
        makeTicket({ id: 't2', groupId: 'g' }),
        makeTicket({ id: 't3' }),
        makeTicket({ id: 't4', groupId: 'g' }),
      ],
      groups: [makeGroup({ id: 'g' })],
    });

    expect(describeOrder(session, 'col1')).toEqual([
      'ticket:t1',
      'group:g',
      'ticket:t3',
    ]);
  });

  it('falls back to the earliest member when the anchor ticket no longer exists', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 't1' }),
        makeTicket({ id: 't2', groupId: 'g' }),
        makeTicket({ id: 't3', groupId: 'g' }),
      ],
      groups: [makeGroup({ id: 'g', anchorTicketId: 'deleted' })],
    });

    expect(describeOrder(session, 'col1')).toEqual(['ticket:t1', 'group:g']);
  });

  it('only includes tickets and groups from the requested column', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 'a1', colId: 'col1' }),
        makeTicket({ id: 'b1', colId: 'col2' }),
        makeTicket({ id: 'a2', colId: 'col1', groupId: 'gA' }),
        makeTicket({ id: 'a3', colId: 'col1', groupId: 'gA' }),
      ],
      groups: [makeGroup({ id: 'gA', colId: 'col1', anchorTicketId: 'a2' })],
    });

    expect(describeOrder(session, 'col1')).toEqual(['ticket:a1', 'group:gA']);
    expect(describeOrder(session, 'col2')).toEqual(['ticket:b1']);
  });
});
