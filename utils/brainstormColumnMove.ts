import type { RetroSession } from '../types';
import { stampOriginColumn } from './retroGrouping';

/**
 * Moving a card between columns during **Brainstorm**.
 *
 * This is deliberately *not* grouping, and the distinction is the whole reason
 * the module exists. In the Group phase a card dropped on another card merges
 * the two into a group; here a card dropped on another column simply changes
 * columns and stays its own card. Nothing is created, nothing is merged,
 * nothing is dissolved — so a Brainstorm move can never change the composition
 * of a group.
 *
 * Which is also why a **grouped** card cannot be moved on its own: pulling one
 * member out of a group is exactly the composition change the Brainstorm phase
 * must not make. The group moves as a unit instead (`moveGroupToColumn`), which
 * is what a facilitator revisiting the board after grouping actually wants.
 *
 * Both functions mutate `session` in place, matching the update patterns in
 * `retroGrouping.ts`, and both answer `false` when they changed nothing so the
 * caller can tell a real move from a no-op.
 */

const columnExists = (session: RetroSession, colId: string): boolean =>
  session.columns.some((c) => c.id === colId);

/**
 * Moves one ungrouped ticket to another column.
 *
 * The origin marker is **cleared**, for the same reason dropping a card
 * straight onto a column clears it in the Group phase: this is an explicit
 * re-homing by a human, so the card now belongs where they put it and a
 * "from ..." chip pointing somewhere else would be a lie.
 */
export const moveTicketToColumn = (
  session: RetroSession,
  ticketId: string,
  colId: string,
): boolean => {
  if (!columnExists(session, colId)) return false;

  const ticket = session.tickets.find((t) => t.id === ticketId);
  if (!ticket) return false;
  // A member of a group travels with its group, never on its own.
  if (ticket.groupId) return false;
  if (ticket.colId === colId) return false;

  ticket.colId = colId;
  delete ticket.originColId;
  return true;
};

/**
 * Moves a whole group — the group itself and every card in it — to another
 * column, leaving its membership untouched.
 *
 * Unlike a single card, the members keep their origin marker: they were
 * displaced by grouping, not re-homed by hand, so each card goes on naming the
 * column it was written in (and a card returning to that column loses the chip
 * again, because `getTicketOriginColumn` reports nothing once the two agree).
 */
export const moveGroupToColumn = (
  session: RetroSession,
  groupId: string,
  colId: string,
): boolean => {
  if (!columnExists(session, colId)) return false;

  const group = session.groups.find((g) => g.id === groupId);
  if (!group) return false;
  if (group.colId === colId) return false;

  group.colId = colId;
  session.tickets
    .filter((t) => t.groupId === groupId)
    .forEach((t) => {
      stampOriginColumn(t, colId);
      t.colId = colId;
    });
  return true;
};
