import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aimDisplaced, guardsPress, type GestureGuardState } from '../components/session/doubleGestureGuard';

/**
 * The double-gesture guard on a page laid out by hand: jsdom lays nothing out
 * (every box is empty) and has no elementFromPoint, so the checks a browser
 * needs — what lies under the point the first press aimed at, where the
 * control it pressed is drawn now — are given a layout here. The screens'
 * suites (sessionGroupTouch, healthCheckDoubleGesture) drive the rest, and
 * e2e/retro-touch-card-controls.spec.ts the real layout.
 */

type Box = { left: number; top: number; width: number; height: number };
const boxes = new Map<Element, Box>();
let underPoint: Element | null = null;

const freshState = (): GestureGuardState => ({ aim: null, boardMoved: null, tapStartedAt: null, touchEndAt: null, stopped: false });
const control = (tag: string, text: string) => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (tag === 'input') (element as HTMLInputElement).type = 'text';
  document.body.appendChild(element);
  return element;
};

let now = 1000;
// A press at a time of its own clock (the event's timeStamp), as a browser stamps it.
const press = (state: GestureGuardState, element: Element, { detail = 1, x = 50, y = 50, tap = false } = {}) => {
  if (tap) {
    state.tapStartedAt = now - 40;
    state.touchEndAt = now;
  }
  let stopped: boolean | null = null;
  const listener = (e: Event) => { stopped = guardsPress(state, e as MouseEvent); };
  window.addEventListener('mousedown', listener, true);
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail, clientX: x, clientY: y }));
  window.removeEventListener('mousedown', listener, true);
  return stopped;
};

beforeEach(() => {
  now = 1000;
  vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => now);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const b = boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b } as DOMRect;
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => underPoint });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  boxes.clear();
  underPoint = null;
  document.body.innerHTML = '';
});

describe('the double-gesture guard, on a page laid out', () => {
  // Review finding (pass 18 of 42.1): past the browser's count, only what lies
  // under the point says the board moved there.
  it('stops the next tap once the first’s click drew another label under its point', () => {
    const state = freshState();
    const unlimited = control('label', 'Unlimited votes');
    const oneVote = control('label', '1 vote/item');
    underPoint = unlimited;
    expect(press(state, unlimited, { tap: true })).toBe(false);
    // Its click drew the votes left in front of it: the next label came there.
    underPoint = oneVote;
    now += 430;
    expect(press(state, oneVote, { tap: true, x: 52 })).toBe(true);
  });

  it('leaves the next tap a fingertip away to the control it reaches when nothing moved', () => {
    const state = freshState();
    const add = control('button', 'Add a vote');
    const takeBack = control('button', 'Take back my vote');
    boxes.set(add, { left: 30, top: 40, width: 40, height: 20 });
    underPoint = add;
    expect(press(state, add, { tap: true })).toBe(false);
    now += 430;
    expect(press(state, takeBack, { tap: true, x: 62 })).toBe(false);
  });

  // Review finding (pass 18 of 42.1): the thumb was wide enough to still lie
  // under the first point once its vote box moved 36 px; a finger a few
  // pixels off reached the neutral vote that came beside it.
  it('stops the next tap once the control the first pressed moved, though it still lies under its point', () => {
    const state = freshState();
    const thumb = control('button', 'thumb_up');
    const neutral = control('button', 'remove');
    boxes.set(thumb, { left: 30, top: 40, width: 52, height: 24 });
    underPoint = thumb;
    expect(press(state, thumb, { tap: true })).toBe(false);
    boxes.set(thumb, { left: -6, top: 40, width: 52, height: 24 });
    now += 430;
    expect(press(state, neutral, { tap: true, x: 60 })).toBe(true);
  });

  it('stops the next tap once the control the first pressed grew, in its place', () => {
    const state = freshState();
    const vote = control('button', 'Add a vote');
    const next = control('button', 'Delete ticket');
    boxes.set(vote, { left: 30, top: 40, width: 52, height: 24 });
    underPoint = vote;
    expect(press(state, vote, { tap: true })).toBe(false);
    boxes.set(vote, { left: 30, top: 40, width: 52, height: 48 });
    now += 430;
    expect(press(state, next, { tap: true, x: 60 })).toBe(true);
  });

  // Review finding (pass 18 of 42.1): a press that pressed no control brought
  // nothing with it: the retry of a missed "+" is the user's own.
  it('leaves a press the browser counts to the control it reaches after a first press on no control, nothing moved', () => {
    const state = freshState();
    const count = control('span', '3');
    const add = control('button', '+');
    underPoint = count;
    expect(press(state, count)).toBe(false);
    expect(press(state, add, { detail: 2, x: 52 })).toBe(false);
  });

  it('stops a press the browser counts on another control after a first press on a control', () => {
    const state = freshState();
    const first = control('button', 'Unlimited votes');
    const second = control('button', '1 vote/item');
    underPoint = first;
    expect(press(state, first)).toBe(false);
    expect(press(state, second, { detail: 2 })).toBe(true);
  });

  // Review finding (pass 18 of 42.1): after the card's Edit went with its
  // click, the next press selected the word under it in the editor that came
  // there, and the next keystroke replaced it.
  it('stops the next press in a field that came where the control the first pressed was', () => {
    const state = freshState();
    const edit = control('button', 'Edit ticket');
    underPoint = edit;
    expect(press(state, edit)).toBe(false);
    edit.remove();
    const editor = control('textarea', 'Too many meetings');
    underPoint = editor;
    expect(press(state, editor, { detail: 2 })).toBe(true);
  });

  it('leaves the next press to a field that came where the text the first pressed was', () => {
    const state = freshState();
    const text = control('span', 'Write the notes the day before');
    underPoint = text;
    expect(press(state, text)).toBe(false);
    text.remove();
    const field = control('input', '');
    underPoint = field;
    expect(press(state, field, { detail: 2 })).toBe(false);
  });

  it('stops the next press in a field that came under a control the first pressed and left in place', () => {
    const state = freshState();
    const setTimer = control('button', 'Set the timer');
    underPoint = setTimer;
    expect(press(state, setTimer)).toBe(false);
    const minutes = control('input', '');
    expect(press(state, minutes, { detail: 2 })).toBe(true);
  });

  it('stops the next press in a field after a press on text, once something marked the board', () => {
    const state = freshState();
    const text = control('span', 'Delivery');
    underPoint = text;
    expect(press(state, text)).toBe(false);
    // The press's end closed an editor: the card grew back under the pointer.
    state.boardMoved = 'editor';
    const title = control('input', '');
    expect(press(state, title, { detail: 2 })).toBe(true);
  });

  it('takes what the first aimed at as still under its point when a part of it lies there', () => {
    const cardEl = control('div', '');
    const words = document.createElement('span');
    cardEl.appendChild(words);
    underPoint = words;
    expect(aimDisplaced({ key: cardEl, under: words, x: 50, y: 50, at: 1000 })).toBe(false);
    underPoint = control('div', 'The card above');
    expect(aimDisplaced({ key: cardEl, under: words, x: 50, y: 50, at: 1000 })).toBe(true);
  });

  // Review finding (pass 18 of 42.1): a mark belongs to the gesture after the
  // one that made it, never to a later one: kept, a long-closed editor cut
  // every quick pair of neighbouring taps after it.
  it('forgets a mark at the next press it lets through', () => {
    const state = freshState();
    const vote = control('button', 'Add a vote');
    const next = control('button', 'Add a vote to the next card');
    state.boardMoved = 'editor';
    underPoint = vote;
    now += 2000;
    expect(press(state, vote, { tap: true })).toBe(false);
    expect(state.boardMoved).toBeNull();
    now += 430;
    expect(press(state, next, { tap: true, x: 62 })).toBe(false);
  });
});
