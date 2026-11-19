import type { Group, RetroSession, Ticket } from '../types';

/**
 * What just happened in a session, read from two of its states.
 *
 * The look animates a card that arrives, a guest who joins, a vote, the reveal.
 * None of it can be read from an element appearing: every phase change remounts
 * the whole board, a card remounts when it changes group or column, and a
 * search lets a card back in. An animation tied to a mount would replay each
 * time. So the session screens compare the state they showed with the state
 * they show now, hold the ids this module names for the length of an
 * animation, and forget them (`components/session/useSessionMotion.ts`).
 *
 * Pure: no DOM, no clock. Session blobs are written by every client, so every
 * list is read as data that may be missing or malformed.
 */

/** Phases whose board hides other people's cards until the facilitator shows them. */
const HIDING_PHASES: ReadonlySet<string> = new Set(['BRAINSTORM', 'OPEN_BOARD']);

/**
 * More cards than this in one write is not people writing: a healed state, a
 * restore, a reconnection after minutes away. Nothing arrives then.
 */
export const MAX_CARD_BURST = 6;

/**
 * More people than this at once is not guests arriving: after a rolling update
 * every browser reconnects within a second and the whole roster comes back.
 */
export const MAX_PEOPLE_BURST = 2;

export interface SessionMotionContext {
  /** The person looking at the screen. */
  viewerId: string;
  /** Ids of the cards this client created and the server has not confirmed yet. */
  ownPendingIds: ReadonlySet<string>;
}

export interface SessionMotion {
  /** Cards that appeared and that this client did not just create (hidden ones included). */
  arrivedCards: string[];
  /** Cards this client just created: they leave its own add field. */
  ownCards: string[];
  /** The cards were just shown: those that were hidden from this viewer, in board order. */
  revealedCards: string[];
  /** `<ticketId>:<emoji>` for each reaction whose count grew. */
  reactions: string[];
  /** Columns whose number of entries (cards outside a group, and groups) changed. */
  columns: string[];
  /** Cards and groups whose vote total changed. */
  voteTotals: string[];
}

export const NO_MOTION: SessionMotion = Object.freeze({
  arrivedCards: [],
  ownCards: [],
  revealedCards: [],
  reactions: [],
  columns: [],
  voteTotals: [],
}) as SessionMotion;

const listOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const countOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** Entries a column shows: its cards outside a group, and its groups. */
const columnCounts = (tickets: Ticket[], groups: Group[]): Map<string, number> => {
  const counts = new Map<string, number>();
  const add = (colId: unknown) => {
    if (typeof colId === 'string') counts.set(colId, (counts.get(colId) ?? 0) + 1);
  };
  for (const ticket of tickets) if (!ticket.groupId) add(ticket.colId);
  for (const group of groups) add(group.colId);
  return counts;
};

/**
 * The events between two states of one session in one phase. A first state, a
 * switch of session and a phase change are none: the board is drawn again, and
 * nothing on it is news.
 */
export function diffSessionMotion(
  prev: RetroSession | undefined | null,
  next: RetroSession | undefined | null,
  context: SessionMotionContext,
): SessionMotion {
  if (!prev || !next || prev.id !== next.id || prev.phase !== next.phase) return NO_MOTION;

  const prevTickets = listOf<Ticket>(prev.tickets);
  const nextTickets = listOf<Ticket>(next.tickets);
  const prevGroups = listOf<Group>(prev.groups);
  const nextGroups = listOf<Group>(next.groups);
  const before = new Map(prevTickets.map((ticket) => [ticket.id, ticket]));

  const fresh = nextTickets.filter((ticket) => !before.has(ticket.id));
  const ownCards = fresh.filter((ticket) => context.ownPendingIds.has(ticket.id)).map((ticket) => ticket.id);
  const others = fresh.filter((ticket) => !context.ownPendingIds.has(ticket.id)).map((ticket) => ticket.id);
  const arrivedCards = others.length > MAX_CARD_BURST ? [] : others;

  const wasHidden = !prev.settings?.revealBrainstorm;
  const isShown = !!next.settings?.revealBrainstorm;
  const revealedCards =
    wasHidden && isShown && HIDING_PHASES.has(next.phase)
      ? nextTickets.filter((ticket) => before.has(ticket.id) && ticket.authorId !== context.viewerId).map((ticket) => ticket.id)
      : [];

  const reactions: string[] = [];
  const voteTotals: string[] = [];
  for (const ticket of nextTickets) {
    const earlier = before.get(ticket.id);
    if (!earlier) continue;
    if (countOf(ticket.votes) !== countOf(earlier.votes)) voteTotals.push(ticket.id);
    const now = ticket.reactions && typeof ticket.reactions === 'object' ? ticket.reactions : {};
    const then: Record<string, unknown> = earlier.reactions && typeof earlier.reactions === 'object' ? earlier.reactions : {};
    for (const emoji of Object.keys(now)) {
      const had = Object.prototype.hasOwnProperty.call(then, emoji) ? countOf(then[emoji]) : 0;
      if (countOf(now[emoji]) > had) reactions.push(`${ticket.id}:${emoji}`);
    }
  }
  const groupsBefore = new Map(prevGroups.map((group) => [group.id, group]));
  for (const group of nextGroups) {
    const earlier = groupsBefore.get(group.id);
    if (earlier && countOf(group.votes) !== countOf(earlier.votes)) voteTotals.push(group.id);
  }

  const countsBefore = columnCounts(prevTickets, prevGroups);
  const countsNow = columnCounts(nextTickets, nextGroups);
  const columns = [...new Set([...countsBefore.keys(), ...countsNow.keys()])].filter(
    (colId) => (countsBefore.get(colId) ?? 0) !== (countsNow.get(colId) ?? 0),
  );

  // Who finished is the participants panel's to show (usePanelMotion): read
  // here as an event, it made a state that only said "someone is done" look
  // like news for the board, which then searched the page for nothing.
  if (!arrivedCards.length && !ownCards.length && !revealedCards.length && !reactions.length && !columns.length && !voteTotals.length) {
    return NO_MOTION;
  }
  return { arrivedCards, ownCards, revealedCards, reactions, columns, voteTotals };
}

/**
 * The people of a list who were not in it before. `previous` is `null` the
 * first time the list is known: nobody arrives then.
 */
export function arrivedPeople(previous: readonly string[] | null, current: readonly string[]): string[] {
  if (previous === null) return [];
  const known = new Set(previous);
  const arrived = current.filter((id) => !known.has(id));
  return arrived.length > MAX_PEOPLE_BURST ? [] : arrived;
}

/**
 * The delay of each of `count` items that appear one after another: `step`
 * milliseconds apart, compressed so the last one never waits longer than `cap`
 * (a hundred cards shown at 80 ms each would take eight seconds).
 */
export function staggerDelays(count: number, step: number, cap: number): number[] {
  if (count <= 0) return [];
  const spacing = count > 1 ? Math.min(step, cap / (count - 1)) : 0;
  return Array.from({ length: count }, (_, index) => Math.round(index * spacing));
}

export interface BoxLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlightPath {
  from: { x: number; y: number };
  via: { x: number; y: number };
  to: { x: number; y: number };
}

const centreOf = (box: BoxLike) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

const inWindow = (point: { x: number; y: number }, viewport: { width: number; height: number }) =>
  point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height;

/**
 * The trip of a decorative token from one box to another: centre to centre,
 * its middle lifted by `arc` pixels. `null` when an end is missing, has no
 * size (it is not drawn) or lies outside the window: nothing flies then.
 */
export function flightPath(
  from: BoxLike | null | undefined,
  to: BoxLike | null | undefined,
  viewport: { width: number; height: number },
  arc = 40,
): FlightPath | null {
  if (!from || !to) return null;
  if (!(from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0)) return null;
  const start = centreOf(from);
  const end = centreOf(to);
  if (!inWindow(start, viewport) || !inWindow(end, viewport)) return null;
  return {
    from: start,
    via: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - arc },
    to: end,
  };
}
