import type { RetroSession, RetroSettings, Ticket } from '../types';
import type { ColumnEntry } from './retroColumnOrder';

/**
 * How one person looks at an open board (utils/openBoard.ts): the order of the
 * cards in each column, and a search. Both belong to the viewer, never to the
 * session — two people can sort the same board differently, and nothing here
 * is written, synced or guarded.
 *
 * A board is kept for weeks, so the newest cards come first by default: they
 * are the ones a team has not talked about yet. "Oldest first" is the order
 * the cards were written in, the one the guided phases show.
 */
export type BoardSort = 'newest' | 'oldest' | 'votes';

export const BOARD_SORTS: readonly BoardSort[] = ['newest', 'oldest', 'votes'];

export const DEFAULT_BOARD_SORT: BoardSort = 'newest';

/** A value read back from the screen's select, which only offers the three. */
export const toBoardSort = (value: unknown): BoardSort =>
  (BOARD_SORTS as readonly unknown[]).includes(value) ? (value as BoardSort) : DEFAULT_BOARD_SORT;

/**
 * "Most votes" orders the cards by their totals. While the facilitator hides
 * the totals it would show them anyway, as a ranking, so the board falls back
 * to the default order.
 */
export const effectiveBoardSort = (
  sort: BoardSort,
  settings: Pick<RetroSettings, 'voteCountHidden'>,
): BoardSort => (sort === 'votes' && settings.voteCountHidden ? DEFAULT_BOARD_SORT : sort);

/**
 * Text as the search compares it: no accents, no case, single spaces. French
 * cards are typed with and without accents ("équipe", "equipe") and both must
 * be found by either spelling — and so for the apostrophe a phone types by
 * itself (’) and the one a laptop does ('), and for the ligatures œ and æ,
 * which no keyboard layout types the same way.
 */
export const normalizeForSearch = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ')
    .trim();

/** The words a query looks for, compared as `normalizeForSearch` writes them. */
const searchTerms = (query: string): string[] => normalizeForSearch(query).split(' ').filter(Boolean);

const containsTerms = (text: string, terms: readonly string[]): boolean => {
  if (terms.length === 0) return true;
  const haystack = normalizeForSearch(text);
  return terms.every((term) => haystack.includes(term));
};

/** Every word of the query, in any order, somewhere in the text. */
export const matchesSearch = (text: string, query: string): boolean => containsTerms(text, searchTerms(query));

/**
 * The entries of a column that match a search. A card the viewer cannot read
 * (the facilitator hides the cards) never matches: a hidden card that stayed
 * on screen while one searched for a word would tell that it holds the word. A
 * group matches by its title or by any card in it the viewer can read, and is
 * then shown whole.
 */
export const filterBoardEntries = (
  entries: readonly ColumnEntry[],
  session: Pick<RetroSession, 'tickets'>,
  query: string,
  canRead: (ticket: Ticket) => boolean,
): ColumnEntry[] => {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...entries];
  // Read on every keystroke of the search, so each group's cards are found
  // once rather than by scanning every card for every group.
  const cardsOf = new Map<string, Ticket[]>();
  session.tickets.forEach((t) => {
    if (!t.groupId) return;
    const cards = cardsOf.get(t.groupId);
    if (cards) cards.push(t);
    else cardsOf.set(t.groupId, [t]);
  });
  return entries.filter((entry) => {
    if (entry.kind === 'ticket') return canRead(entry.ticket) && containsTerms(entry.ticket.text, terms);
    if (containsTerms(entry.group.title, terms)) return true;
    return (cardsOf.get(entry.group.id) ?? []).some((t) => canRead(t) && containsTerms(t.text, terms));
  });
};

const voteCountOf = (entry: ColumnEntry): number =>
  entry.kind === 'ticket' ? entry.ticket.votes.length : entry.group.votes.length;

/**
 * The entries of a column in the viewer's order. `entries` come from
 * `getColumnEntries`, already in the order the cards were written ("oldest").
 * Newest first puts a group at its most recent card, so a card just added to
 * an old group brings the group up with it. Most votes breaks ties newest
 * first. The sort is stable, so entries that tie keep their written order.
 */
export const sortBoardEntries = (
  entries: readonly ColumnEntry[],
  session: Pick<RetroSession, 'tickets'>,
  sort: BoardSort,
): ColumnEntry[] => {
  if (sort === 'oldest') return [...entries];
  // Each entry's place is worked out once, before sorting: a comparator runs
  // n log n times on every render of the board.
  const indexById = new Map(session.tickets.map((t, i) => [t.id, i]));
  const newestInGroup = new Map<string, number>();
  session.tickets.forEach((t, i) => {
    if (t.groupId) newestInGroup.set(t.groupId, Math.max(newestInGroup.get(t.groupId) ?? -1, i));
  });
  const keyed = entries.map((entry) => ({
    entry,
    newest: entry.kind === 'ticket'
      ? indexById.get(entry.ticket.id) ?? entry.order
      : newestInGroup.get(entry.group.id) ?? entry.order,
    votes: voteCountOf(entry),
  }));
  type Keyed = (typeof keyed)[number];
  const byNewest = (a: Keyed, b: Keyed) => b.newest - a.newest;
  const compare = sort === 'votes' ? (a: Keyed, b: Keyed) => b.votes - a.votes || byNewest(a, b) : byNewest;
  return keyed.sort(compare).map(({ entry }) => entry);
};
