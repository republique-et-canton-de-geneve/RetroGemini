import { describe, it, expect } from 'vitest';
import type { RetroSession, Ticket, Group } from '../types';
import {
  addTicketToGroup,
  applySuggestedClusters,
  dissolveGroupIfTooSmall,
  getTicketOriginColumn,
  groupTicketsTogether,
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
