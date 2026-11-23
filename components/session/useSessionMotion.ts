import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { RetroSession } from '../../types';
import { motionAllowed, playEffect } from '../common/motion/effects';
import { NO_MOTION, QUIET_AFTER_LIVE_MS, diffSessionMotion, staggerDelays, type SessionMotion } from '../../utils/sessionMotion';

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
 * It stays quiet while the connection is down, and nothing is compared before
 * the server's first state since the session was last live is applied
 * (`ready`): the screen is drawn first from the team cache, which lags the
 * session row, and after a reconnection from the state of before the outage;
 * the snapshot that comes back can land seconds later (a rolling update
 * reconnects everybody, and a pod that starts cold answers late), and its
 * differences from that seed are no news. The three quiet seconds open when it
 * lands, and also follow the viewer's own reconnection.
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

/** How long the board stays quiet after the viewer's connection comes back (ms): the panel's seconds too. */
export const RECONNECT_QUIET_MS = QUIET_AFTER_LIVE_MS;
/** Hidden cards being shown start this far apart (ms)... */
export const REVEAL_STEP_MS = 80;
/** ...and the last one starts within this (ms). */
export const REVEAL_CAP_MS = 600;
/**
 * At most this many cards are unblurred at once, of those in the window. The
 * reveal is the one effect that grows with the board: a blur and a fade on
 * every hidden card, hundreds on a board kept for weeks, most of them far
 * below the screen. A card outside the window, or past this number, is simply
 * shown, as it is to a reader who asked for less motion.
 */
export const MAX_REVEALED_AT_ONCE = 60;

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
  /**
   * The server's first state since the session was last live has been
   * applied: the screen puts it down when the session stops being live. Before
   * it the screen shows a seed (the cache, or the state of before the outage),
   * never compared with what follows; the quiet seconds open when it turns true.
   */
  ready: boolean;
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

/** Whether any of an element's box is inside the window. An element that cannot be measured counts as in. */
const inWindow = (element: Element): boolean => {
  try {
    const box = element.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    return box.bottom >= 0 && box.right >= 0 && box.top <= height && box.left <= width;
  } catch {
    return true;
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
 * Whose vote totals may be marked: only where the screen draws a vote. The
 * guided Vote phase and the open board draw one on a card or a group, but a
 * board whose voting is off and whose counts are hidden draws none, the
 * viewer's own included (Session.tsx → showsBoardVotes, showsGroupVotes).
 * Where none is drawn, a ring would say that an item holds votes the screen
 * keeps hidden: a regrouping carries a card's votes into its group
 * (combineVotes), in the Group phase and on such a board alike, and a lowered
 * number takes some back (capVotes). The guided Vote phase keeps everyone's
 * votes to itself, and so does a board whose counts are hidden: a ring there
 * on a teammate's vote would say where it went. Only the viewer's own votes
 * move then. Neither screen draws a vote on a card inside a group (every vote
 * control of the card is drawn only when it is not grouped): its votes are its
 * group's, and a card that joins one hands them over, so its own total drops
 * while nothing on it shows a vote.
 */
const visibleVoteChanges = (motion: SessionMotion, prev: RetroSession, next: RetroSession, viewerId: string): string[] => {
  if (next.phase !== 'VOTE' && next.phase !== 'OPEN_BOARD') return [];
  if (next.phase === 'OPEN_BOARD' && !!next.settings?.votingDisabled && !!next.settings?.voteCountHidden) return [];
  const grouped = new Set(
    (Array.isArray(next.tickets) ? next.tickets : [])
      .filter((ticket) => !!ticket && typeof ticket === 'object' && !!ticket.groupId)
      .map((ticket) => ticket.id),
  );
  const drawn = motion.voteTotals.filter((id) => !grouped.has(id));
  const totalsHidden = next.phase === 'VOTE' || !!next.settings?.voteCountHidden;
  if (!totalsHidden) return drawn;
  const itemsOf = (session: RetroSession) =>
    new Map<string, unknown>([
      ...(Array.isArray(session.tickets) ? session.tickets : []).map((ticket) => [ticket.id, ticket.votes] as [string, unknown]),
      ...(Array.isArray(session.groups) ? session.groups : []).map((group) => [group.id, group.votes] as [string, unknown]),
    ]);
  const before = itemsOf(prev);
  const after = itemsOf(next);
  return drawn.filter((id) => votesOf(before.get(id), viewerId) !== votesOf(after.get(id), viewerId));
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

  // Measured before any effect is put on: a class written first would have
  // the browser lay the page out again for each box read after it.
  const shown: Element[] = [];
  for (const id of motion.revealedCards) {
    if (shown.length >= MAX_REVEALED_AT_ONCE) break;
    const card = first(cards, id);
    if (!card || !inWindow(card)) continue;
    const text = partOf(card, CARD_TEXT_SELECTOR);
    if (text) shown.push(text);
  }

  for (const id of [...motion.arrivedCards, ...motion.ownCards]) {
    const card = first(cards, id);
    if (!card) continue;
    playEffect(card, 'fx-card-in');
    playEffect(card, 'fx-ring', ringOptions(card));
  }

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

interface Shown {
  session: RetroSession | null;
  wasLive: boolean;
  wasReady: boolean;
  quietUntil: number;
}

export function useSessionMotion({ session, viewerId, ownPendingIds, isLive, ready, root, heldVotes }: SessionMotionInput): void {
  const shown = useRef<Shown>({ session: null, wasLive: false, wasReady: false, quietUntil: 0 });

  useLayoutEffect(() => {
    const state = shown.current;
    const now = Date.now();
    if (isLive && !state.wasLive) state.quietUntil = now + RECONNECT_QUIET_MS;
    if (ready && !state.wasReady) state.quietUntil = Math.max(state.quietUntil, now + RECONNECT_QUIET_MS);
    state.wasLive = isLive;
    // The seed shown before the server's first state is never a "before".
    const prev = state.wasReady ? state.session : null;
    state.wasReady = ready;
    const next = session ?? null;
    state.session = next;

    if (!isLive || now < state.quietUntil || !prev || !next || prev === next) return;
    // Read before the comparison: a reader who wants no motion costs nothing.
    if (!motionAllowed()) return;
    try {
      // A burst of new cards is no motion either (MAX_CARD_BURST, in the
      // diff): a healed state, a restore, a return after minutes away.
      const motion = diffSessionMotion(prev, next, { viewerId, ownPendingIds: toSet(ownPendingIds()) });
      if (motion === NO_MOTION) return;
      playSessionMotion(root?.current ?? document, motion, prev, next, viewerId, heldVotes?.());
    } catch {
      // Decoration: a malformed state never breaks the screen.
    }
  }, [session, isLive, ready, viewerId, ownPendingIds, root, heldVotes]);
}
