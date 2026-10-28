import { describe, it, expect } from 'vitest';
import type { RetroSession, Ticket, Group } from '../types';
import {
  addTicketToGroup,
  applySuggestedClusters,
  deleteGroup,
  deleteTicket,
  dissolveGroupIfTooSmall,
  getTicketOriginColumn,
  groupTicketsTogether,
  removeColumn,
  removeTicketFromGroup,
} from '../utils/retroGrouping';

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
  columns: [
    {
      id: 'col1',
      title: 'Went well',
      color: 'bg-green-500',
      border: 'border-green-500',
      icon: 'thumb_up',
      text: 'text-green-500',
      ring: 'ring-green-500',
    },
  ],
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

describe('retroGrouping helpers', () => {
  describe('groupTicketsTogether', () => {
    it('creates a new group containing both tickets when neither is grouped', () => {
      const session = makeSession({
        tickets: [makeTicket({ id: 'A' }), makeTicket({ id: 'B' })],
      });

      const result = groupTicketsTogether(session, 'B', 'A', () => 'g-new');

      expect(result.noOp).toBe(false);
      expect(result.newGroupId).toBe('g-new');
      expect(session.groups).toHaveLength(1);
      expect(session.groups[0].id).toBe('g-new');
      expect(session.tickets.find((t) => t.id === 'A')!.groupId).toBe('g-new');
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g-new');
    });

    it('adds the dragged ticket to the target ticket group when target is already grouped', () => {
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A', groupId: 'g1' }),
          makeTicket({ id: 'C', groupId: 'g1' }),
          makeTicket({ id: 'B' }),
        ],
        groups: [makeGroup({ id: 'g1' })],
      });

      const result = groupTicketsTogether(session, 'B', 'A');

      expect(result.noOp).toBe(false);
      expect(result.newGroupId).toBeNull();
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g1');
      expect(session.groups).toHaveLength(1);
    });

    it('REGRESSION: does not delete the dragged ticket when both tickets were already grouped together by a concurrent update', () => {
      // Bug scenario: User 2's draggedTicket reference is stale (B.groupId=null
      // in the closure), but in the LATEST session state User 1 has already
      // grouped A and B together. User 2 now drops the stale B onto the
      // (already grouped) A.
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A', groupId: 'g1' }),
          makeTicket({ id: 'B', groupId: 'g1' }),
        ],
        groups: [makeGroup({ id: 'g1' })],
      });

      const result = groupTicketsTogether(session, 'B', 'A', () => 'should-not-be-called');

      expect(result.noOp).toBe(true);
      // Both tickets must still belong to the existing group; the group
      // must still exist; nothing must reference a phantom group id.
      expect(session.groups.map((g) => g.id)).toEqual(['g1']);
      expect(session.tickets.find((t) => t.id === 'A')!.groupId).toBe('g1');
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g1');
      const validGroupIds = new Set(session.groups.map((g) => g.id));
      for (const ticket of session.tickets) {
        if (ticket.groupId !== null) {
          expect(validGroupIds.has(ticket.groupId)).toBe(true);
        }
      }
    });

    it('does nothing when dragged and target ids are equal', () => {
      const session = makeSession({
        tickets: [makeTicket({ id: 'A' })],
      });
      const result = groupTicketsTogether(session, 'A', 'A');
      expect(result.noOp).toBe(true);
      expect(session.groups).toHaveLength(0);
    });

    it('dissolves the dragged ticket previous group when it would be left with one member', () => {
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A' }),
          makeTicket({ id: 'B', groupId: 'gOld' }),
          makeTicket({ id: 'C', groupId: 'gOld' }),
        ],
        groups: [makeGroup({ id: 'gOld' })],
      });

      groupTicketsTogether(session, 'B', 'A', () => 'g-new');

      expect(session.groups.find((g) => g.id === 'gOld')).toBeUndefined();
      expect(session.tickets.find((t) => t.id === 'C')!.groupId).toBeNull();
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g-new');
    });
  });

  describe('addTicketToGroup', () => {
    it('moves a ticket into the target group', () => {
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A', groupId: 'g1' }),
          makeTicket({ id: 'X', groupId: 'g1' }),
          makeTicket({ id: 'B' }),
        ],
        groups: [makeGroup({ id: 'g1' })],
      });

      const moved = addTicketToGroup(session, 'B', 'g1');

      expect(moved).toBe(true);
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g1');
    });

    it('REGRESSION: returns false and does not orphan the ticket when the target group has been removed concurrently', () => {
      // Before User 2's drop on group "gPhantom", User 1 has already removed
      // gPhantom (e.g. by ungrouping a ticket). Without this guard, the
      // ticket would be reassigned to a non-existent group id and disappear.
      const session = makeSession({
        tickets: [makeTicket({ id: 'B', groupId: null })],
        groups: [],
      });

      const moved = addTicketToGroup(session, 'B', 'gPhantom');

      expect(moved).toBe(false);
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBeNull();
    });

    it('REGRESSION: returns false when the ticket is already in the target group (no double-dissolve)', () => {
      // Bug scenario: User 2 drops B onto group g1, but in the latest state
      // B is already in g1 (User 1 just put it there). Previously this would
      // dissolve g1 (since A would be the only sibling), then re-assign B to
      // the deleted g1 -> ticket disappears.
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A', groupId: 'g1' }),
          makeTicket({ id: 'B', groupId: 'g1' }),
        ],
        groups: [makeGroup({ id: 'g1' })],
      });

      const moved = addTicketToGroup(session, 'B', 'g1');

      expect(moved).toBe(false);
      expect(session.groups).toHaveLength(1);
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g1');
      expect(session.tickets.find((t) => t.id === 'A')!.groupId).toBe('g1');
    });
  });

  describe('removeTicketFromGroup', () => {
    it('clears the groupId and dissolves the group when only one member is left', () => {
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A', groupId: 'g1' }),
          makeTicket({ id: 'B', groupId: 'g1' }),
        ],
        groups: [makeGroup({ id: 'g1' })],
      });

      removeTicketFromGroup(session, 'B', 'col1');

      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBeNull();
      expect(session.tickets.find((t) => t.id === 'A')!.groupId).toBeNull();
      expect(session.groups).toHaveLength(0);
    });
  });

  describe('applySuggestedClusters', () => {
    it('creates every cluster in a single pass, even cross-column', () => {
      let counter = 0;
      const session = makeSession({
        tickets: [
          makeTicket({ id: 't1', colId: 'c1' }),
          makeTicket({ id: 't2', colId: 'c1' }),
          makeTicket({ id: 't3', colId: 'c2' }),
          makeTicket({ id: 't4', colId: 'c3' }),
        ],
      });
      applySuggestedClusters(
        session,
        [
          { title: 'First', ticketIds: ['t1', 't2'] },
          { title: 'Second', ticketIds: ['t3', 't4'] },
        ],
        () => `g${++counter}`,
      );
      expect(session.groups).toHaveLength(2);
      expect(session.groups[0].title).toBe('First');
      expect(session.groups[1].title).toBe('Second');
      expect(session.tickets.find((t) => t.id === 't1')!.groupId).toBe('g1');
      expect(session.tickets.find((t) => t.id === 't2')!.groupId).toBe('g1');
      expect(session.tickets.find((t) => t.id === 't3')!.groupId).toBe('g2');
      expect(session.tickets.find((t) => t.id === 't4')!.groupId).toBe('g2');
    });

    // A group title is stored in the session and the team record; half an
    // emoji there is text PostgreSQL's jsonb refuses (utils/textCut.js).
    it('cuts a long title at 80 characters without halving an emoji', () => {
      const session = makeSession({ tickets: [makeTicket({ id: 't1' }), makeTicket({ id: 't2' })] });
      applySuggestedClusters(session, [{ title: `${'d'.repeat(79)}😀 and more`, ticketIds: ['t1', 't2'] }], () => 'g1');
      expect(session.groups[0].title).toBe('d'.repeat(79));
    });

    it('skips clusters that share ids with an already-applied cluster', () => {
      let counter = 0;
      const session = makeSession({
        tickets: [
          makeTicket({ id: 't1' }),
          makeTicket({ id: 't2' }),
          makeTicket({ id: 't3' }),
        ],
      });
      applySuggestedClusters(
        session,
        [
          { title: 'Keep', ticketIds: ['t1', 't2'] },
          { title: 'Reuse', ticketIds: ['t1', 't3'] },
        ],
        () => `g${++counter}`,
      );
      expect(session.groups).toHaveLength(1);
      expect(session.tickets.find((t) => t.id === 't3')!.groupId).toBeNull();
    });

    it('ignores clusters whose tickets are already grouped or missing', () => {
      let counter = 0;
      const session = makeSession({
        tickets: [
          makeTicket({ id: 't1', groupId: 'existing' }),
          makeTicket({ id: 't2' }),
        ],
        groups: [makeGroup({ id: 'existing' })],
      });
      applySuggestedClusters(
        session,
        [
          { title: 'Should not apply', ticketIds: ['t1', 't2'] },
          { title: 'Ghosts only', ticketIds: ['ghost1', 'ghost2'] },
        ],
        () => `g${++counter}`,
      );
      // The original group is untouched and no new group is created.
      expect(session.groups).toHaveLength(1);
      expect(session.groups[0].id).toBe('existing');
      expect(session.tickets.find((t) => t.id === 't2')!.groupId).toBeNull();
    });

    it('trims the title to 80 characters', () => {
      const session = makeSession({
        tickets: [makeTicket({ id: 't1' }), makeTicket({ id: 't2' })],
      });
      const longTitle = 'a'.repeat(200);
      applySuggestedClusters(
        session,
        [{ title: longTitle, ticketIds: ['t1', 't2'] }],
        () => 'g1',
      );
      expect(session.groups[0].title).toHaveLength(80);
    });
  });

  describe('dissolveGroupIfTooSmall', () => {
    it('does nothing when groupId is null', () => {
      const session = makeSession({
        tickets: [makeTicket({ id: 'A', groupId: 'g1' })],
        groups: [makeGroup({ id: 'g1' })],
      });
      dissolveGroupIfTooSmall(session, null, 'A');
      expect(session.groups).toHaveLength(1);
    });

    it('keeps the group when at least 2 siblings remain after ignoring the given ticket', () => {
      const session = makeSession({
        tickets: [
          makeTicket({ id: 'A', groupId: 'g1' }),
          makeTicket({ id: 'B', groupId: 'g1' }),
          makeTicket({ id: 'C', groupId: 'g1' }),
        ],
        groups: [makeGroup({ id: 'g1' })],
      });
      dissolveGroupIfTooSmall(session, 'g1', 'A');
      expect(session.groups).toHaveLength(1);
      expect(session.tickets.find((t) => t.id === 'B')!.groupId).toBe('g1');
    });
  });

  describe('origin column tracking (cross-column grouping)', () => {
    const twoColumns = [
      {
        id: 'col1',
        title: 'Went well',
        color: 'bg-green-500',
        border: 'border-green-500',
        icon: 'thumb_up',
        text: 'text-green-500',
        ring: 'ring-green-500',
      },
      {
        id: 'col2',
        title: 'Went wrong',
        color: 'bg-red-500',
        border: 'border-red-500',
        icon: 'thumb_down',
        text: 'text-red-500',
        ring: 'ring-red-500',
      },
    ];

    it('stamps originColId when grouping moves a ticket to another column', () => {
      const session = makeSession({
        columns: twoColumns,
        tickets: [
          makeTicket({ id: 'A', colId: 'col1' }),
          makeTicket({ id: 'B', colId: 'col2' }),
        ],
      });

      groupTicketsTogether(session, 'B', 'A', () => 'g-new');

      const dragged = session.tickets.find((t) => t.id === 'B')!;
      expect(dragged.colId).toBe('col1');
      expect(dragged.originColId).toBe('col2');
      // The drop target never moved: no origin marker
      expect(session.tickets.find((t) => t.id === 'A')!.originColId).toBeUndefined();
    });

    it('does not stamp originColId when grouping within the same column', () => {
      const session = makeSession({
        columns: twoColumns,
        tickets: [
          makeTicket({ id: 'A', colId: 'col1' }),
          makeTicket({ id: 'B', colId: 'col1' }),
        ],
      });

      groupTicketsTogether(session, 'B', 'A', () => 'g-new');

      expect(session.tickets.find((t) => t.id === 'B')!.originColId).toBeUndefined();
    });

    it('stamps originColId when a ticket is added to a group in another column', () => {
      const session = makeSession({
        columns: twoColumns,
        tickets: [
          makeTicket({ id: 'A', colId: 'col1', groupId: 'g1' }),
          makeTicket({ id: 'B', colId: 'col1', groupId: 'g1' }),
          makeTicket({ id: 'C', colId: 'col2' }),
        ],
        groups: [makeGroup({ id: 'g1', colId: 'col1' })],
      });

      addTicketToGroup(session, 'C', 'g1');

      const moved = session.tickets.find((t) => t.id === 'C')!;
      expect(moved.colId).toBe('col1');
      expect(moved.originColId).toBe('col2');
    });

    it('keeps the very first origin when a ticket is regrouped several times', () => {
      const session = makeSession({
        columns: twoColumns,
        tickets: [
          makeTicket({ id: 'A', colId: 'col1', groupId: 'g1' }),
          makeTicket({ id: 'B', colId: 'col1', groupId: 'g1' }),
          makeTicket({ id: 'C', colId: 'col2', originColId: 'col2' }),
          makeTicket({ id: 'D', colId: 'col2' }),
        ],
        groups: [makeGroup({ id: 'g1', colId: 'col1' })],
      });

      // C written in col2, moved to a col1 group...
      addTicketToGroup(session, 'C', 'g1');
      expect(session.tickets.find((t) => t.id === 'C')!.originColId).toBe('col2');

      // ...then regrouped with D back in col2: origin still points at col2
      groupTicketsTogether(session, 'C', 'D', () => 'g-2');
      const moved = session.tickets.find((t) => t.id === 'C')!;
      expect(moved.colId).toBe('col2');
      expect(moved.originColId).toBe('col2');
      // Origin equals the current column again -> no badge is displayed
      expect(getTicketOriginColumn(moved, session.columns)).toBeNull();
    });

    it('stamps originColId when AI-suggested clusters mix columns', () => {
      const session = makeSession({
        columns: twoColumns,
        tickets: [
          makeTicket({ id: 'A', colId: 'col1' }),
          makeTicket({ id: 'B', colId: 'col2' }),
        ],
      });

      applySuggestedClusters(session, [{ title: 'Mixed', ticketIds: ['A', 'B'] }], () => 'g-ai');

      // The cluster lands in the first ticket's column (col1): A never moved,
      // B was pulled over from col2 and remembers it.
      expect(session.tickets.find((t) => t.id === 'A')!.originColId).toBeUndefined();
      const moved = session.tickets.find((t) => t.id === 'B')!;
      expect(moved.colId).toBe('col1');
      expect(moved.originColId).toBe('col2');
    });

    it('clears originColId when the ticket is explicitly dropped on a column', () => {
      const session = makeSession({
        columns: twoColumns,
        tickets: [
          makeTicket({ id: 'A', colId: 'col1', groupId: 'g1' }),
          makeTicket({ id: 'B', colId: 'col1', groupId: 'g1', originColId: 'col2' }),
        ],
        groups: [makeGroup({ id: 'g1', colId: 'col1' })],
      });

      removeTicketFromGroup(session, 'B', 'col2');

      const rehomed = session.tickets.find((t) => t.id === 'B')!;
      expect(rehomed.colId).toBe('col2');
      expect(rehomed.originColId).toBeUndefined();
    });

    describe('getTicketOriginColumn', () => {
      it('returns the origin column when the ticket sits in another column', () => {
        const ticket = makeTicket({ id: 'A', colId: 'col1', originColId: 'col2' });
        expect(getTicketOriginColumn(ticket, twoColumns)?.id).toBe('col2');
      });

      it('returns null when there is no origin or it matches the current column', () => {
        expect(getTicketOriginColumn(makeTicket({ id: 'A', colId: 'col1' }), twoColumns)).toBeNull();
        expect(
          getTicketOriginColumn(makeTicket({ id: 'A', colId: 'col1', originColId: 'col1' }), twoColumns)
        ).toBeNull();
      });

      it('returns null when the origin column was deleted', () => {
        const ticket = makeTicket({ id: 'A', colId: 'col1', originColId: 'gone' });
        expect(getTicketOriginColumn(ticket, twoColumns)).toBeNull();
      });
    });
  });
});

/**
 * The open board votes while it groups (utils/openBoard.ts), so there the votes
 * travel with the cards instead of being cleared: a group gets the votes of the
 * cards put in it, and a group left with one card hands its votes to that card.
 * Nobody's vote count ever grows — a person who voted for two cards that become
 * one group keeps both votes, or one when the facilitator allows one vote per
 * item. The guided Group phase runs before the vote and keeps clearing them.
 */
describe('grouping on an open board keeps the votes', () => {
  const KEEP = { keepVotes: true };
  const votesOf = (session: RetroSession, id: string) =>
    session.groups.find((g) => g.id === id)?.votes ?? session.tickets.find((t) => t.id === id)?.votes;
  const sorted = (votes: string[] | undefined) => [...(votes ?? [])].sort();

  it('gives a new group the votes of both cards', () => {
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', votes: ['u1', 'u2'] }), makeTicket({ id: 'B', votes: ['u3'] })],
    });

    groupTicketsTogether(session, 'B', 'A', () => 'g-new', KEEP);

    expect(sorted(votesOf(session, 'g-new'))).toEqual(['u1', 'u2', 'u3']);
    expect(votesOf(session, 'A')).toEqual([]);
    expect(votesOf(session, 'B')).toEqual([]);
  });

  it('adds the votes of a card dropped on a grouped card to that group', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 'A', groupId: 'g1' }),
        makeTicket({ id: 'C', groupId: 'g1' }),
        makeTicket({ id: 'B', votes: ['u2', 'u2'] }),
      ],
      groups: [makeGroup({ id: 'g1', votes: ['u1'] })],
    });

    groupTicketsTogether(session, 'B', 'A', undefined, KEEP);

    expect(sorted(votesOf(session, 'g1'))).toEqual(['u1', 'u2', 'u2']);
    expect(votesOf(session, 'B')).toEqual([]);
  });

  it('adds the votes of a card dropped on a group to that group', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 'A', groupId: 'g1' }),
        makeTicket({ id: 'X', groupId: 'g1' }),
        makeTicket({ id: 'B', votes: ['u3'] }),
      ],
      groups: [makeGroup({ id: 'g1', votes: ['u1'] })],
    });

    expect(addTicketToGroup(session, 'B', 'g1', KEEP)).toBe(true);

    expect(sorted(votesOf(session, 'g1'))).toEqual(['u1', 'u3']);
    expect(votesOf(session, 'B')).toEqual([]);
  });

  it('keeps one vote per person on the group when only one vote per item is allowed', () => {
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', votes: ['u1', 'u2'] }), makeTicket({ id: 'B', votes: ['u1', 'u3'] })],
    });
    session.settings.oneVotePerTicket = true;

    groupTicketsTogether(session, 'B', 'A', () => 'g-new', KEEP);

    // u1 voted for both cards: one item now, so one vote, and one vote back
    // to spend elsewhere.
    expect(sorted(votesOf(session, 'g-new'))).toEqual(['u1', 'u2', 'u3']);
  });

  it('hands the votes of a group left with one card to that card', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 'A' }),
        makeTicket({ id: 'B', groupId: 'gOld' }),
        makeTicket({ id: 'C', groupId: 'gOld' }),
      ],
      groups: [makeGroup({ id: 'gOld', votes: ['u1', 'u4'] })],
    });

    groupTicketsTogether(session, 'B', 'A', () => 'g-new', KEEP);

    expect(session.groups.find((g) => g.id === 'gOld')).toBeUndefined();
    // C is what is left of the old group: the topic people voted for.
    expect(sorted(votesOf(session, 'C'))).toEqual(['u1', 'u4']);
    expect(votesOf(session, 'g-new')).toEqual([]);
  });

  it('hands them over when a card is taken out to a column, or deleted', () => {
    const moved = makeSession({
      tickets: [makeTicket({ id: 'A', groupId: 'g1' }), makeTicket({ id: 'B', groupId: 'g1' })],
      groups: [makeGroup({ id: 'g1', votes: ['u1'] })],
    });
    removeTicketFromGroup(moved, 'B', 'col1', KEEP);
    expect(votesOf(moved, 'A')).toEqual(['u1']);
    expect(votesOf(moved, 'B')).toEqual([]);

    const deleted = makeSession({
      tickets: [makeTicket({ id: 'A', groupId: 'g1' }), makeTicket({ id: 'B', groupId: 'g1' })],
      groups: [makeGroup({ id: 'g1', votes: ['u2'] })],
    });
    expect(deleteTicket(deleted, 'B', KEEP)).toBe(true);
    expect(deleted.tickets.map((t) => t.id)).toEqual(['A']);
    expect(deleted.groups).toEqual([]);
    expect(votesOf(deleted, 'A')).toEqual(['u2']);
  });

  it('gives an AI-suggested cluster the votes of its cards', () => {
    const session = makeSession({
      tickets: [makeTicket({ id: 't1', votes: ['u1'] }), makeTicket({ id: 't2', votes: ['u2'] })],
    });

    applySuggestedClusters(session, [{ title: 'Deploys', ticketIds: ['t1', 't2'] }], () => 'g-ai', KEEP);

    expect(sorted(votesOf(session, 'g-ai'))).toEqual(['u1', 'u2']);
    expect(votesOf(session, 't1')).toEqual([]);
  });

  it('still clears them in the guided Group phase, which runs before the vote', () => {
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', votes: ['u1'] }), makeTicket({ id: 'B', votes: ['u2'] })],
    });

    groupTicketsTogether(session, 'B', 'A', () => 'g-new');

    expect(votesOf(session, 'g-new')).toEqual([]);
    expect(votesOf(session, 'A')).toEqual([]);
    expect(votesOf(session, 'B')).toEqual([]);
  });
});

describe('deleteTicket', () => {
  it('removes an ungrouped card and nothing else', () => {
    const session = makeSession({
      tickets: [makeTicket({ id: 'A', votes: ['u1'] }), makeTicket({ id: 'B' })],
    });

    expect(deleteTicket(session, 'A')).toBe(true);

    expect(session.tickets.map((t) => t.id)).toEqual(['B']);
  });

  it('keeps a group that still has two cards, with its votes', () => {
    const session = makeSession({
      tickets: [
        makeTicket({ id: 'A', groupId: 'g1' }),
        makeTicket({ id: 'B', groupId: 'g1' }),
        makeTicket({ id: 'C', groupId: 'g1' }),
      ],
      groups: [makeGroup({ id: 'g1', votes: ['u1'] })],
    });

    deleteTicket(session, 'C', { keepVotes: true });

    expect(session.groups).toHaveLength(1);
    expect(session.groups[0].votes).toEqual(['u1']);
    expect(session.tickets.every((t) => t.groupId === 'g1')).toBe(true);
  });

  it('answers false for a card that is already gone', () => {
    const session = makeSession({ tickets: [makeTicket({ id: 'A' })] });
    expect(deleteTicket(session, 'missing')).toBe(false);
    expect(session.tickets).toHaveLength(1);
  });
});

/**
 * Deleting a group keeps its cards, ungrouped. On an open board its votes go
 * to the card it was anchored to: two reviews found the board's "Delete group"
 * running the Group phase's ungroup and dropping every vote the topic held,
 * while taking either card out of the same pair handed them over.
 */
describe('deleteGroup', () => {
  const pair = (anchorTicketId?: string) => makeSession({
    tickets: [
      makeTicket({ id: 'A', groupId: 'g1' }),
      makeTicket({ id: 'B', groupId: 'g1' }),
      makeTicket({ id: 'C' }),
    ],
    groups: [makeGroup({ id: 'g1', votes: ['u1', 'u2', 'u2'], ...(anchorTicketId ? { anchorTicketId } : {}) })],
  });

  it('ungroups its cards and gives its votes to the card it was anchored to, on a board', () => {
    const session = pair('B');

    expect(deleteGroup(session, 'g1', { keepVotes: true })).toBe(true);

    expect(session.groups).toEqual([]);
    expect(session.tickets.every((t) => t.groupId === null)).toBe(true);
    expect(session.tickets.find((t) => t.id === 'B')?.votes).toEqual(['u1', 'u2', 'u2']);
    expect(session.tickets.find((t) => t.id === 'A')?.votes).toEqual([]);
  });

  it('gives them to its first card when the anchor has left the group', () => {
    const session = pair('C');

    deleteGroup(session, 'g1', { keepVotes: true });

    expect(session.tickets.find((t) => t.id === 'A')?.votes).toEqual(['u1', 'u2', 'u2']);
    expect(session.tickets.find((t) => t.id === 'C')?.votes).toEqual([]);
  });

  it('keeps no votes in the guided Group phase, which runs before the vote', () => {
    const session = pair('A');

    deleteGroup(session, 'g1');

    expect(session.groups).toEqual([]);
    expect(session.tickets.flatMap((t) => t.votes)).toEqual([]);
  });

  it('answers false for a group that is already gone', () => {
    const session = pair();
    expect(deleteGroup(session, 'missing', { keepVotes: true })).toBe(false);
    expect(session.groups).toHaveLength(1);
  });
});

/**
 * Removing a column moves what it holds to the column beside it. Removed with
 * only the column, its cards stayed in the session out of sight, and on an open
 * board their votes went on counting against their voters (adversarial review
 * of PR #540).
 */
describe('removeColumn', () => {
  const column = (id: string) => ({ ...makeSession().columns[0], id, title: id });
  const threeColumns = () => makeSession({
    columns: [column('c1'), column('c2'), column('c3')],
    tickets: [
      makeTicket({ id: 'A', colId: 'c2', votes: ['u1'] }),
      makeTicket({ id: 'B', colId: 'c2', groupId: 'g1' }),
      makeTicket({ id: 'C', colId: 'c2', groupId: 'g1' }),
      makeTicket({ id: 'D', colId: 'c3', originColId: 'c2' }),
      makeTicket({ id: 'E', colId: 'c1' }),
    ],
    groups: [makeGroup({ id: 'g1', colId: 'c2', votes: ['u2'] })],
  });

  it('moves its cards and groups, votes and all, to the column before it', () => {
    const session = threeColumns();

    expect(removeColumn(session, 'c2')).toBe(true);

    expect(session.columns.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(session.tickets.filter((t) => t.colId === 'c1').map((t) => t.id).sort()).toEqual(['A', 'B', 'C', 'E']);
    expect(session.groups[0]).toMatchObject({ colId: 'c1', votes: ['u2'] });
    expect(session.tickets.find((t) => t.id === 'A')?.votes).toEqual(['u1']);
    // A "from" chip naming the removed column would name nothing.
    expect(session.tickets.find((t) => t.id === 'D')).not.toHaveProperty('originColId');
  });

  it('moves them to the column after it when it was the first', () => {
    const session = threeColumns();

    removeColumn(session, 'c1');

    expect(session.tickets.find((t) => t.id === 'E')?.colId).toBe('c2');
  });

  it('removes the last column only when nothing is in it', () => {
    const holding = makeSession({ columns: [column('only')], tickets: [makeTicket({ id: 'A', colId: 'only' })] });
    expect(removeColumn(holding, 'only')).toBe(false);
    expect(holding.columns).toHaveLength(1);

    const empty = makeSession({ columns: [column('only')] });
    expect(removeColumn(empty, 'only')).toBe(true);
    expect(empty.columns).toEqual([]);
  });

  it('answers false for a column that is already gone', () => {
    const session = threeColumns();
    expect(removeColumn(session, 'missing')).toBe(false);
    expect(session.columns).toHaveLength(3);
  });
});
