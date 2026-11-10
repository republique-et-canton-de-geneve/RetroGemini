import { describe, it, expect } from 'vitest';
import type { Group, Ticket } from '../types';
import { capVotes, keepOneVotePerItem, mayAddVote, voteBudget, votesCastByVoter, votesLeftFor } from '../utils/voteBudget';

/**
 * How many votes one person may cast (utils/voteBudget.ts), and what lowering
 * that number takes back.
 */

const ticket = (id: string, votes: string[], groupId: string | null = null): Ticket => ({
  id, colId: 'col', text: id, authorId: 'a', groupId, votes,
});
const group = (id: string, votes: string[]): Group => ({ id, title: id, colId: 'col', votes });

describe('voteBudget', () => {
  it('is the facilitator’s number, or no limit at all', () => {
    expect(voteBudget({ maxVotes: 5 })).toBe(5);
    expect(voteBudget({ maxVotes: 5, unlimitedVotes: false })).toBe(5);
    expect(voteBudget({ maxVotes: 5, unlimitedVotes: true })).toBe(Number.POSITIVE_INFINITY);
    // What the screens compute from it stays a number that never runs out.
    expect(voteBudget({ maxVotes: 5, unlimitedVotes: true }) - 40 > 0).toBe(true);
  });
});

// The Vote phase's participants panel (43.0) counts, per person, the votes
// they still have to cast: the same count the rules below judge a vote by, and
// the number their own "N votes remaining" chip shows them.
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

  it('agrees with mayAddVote on whether one more vote goes in', () => {
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
