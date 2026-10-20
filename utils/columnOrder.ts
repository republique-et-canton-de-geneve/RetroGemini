/**
 * Moving a retrospective column one place earlier (-1) or later (+1). The same
 * rule serves the two template editors on the Dashboard and the facilitator's
 * "Edit layout" mode in a session, where the order of `session.columns` is the
 * order of the board for everyone.
 *
 * Only the array order changes: cards and groups point at a column by its id
 * (`colId`), so nothing else needs rewriting, and a client from an older
 * release simply renders the new order.
 */

export type MoveDirection = -1 | 1;

export const canMoveColumn = (index: number, count: number, direction: MoveDirection): boolean => {
  if (index < 0 || index >= count) return false;
  const target = index + direction;
  return target >= 0 && target < count;
};

/**
 * A new array with the column swapped with its neighbour, or the very array
 * given when there is nothing to do (an edge, or an unknown id), so a caller
 * can skip a write that would change nothing.
 */
export const moveColumn = <T extends { id: string }>(
  columns: T[],
  columnId: string,
  direction: MoveDirection
): T[] => {
  const index = columns.findIndex((column) => column.id === columnId);
  if (!canMoveColumn(index, columns.length, direction)) return columns;
  const next = [...columns];
  const target = index + direction;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};
