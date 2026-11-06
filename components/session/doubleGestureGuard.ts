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
 * A field a press only puts the caret in, or selects the words of: a press
 * there does nothing else, so the next press of a double click is its own — a
 * proposal's text, a press opening its field where the text was, selects a
 * word with a double click as it always did.
 */
export const isTextField = (target: Element | null) =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type));

/**
 * Where and when the gesture before aimed, and what it pressed: the control
 * around its target (key), and what lay under the pointer there (under). For
 * a tap the board claims, key is its card or group and under what the finger
 * reached in it. relaid: that tap changed what is held, and the card it
 * reached was drawn again around the finger (its "Selected" banner pushed
 * its content down).
 */
export type GuardAim = GestureAim & { key: Element | null; under: Element | null; relaid?: boolean };

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
 * at the same point, a moment later. On another control than the first, what
 * lies under the pointer changed with the first click, whatever changed it —
 * a row moved, a chip appeared, a dialog opened or closed — and the press
 * landed on what came there: it presses nothing (pass 17 of 42.1). For a tap
 * the browser counts each tap from the one before, and far (100 dp on
 * Android): counted, it is the next only a fingertip from where the first
 * aimed (isNearAim). Past the browser's count, the board's own half second
 * (isNextTap) still makes a tap the next once something moved under it
 * (boardMovedSince, underMoved, a claimed tap that drew its card again).
 */
export const guardsPress = (state: GestureGuardState, e: MouseEvent): boolean => {
  const target = e.target instanceof Element ? e.target : null;
  const point = { x: e.clientX, y: e.clientY };
  const aim = state.aim;
  const tapMouse = isTapMouse(state.touchEndAt, e.timeStamp);
  const counted = e.detail > 1 && (!tapMouse || isNearAim(aim, point));
  const nextTap = tapMouse && isNextTap(aim, state.tapStartedAt ?? e.timeStamp, point);
  if (aim && (counted || nextTap) && pressedControl(target) !== aim.key && !isTextField(target)) {
    const moved = !!boardMovedSince(state) || !!aim.relaid || underMoved(aim);
    if (counted || moved) {
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
  state.aim = { key, under: key, at: e.timeStamp, x: e.clientX, y: e.clientY };
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
