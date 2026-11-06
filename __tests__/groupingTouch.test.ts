import { describe, it, expect } from 'vitest';
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  TAP_MOUSE_MS,
  TOUCH_SLOP_PX,
  claimGesture,
  endGesture,
  idleGesture,
  isNearAim,
  isNextTap,
  isTapMouse,
  moveGesture,
  startGesture,
} from '../components/session/groupingTouch';

/**
 * The Group phase's touch gesture (Codex, PR #436).
 *
 * Tap-to-group predates the keyboard work and was never tested. The ticket card
 * grew a movement threshold so a scroll would not group two cards; the group
 * *container* never did — it carried a bare `onTouchEnd`. Touch events bubble,
 * so that gap defeated the card's own guard: a swipe that started on a ticket
 * inside a group was correctly ignored by the ticket and then acted on by its
 * parent, and a plain tap on a ticket inside a group fired **both**.
 *
 * The rule these functions encode is one sentence: **one gesture drops the held
 * card at most once, and only if the finger stayed put.** The state lives in a
 * plain mutable object rather than in React state because a gesture spans three
 * events within one frame — a `useState` update would not be visible to the
 * `touchend` that follows the `touchmove` that set it.
 */

const point = (x: number, y: number) => ({ x, y });

describe('a grouping touch gesture', () => {
  it('is not droppable before it has begun', () => {
    expect(claimGesture(idleGesture())).toBe(false);
  });

  it('is droppable after a still tap', () => {
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));

    expect(claimGesture(gesture)).toBe(true);
  });

  it('tolerates the small movement every real finger makes', () => {
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));
    moveGesture(gesture, point(10 + TOUCH_SLOP_PX - 1, 10));

    expect(claimGesture(gesture)).toBe(true);
  });

  it('refuses once the finger has travelled past the threshold — that is a scroll', () => {
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));
    moveGesture(gesture, point(10, 10 + TOUCH_SLOP_PX + 1));

    expect(claimGesture(gesture)).toBe(false);
  });

  it('stays refused even if the finger comes back to where it started', () => {
    // A scroll that returns to its origin is still a scroll, not a tap.
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));
    moveGesture(gesture, point(10, 200));
    moveGesture(gesture, point(10, 10));

    expect(claimGesture(gesture)).toBe(false);
  });

  it('can be claimed only once, so a bubbling event cannot act twice', () => {
    // This is the defect: the ticket handler runs, then the same touchend
    // bubbles to the group container, which used to drop the card again.
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));

    expect(claimGesture(gesture)).toBe(true);
    expect(claimGesture(gesture)).toBe(false);
  });

  it('keeps the origin of whichever handler saw the gesture first', () => {
    // Touch events bubble, so the innermost element starts the gesture and the
    // container must not restart it with a second, identical touchstart.
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));
    startGesture(gesture, point(999, 999));
    moveGesture(gesture, point(20, 10));

    expect(claimGesture(gesture)).toBe(false);
  });

  it('is reusable: ending it lets the next gesture start clean', () => {
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));
    moveGesture(gesture, point(10, 200));
    endGesture(gesture);

    startGesture(gesture, point(50, 50));
    expect(claimGesture(gesture)).toBe(true);
  });

  it('treats a cancelled gesture as no gesture at all', () => {
    const gesture = idleGesture();
    startGesture(gesture, point(10, 10));
    endGesture(gesture);

    expect(claimGesture(gesture)).toBe(false);
  });
});

// Review finding (pass 12 of 42.1): the next tap of a double tap, once the
// first closed an editor, acted on the card that grew back under the finger.
describe('the next tap of a double tap', () => {
  const first = { at: 1000, x: 50, y: 50 };

  it('is a tap this soon after the first, this near it', () => {
    expect(isNextTap(first, 1000, point(50, 50))).toBe(true);
    expect(isNextTap(first, 1000 + DOUBLE_TAP_MS, point(50 + DOUBLE_TAP_SLOP_PX, 50))).toBe(true);
  });

  it('is no longer one later, or further away', () => {
    expect(isNextTap(first, 1001 + DOUBLE_TAP_MS, point(50, 50))).toBe(false);
    expect(isNextTap(first, 1000, point(50 + DOUBLE_TAP_SLOP_PX, 51))).toBe(false);
    expect(isNextTap(first, 1000, point(50, 50 - DOUBLE_TAP_SLOP_PX - 1))).toBe(false);
  });

  it('follows no tap at all, nor one that came after it', () => {
    expect(isNextTap(null, 1000, point(50, 50))).toBe(false);
    expect(isNextTap(first, 999, point(50, 50))).toBe(false);
  });

  // Review finding (pass 13 of 42.1): what the documentation says, in its
  // own numbers — half a second, a fingertip — and in every direction.
  it('lasts half a second, and reaches a fingertip away in any direction', () => {
    expect(isNextTap(first, 1450, point(50, 50))).toBe(true);
    expect(isNextTap(first, 1500, point(50, 50))).toBe(true);
    expect(isNextTap(first, 1501, point(50, 50))).toBe(false);
    // 17.7 px on the diagonal, inside 24; 25.5 px outside it.
    expect(isNextTap(first, 1000, point(63, 62))).toBe(true);
    expect(isNextTap(first, 1000, point(68, 68))).toBe(false);
  });
});

// Review finding (pass 14 of 42.1): a browser counts each tap from the one
// before, and further than a fingertip; the board's place is the first's.
describe('a fingertip from where the sequence first aimed', () => {
  const first = { at: 1000, x: 50, y: 50 };

  it('reaches a fingertip away in any direction, whenever', () => {
    expect(isNearAim(first, point(50, 50))).toBe(true);
    expect(isNearAim(first, point(50 + DOUBLE_TAP_SLOP_PX, 50))).toBe(true);
    expect(isNearAim(first, point(63, 62))).toBe(true);
  });

  it('reaches no further, and from no aim at all', () => {
    expect(isNearAim(first, point(50 + DOUBLE_TAP_SLOP_PX, 51))).toBe(false);
    expect(isNearAim(first, point(68, 68))).toBe(false);
    expect(isNearAim(first, point(90, 50))).toBe(false);
    expect(isNearAim(null, point(50, 50))).toBe(false);
  });
});

// Review finding (pass 13 of 42.1): the mouse a browser emulates for a tap
// says nothing of the board's half second, and is told from the mouse itself
// by the touchend that comes just before it.
describe('the mouse a browser emulates for a tap', () => {
  it('comes right after the tap\u2019s touchend', () => {
    expect(isTapMouse(1000, 1000)).toBe(true);
    expect(isTapMouse(1000, 1000 + TAP_MOUSE_MS)).toBe(true);
    expect(TAP_MOUSE_MS).toBe(500);
  });

  it('is not the mouse of a tap that ended longer ago, after it, or of none', () => {
    expect(isTapMouse(1000, 1001 + TAP_MOUSE_MS)).toBe(false);
    expect(isTapMouse(1000, 999)).toBe(false);
    expect(isTapMouse(null, 1000)).toBe(false);
    // Event times count from the page's load: no touch, no tap, from its start.
    expect(isTapMouse(null, 0)).toBe(false);
  });
});
