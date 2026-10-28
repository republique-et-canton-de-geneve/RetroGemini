import { describe, it, expect } from 'vitest';
import type { Group, Ticket } from '../types';
import { capVotes, keepOneVotePerItem, voteBudget } from '../utils/voteBudget';

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
