import type { Group, RetroSession, Ticket } from '../types';

/**
 * A top-level entry rendered in a column during the Group and Vote phases:
 * either an ungrouped ticket or a group (which itself contains tickets).
 */
export type ColumnEntry =
  | { kind: 'ticket'; order: number; ticket: Ticket }
  | { kind: 'group'; order: number; group: Group };

/**
 * Returns the ordered list of top-level entries (ungrouped tickets and
 * groups) for a column, preserving positional order so a freshly created
 * group stays where it was dropped instead of jumping to the top.
 *
 * Ordering is derived from ticket creation order (their index in
 * `session.tickets`, since brainstorm appends new tickets). A group is
 * positioned at its anchor ticket — the drop target captured when the group
 * was created. When no anchor is known (legacy groups or AI-suggested
 * clusters) it falls back to its earliest-created member ticket.
 */
export const getColumnEntries = (
  session: RetroSession,
  colId: string,
): ColumnEntry[] => {
  const indexById = new Map<string, number>();
  session.tickets.forEach((t, i) => indexById.set(t.id, i));
  const orderOf = (id: string): number =>
    indexById.has(id) ? (indexById.get(id) as number) : Number.MAX_SAFE_INTEGER;

  const ticketEntries: ColumnEntry[] = session.tickets
    .filter((t) => t.colId === colId && !t.groupId)
    .map((ticket) => ({ kind: 'ticket', order: orderOf(ticket.id), ticket }));

  const groupEntries: ColumnEntry[] = session.groups
    .filter((g) => g.colId === colId)
    .map((group) => {
      let order: number;
      if (group.anchorTicketId && indexById.has(group.anchorTicketId)) {
        order = orderOf(group.anchorTicketId);
      } else {
        const memberOrders = session.tickets
          .filter((t) => t.groupId === group.id)
          .map((t) => orderOf(t.id));
        order = memberOrders.length
          ? Math.min(...memberOrders)
          : Number.MAX_SAFE_INTEGER;
      }
      return { kind: 'group', order, group };
    });

  return [...ticketEntries, ...groupEntries].sort((a, b) => a.order - b.order);
};
