import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aimClaimedTap,
  came,
  drawnNear,
  guardsPress,
  ignoresClaimedTap,
  type GestureGuardState,
} from '../components/session/doubleGestureGuard';

/**
 * The double-gesture guard on a page laid out by hand: jsdom lays nothing out
 * (every box is empty) and has no elementFromPoint, so what the guard reads of
 * a layout — where each control, card and group is drawn, and what lies on
 * top at a point — is given here. A button holds an icon, as in the app: a
 * real finger reaches the icon, not the button (pass 19 of 42.1). The
 * screens' suites (sessionGroupTouch, healthCheckDoubleGesture) drive the
 * rest, and e2e/retro-touch-card-controls.spec.ts the real layout.
 */

type Box = { left: number; top: number; width: number; height: number };
// Drawn in insertion order: the last drawn lies on top.
const boxes = new Map<Element, Box>();
const draw = (element: Element, box: Box) => {
  boxes.delete(element);
  boxes.set(element, box);
};
const inside = (b: Box, x: number, y: number) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
const topmostAt = (x: number, y: number) => {
  let found: Element | null = null;
  for (const [element, box] of boxes) if (element.isConnected && inside(box, x, y)) found = element;
  return found;
};

const freshState = (): GestureGuardState => ({ aim: null, boardMoved: null, tapStartedAt: null, touchEndAt: null, stopped: false });
const el = (tag: string, text = '', parent: Element = document.body) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (tag === 'input') (element as HTMLInputElement).type = 'text';
  parent.appendChild(element);
  return element;
};
/** A button holding its icon, both drawn: the icon a few pixels inside the button. */
const iconButton = (label: string, box: Box, parent: Element = document.body) => {
  const button = el('button', '', parent);
  button.setAttribute('aria-label', label);
  const icon = el('span', 'thumb_up', button);
  draw(button, box);
  draw(icon, { left: box.left + 4, top: box.top + 4, width: box.width - 8, height: box.height - 8 });
  return { button, icon };
};

let now = 1000;
// A press at a point, at a time of its own clock (the event's timeStamp), as a
// browser stamps it; what it reaches is what lies on top there.
const pressAt = (state: GestureGuardState, x: number, y: number, { detail = 1, tap = false, on }: { detail?: number; tap?: boolean; on?: Element } = {}) => {
  if (tap) {
    state.tapStartedAt = now - 40;
    state.touchEndAt = now;
  }
  const target = on ?? topmostAt(x, y);
  if (!target) throw new Error(`nothing drawn at ${x},${y}`);
  let stopped: boolean | null = null;
  const listener = (e: Event) => { stopped = guardsPress(state, e as MouseEvent); };
  window.addEventListener('mousedown', listener, true);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail, clientX: x, clientY: y }));
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
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: topmostAt });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  boxes.clear();
  document.body.innerHTML = '';
});

describe('the next tap past the browser’s count, by what came under it', () => {
  // Review finding (pass 19 of 42.1): the score a tap chose is drawn larger
  // (scale-110) about its centre, and nothing else moves; a quick correction
  // to the score beside it was ignored, and the mistaken score stayed stored.
  it('presses the control beside the first when only the first was drawn again, larger', () => {
    const state = freshState();
    const three = iconButton('3', { left: 0, top: 0, width: 48, height: 48 }).button;
    iconButton('4', { left: 56, top: 0, width: 48, height: 48 });
    expect(pressAt(state, 42, 24, { tap: true })).toBe(false);
    draw(three, { left: -2.4, top: -2.4, width: 52.8, height: 52.8 });
    now += 420;
    expect(pressAt(state, 62, 24, { tap: true })).toBe(false);
  });

  // Review finding (pass 19 of 42.1): a vote drew its cross beside the thumb,
  // which stayed put; the next tap a few pixels off took the vote back.
  it('stops the next tap on a control the first drew beside it', () => {
    const state = freshState();
    const row = el('div');
    iconButton('Add a vote', { left: 60, top: 0, width: 40, height: 24 }, row);
    expect(pressAt(state, 68, 12, { tap: true })).toBe(false);
    iconButton('Take back one of your votes', { left: 36, top: 0, width: 22, height: 24 }, row);
    now += 430;
    expect(pressAt(state, 54, 12, { tap: true })).toBe(true);
  });

  it('stops the next tap on a control that moved down under the point', () => {
    const state = freshState();
    iconButton('Unlimited votes', { left: 0, top: 0, width: 120, height: 24 });
    const oneVote = iconButton('1 vote/item', { left: 0, top: 30, width: 120, height: 24 }).button;
    expect(pressAt(state, 60, 20, { tap: true })).toBe(false);
    draw(oneVote, { left: 0, top: 14, width: 120, height: 24 });
    draw(oneVote.firstElementChild as Element, { left: 4, top: 18, width: 112, height: 16 });
    now += 430;
    expect(pressAt(state, 60, 22, { tap: true })).toBe(true);
  });

  it('stops the next tap on a control that grew to the point, its left edge kept', () => {
    const state = freshState();
    iconButton('Add a vote', { left: 0, top: 0, width: 40, height: 24 });
    const next = iconButton('Delete ticket', { left: 44, top: 0, width: 10, height: 24 }).button;
    expect(pressAt(state, 36, 12, { tap: true })).toBe(false);
    draw(next, { left: 44, top: 0, width: 30, height: 24 });
    draw(next.firstElementChild as Element, { left: 48, top: 4, width: 22, height: 16 });
    now += 430;
    expect(pressAt(state, 58, 12, { tap: true })).toBe(true);
  });

  it('presses a control that moved a pixel, to the point', () => {
    const state = freshState();
    iconButton('Add a vote', { left: 0, top: 0, width: 60, height: 24 });
    const next = iconButton('Comments', { left: 0, top: 24, width: 60, height: 20 }).button;
    expect(pressAt(state, 30, 22, { tap: true })).toBe(false);
    draw(next, { left: 0, top: 25, width: 60, height: 20 });
    draw(next.firstElementChild as Element, { left: 4, top: 29, width: 52, height: 12 });
    now += 430;
    // Below the box it was drawn in, inside the one it is drawn in now.
    expect(pressAt(state, 30, 44.5, { tap: true })).toBe(false);
  });

  it('presses a control that moved but already lay under the point, at its very edge', () => {
    const state = freshState();
    iconButton('Add a vote', { left: 0, top: 0, width: 40, height: 24 });
    const next = iconButton('Comments', { left: 44, top: 0, width: 40, height: 24 }).button;
    expect(pressAt(state, 36, 12, { tap: true })).toBe(false);
    draw(next, { left: 44, top: 6, width: 40, height: 24 });
    draw(next.firstElementChild as Element, { left: 48, top: 10, width: 32, height: 16 });
    now += 430;
    // Half a pixel inside the bottom edge of the box it was drawn in.
    expect(pressAt(state, 56, 23.6, { tap: true })).toBe(false);
  });

  it('stops the next tap on a control that grew down to the point, nothing else of its box changed', () => {
    const state = freshState();
    const above = iconButton('Comments', { left: 0, top: 0, width: 60, height: 10 }).button;
    iconButton('Add a vote', { left: 0, top: 14, width: 60, height: 20 });
    expect(pressAt(state, 30, 30, { tap: true })).toBe(false);
    draw(above, { left: 0, top: 0, width: 60, height: 20 });
    draw(above.firstElementChild as Element, { left: 4, top: 4, width: 52, height: 12 });
    now += 430;
    expect(pressAt(state, 30, 18, { tap: true })).toBe(true);
  });

  it('stops the next tap on a control that moved ten pixels to the point', () => {
    const state = freshState();
    iconButton('Add a vote', { left: 0, top: 0, width: 40, height: 24 });
    const next = iconButton('Comments', { left: 56, top: 0, width: 24, height: 24 }).button;
    expect(pressAt(state, 36, 12, { tap: true })).toBe(false);
    draw(next, { left: 46, top: 0, width: 24, height: 24 });
    draw(next.firstElementChild as Element, { left: 50, top: 4, width: 16, height: 16 });
    now += 430;
    expect(pressAt(state, 52, 12, { tap: true })).toBe(true);
  });

  // The backdrop of a dialog lay over a card's Delete: it was drawn there,
  // and could not be pressed there.
  it('stops the next tap on a control a backdrop lay over when the gesture before began', () => {
    const state = freshState();
    const remove = iconButton('Delete ticket', { left: 0, top: 0, width: 24, height: 24 });
    const backdrop = el('div');
    draw(backdrop, { left: -100, top: -100, width: 400, height: 400 });
    expect(pressAt(state, 12, 12, { tap: true })).toBe(false);
    // Its click takes the dialog away, and nothing else moves.
    backdrop.remove();
    expect(came(state.aim, remove.button, { x: 12, y: 12 })).toBe(true);
    now += 430;
    expect(pressAt(state, 12, 12, { tap: true })).toBe(true);
  });

  // Where nothing is laid out every box is empty, at the page's corner: a
  // press there records none of them.
  it('says nothing came where nothing is laid out', () => {
    const state = freshState();
    const first = el('button', 'Add a vote');
    const next = el('button', 'Comments');
    expect(pressAt(state, 6, 6, { tap: true, on: first })).toBe(false);
    expect(state.aim?.drawn).toEqual([]);
    expect(came(state.aim, next, { x: 6, y: 6 })).toBe(false);
    now += 430;
    expect(pressAt(state, 10, 6, { tap: true, on: next })).toBe(false);
  });

  // jsdom's case: nothing laid out, and what the tap before pressed went with
  // its click.
  it('stops the next tap once what the first pressed went with its click, nothing laid out', () => {
    const state = freshState();
    const remove = el('button', 'Delete ticket');
    const backdrop = el('div');
    expect(pressAt(state, 12, 12, { tap: true, on: backdrop })).toBe(false);
    backdrop.remove();
    now += 430;
    expect(pressAt(state, 12, 12, { tap: true, on: remove })).toBe(true);
  });

  it('records what is drawn around a press, and no farther', () => {
    const near = iconButton('Near', { left: 40, top: 0, width: 20, height: 20 }).button;
    const far = iconButton('Far', { left: 200, top: 0, width: 20, height: 20 }).button;
    const recorded = drawnNear({ x: 10, y: 10 }).map((d) => d.element);
    expect(recorded).toContain(near);
    expect(recorded).not.toContain(far);
  });
});

describe('the next press the browser counts', () => {
  // Review finding (pass 18 of 42.1): a press that pressed no control brought
  // nothing with it: the retry of a missed "+" is the user's own.
  it('leaves a press the browser counts to the control it reaches after a first press on no control, nothing moved', () => {
    const state = freshState();
    const count = el('span', '3');
    draw(count, { left: 0, top: 0, width: 20, height: 24 });
    iconButton('Add a vote', { left: 22, top: 0, width: 24, height: 24 });
    expect(pressAt(state, 18, 12)).toBe(false);
    expect(pressAt(state, 27, 12, { detail: 2 })).toBe(false);
  });

  it('stops a press the browser counts on another control after a first press on a control, nothing moved', () => {
    const state = freshState();
    iconButton('Unlimited votes', { left: 0, top: 0, width: 40, height: 24 });
    iconButton('1 vote/item', { left: 42, top: 0, width: 40, height: 24 });
    expect(pressAt(state, 38, 12)).toBe(false);
    expect(pressAt(state, 46, 12, { detail: 2 })).toBe(true);
  });

  // Review finding (pass 18 of 42.1): after the card's Edit went with its
  // click, the next press selected the word under it in the editor that came
  // there, and the next keystroke replaced it.
  it('stops the next press in a field that came where the control the first pressed was', () => {
    const state = freshState();
    const edit = iconButton('Edit ticket', { left: 0, top: 0, width: 24, height: 24 }).button;
    expect(pressAt(state, 12, 12)).toBe(false);
    edit.remove();
    draw(el('textarea', 'Too many meetings'), { left: 0, top: 0, width: 200, height: 60 });
    expect(pressAt(state, 13, 12, { detail: 2 })).toBe(true);
  });

  it('leaves the next press to the field a click made of the text the first pressed, where it was', () => {
    const state = freshState();
    const text = el('span', 'Write the notes the day before');
    text.setAttribute('data-edits-in-place', '');
    draw(text, { left: 0, top: 0, width: 200, height: 20 });
    expect(pressAt(state, 40, 10)).toBe(false);
    text.remove();
    draw(el('input'), { left: 0, top: 0, width: 200, height: 24 });
    expect(pressAt(state, 41, 10, { detail: 2 })).toBe(false);
  });

  // Review finding (pass 19 of 42.1): the exemption reached any field after a
  // press on no control: a double click on a dialog's backdrop selected the
  // word of the group title under it, and the next keystroke renamed the
  // group for everyone.
  it('stops the next press in a field once the backdrop the first pressed went with its click', () => {
    const state = freshState();
    draw(el('input'), { left: 0, top: 0, width: 200, height: 24 });
    const backdrop = el('div');
    draw(backdrop, { left: -100, top: -100, width: 400, height: 400 });
    expect(pressAt(state, 40, 12)).toBe(false);
    backdrop.remove();
    expect(pressAt(state, 41, 12, { detail: 2 })).toBe(true);
  });

  it('stops the next press in a field after text that is no field of its own', () => {
    const state = freshState();
    const text = el('span', 'Delivery');
    draw(text, { left: 0, top: 0, width: 200, height: 20 });
    expect(pressAt(state, 40, 10)).toBe(false);
    text.remove();
    draw(el('input'), { left: 0, top: 0, width: 200, height: 24 });
    expect(pressAt(state, 41, 10, { detail: 2 })).toBe(true);
  });

  // Review finding (pass 19 of 42.1): "nothing marked" held for the editor's
  // mark alone in the tests.
  it.each(['editor', 'act'] as const)('stops the next press in the text’s own field once the board was marked moved (%s)', (mark) => {
    const state = freshState();
    const text = el('span', 'Write the notes the day before');
    text.setAttribute('data-edits-in-place', '');
    draw(text, { left: 0, top: 0, width: 200, height: 20 });
    expect(pressAt(state, 40, 10)).toBe(false);
    state.boardMoved = mark;
    text.remove();
    draw(el('input'), { left: 0, top: 0, width: 200, height: 24 });
    expect(pressAt(state, 41, 10, { detail: 2 })).toBe(true);
  });
});

describe('a tap the board claims', () => {
  const cardAt = (id: string, box: Box) => {
    const element = el('div');
    element.setAttribute('data-ticket-id', id);
    const words = el('span', `card ${id}`, element);
    const padding = el('div', '', element);
    draw(element, box);
    draw(padding, { left: box.left, top: box.top, width: box.width, height: 8 });
    draw(words, { left: box.left + 8, top: box.top + 8, width: box.width - 16, height: box.height - 16 });
    return { element, words, padding };
  };
  const groupAt = (box: Box) => {
    const element = el('div');
    element.className = 'group-container';
    draw(element, box);
    return element;
  };

  // Review finding (pass 19 of 42.1): judged against the raw point of a touch
  // the browser gave to the nearest card, a deliberate drop on the card beside
  // it was ignored, though nothing moved.
  it('acts on the next tap on a card drawn where it was, the tap before having landed beside its card', () => {
    const state = freshState();
    // The column under the cards: what lies in the gap between two of them.
    draw(el('div'), { left: 0, top: 0, width: 200, height: 200 });
    const below = cardAt('a', { left: 0, top: 60, width: 200, height: 40 }).element;
    const above = cardAt('z', { left: 0, top: 8, width: 200, height: 40 }).element;
    state.tapStartedAt = 960;
    aimClaimedTap(state, below, { x: 50, y: 56 }, 1000);
    now += 230;
    state.tapStartedAt = now - 40;
    expect(ignoresClaimedTap(state, above, { x: 50, y: 44 }, now)).toBe(false);
  });

  // Review finding (pass 19 of 42.1): the card's own padding came to the point
  // its words were at, and the card is still under it.
  it('acts on the next tap when another part of the card the first reached lies at its point', () => {
    const state = freshState();
    const { element: lower, words } = cardAt('x', { left: 0, top: 60, width: 200, height: 40 });
    const upper = cardAt('y', { left: 0, top: 0, width: 200, height: 50 }).element;
    aimClaimedTap(state, lower, { x: 50, y: 70 }, 1000);
    // Picked up, its words were drawn a line lower: its padding lies there now.
    draw(words, { left: 8, top: 84, width: 184, height: 12 });
    now += 230;
    state.tapStartedAt = now - 40;
    expect(ignoresClaimedTap(state, upper, { x: 50, y: 48 }, now)).toBe(false);
  });

  it('ignores the next tap on the card above that came under the point', () => {
    const state = freshState();
    const held = cardAt('td', { left: 0, top: 40, width: 200, height: 30 }).element;
    const above = cardAt('tc', { left: 0, top: 0, width: 200, height: 30 }).element;
    aimClaimedTap(state, held, { x: 50, y: 50 }, 1000);
    draw(above, { left: 0, top: 36, width: 200, height: 30 });
    now += 150;
    state.tapStartedAt = now - 40;
    expect(ignoresClaimedTap(state, above, { x: 50, y: 50 }, now)).toBe(true);
  });

  it('acts on the next tap on a group drawn where it was, a card picked up beside it', () => {
    const state = freshState();
    const held = cardAt('tc', { left: 0, top: 0, width: 200, height: 30 }).element;
    const group = groupAt({ left: 0, top: 36, width: 200, height: 80 });
    aimClaimedTap(state, held, { x: 50, y: 26 }, 1000);
    now += 230;
    state.tapStartedAt = now - 40;
    expect(ignoresClaimedTap(state, group, { x: 50, y: 44 }, now)).toBe(false);
  });

  it('acts on a tap on the same card, and on one past the half second', () => {
    const state = freshState();
    const held = cardAt('td', { left: 0, top: 40, width: 200, height: 30 }).element;
    const above = cardAt('tc', { left: 0, top: 0, width: 200, height: 30 }).element;
    aimClaimedTap(state, held, { x: 50, y: 50 }, 1000);
    draw(above, { left: 0, top: 36, width: 200, height: 30 });
    now += 150;
    state.tapStartedAt = now - 40;
    expect(ignoresClaimedTap(state, held, { x: 50, y: 50 }, now)).toBe(false);
    now += 600;
    state.tapStartedAt = now - 40;
    expect(ignoresClaimedTap(state, above, { x: 50, y: 50 }, now)).toBe(false);
  });

  // Review finding (pass 19 of 42.1): a group's pick-up is an act like any:
  // a double tap whose second touch landed a fingertip away on its Delete
  // group dissolved it for everyone, and on its vote added one.
  it('stops a press the browser counts on a control beside a group the tap before picked up', () => {
    const state = freshState();
    const group = groupAt({ left: 0, top: 0, width: 300, height: 120 });
    iconButton('Delete group', { left: 268, top: 4, width: 28, height: 28 }, group);
    aimClaimedTap(state, group, { x: 270, y: 44 }, 1000);
    state.touchEndAt = 1000;
    now += 150;
    expect(pressAt(state, 278, 30, { detail: 2 })).toBe(true);
  });

  it('presses a control beside a group the tap before picked up, past the browser’s count, nothing moved', () => {
    const state = freshState();
    const group = groupAt({ left: 0, top: 0, width: 300, height: 120 });
    iconButton('Add a vote to this group', { left: 240, top: 80, width: 48, height: 28 }, group);
    aimClaimedTap(state, group, { x: 250, y: 70 }, 1000);
    now += 450;
    expect(pressAt(state, 256, 86, { tap: true })).toBe(false);
  });

  // Review finding (pass 19 of 42.1): in Brainstorm on a phone a pick-up draws
  // the hint a line longer, and the group moves down 16 px: the next tap
  // pressed the Edit of a card in it, which had come under the finger.
  it('stops the next tap on a control a group’s pick-up moved under the finger', () => {
    const state = freshState();
    const group = groupAt({ left: 0, top: 0, width: 300, height: 120 });
    const { button: edit, icon } = iconButton('Edit ticket', { left: 260, top: 10, width: 24, height: 24 }, group);
    aimClaimedTap(state, group, { x: 266, y: 46 }, 1000);
    draw(group, { left: 0, top: 16, width: 300, height: 120 });
    draw(edit, { left: 260, top: 26, width: 24, height: 24 });
    draw(icon, { left: 264, top: 30, width: 16, height: 16 });
    now += 300;
    expect(pressAt(state, 270, 40, { tap: true })).toBe(true);
  });
});

// Review finding (pass 18 of 42.1): a mark belongs to the gesture after the
// one that made it, never to a later one: kept, a long-closed editor cut
// every quick pair of neighbouring taps after it.
it('forgets a mark at the next press it lets through', () => {
  const state = freshState();
  iconButton('Add a vote', { left: 0, top: 0, width: 40, height: 24 });
  iconButton('Add a vote to the next card', { left: 44, top: 0, width: 40, height: 24 });
  state.boardMoved = 'editor';
  now += 2000;
  expect(pressAt(state, 30, 12, { tap: true })).toBe(false);
  expect(state.boardMoved).toBeNull();
  now += 430;
  expect(pressAt(state, 50, 12, { tap: true })).toBe(false);
});
