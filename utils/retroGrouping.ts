import type { RetroSession } from '../types';

const defaultIdGenerator = (): string =>
  Math.random().toString(36).substr(2, 9);

/**
 * Removes a group when it would have one or zero remaining members.
 * The remaining sibling (if any) is returned to the ungrouped state.
 *
 * Mutates `session` in place to match the existing update patterns.
 */
export const dissolveGroupIfTooSmall = (
  session: RetroSession,
  groupId: string | null | undefined,
  ticketIdToIgnore: string,
): void => {
  if (!groupId) return;
  const siblings = session.tickets.filter(
    (t) => t.groupId === groupId && t.id !== ticketIdToIgnore,
  );
  if (siblings.length <= 1) {
    if (siblings.length === 1) siblings[0].groupId = null;
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
    dissolveGroupIfTooSmall(session, draggedT.groupId, draggedT.id);
    draggedT.votes = [];
    draggedT.groupId = targetT.groupId;
    draggedT.colId = targetT.colId;
    return { newGroupId: null, noOp: false };
  }

  dissolveGroupIfTooSmall(session, draggedT.groupId, draggedT.id);
  draggedT.votes = [];

  const newGroupId = generateId();
  session.groups.push({
    id: newGroupId,
    title: '',
    colId: targetT.colId,
    votes: [],
  });
  targetT.groupId = newGroupId;
  targetT.votes = [];
  draggedT.groupId = newGroupId;
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
): boolean => {
  const t = session.tickets.find((x) => x.id === ticketId);
  if (!t) return false;

  const targetGroup = session.groups.find((g) => g.id === targetGroupId);
  if (!targetGroup) return false;

  if (t.groupId === targetGroupId) return false;

  dissolveGroupIfTooSmall(session, t.groupId, t.id);
  t.groupId = targetGroup.id;
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
): void => {
  const t = session.tickets.find((x) => x.id === ticketId);
  if (!t) return;
  dissolveGroupIfTooSmall(session, t.groupId, t.id);
  t.colId = colId;
  t.groupId = null;
};
