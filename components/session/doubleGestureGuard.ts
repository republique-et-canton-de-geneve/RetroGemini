import { useEffect, useRef, type MutableRefObject } from 'react';
import { isNearAim, isNextTap, isTapMouse, type GestureAim } from './groupingTouch';

/**
 * The next press of a double click, and the next tap of a double tap, press
 * nothing on another control than the first pressed (AGENTS.md → Accessibility,
 * the press paragraph). Both session types mount this guard (useDoubleGestureGuard):
 * a behaviour both have is written once. The retrospective adds what only it
 * has — the card editor that closes under the pointer, the taps the board
 * claims — through the state the guard keeps.
 */

export const CONTROL_SELECTOR = 'button, a[href], input, textarea, select, label, summary, [role="button"]';
/** What a press of the mouse presses: the control around its target, or the target itself. */
export const pressedControl = (target: Element | null) => target?.closest(CONTROL_SELECTOR) ?? target;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
/**
 * A field a press puts the caret in — or, the next of a double click, selects
 * a word of, and a triple click its whole text, for the next keystroke to
 * replace. It is the next press's own only where the first pressed text that
 * became that field (guardsPress): a proposal's text opens its field where the
 * text was, and a double click there selects a word as it always did.
 */
export const isTextField = (target: Element | null) =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type));

/**
 * Where and when the gesture before aimed, and what it pressed: the control
 * around its target (key), what lay under the pointer there (under), and where
 * that control was drawn (box). For a tap the board claims, key is its card or
 * group and under what the finger reached in it. relaid: that tap was on a
 * card, which it picked up or put down, and drew again around the finger (its
 * "Selected" banner pushed its content down) — a group's ring moves nothing.
 */
export type GuardAim = GestureAim & { key: Element | null; under: Element | null; box?: Box | null; relaid?: boolean };
type Box = { left: number; top: number; width: number; height: number };
export const boxOf = (element: Element | null): Box | null => {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
// Moved or resized by more than this, the control is not where the press found it.
const SHIFT_PX = 2;

export interface GestureGuardState {
  aim: GuardAim | null;
  // What lies under the pointer moved after that gesture aimed: an editor
  // closed — at its press's end, by its click's write, or by ending a press
  // before it, at its own mousedown — and the card grew back ('editor'); or
  // the gesture's own act moved it: the control it pressed went with its
  // click (aimLeftPage), or the tap put down what was held, and the board was
  // laid out again under the finger ('act').
  boardMoved: 'editor' | 'act' | null;
  // When the touch of the last tap began: a browser counts the next tap of a
  // double tap from the lift before it to that touch.
  tapStartedAt: number | null;
  // When the last touch ended: the mouse a browser emulates for a tap follows
  // it (isTapMouse).
  touchEndAt: number | null;
  // A press that presses nothing: its click clicks nothing either.
  stopped: boolean;
}

/**
 * The control a press aimed at went with its own click: a Delete that asks
 * nothing with its card, its group, its comment, its proposal, its column; the
 * picker's emoji with the picker; a reaction badge with the last reaction to
 * it; an editor's Cancel or Save with its editor; a follow-up's Accept with
 * its row (passes 14 to 16 of 42.1). A press on text that becomes a field (a
 * proposal's) is not one: the field comes where the text was.
 */
export const aimLeftPage = (aim: GuardAim | null) =>
  !!aim?.key && !aim.key.isConnected && aim.key.matches(CONTROL_SELECTOR);

/**
 * What lay under the pointer where the gesture before aimed is no longer
 * there, in a browser that lays the page out: a label pushed aside by a chip
 * its own click drew ("Unlimited votes" by the votes left, the next label
 * coming under it), a vote badge that shrank, a row that moved down, a
 * dialog's backdrop gone, a dialog opened over the control (pass 17 of 42.1).
 * jsdom lays nothing out and has no elementFromPoint: there it says nothing.
 */
export const underMoved = (aim: GuardAim | null) => {
  if (!aim?.under || typeof document.elementFromPoint !== 'function') return false;
  const now = document.elementFromPoint(aim.x, aim.y);
  return !!now && pressedControl(now) !== aim.under;
};

/**
 * The control the gesture before pressed is still on the page, but moved or
 * resized: its own click shrank the badge beside it, and the box it sits in
 * moved. The point it was pressed at may still lie on it — a proposal's thumb
 * is wide, and the vote box moved 36 px — while a finger that drifts a few
 * pixels reaches the neutral vote that came there (pass 18 of 42.1). jsdom
 * lays nothing out: every box is empty, and nothing moves.
 */
export const aimShifted = (aim: GuardAim | null) => {
  const now = aim?.key?.isConnected ? boxOf(aim.key) : null;
  if (!now || !aim?.box) return false;
  return Math.abs(now.left - aim.box.left) > SHIFT_PX || Math.abs(now.top - aim.box.top) > SHIFT_PX
    || Math.abs(now.width - aim.box.width) > SHIFT_PX || Math.abs(now.height - aim.box.height) > SHIFT_PX;
};

/** What the gesture before pressed, a control or not, left the page: a dialog's backdrop gone with its click. */
export const aimGone = (aim: GuardAim | null) => !!aim?.key && !aim.key.isConnected;

/**
 * What the gesture before aimed at is no longer under the point it aimed at
 * — covered by a dialog that closed or opened, or moved away with the board:
 * a pick-up in the Group phase drew the hint above the board a line longer,
 * and the card above came under the finger. For the taps the board claims;
 * jsdom has no elementFromPoint, and there it says nothing.
 */
export const aimDisplaced = (aim: GuardAim | null) => {
  if (!aim?.key || typeof document.elementFromPoint !== 'function') return false;
  const now = document.elementFromPoint(aim.x, aim.y);
  return !!now && !aim.key.contains(now);
};

/**
 * The control of the gesture before went with its click: an act, whatever
 * editor its press closed too — taken as the reason, it stopped every tap of
 * a steady pace on the Delete that came up (pass 16 of 42.1). Asked when the
 * next gesture comes, before or after the end of that press: on a slow
 * machine the next press comes first.
 */
export const boardMovedSince = (state: GestureGuardState) => {
  if (aimLeftPage(state.aim)) state.boardMoved = 'act';
  return state.boardMoved;
};

/**
 * Decides one mousedown — of the mouse itself, or the one a browser emulates
 * for a tap on a control — and answers whether it presses nothing.
 *
 * The browser's own count (detail) says a press is the next of a double click:
 * at the same point, a moment later. After a press on a control, another
 * control there came with the first click, whatever changed it — a row moved,
 * a chip appeared, a dialog opened or closed — and the press landed on what
 * came there: it presses nothing (pass 17 of 42.1). After a press on no
 * control (a vote's count, missed for its "+"), nothing came with it unless
 * something moved: the retry is the user's own (pass 18). For a tap the
 * browser counts each tap from the one before, and far (100 dp on Android):
 * counted, it is the next only a fingertip from where the first aimed
 * (isNearAim). Past the browser's count, the board's own half second
 * (isNextTap) still makes a tap the next once something moved under it: a
 * mark (boardMovedSince), a claimed tap that drew its card again (relaid),
 * what it pressed gone, moved (aimShifted) or no longer under its point
 * (underMoved).
 *
 * A text field is the next press's own only where the first pressed text
 * that became that field, nothing marked: after the card's Edit went with its
 * click, the next press of a double click selected the word under it in the
 * editor that came there, and the next keystroke replaced it for everyone
 * (pass 18).
 */
export const guardsPress = (state: GestureGuardState, e: MouseEvent): boolean => {
  const target = e.target instanceof Element ? e.target : null;
  const point = { x: e.clientX, y: e.clientY };
  const aim = state.aim;
  const tapMouse = isTapMouse(state.touchEndAt, e.timeStamp);
  const counted = e.detail > 1 && (!tapMouse || isNearAim(aim, point));
  const nextTap = tapMouse && isNextTap(aim, state.tapStartedAt ?? e.timeStamp, point);
  if (aim && (counted || nextTap) && pressedControl(target) !== aim.key) {
    const marked = boardMovedSince(state);
    const onControl = !!aim.key?.matches(CONTROL_SELECTOR);
    const moved = !!marked || !!aim.relaid || aimGone(aim) || aimShifted(aim) || underMoved(aim);
    const ownField = isTextField(target) && !onControl && !marked;
    if (!ownField && ((counted && onControl) || moved)) {
      state.stopped = true;
      // The half second after a closed editor runs on from each press it
      // stops; an act's runs from the act alone: from its stops, at a steady
      // pace of two taps a second on the Delete that came up, every tap after
      // the first pressed nothing (pass 15 of 42.1). A press it stops aims at
      // nothing: the third press of a triple click is stopped too.
      if (state.boardMoved === 'editor') state.aim = { ...aim, at: e.timeStamp };
      return true;
    }
  }
  state.stopped = false;
  const key = pressedControl(target);
  state.aim = { key, under: key, box: boxOf(key), at: e.timeStamp, x: e.clientX, y: e.clientY };
  state.boardMoved = null;
  return false;
};

/**
 * Mounts the guard on the window, before anything that mounts after it: a
 * press it stops goes no further — no listener after it on the window hears
 * it, no handler on the page, and its click clicks nothing (the keyboard's
 * click, which has no detail, is never one).
 */
export const useDoubleGestureGuard = (): MutableRefObject<GestureGuardState> => {
  const ref = useRef<GestureGuardState>({ aim: null, boardMoved: null, tapStartedAt: null, touchEndAt: null, stopped: false });
  useEffect(() => {
    const state = ref.current;
    // When the last touch began: every touch ends after its own start.
    let touchStartAt: number | null = null;
    const touchStarts = (e: Event) => { touchStartAt = e.timeStamp; };
    const touchEnds = (e: Event) => {
      state.touchEndAt = e.timeStamp;
      state.tapStartedAt = touchStartAt;
    };
    const guards = (e: MouseEvent) => {
      if (!guardsPress(state, e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const stopsClick = (e: MouseEvent) => {
      if (!state.stopped || e.detail === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('click', stopsClick, true);
    window.addEventListener('mousedown', guards, true);
    window.addEventListener('touchstart', touchStarts, { capture: true, passive: true });
    window.addEventListener('touchend', touchEnds, { capture: true, passive: true });
    return () => {
      window.removeEventListener('click', stopsClick, true);
      window.removeEventListener('mousedown', guards, true);
      window.removeEventListener('touchstart', touchStarts, true);
      window.removeEventListener('touchend', touchEnds, true);
    };
  }, []);
  return ref;
};
