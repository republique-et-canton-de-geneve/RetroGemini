import { useEffect, useRef, type MutableRefObject } from 'react';
import { isNearAim, isNextTap, isTapMouse, type GestureAim, type TouchPoint } from './groupingTouch';

/**
 * The next press of a double click, and the next tap of a double tap, press
 * nothing on a control the gesture before brought under the pointer (AGENTS.md
 * → Accessibility, the press paragraph). Both session types mount this guard
 * (useDoubleGestureGuard): a behaviour both have is written once. The
 * retrospective adds what only it has — the card editor that closes under the
 * pointer, the taps the board claims — through the state the guard keeps.
 */

export const CONTROL_SELECTOR = 'button, a[href], input, textarea, select, label, summary, [role="button"]';
/** What a press of the mouse presses: the control around its target, or the target itself. */
export const pressedControl = (target: Element | null) => target?.closest(CONTROL_SELECTOR) ?? target;

/**
 * What the guard tells apart under the pointer: a control, and a card or a
 * group the board's taps act on. A press on a card's words reaches the card,
 * on its icon the button around it.
 */
const AIMED_SELECTOR = `${CONTROL_SELECTOR}, [data-ticket-id], .group-container`;
export const aimedElement = (target: Element | null) => target?.closest(AIMED_SELECTOR) ?? null;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
/**
 * A field a press puts the caret in — or, the next of a double click, selects
 * a word of, and a triple click its whole text, for the next keystroke to
 * replace.
 */
export const isTextField = (target: Element | null) =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type));

/**
 * Text a click turns into its own field, where it is (a proposal's text): the
 * next press of a double click selects a word of that field, as it always did
 * (guardsPress). Nothing else is: a field that came where a control was (the
 * card's Edit), where a dialog's backdrop was, or where a card was drawn
 * again, takes no press of a double click (pass 19 of 42.1).
 */
export const EDITS_IN_PLACE_ATTRIBUTE = 'data-edits-in-place';

type Box = { left: number; top: number; width: number; height: number };
export const boxOf = (element: Element | null): Box | null => {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
// Moved or resized by more than this, an element is not where it was drawn.
const SHIFT_PX = 2;
// How far around a press what is drawn there is recorded: past the fingertip
// the next tap is counted within (isNearAim, 24 px).
export const DRAWN_NEAR_PX = 32;

/**
 * What was drawn around the point a gesture aimed at, as it began: each
 * control, card and group, where it was drawn, and whether it could be
 * pressed there (seen) — a dialog's backdrop lay over a card's Delete, an
 * open picker over a card's Comments.
 */
export type Drawn = { element: Element; box: Box; seen: boolean };

const shifted = (was: Box, now: Box) =>
  Math.abs(now.left - was.left) > SHIFT_PX || Math.abs(now.top - was.top) > SHIFT_PX
  || Math.abs(now.width - was.width) > SHIFT_PX || Math.abs(now.height - was.height) > SHIFT_PX;
const contains = (box: Box, point: TouchPoint) =>
  point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height;

/** Whether what lies at the point of a box nearest to a press is that element, or inside it. */
const pressableNear = (element: Element, box: Box, point: TouchPoint) => {
  if (typeof document.elementFromPoint !== 'function') return true;
  const x = Math.min(Math.max(point.x, box.left + 1), box.left + box.width - 1);
  const y = Math.min(Math.max(point.y, box.top + 1), box.top + box.height - 1);
  const hit = document.elementFromPoint(x, y);
  return !hit || element.contains(hit);
};

/**
 * Records what is drawn within DRAWN_NEAR_PX of a point. jsdom lays nothing
 * out — every box is empty — and records nothing.
 */
export const drawnNear = (point: TouchPoint): Drawn[] => {
  const drawn: Drawn[] = [];
  document.querySelectorAll(AIMED_SELECTOR).forEach((element) => {
    const box = boxOf(element);
    if (!box || !box.width || !box.height) return;
    if (box.left > point.x + DRAWN_NEAR_PX || box.left + box.width < point.x - DRAWN_NEAR_PX
      || box.top > point.y + DRAWN_NEAR_PX || box.top + box.height < point.y - DRAWN_NEAR_PX) return;
    drawn.push({ element, box, seen: pressableNear(element, box, point) });
  });
  return drawn;
};

/**
 * The element the next press or tap reaches came under its point with the
 * gesture before: it was not drawn around that gesture (an emoji of the
 * picker it opened, the cross a vote drew beside its thumb, a proposal's
 * Undo accept), could not be pressed there (a dialog's backdrop lay over it),
 * or was drawn elsewhere and the point did not lie on it then (the next
 * participant's row moved up, a label pushed aside, the card above pushed
 * down by a hint a line longer). One drawn where it was is the user's to
 * press, whatever else changed: the next score beside the one the first tap
 * chose, drawn larger (pass 19 of 42.1); a card the banner of the one picked
 * up pushed down, still under the finger. jsdom lays nothing out: an element
 * drawn nowhere says nothing.
 */
export const came = (aim: GuardAim | null, element: Element | null, point: TouchPoint) => {
  if (!aim?.drawn || !element) return false;
  const now = boxOf(element);
  if (!now || !now.width || !now.height) return false;
  const was = aim.drawn.find((d) => d.element === element);
  if (!was || !was.seen) return true;
  return shifted(was.box, now) && !contains(was.box, point);
};

/**
 * Where and when the gesture before aimed, and what it pressed: the control
 * around its target (key), and what was drawn around its point (drawn). For a
 * tap the board claims (claimed), key is its card or group. relaid: that tap
 * was on a card, which it picked up or put down, and drew again around the
 * finger (its "Selected" banner pushed its content down). inPlace: it pressed
 * text a click turns into its own field.
 */
export type GuardAim = GestureAim & {
  key: Element | null;
  drawn?: Drawn[];
  claimed?: boolean;
  relaid?: boolean;
  inPlace?: boolean;
};

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

/** What the gesture before pressed, a control or not, left the page: a dialog's backdrop gone with its click. */
export const aimGone = (aim: GuardAim | null) => !!aim?.key && !aim.key.isConnected;

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
 * at the same point, a moment later. After a gesture that acted — it pressed a
 * control, the board acted on its tap, or what it pressed went with its click
 * (a dialog's backdrop) — such a press on another element is the same gesture
 * gone astray, whatever brought that element: it presses nothing (pass 17 of
 * 42.1). After a press that did nothing (a vote's count, missed for its "+"),
 * the retry is the user's own (pass 18). For a tap the browser counts each tap
 * from the one before, and far (100 dp on Android): counted, it is the next
 * only a fingertip from where the first aimed (isNearAim).
 *
 * Past the browser's count, the board's own half second (isNextTap) makes a
 * tap the next only once something moved under it: a mark (boardMovedSince), a
 * card the board drew again around the finger (relaid), what the gesture
 * before pressed gone, or the element this press reaches came there (came).
 *
 * A text field is the next press's own only where the first pressed text a
 * click turns into that very field, nothing marked: after the card's Edit went
 * with its click, the next press of a double click selected the word under it
 * in the editor that came there, and the next keystroke replaced it for
 * everyone (pass 18); after a dialog's backdrop, a group's title (pass 19).
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
    // What the gesture before pressed went with its click (a dialog's
    // backdrop) is a move, counted or not: aimGone below.
    const acted = !!aim.key?.matches(CONTROL_SELECTOR) || !!aim.claimed;
    const moved = !!marked || !!aim.relaid || aimGone(aim) || came(aim, aimedElement(target), point);
    const ownField = isTextField(target) && !!aim.inPlace && !marked;
    if (!ownField && ((counted && acted) || moved)) {
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
  state.aim = {
    key: pressedControl(target), at: e.timeStamp, x: point.x, y: point.y,
    drawn: drawnNear(point),
    inPlace: !!target?.closest(`[${EDITS_IN_PLACE_ATTRIBUTE}]`),
  };
  state.boardMoved = null;
  return false;
};

/**
 * A tap the board claims (a card's or a group's), and what that tap acts on
 * (aimedAt): whether it is the next tap of a double tap whose first moved what
 * this one reaches, which it then ignores. As the press: once an editor closed
 * after the tap before was aimed, the card grew back under the finger, and the
 * next tap grouped the card that came there with the one the first picked up,
 * for everyone (pass 15 of 42.1); once what the tap before pressed left the
 * page — a dialog's backdrop, and the card under it took the drop (pass 18);
 * once what this one reaches came under the finger — a pick-up in the Group
 * phase drew the hint above the board a line longer, and the card above came
 * there (came). On the same card or group it is a tap again. Measured from its
 * touch, as a browser counts the next tap (pass 15).
 */
export const ignoresClaimedTap = (state: GestureGuardState, aimedAt: Element, point: TouchPoint, at: number) => {
  const aim = state.aim;
  if (!aim || aim.key === aimedAt || !isNextTap(aim, state.tapStartedAt ?? at, point)) return false;
  if (!boardMovedSince(state) && !aimGone(aim) && !came(aim, aimedAt, point)) return false;
  if (state.boardMoved === 'editor') state.aim = { ...aim, at };
  return true;
};

/**
 * Aims the guard at a tap the board claims and acts on. The board acted: the
 * next tap the browser counts presses nothing on another control (guardsPress),
 * past its count only once something moved. On a card the tap draws it again
 * around the finger (relaid): picked up, its "Selected" banner pushed its
 * content down, and the next tap pressed what came under the finger — its
 * vote, its comments, its Delete (pass 17 of 42.1). A group takes a ring; what
 * else moves — a phone's hint drawn a line longer or shorter moves the board,
 * the group with it — is told by where things are drawn (came).
 */
export const aimClaimedTap = (state: GestureGuardState, aimedAt: Element, point: TouchPoint, at: number) => {
  state.aim = {
    key: aimedAt, at, x: point.x, y: point.y, drawn: drawnNear(point), claimed: true,
    relaid: aimedAt.matches('[data-ticket-id]'),
  };
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
