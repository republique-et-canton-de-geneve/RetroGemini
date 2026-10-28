import type { Column, RetroSession, Ticket } from '../types';
import { cutCodeUnits } from './textCut';
import { randomId } from './randomId';

const defaultIdGenerator = (): string => randomId();

/**
 * Remembers where a ticket was written before grouping moves it to another
 * column. Only the very first cross-column move stamps the origin, so a
 * ticket regrouped several times still points at the column it was born in.
 *
 * Exported for `brainstormColumnMove.ts`, which displaces cards the same way
 * when a whole group is moved: one rule for what the "from ..." chip means, or
 * the two paths would disagree about where a card was written.
 */
export const stampOriginColumn = (ticket: Ticket, targetColId: string): void => {
  if (!ticket.originColId && ticket.colId !== targetColId) {
    ticket.originColId = ticket.colId;
  }
};

/**
 * Returns the origin column to display for a ticket that currently sits in a
 * different column than the one it was written in, or null when the ticket
 * is "at home" (or the origin column no longer exists).
 */
export const getTicketOriginColumn = (
  ticket: Pick<Ticket, 'colId' | 'originColId'>,
  columns: Column[],
): Column | null => {
  if (!ticket.originColId || ticket.originColId === ticket.colId) return null;
  return columns.find((c) => c.id === ticket.originColId) ?? null;
};

/**
 * What grouping does with the votes already on the cards.
 *
 * The guided Group phase runs before the vote, so its cards carry none and
 * grouping clears whatever they hold. An open board (`utils/openBoard.ts`)
 * votes while it groups, so there `keepVotes` makes the votes travel with the
 * cards: a group gets the votes of every card put in it, and a group left with
 * one card hands its votes to that card. Nobody's count ever grows, so the vote
 * budget holds — and with one vote per item allowed, a person who voted for two
 * cards that become one keeps one vote on it and gets the other back.
 */
export interface GroupingOptions {
  keepVotes?: boolean;
}

const combineVotes = (session: RetroSession, into: string[] | undefined, added: string[] | undefined): string[] => {
  const all = [...(into ?? []), ...(added ?? [])];
  return session.settings?.oneVotePerTicket ? [...new Set(all)] : all;
};

/**
 * Removes a group when it would have one or zero remaining members.
 * The remaining sibling (if any) is returned to the ungrouped state, with the
 * group's votes when they are kept (see `GroupingOptions`).
 *
 * Mutates `session` in place to match the existing update patterns.
 */
export const dissolveGroupIfTooSmall = (
  session: RetroSession,
  groupId: string | null | undefined,
  ticketIdToIgnore: string,
  options: GroupingOptions = {},
): void => {
  if (!groupId) return;
  const siblings = session.tickets.filter(
    (t) => t.groupId === groupId && t.id !== ticketIdToIgnore,
  );
  if (siblings.length <= 1) {
    if (siblings.length === 1) {
      const lastCard = siblings[0];
      if (options.keepVotes) {
        const group = session.groups.find((g) => g.id === groupId);
        lastCard.votes = combineVotes(session, lastCard.votes, group?.votes);
      }
      lastCard.groupId = null;
    }
    session.groups = session.groups.filter((g) => g.id !== groupId);
  }
};

export interface GroupTicketsResult {
  /** Newly created group id, when a fresh group was created. */
  newGroupId: string | null;
  /** True when nothing changed (already grouped, missing entities, etc.). */
  noOp: boolean;
}

/**
 * Groups two tickets together based on the LATEST session state.
 *
 * Concurrency safety: if a remote update has already grouped the two
 * tickets together (e.g. another user performed the same drag-and-drop
 * a moment earlier), this function is a no-op. Without this guard the
 * dragged ticket would be reassigned to a group id that
 * `dissolveGroupIfTooSmall` had just removed, leaving the ticket
 * orphaned and invisible in the UI.
 */
export const groupTicketsTogether = (
  session: RetroSession,
  draggedTicketId: string,
  targetTicketId: string,
  generateId: () => string = defaultIdGenerator,
  options: GroupingOptions = {},
): GroupTicketsResult => {
  if (draggedTicketId === targetTicketId) {
    return { newGroupId: null, noOp: true };
  }

  const draggedT = session.tickets.find((t) => t.id === draggedTicketId);
  const targetT = session.tickets.find((t) => t.id === targetTicketId);
  if (!draggedT || !targetT) {
    return { newGroupId: null, noOp: true };
  }

  if (draggedT.groupId && draggedT.groupId === targetT.groupId) {
    return { newGroupId: null, noOp: true };
  }

  if (targetT.groupId) {
    const targetGroupExists = session.groups.some(
      (g) => g.id === targetT.groupId,
    );
    if (!targetGroupExists) {
      return { newGroupId: null, noOp: true };
    }
    dissolveGroupIfTooSmall(session, draggedT.groupId, draggedT.id, options);
    if (options.keepVotes) {
      const targetGroup = session.groups.find((g) => g.id === targetT.groupId);
      if (targetGroup) targetGroup.votes = combineVotes(session, targetGroup.votes, draggedT.votes);
    }
    draggedT.votes = [];
    draggedT.groupId = targetT.groupId;
    stampOriginColumn(draggedT, targetT.colId);
    draggedT.colId = targetT.colId;
    return { newGroupId: null, noOp: false };
  }

  dissolveGroupIfTooSmall(session, draggedT.groupId, draggedT.id, options);
  const groupVotes = options.keepVotes ? combineVotes(session, targetT.votes, draggedT.votes) : [];
  draggedT.votes = [];

  const newGroupId = generateId();
  session.groups.push({
    id: newGroupId,
    title: '',
    colId: targetT.colId,
    votes: groupVotes,
    // Anchor the group to the drop target so it stays where it was created
    // instead of jumping to the top of the column.
    anchorTicketId: targetT.id,
  });
  targetT.groupId = newGroupId;
  targetT.votes = [];
  draggedT.groupId = newGroupId;
  stampOriginColumn(draggedT, targetT.colId);
  draggedT.colId = targetT.colId;
  return { newGroupId, noOp: false };
};

/**
 * Adds a ticket to an existing group based on the LATEST session state.
 *
 * Concurrency safety: if the target group has been removed remotely or
 * if the ticket is already in that group, this is a no-op. This prevents
 * the ticket from being assigned to a phantom group id.
 */
export const addTicketToGroup = (
  session: RetroSession,
  ticketId: string,
  targetGroupId: string,
  options: GroupingOptions = {},
): boolean => {
  const t = session.tickets.find((x) => x.id === ticketId);
  if (!t) return false;

  const targetGroup = session.groups.find((g) => g.id === targetGroupId);
  if (!targetGroup) return false;

  if (t.groupId === targetGroupId) return false;

  dissolveGroupIfTooSmall(session, t.groupId, t.id, options);
  if (options.keepVotes) targetGroup.votes = combineVotes(session, targetGroup.votes, t.votes);
  t.groupId = targetGroup.id;
  stampOriginColumn(t, targetGroup.colId);
  t.colId = targetGroup.colId;
  t.votes = [];
  return true;
};

/**
 * Removes a ticket from its group and places it in the given column.
 */
export const removeTicketFromGroup = (
  session: RetroSession,
  ticketId: string,
  colId: string,
  options: GroupingOptions = {},
): void => {
  const t = session.tickets.find((x) => x.id === ticketId);
  if (!t) return;
  dissolveGroupIfTooSmall(session, t.groupId, t.id, options);
  t.colId = colId;
  t.groupId = null;
  // Dropping straight onto a column is an explicit re-homing: the ticket now
  // belongs where the user put it, so the origin marker is cleared.
  delete t.originColId;
};

/**
 * Deletes a card. A group it leaves with one card is dissolved, as when a card
 * is taken out of it, so no group of one is left behind. Answers false when
 * the card is already gone.
 */
export const deleteTicket = (
  session: RetroSession,
  ticketId: string,
  options: GroupingOptions = {},
): boolean => {
  const t = session.tickets.find((x) => x.id === ticketId);
  if (!t) return false;
  dissolveGroupIfTooSmall(session, t.groupId, t.id, options);
  session.tickets = session.tickets.filter((x) => x.id !== ticketId);
  return true;
};

/**
 * Deletes a group: its cards stay, ungrouped, where they are. With `keepVotes`
 * (an open board) the group's votes go to the card it was anchored to (the
 * card it was made on), or to its first card when that one has left it: a
 * deletion that only meant to separate the cards never takes the votes the
 * topic received. The guided Group phase runs before the vote, so it has none
 * to keep. Answers false when the group is already gone.
 */
export const deleteGroup = (
  session: RetroSession,
  groupId: string,
  options: GroupingOptions = {},
): boolean => {
  const group = session.groups.find((g) => g.id === groupId);
  if (!group) return false;
  const members = session.tickets.filter((t) => t.groupId === groupId);
  if (options.keepVotes && members.length > 0) {
    const heir = members.find((t) => t.id === group.anchorTicketId) ?? members[0];
    heir.votes = combineVotes(session, heir.votes, group.votes);
  }
  for (const t of members) t.groupId = null;
  session.groups = session.groups.filter((g) => g.id !== groupId);
  return true;
};

/**
 * Removes a column. Its cards and groups move to the column before it (after
 * it, for the first one), so nothing written in it disappears with it: removed
 * whole, they stayed in the session, out of sight, and on an open board their
 * votes went on counting against their voters with no control left to take
 * them back. Answers false, removing nothing, for an unknown column or for the
 * last one while something is still in it.
 */
export const removeColumn = (session: RetroSession, colId: string): boolean => {
  const index = session.columns.findIndex((c) => c.id === colId);
  if (index === -1) return false;
  const heir = session.columns[index - 1] ?? session.columns[index + 1];
  const holdsSomething =
    session.tickets.some((t) => t.colId === colId) || session.groups.some((g) => g.colId === colId);
  if (!heir && holdsSomething) return false;
  if (heir) {
    for (const t of session.tickets) {
      if (t.colId === colId) t.colId = heir.id;
      // A "from" chip naming a column that is gone would name nothing.
      if (t.originColId === colId) delete t.originColId;
    }
    for (const g of session.groups) {
      if (g.colId === colId) g.colId = heir.id;
    }
  }
  session.columns = session.columns.filter((c) => c.id !== colId);
  return true;
};

export interface SuggestedCluster {
  title: string;
  ticketIds: string[];
}

/**
 * Apply one or more suggested clusters (e.g. coming from the AI helper)
 * onto a session in place. Tickets that no longer exist or are already
 * grouped are skipped, and the same ticket id can never end up in two
 * different new groups.
 *
 * IMPORTANT: this MUST be called in a single update so all clusters see
 * the same starting point. Calling it once per cluster in a row would
 * read stale state from the previous call and lose groups.
 */
export const applySuggestedClusters = (
  session: RetroSession,
  suggestions: SuggestedCluster[],
  generateId: () => string = defaultIdGenerator,
  options: GroupingOptions = {},
): void => {
  const usedIds = new Set<string>();
  for (const suggestion of suggestions) {
    const ids = suggestion?.ticketIds || [];
    if (ids.length < 2) continue;
    const validTickets = ids
      .map((id) => session.tickets.find((t) => t.id === id))
      .filter(
        (t): t is NonNullable<typeof t> =>
          !!t && !t.groupId && !usedIds.has(t.id),
      );
    if (validTickets.length < 2) continue;
    const colId = validTickets[0].colId;
    const newGroupId = generateId();
    session.groups.push({
      id: newGroupId,
      // Never half an emoji: the title is stored (utils/textCut.js).
      title: cutCodeUnits((suggestion.title || '').trim(), 80),
      colId,
      votes: options.keepVotes
        ? validTickets.reduce<string[]>((votes, t) => combineVotes(session, votes, t.votes), [])
        : [],
    });
    for (const t of validTickets) {
      t.groupId = newGroupId;
      stampOriginColumn(t, colId);
      t.colId = colId;
      t.votes = [];
      usedIds.add(t.id);
    }
  }
};
