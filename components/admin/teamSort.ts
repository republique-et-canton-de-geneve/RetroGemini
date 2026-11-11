import type { Team } from '../../types';

/**
 * The order of the console's Teams tab, sorted in the browser.
 *
 * Two columns hold a value a team may not have: a team that never connected
 * has no last activity, and a pod of an earlier release, answering the console
 * during a rolling update, sends no retrospective count. Those teams stay last
 * whichever the direction, in the order the server sent them.
 */

export type TeamSortColumn = 'name' | 'members' | 'retrospectives' | 'lastActive';
export type SortDirection = 'asc' | 'desc';

/**
 * The retrospective count the server sent, or null when it sent none. Never
 * the history's length: the console's team list does not carry the history.
 */
export const retrospectiveCountOf = (team: Pick<Team, 'retrospectiveCount'>): number | null =>
  (typeof team.retrospectiveCount === 'number' ? team.retrospectiveCount : null);

type ColumnWithGaps = 'retrospectives' | 'lastActive';

const valueOf = (column: ColumnWithGaps, team: Team): number | null => {
  if (column === 'retrospectives') return retrospectiveCountOf(team);
  return team.lastConnectionDate ? new Date(team.lastConnectionDate).getTime() : null;
};

const compareWithGapsLast = (column: ColumnWithGaps) => (a: Team, b: Team): number => {
  const valueA = valueOf(column, a);
  const valueB = valueOf(column, b);
  if (valueA === null && valueB === null) return 0;
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  return valueA - valueB;
};

/** A sorted copy (the same array while no column is chosen). */
export const sortTeams = (teams: Team[], column: TeamSortColumn | null, direction: SortDirection): Team[] => {
  if (!column) return teams;
  if (column === 'name' || column === 'members') {
    const sorted = [...teams].sort(column === 'name'
      ? (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      : (a, b) => a.members.length - b.members.length);
    return direction === 'asc' ? sorted : sorted.reverse();
  }
  const sorted = [...teams].sort(compareWithGapsLast(column));
  if (direction === 'asc') return sorted;
  // Only the teams with a value are reversed; the others stay last.
  const known = sorted.filter((team) => valueOf(column, team) !== null);
  const unknown = sorted.filter((team) => valueOf(column, team) === null);
  return [...known.reverse(), ...unknown];
};

/** `aria-sort` for a column's header: on the sorted column only. */
export const ariaSortOf = (
  column: TeamSortColumn,
  sortedColumn: TeamSortColumn | null,
  direction: SortDirection
): 'ascending' | 'descending' | undefined => {
  if (column !== sortedColumn) return undefined;
  return direction === 'asc' ? 'ascending' : 'descending';
};

/** The icon beside a column's label: a ligature of the self-hosted font. */
export const sortIconOf = (column: TeamSortColumn, sortedColumn: TeamSortColumn | null, direction: SortDirection): string => {
  if (column !== sortedColumn) return 'unfold_more';
  return direction === 'asc' ? 'arrow_upward' : 'arrow_downward';
};
