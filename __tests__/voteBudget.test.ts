import { describe, it, expect } from 'vitest';
import type { Column, Group, RetroSession, Ticket } from '../types';
import { getColumnEntries } from '../utils/retroColumnOrder';
import {
  capVotes,
  keepOneVotePerItem,
  mayAddVote,
  voteBudget,
  votableItems,
  votesCastByVoter,
  votesLeftFor,
  votesLeftToPlace,
} from '../utils/voteBudget';

/**
 * How many votes one person may cast (utils/voteBudget.ts), and what lowering
 * that number takes back.
 */

const ticket = (id: string, votes: string[], groupId: string | null = null, colId = 'col'): Ticket => ({
  id, colId, text: id, authorId: 'a', groupId, votes,
});
const group = (id: string, votes: string[], colId = 'col'): Group => ({ id, title: id, colId, votes });
const column = (id: string): Column => ({
  id, title: id, color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'thumb_up', text: 'text-emerald-700', ring: 'ring-emerald-300',
});
const idsOf = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id).sort();

describe('voteBudget', () => {
  it('is the facilitator’s number, or no limit at all', () => {
    expect(voteBudget({ maxVotes: 5 })).toBe(5);
    expect(voteBudget({ maxVotes: 5, unlimitedVotes: false })).toBe(5);
    expect(voteBudget({ maxVotes: 5, unlimitedVotes: true })).toBe(Number.POSITIVE_INFINITY);
    // What the screens compute from it stays a number that never runs out.
    expect(voteBudget({ maxVotes: 5, unlimitedVotes: true }) - 40 > 0).toBe(true);
  });
});

// The votes each person has cast: the one count the rules below judge a vote
// by, the Vote phase's participants panel (43.0) counts each row's votes left
// from, and the person's own "N votes remaining" in the bar reads too.
describe('votesCastByVoter', () => {
  it('counts stacked votes, grouped cards and groups together', () => {
    const cast = votesCastByVoter({
      tickets: [ticket('t1', ['a', 'a', 'b']), ticket('t2', ['fac'], 'g1')],
      groups: [group('g1', ['a'])],
    });
    expect(cast.get('a')).toBe(3);
    expect(cast.get('b')).toBe(1);
    expect(cast.get('fac')).toBe(1);
    expect(cast.has('c')).toBe(false);
  });

  it('counts a voter no roster holds', () => {
    const cast = votesCastByVoter({ tickets: [ticket('t1', ['gone', '__proto__'])], groups: [] });
    expect(cast.get('gone')).toBe(1);
    expect(cast.get('__proto__')).toBe(1);
  });

  it('answers an empty map with no votes', () => {
    expect(votesCastByVoter({ tickets: [ticket('t1', [])], groups: [group('g1', [])] }).size).toBe(0);
  });
});

describe('votesLeftFor', () => {
  it('is the number less the votes cast', () => {
    expect(votesLeftFor({ maxVotes: 5 }, 2)).toBe(3);
  });

  it('never goes below 0', () => {
    // The number can be lowered under what someone has already cast.
    expect(votesLeftFor({ maxVotes: 1 }, 3)).toBe(0);
  });

  it('counts nothing while votes are unlimited, or with no number', () => {
    expect(votesLeftFor({ maxVotes: 5, unlimitedVotes: true }, 2)).toBeNull();
    // A session stored without a number.
    expect(votesLeftFor({ maxVotes: undefined }, 0)).toBeNull();
  });

  // What it covers is the budget alone: with several votes per item, and on an
  // item the voter has not voted on, a vote goes in exactly while one is left.
  // With one vote per item an item they voted on takes none, which the number
  // cannot see: that is votesLeftToPlace, below.
  it('agrees with mayAddVote on the budget alone, with several votes per item and on an item without the vote', () => {
    const sessions = [
      { tickets: [ticket('t1', [])], groups: [] as Group[], settings: { maxVotes: 3, oneVotePerTicket: false } },
      { tickets: [ticket('t1', ['u1'])], groups: [group('g1', ['u1'])], settings: { maxVotes: 3, oneVotePerTicket: false } },
      { tickets: [ticket('t1', ['u1', 'u1'])], groups: [group('g1', ['u1'])], settings: { maxVotes: 3, oneVotePerTicket: false } },
      { tickets: [ticket('t1', ['u1', 'u1', 'u1', 'u1'])], groups: [] as Group[], settings: { maxVotes: 2, oneVotePerTicket: false } },
      { tickets: [ticket('t1', ['u1'])], groups: [] as Group[], settings: { maxVotes: 0, oneVotePerTicket: false } },
      {
        tickets: [ticket('t1', Array.from({ length: 10 }, () => 'u1'))],
        groups: [] as Group[],
        settings: { maxVotes: 1, unlimitedVotes: true, oneVotePerTicket: false },
      },
    ];
    const freshItem = ticket('fresh', []);
    for (const s of sessions) {
      const left = votesLeftFor(s.settings, votesCastByVoter(s).get('u1') ?? 0) ?? Number.POSITIVE_INFINITY;
      expect(left > 0).toBe(mayAddVote(s, freshItem, 'u1'));
    }
  });
});

// The items the guided Vote phase offers a vote on: what Session.tsx draws with
// a vote control, column by column (utils/retroColumnOrder.ts → getColumnEntries).
describe('votableItems', () => {
  it('lists the groups and the cards in no group, of the columns that exist', () => {
    const s = {
      columns: [column('col'), column('col-2')],
      tickets: [
        ticket('loose', []),
        ticket('grouped', [], 'g1'),
        ticket('other-column', [], null, 'col-2'),
        // Its column was removed: no column draws it, so nobody can vote on it.
        ticket('orphan', [], null, 'gone'),
      ],
      groups: [group('g1', []), group('g-orphan', [], 'gone')],
    };

    expect(idsOf(votableItems(s))).toEqual(['g1', 'loose', 'other-column']);
  });

  it('is exactly what getColumnEntries lists over the columns', () => {
    const session: RetroSession = {
      id: 's', teamId: 't', name: 'Retro', date: '2026-11-10', status: 'IN_PROGRESS', phase: 'VOTE',
      participants: [], icebreakerQuestion: '',
      columns: [column('col'), column('col-2')],
      settings: { isAnonymous: false, maxVotes: 5, oneVotePerTicket: true, revealBrainstorm: true, revealHappiness: false, revealRoti: false, timerSeconds: 0, timerRunning: false, timerInitial: 0 },
      tickets: [
        ticket('t1', ['u1']),
        ticket('t2', [], 'g1'),
        ticket('t3', [], 'g1'),
        ticket('t4', [], null, 'col-2'),
        ticket('t5', [], 'g2', 'col-2'),
        ticket('t6', [], null, 'gone'),
        // In a group that no longer exists: drawn nowhere.
        ticket('t7', [], 'g-gone'),
      ],
      groups: [group('g1', ['u1']), group('g2', [], 'col-2'), group('g3', [], 'gone')],
      actions: [], happiness: {}, roti: {}, finishedUsers: [],
    };
    const listed = session.columns
      .flatMap((col) => getColumnEntries(session, col.id))
      .map((entry) => (entry.kind === 'group' ? entry.group : entry.ticket));

    expect(new Set(votableItems(session))).toEqual(new Set(listed));
    expect(idsOf(votableItems(session))).toEqual(idsOf(listed));
  });
});

// The number the Vote phase shows each person, in their row of the panel and in
// their own bar: the votes they can still place. With one vote per item, never
// more than the items still without their vote (review of 43.0: a person who had
// voted on every item read "1 vote left", and nobody was finished automatically).
describe('votesLeftToPlace', () => {
  const vote = (overrides: { tickets?: Ticket[]; groups?: Group[] }, settings: { maxVotes?: number; unlimitedVotes?: boolean; oneVotePerTicket?: boolean }) => ({
    columns: [column('col')],
    tickets: overrides.tickets ?? [],
    groups: overrides.groups ?? [],
    settings: { maxVotes: 5, oneVotePerTicket: false, ...settings },
  });
  const castOf = (s: Parameters<typeof votesCastByVoter>[0], voter: string) => votesCastByVoter(s).get(voter) ?? 0;
  const fourTopics = (votedBy: (index: number) => string[]) =>
    ['g1', 'g2', 'g3', 'g4'].map((id, index) => group(id, votedBy(index)));

  it('caps the budget at the items still without the vote, with one vote per item', () => {
    const allVoted = vote({ groups: fourTopics(() => ['u1']) }, { oneVotePerTicket: true });
    expect(votesLeftToPlace(allVoted, 'u1', castOf(allVoted, 'u1'))).toBe(0);

    const threeVoted = vote({ groups: fourTopics((index) => (index < 3 ? ['u1'] : [])) }, { oneVotePerTicket: true });
    expect(votesLeftToPlace(threeVoted, 'u1', castOf(threeVoted, 'u1'))).toBe(1);

    // The budget, when it is the smaller one.
    const twoLeft = vote({ groups: fourTopics((index) => (index < 1 ? ['u1'] : [])) }, { maxVotes: 3, oneVotePerTicket: true });
    expect(votesLeftToPlace(twoLeft, 'u1', castOf(twoLeft, 'u1'))).toBe(2);
  });

  it('is the budget less the votes with several votes per item', () => {
    const s = vote({ groups: fourTopics(() => ['u1']) }, { oneVotePerTicket: false });
    expect(votesLeftToPlace(s, 'u1', castOf(s, 'u1'))).toBe(1);
  });

  it('counts nothing while votes are unlimited', () => {
    const s = vote({ groups: fourTopics(() => ['u1']) }, { unlimitedVotes: true, oneVotePerTicket: true });
    expect(votesLeftToPlace(s, 'u1', castOf(s, 'u1'))).toBeNull();
  });

  it('never goes below 0', () => {
    // The number lowered under what the voter cast, both ways.
    for (const oneVotePerTicket of [false, true]) {
      const s = vote({ tickets: [ticket('t1', ['u1', 'u1', 'u1'])], groups: fourTopics(() => []) }, { maxVotes: 1, oneVotePerTicket });
      expect(votesLeftToPlace(s, 'u1', castOf(s, 'u1')), String(oneVotePerTicket)).toBe(0);
    }
  });

  it('counts every item for a voter on none', () => {
    const s = vote({ groups: fourTopics(() => ['u1']) }, { oneVotePerTicket: true });
    expect(votesLeftToPlace(s, 'u2', castOf(s, 'u2'))).toBe(4);
    expect(votesLeftToPlace(vote({ groups: fourTopics(() => []) }, { maxVotes: 2, oneVotePerTicket: true }), 'u2', 0)).toBe(2);
  });

  it('counts the items it is given, so a caller reads them once for every voter', () => {
    const s = vote({ groups: fourTopics(() => ['u1']) }, { oneVotePerTicket: true });
    expect(votesLeftToPlace(s, 'u1', castOf(s, 'u1'), [group('open', [])])).toBe(1);
  });

  // The number and the vote controls must agree, or the panel names as still
  // voting someone no item will take a vote from (and the Vote phase never
  // finishes them on its own), or the reverse. Stated with a number and on a
  // board with at least one item: unlimited votes count nothing, and with no item
  // at all there is nothing to vote on.
  it('says a vote is left exactly when an item would take it, in both modes', () => {
    const boards = [
      // The stuck one: four topics, every one voted, five votes.
      { groups: fourTopics(() => ['u1']) },
      { groups: fourTopics((index) => (index < 3 ? ['u1'] : [])) },
      { tickets: [ticket('t1', ['u1', 'u1'])], groups: [group('g1', ['u1'])] },
      { tickets: [ticket('t1', ['u1']), ticket('t2', ['u1'], 'g1')], groups: [group('g1', [])] },
      { tickets: [ticket('t1', [])], groups: [] },
      { tickets: [ticket('t1', ['u1', 'u1', 'u1', 'u1', 'u1'])], groups: [group('g1', [])] },
    ];
    for (const oneVotePerTicket of [false, true]) {
      for (const maxVotes of [1, 3, 5]) {
        for (const board of boards) {
          const s = vote(board, { maxVotes, oneVotePerTicket });
          const left = votesLeftToPlace(s, 'u1', castOf(s, 'u1'));
          const anItemTakesIt = votableItems(s).some((item) => mayAddVote(s, item, 'u1'));
          expect(left !== null && left > 0, JSON.stringify({ oneVotePerTicket, maxVotes, board })).toBe(anItemTakesIt);
        }
      }
    }
  });
});

// Review finding (pass 3 of 42.1): a number typed in the votes field and left
// for a vote button joins that button's own write, and the button was enabled
// under the old number. The rule is read again on the state the write is
// built on.
describe('mayAddVote', () => {
  const session = (votes: string[][], settings: { maxVotes: number; unlimitedVotes?: boolean; oneVotePerTicket?: boolean }) => ({
    tickets: votes.map((v, i) => ticket(`t${i + 1}`, v)),
    groups: [group('g1', ['u1'])],
    settings: { oneVotePerTicket: false, ...settings },
  });

  it('adds a vote while the voter has some left, counting the groups too', () => {
    const s = session([['u1'], []], { maxVotes: 3 });
    expect(mayAddVote(s, s.tickets[1], 'u1')).toBe(true);
    expect(mayAddVote(s, s.tickets[1], 'u2')).toBe(true);
    const spent = session([['u1', 'u1'], []], { maxVotes: 3 });
    expect(mayAddVote(spent, spent.tickets[1], 'u1')).toBe(false);
  });

  it('never runs out while votes are unlimited', () => {
    const s = session([['u1', 'u1', 'u1'], []], { maxVotes: 1, unlimitedVotes: true });
    expect(mayAddVote(s, s.tickets[1], 'u1')).toBe(true);
  });

  it('adds no second vote on one item while one vote per item is on', () => {
    const s = session([['u1'], []], { maxVotes: 5, oneVotePerTicket: true });
    expect(mayAddVote(s, s.tickets[0], 'u1')).toBe(false);
    expect(mayAddVote(s, s.groups[0], 'u1')).toBe(false);
    expect(mayAddVote(s, s.tickets[1], 'u1')).toBe(true);
  });
});

describe('capVotes', () => {
  it('takes each voter down to the number, from the cards first, then the groups', () => {
    const session = {
      tickets: [ticket('t1', ['u1', 'u2', 'u1']), ticket('t2', ['u1'])],
      groups: [group('g1', ['u1', 'u2'])],
    };
    expect(capVotes(session, 2)).toBe(true);
    // u1 had four votes: the two on t1 go first, then the one on t2 is kept
    // along with the group's.
    expect(session.tickets[0].votes).toEqual(['u2']);
    expect(session.tickets[1].votes).toEqual(['u1']);
    expect(session.groups[0].votes).toEqual(['u1', 'u2']);
  });

  it('reaches the groups when the cards do not hold enough', () => {
    const session = {
      tickets: [ticket('t1', ['u1'])],
      groups: [group('g1', ['u1', 'u1']), group('g2', ['u1'])],
    };
    capVotes(session, 1);
    // Four votes for one: the card's, then both of the first group's.
    expect(session.tickets[0].votes).toEqual([]);
    expect(session.groups[0].votes).toEqual([]);
    expect(session.groups[1].votes).toEqual(['u1']);
  });

  it('caps a voter who is on no roster, and changes nothing under the number', () => {
    const session = { tickets: [ticket('t1', ['gone', 'gone'])], groups: [] as Group[] };
    expect(capVotes(session, 1)).toBe(true);
    expect(session.tickets[0].votes).toEqual(['gone']);
    expect(capVotes(session, 1)).toBe(false);
    expect(capVotes(session, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('keepOneVotePerItem', () => {
  it('takes every voter down to one vote per card and per group', () => {
    const session = {
      tickets: [ticket('t1', ['u1', 'u2', 'u1', 'u1']), ticket('t2', ['u2'])],
      groups: [group('g1', ['u3', 'u3'])],
    };
    expect(keepOneVotePerItem(session)).toBe(true);
    expect(session.tickets[0].votes).toEqual(['u1', 'u2']);
    expect(session.tickets[1].votes).toEqual(['u2']);
    expect(session.groups[0].votes).toEqual(['u3']);
    // Nothing left to take back.
    expect(keepOneVotePerItem(session)).toBe(false);
  });
});
