import { useEffect, useRef, type MutableRefObject } from 'react';
import { isNearAim, isNextTap, isTapMouse, type GestureAim, type TouchPoint } from './groupingTouch';

/**
 * The double-gesture guard, one rule (AGENTS.md → Accessibility → The
 * double-gesture guard): the presses that follow the first press of a double
 * click, or the taps that follow the first tap of a double tap, press nothing
 * but what that first press pressed. The first click deletes a card, closes an
 * editor or opens a dialog, the layout moves, and the second used to land on
 * the next card's Delete (which asks nothing), a vote, *Undo accept* or a
 * dialog's backdrop — for everyone.
 *
 * It reads no layout: it compares what two presses reach, never where things
 * are drawn. The heuristic it replaces (42.0–42.2) measured every control of
 * the page at each press to guess whether something had moved under the
 * pointer, and twenty reviews kept finding cases it guessed wrong
 * (HARDENING_STATUS.md → H54). The cost of the simple rule is stated rather
 * than guessed around: a quick second press on another control at the same
 * place presses nothing, and is pressed again after a pause.
 *
 * Both session types mount it (useDoubleGestureGuard): a behaviour both have is
 * written once. The retrospective adds the taps its board claims and acts on
 * itself (pressesClaimedTap), which the browser sends no mouse for.
 */

export const CONTROL_SELECTOR = 'button, a[href], input, textarea, select, label, summary, [role="button"]';
// A card or a group: words pressed in one reach the card or the group, the
// one thing a tap the board claims acts on too.
const ITEM_SELECTOR = '[data-ticket-id], .group-container';

/**
 * Two elements that are one thing to a double click carry the same value: text
 * a click turns into its own field, in place, and that field (a proposal's
 * text) — the next press of a double click selects a word there, as it always
 * did. Only on such a pair: a key on a container would let the next press
 * reach every control inside it.
 */
export const PRESS_KEY_ATTRIBUTE = 'data-press-key';

/** What a press reaches: a control, a shared key, or an element. */
export type PressKey = Element | string;

/**
 * What a press presses: the control around its target (the button around an
 * icon) or the key it shares with the element it turned into; else the card or
 * the group around it, whatever inline element of their words it reached; else
 * its target.
 */
export const pressKey = (target: Element | null): PressKey | null => {
  if (!target) return null;
  const control = target.closest(CONTROL_SELECTOR);
  if (control) return control.getAttribute(PRESS_KEY_ATTRIBUTE) ?? control;
  const keyed = target.closest(`[${PRESS_KEY_ATTRIBUTE}]`);
  if (keyed) return keyed.getAttribute(PRESS_KEY_ATTRIBUTE) ?? keyed;
  return target.closest(ITEM_SELECTOR) ?? target;
};

/**
 * The gesture under way: what its first press pressed (key) and where (x, y),
 * and when its last press came (at), since a browser counts each tap from the
 * one before.
 */
export type GuardAim = GestureAim & { key: PressKey | null };

export interface GestureGuardState {
  aim: GuardAim | null;
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
 * Whether a press goes on the gesture under way, and if so, presses nothing.
 * The press of the mouse goes on it when the browser counts it so (detail, at
 * the same point a moment later). A tap's mouse goes on it within the board's
 * own half second from the tap before and a fingertip from where the gesture
 * began (isNextTap) — Firefox counts every tap as a first, and Chromium only
 * within its own 400 ms — or when the browser counts it so within that
 * fingertip (Chromium counts each tap from the one before, and far: 100 dp on
 * Android). A press that goes on the gesture is counted from, for the next one.
 */
const goesOn = (state: GestureGuardState, e: MouseEvent, point: TouchPoint) => {
  if (!isTapMouse(state.touchEndAt, e.timeStamp)) return e.detail > 1;
  return (e.detail > 1 && isNearAim(state.aim, point)) || isNextTap(state.aim, state.tapStartedAt ?? e.timeStamp, point);
};

/**
 * Decides one mousedown — of the mouse itself, or the one a browser emulates
 * for a tap — and answers whether it presses nothing: it goes on a gesture
 * whose first press pressed something else. A press the browser counts as the
 * next of a double click whose first the guard never saw (made on the screen
 * before, the one that opened the session) presses nothing either. Any other
 * press begins a gesture.
 */
export const guardsPress = (state: GestureGuardState, e: MouseEvent): boolean => {
  const target = e.target instanceof Element ? e.target : null;
  const point = { x: e.clientX, y: e.clientY };
  const aim = state.aim;
  if (goesOn(state, e, point)) {
    if (aim) aim.at = e.timeStamp;
    state.stopped = !aim || aim.key !== pressKey(target);
    return state.stopped;
  }
  state.stopped = false;
  state.aim = { key: pressKey(target), at: e.timeStamp, x: point.x, y: point.y };
  return false;
};

/**
 * A tap the board claims (on a card or a group, aimedAt) and acts on itself:
 * the browser sends no mouse for it, so the board asks here. It answers whether
 * the tap acts: one that goes on the gesture under way acts only on what that
 * gesture's first press reached — a card picked up and put down again by a
 * double tap, never the card or the group that came under the finger. One that
 * acts begins a gesture, or goes on its own.
 */
export const pressesClaimedTap = (state: GestureGuardState, aimedAt: Element, point: TouchPoint, at: number) => {
  const aim = state.aim;
  if (aim && isNextTap(aim, state.tapStartedAt ?? at, point)) {
    aim.at = at;
    return aim.key === aimedAt;
  }
  state.aim = { key: aimedAt, at, x: point.x, y: point.y };
  return true;
};

/**
 * Mounts the guard on the window, before anything that mounts after it: a
 * press it stops goes no further — no listener after it on the window hears
 * it, no handler on the page, and its click clicks nothing (the keyboard's
 * click, which has no detail, is never one).
 */
export const useDoubleGestureGuard = (): MutableRefObject<GestureGuardState> => {
  const ref = useRef<GestureGuardState>({ aim: null, tapStartedAt: null, touchEndAt: null, stopped: false });
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
