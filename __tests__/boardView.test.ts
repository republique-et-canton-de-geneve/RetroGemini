import { describe, it, expect } from 'vitest';
import type { Group, RetroSession, Ticket } from '../types';
import { getColumnEntries } from '../utils/retroColumnOrder';
import {
  DEFAULT_BOARD_SORT,
  effectiveBoardSort,
  filterBoardEntries,
  matchesSearch,
  normalizeForSearch,
  sortBoardEntries,
  toBoardSort,
} from '../utils/boardView';

/**
 * How one person looks at an open board (utils/boardView.ts): the order of a
 * column's cards and a search. A board is reused for weeks, so the newest
 * cards come first by default — they are the ones nobody has talked about yet.
 */

const makeTicket = (overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket => ({
  colId: 'col1',
  text: overrides.id,
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
  id: 'board-1',
  teamId: 'team-1',
  name: 'Lean Coffee',
  date: '2026-10-28',
  status: 'IN_PROGRESS',
  phase: 'OPEN_BOARD',
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
    oneVotePerTicket: true,
    revealBrainstorm: true,
    revealHappiness: true,
    revealRoti: true,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  ...overrides,
});

const ids = (session: RetroSession, entries: ReturnType<typeof getColumnEntries>) =>
  entries.map((e) => (e.kind === 'group' ? `group:${e.group.id}` : e.ticket.id));

describe('the sort of a board', () => {
  it('opens newest first, and reads anything else back as that', () => {
    expect(DEFAULT_BOARD_SORT).toBe('newest');
    expect(toBoardSort('votes')).toBe('votes');
    expect(toBoardSort('oldest')).toBe('oldest');
    expect(toBoardSort('random')).toBe('newest');
    expect(toBoardSort(undefined)).toBe('newest');
  });

  it('does not rank by votes while the totals are hidden', () => {
    expect(effectiveBoardSort('votes', { voteCountHidden: true })).toBe('newest');
    expect(effectiveBoardSort('votes', { voteCountHidden: false })).toBe('votes');
    expect(effectiveBoardSort('oldest', { voteCountHidden: true })).toBe('oldest');
  });

  const board = makeSession({
    tickets: [
      makeTicket({ id: 'a', votes: ['u1'] }),
      makeTicket({ id: 'b', groupId: 'g' }),
      makeTicket({ id: 'c', votes: ['u1', 'u2', 'u3'] }),
      makeTicket({ id: 'd' }),
      // The newest card was put in the old group.
      makeTicket({ id: 'e', groupId: 'g' }),
    ],
    groups: [makeGroup({ id: 'g', anchorTicketId: 'b', votes: ['u2', 'u3'] })],
  });
  const entries = getColumnEntries(board, 'col1');

  it('shows the order the cards were written in, oldest first', () => {
    expect(ids(board, sortBoardEntries(entries, board, 'oldest'))).toEqual(['a', 'group:g', 'c', 'd']);
  });

  it('puts the newest first, a group at its most recent card', () => {
    expect(ids(board, sortBoardEntries(entries, board, 'newest'))).toEqual(['group:g', 'd', 'c', 'a']);
  });

  it('puts the most voted first, ties newest first', () => {
    const tied = makeSession({
      tickets: [...board.tickets, makeTicket({ id: 'f', votes: ['u4'] })],
      groups: board.groups,
    });
    expect(ids(tied, sortBoardEntries(getColumnEntries(tied, 'col1'), tied, 'votes')))
      .toEqual(['c', 'group:g', 'f', 'a', 'd']);
  });

  it('never changes the entries it was given', () => {
    const before = ids(board, entries);
    sortBoardEntries(entries, board, 'newest');
    expect(ids(board, entries)).toEqual(before);
  });

  it('keeps a group with no card left at its own place', () => {
    // A group whose cards were all deleted or taken out, as an older release
    // could leave one: last in the written order, so last in the newest too.
    const emptied = makeSession({
      tickets: [makeTicket({ id: 'a' })],
      groups: [makeGroup({ id: 'empty' })],
    });
    expect(ids(emptied, sortBoardEntries(getColumnEntries(emptied, 'col1'), emptied, 'newest')))
      .toEqual(['group:empty', 'a']);
  });
});

describe('the search of a board', () => {
  it('ignores accents, case and extra spaces', () => {
    expect(normalizeForSearch('  Équipe   PÉRENNE ')).toBe('equipe perenne');
    expect(matchesSearch('Disponibilité des personnes (équipe pérenne)', 'equipe')).toBe(true);
    expect(matchesSearch('disponibilite des personnes', 'Disponibilité')).toBe(true);
  });

  it('reads the typographic apostrophe and the French ligatures as typed by anyone', () => {
    // A phone types ’ by itself, and a laptop ' : either finds the other.
    expect(matchesSearch('Améliorer l’équipe', "l'equipe")).toBe(true);
    expect(matchesSearch("Améliorer l'équipe", 'l’équipe')).toBe(true);
    expect(matchesSearch('Le cœur du sujet', 'coeur')).toBe(true);
    expect(matchesSearch('Le coeur du sujet', 'CŒUR')).toBe(true);
    expect(matchesSearch('Ex æquo', 'aequo')).toBe(true);
  });

  it('finds every word of the query, in any order', () => {
    expect(matchesSearch('Uniformiser les workflow Jira', 'jira workflow')).toBe(true);
    expect(matchesSearch('Uniformiser les workflow Jira', 'jira confluence')).toBe(false);
    expect(matchesSearch('anything', '   ')).toBe(true);
  });

  const board = makeSession({
    tickets: [
      makeTicket({ id: 'mine', text: 'Flaky deploys', authorId: 'me' }),
      makeTicket({ id: 'theirs', text: 'Flaky tests', authorId: 'them' }),
      makeTicket({ id: 'in-group', text: 'Slow pipeline', authorId: 'them', groupId: 'g' }),
      makeTicket({ id: 'also-in-group', text: 'Retries', authorId: 'me', groupId: 'g' }),
      makeTicket({ id: 'other', text: 'Coffee machine', authorId: 'me' }),
    ],
    groups: [makeGroup({ id: 'g', title: 'Delivery', anchorTicketId: 'in-group' })],
  });
  const entries = getColumnEntries(board, 'col1');
  const everything = () => true;
  const onlyMine = (t: Ticket) => t.authorId === 'me';

  it('shows every entry for an empty query', () => {
    expect(filterBoardEntries(entries, board, '', everything)).toHaveLength(entries.length);
  });

  it('keeps the cards and the groups that match', () => {
    expect(ids(board, filterBoardEntries(entries, board, 'flaky', everything))).toEqual(['mine', 'theirs']);
    // A group by its title, or by one of its cards.
    expect(ids(board, filterBoardEntries(entries, board, 'delivery', everything))).toEqual(['group:g']);
    expect(ids(board, filterBoardEntries(entries, board, 'pipeline', everything))).toEqual(['group:g']);
  });

  it('never finds a card the viewer cannot read', () => {
    expect(ids(board, filterBoardEntries(entries, board, 'flaky', onlyMine))).toEqual(['mine']);
    // The group's only match is a card hidden from this viewer.
    expect(ids(board, filterBoardEntries(entries, board, 'pipeline', onlyMine))).toEqual([]);
    // Its title is not hidden.
    expect(ids(board, filterBoardEntries(entries, board, 'delivery', onlyMine))).toEqual(['group:g']);
  });

  it('finds a group with no card left by its title alone', () => {
    const emptied = makeSession({ groups: [makeGroup({ id: 'empty', title: 'Leftovers' })] });
    const entries = getColumnEntries(emptied, 'col1');
    expect(ids(emptied, filterBoardEntries(entries, emptied, 'leftovers', everything))).toEqual(['group:empty']);
    expect(ids(emptied, filterBoardEntries(entries, emptied, 'deploys', everything))).toEqual([]);
  });
});
