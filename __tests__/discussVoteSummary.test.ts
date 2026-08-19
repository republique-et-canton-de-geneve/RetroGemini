import { describe, it, expect } from 'vitest';
import { buildDiscussVoteSummary, DiscussVoteItemLike } from '../components/session/discussVoteSummary';

const ticketItem = (
  id: string,
  votes: string[],
  overrides: Partial<DiscussVoteItemLike> = {}
): DiscussVoteItemLike => ({
  id,
  text: `Topic ${id}`,
  votes: votes.length,
  uniqueVotes: new Set(votes).size,
  type: 'ticket',
  ref: { votes },
  ...overrides
});

describe('buildDiscussVoteSummary', () => {
  it('returns an empty summary when the discuss list has no topic', () => {
    const summary = buildDiscussVoteSummary([], 'me');

    expect(summary.votedTopics).toEqual([]);
    expect(summary.myTotalVotes).toBe(0);
    expect(summary.votedTopicCount).toBe(0);
    expect(summary.onlyMineCount).toBe(0);
    expect(summary.topicCount).toBe(0);
    expect(summary.topVotes).toBe(0);
  });

  it('counts every vote the current user placed, including repeated votes on one topic', () => {
    const items = [
      ticketItem('a', ['me', 'me', 'bob']),
      ticketItem('b', ['bob']),
      ticketItem('c', ['me', 'carol', 'bob'])
    ];

    const summary = buildDiscussVoteSummary(items, 'me');

    expect(summary.myTotalVotes).toBe(3);
    expect(summary.votedTopicCount).toBe(2);
    expect(summary.votedTopics.map((topic) => topic.id)).toEqual(['a', 'c']);
    expect(summary.byTopicId.a.myVotes).toBe(2);
    expect(summary.byTopicId.b.myVotes).toBe(0);
    expect(summary.byTopicId.c.myVotes).toBe(1);
  });

  it('separates the current user\'s votes from the support the topic got from others', () => {
    const summary = buildDiscussVoteSummary([ticketItem('a', ['me', 'me', 'bob', 'carol'])], 'me');
    const topic = summary.byTopicId.a;

    expect(topic.totalVotes).toBe(4);
    expect(topic.myVotes).toBe(2);
    expect(topic.otherVotes).toBe(2);
    expect(topic.otherBackers).toBe(2);
    expect(topic.onlyMine).toBe(false);
  });

  it('flags a topic nobody else backed, so a lonely vote is visible at a glance', () => {
    const summary = buildDiscussVoteSummary(
      [ticketItem('a', ['bob', 'carol']), ticketItem('lonely', ['me', 'me'])],
      'me'
    );

    expect(summary.byTopicId.lonely.onlyMine).toBe(true);
    expect(summary.byTopicId.lonely.otherVotes).toBe(0);
    expect(summary.byTopicId.lonely.otherBackers).toBe(0);
    expect(summary.byTopicId.a.onlyMine).toBe(false);
    expect(summary.onlyMineCount).toBe(1);
  });

  it('never reports a topic the user did not vote on as "only mine"', () => {
    const summary = buildDiscussVoteSummary([ticketItem('a', [])], 'me');

    expect(summary.byTopicId.a.myVotes).toBe(0);
    expect(summary.byTopicId.a.onlyMine).toBe(false);
    expect(summary.onlyMineCount).toBe(0);
  });

  it('ranks topics by total votes with ties sharing the same rank', () => {
    const items = [
      ticketItem('top', ['a', 'b', 'c']),
      ticketItem('tie1', ['a', 'b']),
      ticketItem('tie2', ['c', 'd']),
      ticketItem('last', ['a'])
    ];

    const summary = buildDiscussVoteSummary(items, 'me');

    expect(summary.byTopicId.top.rank).toBe(1);
    expect(summary.byTopicId.tie1.rank).toBe(2);
    expect(summary.byTopicId.tie2.rank).toBe(2);
    // Competition ranking: the two tied topics consume ranks 2 and 3
    expect(summary.byTopicId.last.rank).toBe(4);
    expect(summary.byTopicId.last.topicCount).toBe(4);
  });

  it('orders the voted topics by rank even when the incoming list is unsorted', () => {
    const items = [
      ticketItem('weak', ['me']),
      ticketItem('strong', ['me', 'bob', 'carol']),
      ticketItem('middle', ['me', 'bob'])
    ];

    const summary = buildDiscussVoteSummary(items, 'me');

    expect(summary.votedTopics.map((topic) => topic.id)).toEqual(['strong', 'middle', 'weak']);
  });

  it('exposes the best score in the list so support can be drawn to scale', () => {
    const summary = buildDiscussVoteSummary(
      [ticketItem('a', ['me']), ticketItem('b', ['x', 'y', 'z'])],
      'me'
    );

    expect(summary.topVotes).toBe(3);
  });

  it('keeps group rows working and carries the topic label and type through', () => {
    const group: DiscussVoteItemLike = {
      id: 'g1',
      text: 'Flaky pipeline',
      votes: 3,
      uniqueVotes: 2,
      type: 'group',
      ref: { votes: ['me', 'me', 'bob'] }
    };

    const summary = buildDiscussVoteSummary([group], 'me');

    expect(summary.byTopicId.g1.type).toBe('group');
    expect(summary.byTopicId.g1.text).toBe('Flaky pipeline');
    expect(summary.byTopicId.g1.myVotes).toBe(2);
    expect(summary.byTopicId.g1.otherBackers).toBe(1);
  });

  it('falls back to the raw vote list when the caller passes no distinct-voter count', () => {
    const summary = buildDiscussVoteSummary(
      [{ id: 'a', text: 'A', votes: 3, type: 'ticket', ref: { votes: ['me', 'bob', 'bob'] } }],
      'me'
    );

    expect(summary.byTopicId.a.otherBackers).toBe(1);
  });

  it('survives a topic whose reference carries no vote array', () => {
    const summary = buildDiscussVoteSummary(
      [{ id: 'a', text: 'A', votes: 0, type: 'ticket', ref: {} }],
      'me'
    );

    expect(summary.byTopicId.a.myVotes).toBe(0);
    expect(summary.byTopicId.a.otherVotes).toBe(0);
    expect(summary.myTotalVotes).toBe(0);
  });

  it('never reports negative support when the totals and the vote list disagree', () => {
    // Defensive: `votes` is the count the card displays, `ref.votes` the raw list.
    const summary = buildDiscussVoteSummary(
      [{ id: 'a', text: 'A', votes: 1, uniqueVotes: 1, type: 'ticket', ref: { votes: ['me', 'me'] } }],
      'me'
    );

    expect(summary.byTopicId.a.otherVotes).toBe(0);
    expect(summary.byTopicId.a.otherBackers).toBe(0);
  });
});
