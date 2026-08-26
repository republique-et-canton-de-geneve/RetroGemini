import { describe, it, expect } from 'vitest';
import {
  TOUCH_SLOP_PX,
  claimGesture,
  endGesture,
  idleGesture,
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
