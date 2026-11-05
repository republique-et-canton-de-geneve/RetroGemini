/**
 * The Group phase's tap-to-group gesture (audit H42 follow-up, Codex on PR #436).
 *
 * Tap-to-group is the oldest interaction in this phase and it had no test. The
 * ticket card carried a movement threshold so that scrolling the board would not
 * silently group two cards; the group *container* carried a bare `onTouchEnd`
 * with no threshold and no matching `touchstart`. Touch events bubble, so that
 * gap did not merely leave the container unguarded — it **defeated the card's
 * own guard**: a swipe beginning on a ticket inside a group was correctly
 * ignored by the ticket and then acted on by its parent, and a plain tap on such
 * a ticket fired both handlers.
 *
 * One sentence covers both defects: **one gesture drops the held card at most
 * once, and only if the finger stayed put.**
 *
 * The state is a plain mutable object held in a ref, not React state, and that
 * is load-bearing: a gesture spans `touchstart`, `touchmove` and `touchend`
 * inside a single frame, so a `useState` update made by the move would not be
 * visible to the end — which is the shape of bug this module exists to remove.
 */

/**
 * How far a finger may travel and still count as a tap.
 *
 * Eight pixels is what the ticket card already used. It is above the jitter a
 * real finger produces on a phone and well below a deliberate scroll.
 */
export const TOUCH_SLOP_PX = 8;

export type TouchPoint = { x: number; y: number };

export type GroupingGesture = {
  /** Where the finger landed, or `null` when no gesture is in flight. */
  origin: TouchPoint | null;
  /** Set once the finger has travelled past the slop; never unset mid-gesture. */
  moved: boolean;
  /** Set once some handler has acted on this gesture. */
  claimed: boolean;
};

export const idleGesture = (): GroupingGesture => ({ origin: null, moved: false, claimed: false });

/**
 * Begin a gesture, unless one is already in flight.
 *
 * The guard is the whole point: touch events bubble from the innermost element
 * outwards, so a tap on a ticket inside a group reaches the ticket's
 * `touchstart` first and the container's immediately after. Without this, the
 * container would restart the gesture from its own (identical) coordinates and
 * clear a `moved` flag the descendant had already set.
 */
export const startGesture = (gesture: GroupingGesture, point: TouchPoint): void => {
  if (gesture.origin) return;
  gesture.origin = { x: point.x, y: point.y };
  gesture.moved = false;
  gesture.claimed = false;
};

/**
 * Record travel. Once a gesture has moved it stays moved for its whole life:
 * a scroll that happens to end where it started is still a scroll, not a tap.
 */
export const moveGesture = (gesture: GroupingGesture, point: TouchPoint): void => {
  if (!gesture.origin || gesture.moved) return;
  const dx = point.x - gesture.origin.x;
  const dy = point.y - gesture.origin.y;
  if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) gesture.moved = true;
};

/**
 * Ask to act on this gesture. Answers `true` at most once, and only for a
 * gesture that began and stayed still.
 *
 * Callers must treat a `false` as "do nothing", not as "try again": the first
 * caller to get `true` owns the gesture, which is what stops a bubbling
 * `touchend` from grouping a card *and* dropping it into the enclosing group.
 */
export const claimGesture = (gesture: GroupingGesture): boolean => {
  if (!gesture.origin || gesture.moved || gesture.claimed) return false;
  gesture.claimed = true;
  return true;
};

/**
 * The next tap of a double tap: this soon after the one before, this near it
 * (pass 12 of 42.1). Once the first tap closed an editor, the card grew back
 * under the finger, and what the next tap reaches is not what the first one
 * aimed at — it grouped that card with the one the first tap picked up.
 *
 * Half a second, as a mouse's double click allows, and a fingertip: what lies
 * that close under the finger that soon was never aimed at once the board
 * moved there, so the window can be generous without taking a real tap.
 */
export const DOUBLE_TAP_MS = 500;
export const DOUBLE_TAP_SLOP_PX = 24;

/**
 * Where and when a gesture aimed. A tap that does nothing still belongs to the
 * sequence (pass 13 of 42.1): `at` moves to it, as a browser counts its taps
 * each from the one before, while the place stays the first's. Measured from
 * the first tap only, the third tap of a triple tap at an ordinary pace fell
 * past half a second and grouped the card that grew back.
 */
export type GestureAim = TouchPoint & { at: number };

export const isNextTap = (first: GestureAim | null, at: number, point: TouchPoint): boolean =>
  !!first
  && at >= first.at
  && at - first.at <= DOUBLE_TAP_MS
  && Math.hypot(point.x - first.x, point.y - first.y) <= DOUBLE_TAP_SLOP_PX;

/**
 * The mouse a browser emulates for a tap comes right after that tap's
 * `touchend` — Chromium stamps it with the touchend's own time, a browser that
 * waits to tell a tap from a double tap sends it later — and is how a tap on a
 * control reaches the board (pass 13 of 42.1). It says the tap is the next of
 * a double tap (its `detail`) only within the browser's own time, about 400 ms
 * in Chromium and 300 on Android: the comments or the Delete of the card that
 * grew back were pressed by a second tap the board's half second would have
 * stopped. The touchend just before it tells it from the mouse itself.
 */
export const TAP_MOUSE_MS = 500;

export const isTapMouse = (touchEndAt: number | null, at: number): boolean =>
  touchEndAt !== null && at >= touchEndAt && at - touchEndAt <= TAP_MOUSE_MS;

/** Forget the gesture — on `touchend`, and on `touchcancel`. */
export const endGesture = (gesture: GroupingGesture): void => {
  gesture.origin = null;
  gesture.moved = false;
  gesture.claimed = false;
};
