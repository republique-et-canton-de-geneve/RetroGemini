import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { RetroSession } from '../../types';
import { motionAllowed, playEffect } from '../common/motion/effects';
import { MAX_CARD_BURST, NO_MOTION, diffSessionMotion, staggerDelays, type SessionMotion } from '../../utils/sessionMotion';

/**
 * Plays the board's effects for what just happened in a session: a card that
 * arrives, cards being shown, a reaction, a column's count, a vote.
 *
 * What happened is read from two states (`utils/sessionMotion.ts`), never from
 * an element appearing: a phase change remounts the whole board and a card
 * remounts when it changes group or column. The comparison runs in a layout
 * effect, after every commit and before paint, and the effects are put on the
 * elements by their data attributes (`MOTION_HOOKS`), so the screen renders
 * nothing more for them and keeps no state.
 *
 * It stays quiet while the connection is down and for three seconds after the
 * viewer's own (re)connection: a rolling update reconnects everybody, and the
 * snapshot that comes back is no news.
 */

/** The data attributes the board carries for its effects. One table, so the markup and this hook agree. */
export const MOTION_HOOKS = Object.freeze({
  /** A card's root: the card's id. */
  card: 'data-ticket-id',
  /** A group's container: the group's id. */
  group: 'data-group-id',
  /** The number of entries a column shows in its head: the column's id. */
  columnCount: 'data-column-count',
  /** A reaction chip of a card: its emoji. */
  reaction: 'data-reaction',
  /** The vote number a card's or group's control shows this viewer (no value). */
  voteCount: 'data-vote-count',
});

/** A card's words, inside its root (kept on that element: tests and the reveal read it). */
export const CARD_TEXT_SELECTOR = '.whitespace-pre-wrap';

/** How long the board stays quiet after the viewer's connection comes back (ms). */
export const RECONNECT_QUIET_MS = 3000;
/** Hidden cards being shown start this far apart (ms)... */
export const REVEAL_STEP_MS = 80;
/** ...and the last one starts within this (ms). */
export const REVEAL_CAP_MS = 600;

/** Ids of the cards this client created and the server has not confirmed: a set, or the session's map of them. */
type PendingIds = ReadonlySet<string> | ReadonlyMap<string, unknown>;

export interface SessionMotionInput {
  session: RetroSession | null | undefined;
  /** The person looking at the screen. */
  viewerId: string;
  /** Read only when two states are compared, so a ref's current value is fine. */
  ownPendingIds: () => PendingIds;
  /** The session is connected and receiving. */
  isLive: boolean;
  /** Where the board lies; the whole document when absent. */
  root?: RefObject<HTMLElement | null>;
  /**
   * Cards and groups whose own vote a flight is carrying right now: the screen
   * plays their marks where the token lands (`playLandedVote`), so a ring does
   * not close on the card while the token is still on its way.
   */
  heldVotes?: () => ReadonlySet<string>;
}

const toSet = (ids: PendingIds): ReadonlySet<string> => (ids instanceof Set ? ids : new Set((ids as ReadonlyMap<string, unknown>).keys()));

/** The elements carrying `attribute`, by its value (ids are compared, never put in a selector). */
const indexBy = (root: Document | Element, attribute: string): Map<string, Element[]> => {
  const index = new Map<string, Element[]>();
  for (const element of root.querySelectorAll(`[${attribute}]`)) {
    const value = element.getAttribute(attribute) ?? '';
    const list = index.get(value);
    if (list) list.push(element);
    else index.set(value, [element]);
  }
  return index;
};

/** The item (card or group) an element belongs to. */
const ownerOf = (element: Element): Element | null => element.closest(`[${MOTION_HOOKS.card}], [${MOTION_HOOKS.group}]`);

/** The first descendant of an item that matches and belongs to that item, not to a card nested in it. */
const partOf = (item: Element, selector: string): Element | null => {
  for (const element of item.querySelectorAll(selector)) if (ownerOf(element) === item) return element;
  return null;
};

const TRANSPARENT = /^(?:transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/i;

/** The ring takes the item's border colour, so it closes onto that border. */
const ringOptions = (item: Element) => {
  try {
    const colour = (item as HTMLElement).style?.borderColor || getComputedStyle(item).borderTopColor;
    return colour && !TRANSPARENT.test(colour.trim()) ? { properties: { '--fx-ring': colour } } : {};
  } catch {
    return {};
  }
};

const votesOf = (votes: unknown, voterId: string): number =>
  Array.isArray(votes) ? votes.filter((id) => id === voterId).length : 0;

const reactionCount = (session: RetroSession, ticketId: string, emoji: string): number => {
  const ticket = Array.isArray(session.tickets) ? session.tickets.find((entry) => entry.id === ticketId) : undefined;
  const users = ticket?.reactions && typeof ticket.reactions === 'object' ? (ticket.reactions as Record<string, unknown>)[emoji] : undefined;
  return Array.isArray(users) ? users.length : 0;
};

/**
 * Whose vote totals may be marked. The guided Vote phase keeps everyone's
 * votes to itself, and so does a board whose counts are hidden: a ring there
 * on a teammate's vote would say where it went. Only the viewer's own votes
 * move then.
 */
const visibleVoteChanges = (motion: SessionMotion, prev: RetroSession, next: RetroSession, viewerId: string): string[] => {
  const totalsHidden = next.phase === 'VOTE' || (next.phase === 'OPEN_BOARD' && !!next.settings?.voteCountHidden);
  if (!totalsHidden) return motion.voteTotals;
  const itemsOf = (session: RetroSession) =>
    new Map<string, unknown>([
      ...(Array.isArray(session.tickets) ? session.tickets : []).map((ticket) => [ticket.id, ticket.votes] as [string, unknown]),
      ...(Array.isArray(session.groups) ? session.groups : []).map((group) => [group.id, group.votes] as [string, unknown]),
    ]);
  const before = itemsOf(prev);
  const after = itemsOf(next);
  return motion.voteTotals.filter((id) => votesOf(before.get(id), viewerId) !== votesOf(after.get(id), viewerId));
};

/** The card or group of this id under `root` (ids are compared, never put in a selector). */
const itemOf = (root: Document | Element, id: string): Element | null =>
  indexBy(root, MOTION_HOOKS.card).get(id)?.[0] ?? indexBy(root, MOTION_HOOKS.group).get(id)?.[0] ?? null;

/**
 * A vote of the viewer's has landed on a card or a group, carried by a
 * flight: the dot it added springs in (a count with no dot to show, past the
 * dots a control draws, bumps) and a ring closes on the item. Answers whether
 * the item was found.
 */
export function playLandedVote(root: Document | Element, itemId: string): boolean {
  const target = voteTargetOf(root, itemId);
  if (!target) return false;
  if (target.dot) playEffect(target.dot, 'fx-pop');
  else playEffect(target.count, 'fx-bump');
  playEffect(target.item, 'fx-ring', ringOptions(target.item));
  return true;
}

/**
 * Where a vote lands on a card or a group: the item, the vote count its
 * control shows the viewer, and that count's last dot (a dot is an empty
 * element; the number drawn past the dots is not one).
 */
export function voteTargetOf(root: Document | Element, itemId: string): { item: Element; count: Element | null; dot: Element | null } | null {
  const item = itemOf(root, itemId);
  if (!item) return null;
  const count = partOf(item, `[${MOTION_HOOKS.voteCount}]`);
  const last = count?.lastElementChild ?? null;
  return { item, count, dot: last && !last.textContent ? last : null };
}

/** Puts each effect of `motion` on its element under `root`. Exported for the tests. */
export function playSessionMotion(
  root: Document | Element,
  motion: SessionMotion,
  prev: RetroSession,
  next: RetroSession,
  viewerId: string,
  heldVotes: ReadonlySet<string> = new Set(),
): void {
  const cards = indexBy(root, MOTION_HOOKS.card);
  const groups = indexBy(root, MOTION_HOOKS.group);
  const first = (index: Map<string, Element[]>, id: string) => index.get(id)?.[0] ?? null;

  for (const id of [...motion.arrivedCards, ...motion.ownCards]) {
    const card = first(cards, id);
    if (!card) continue;
    playEffect(card, 'fx-card-in');
    playEffect(card, 'fx-ring', ringOptions(card));
  }

  const shown = motion.revealedCards
    .map((id) => first(cards, id))
    .map((card) => (card ? partOf(card, CARD_TEXT_SELECTOR) : null))
    .filter((text): text is Element => !!text);
  staggerDelays(shown.length, REVEAL_STEP_MS, REVEAL_CAP_MS).forEach((delay, index) => {
    playEffect(shown[index], 'fx-reveal', { properties: { '--fx-delay': `${delay}ms` } });
  });

  for (const key of motion.reactions) {
    const split = key.lastIndexOf(':');
    const ticketId = key.slice(0, split);
    const emoji = key.slice(split + 1);
    const card = first(cards, ticketId);
    if (!card) continue;
    const chip = [...card.querySelectorAll(`[${MOTION_HOOKS.reaction}]`)].find(
      (element) => element.getAttribute(MOTION_HOOKS.reaction) === emoji && ownerOf(element) === card,
    );
    // A new reaction springs in; one that gained a person answers with a bump.
    playEffect(chip, reactionCount(prev, ticketId, emoji) > 0 ? 'fx-bump' : 'fx-pop');
  }

  if (motion.columns.length) {
    const counts = indexBy(root, MOTION_HOOKS.columnCount);
    for (const colId of motion.columns) playEffect(first(counts, colId), 'fx-bump');
  }

  for (const id of visibleVoteChanges(motion, prev, next, viewerId)) {
    if (heldVotes.has(id)) continue;
    const item = first(cards, id) ?? first(groups, id);
    if (!item) continue;
    playEffect(partOf(item, `[${MOTION_HOOKS.voteCount}]`), 'fx-bump');
    playEffect(item, 'fx-ring', ringOptions(item));
  }
}

/**
 * More new cards at once than a burst is not people writing (a healed state, a
 * restore, a return after minutes away): the diff already keeps those cards
 * still, and nothing else that came with them moves either.
 */
const isBurst = (prev: RetroSession, next: RetroSession): boolean => {
  if (!Array.isArray(next.tickets)) return false;
  const known = new Set((Array.isArray(prev.tickets) ? prev.tickets : []).map((ticket) => ticket.id));
  return next.tickets.filter((ticket) => !known.has(ticket.id)).length > MAX_CARD_BURST;
};

interface Shown {
  session: RetroSession | null;
  wasLive: boolean;
  quietUntil: number;
}

export function useSessionMotion({ session, viewerId, ownPendingIds, isLive, root, heldVotes }: SessionMotionInput): void {
  const shown = useRef<Shown>({ session: null, wasLive: false, quietUntil: 0 });

  useLayoutEffect(() => {
    const state = shown.current;
    const now = Date.now();
    if (isLive && !state.wasLive) state.quietUntil = now + RECONNECT_QUIET_MS;
    state.wasLive = isLive;
    const prev = state.session;
    const next = session ?? null;
    state.session = next;

    if (!isLive || now < state.quietUntil || !prev || !next || prev === next) return;
    // Read before the comparison: a reader who wants no motion costs nothing.
    if (!motionAllowed()) return;
    try {
      const motion = diffSessionMotion(prev, next, { viewerId, ownPendingIds: toSet(ownPendingIds()) });
      if (motion === NO_MOTION || isBurst(prev, next)) return;
      playSessionMotion(root?.current ?? document, motion, prev, next, viewerId, heldVotes?.());
    } catch {
      // Decoration: a malformed state never breaks the screen.
    }
  }, [session, isLive, viewerId, ownPendingIds, root, heldVotes]);
}
