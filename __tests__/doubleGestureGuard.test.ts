import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  PRESS_KEY_ATTRIBUTE,
  guardsPress,
  pressKey,
  pressesClaimedTap,
  useDoubleGestureGuard,
  type GestureGuardState,
} from '../components/session/doubleGestureGuard';

/**
 * The double-gesture guard's one rule (AGENTS.md → Accessibility → The
 * double-gesture guard; HARDENING_STATUS.md → H54): the presses that follow
 * the first press of a double click, or the taps that follow the first tap of
 * a double tap, press nothing but what that first press pressed. It reads no
 * layout, so these tests lay nothing out: a press is an element, a rank in the
 * gesture (the browser's `detail`) and a time. The screens' suites
 * (sessionGroupTouch, healthCheckDoubleGesture) drive the rest, and
 * e2e/retro-touch-card-controls.spec.ts the real browser.
 */

const freshState = (): GestureGuardState => ({ aim: null, tapStartedAt: null, touchEndAt: null, stopped: false });
const el = (tag: string, parent: Element = document.body, text = '') => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  parent.appendChild(element);
  return element;
};
const card = (text: string) => {
  const c = el('div');
  c.setAttribute('data-ticket-id', text);
  const words = el('div', c, text);
  const remove = el('button', c);
  remove.setAttribute('aria-label', 'Delete ticket');
  const icon = el('span', remove, 'delete');
  return { card: c, words, remove, icon };
};

let now = 1000;
const at = (ms: number) => { now = ms; };
/**
 * A press of the mouse on an element, `detail` its rank in the gesture as the
 * browser counts it. A tap's is the mouse a browser emulates for it, right
 * after the touch ended (40 ms after it began).
 */
const press = (state: GestureGuardState, target: Element, { detail = 1, tap = false, x = 100, y = 100 } = {}) => {
  if (tap) {
    state.tapStartedAt = now - 40;
    state.touchEndAt = now;
  }
  let stopped: boolean | null = null;
  const listener = (e: Event) => { stopped = guardsPress(state, e as MouseEvent); };
  window.addEventListener('mousedown', listener, true);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail, clientX: x, clientY: y }));
  window.removeEventListener('mousedown', listener, true);
  return stopped;
};
/** A tap the board claims and acts on itself, on a card or a group (actOnClaimedTap). */
const claimedTap = (state: GestureGuardState, aimedAt: Element, { x = 100, y = 100 } = {}) => {
  state.tapStartedAt = now - 40;
  state.touchEndAt = now;
  return pressesClaimedTap(state, aimedAt, { x, y }, now);
};

beforeEach(() => {
  now = 1000;
  vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('what a press presses', () => {
  it('is the control around its target, an icon’s button', () => {
    const a = card('A');
    expect(pressKey(a.icon)).toBe(a.remove);
    expect(pressKey(a.remove)).toBe(a.remove);
  });

  it('is the card or the group around words, whatever inline element the press reaches', () => {
    const a = card('A');
    const bold = el('b', a.words, 'deploys');
    expect(pressKey(bold)).toBe(a.card);
    expect(pressKey(a.words)).toBe(a.card);
    const group = el('div');
    group.className = 'group-container';
    const title = el('p', group, 'Delivery');
    expect(pressKey(title)).toBe(group);
    expect(pressKey(document.body)).toBe(document.body);
  });

  it('is the key two elements share when one turns into the other in place, and only for them', () => {
    const text = el('span', document.body, 'Write the release notes');
    text.setAttribute(PRESS_KEY_ATTRIBUTE, 'proposal-text:p1');
    const field = el('input');
    field.setAttribute(PRESS_KEY_ATTRIBUTE, 'proposal-text:p1');
    expect(pressKey(text)).toBe('proposal-text:p1');
    expect(pressKey(field)).toBe('proposal-text:p1');
    // A control inside a keyed element is a control of its own.
    const inner = el('button', text);
    expect(pressKey(inner)).toBe(inner);
  });
});

describe('the next press of a double click', () => {
  it('presses nothing on the Delete that came where the first press deleted its card', () => {
    // The reported scenario: the first click deletes card A, card B moves up,
    // and the second click of the double click lands on B's Delete.
    const state = freshState();
    const a = card('A');
    const b = card('B');
    expect(press(state, a.icon)).toBe(false);
    a.card.remove();
    at(1120);
    expect(press(state, b.icon, { detail: 2 })).toBe(true);
  });

  it('presses the control the first press pressed', () => {
    const state = freshState();
    const plus = el('button');
    expect(press(state, plus)).toBe(false);
    at(1120);
    expect(press(state, plus, { detail: 2 })).toBe(false);
  });

  it('selects a word of a card: both presses reach the same card', () => {
    const state = freshState();
    const a = card('Flaky deploys');
    const bold = el('b', a.words, 'deploys');
    expect(press(state, a.words)).toBe(false);
    at(1100);
    expect(press(state, bold, { detail: 2 })).toBe(false);
    at(1200);
    expect(press(state, a.words, { detail: 3 })).toBe(false);
  });

  it('presses nothing else for the rest of the gesture, a triple click included', () => {
    const state = freshState();
    const a = card('A');
    const b = card('B');
    press(state, a.remove);
    at(1100);
    expect(press(state, b.remove, { detail: 2 })).toBe(true);
    at(1200);
    expect(press(state, b.remove, { detail: 3 })).toBe(true);
    // A pause ends the gesture: the browser counts the next press as a first.
    at(2000);
    expect(press(state, b.remove)).toBe(false);
  });

  it('presses nothing on a control that came after a press on something else (the limit: press again)', () => {
    // Text a click turns into a field, a dialog that opens: whatever the first
    // press reached, the next press of the same gesture presses only that.
    const state = freshState();
    const blank = el('div');
    const plus = el('button');
    press(state, blank);
    at(1100);
    expect(press(state, plus, { detail: 2 })).toBe(true);
    at(1700);
    expect(press(state, plus)).toBe(false);
  });

  it('presses nothing when the guard never saw the first press, made on the screen before', () => {
    const state = freshState();
    expect(press(state, el('button'), { detail: 2 })).toBe(true);
  });

  it('leaves the field that text turned into to the next press, and no other field', () => {
    // A proposal's text becomes its field in place: the next press of a double
    // click selects a word there. The topic's "Propose an action…" field,
    // moved up under the pointer, takes no press of it (H54 → H).
    const state = freshState();
    const text = el('span', document.body, 'Write the release notes');
    text.setAttribute(PRESS_KEY_ATTRIBUTE, 'proposal-text:p1');
    press(state, text);
    text.remove();
    const field = el('input');
    field.setAttribute(PRESS_KEY_ATTRIBUTE, 'proposal-text:p1');
    at(1100);
    expect(press(state, field, { detail: 2 })).toBe(false);

    const other = freshState();
    const text2 = el('span', document.body, 'Book a room');
    text2.setAttribute(PRESS_KEY_ATTRIBUTE, 'proposal-text:p2');
    const propose = el('input');
    at(2000);
    press(other, text2);
    at(2100);
    expect(press(other, propose, { detail: 2 })).toBe(true);
  });
});

describe('the next tap of a double tap', () => {
  it('presses nothing on the backdrop of the dialog the first tap opened, past the browser’s count', () => {
    // The reported scenario: two taps half a second apart on a card's
    // Comments. Chromium counts the second as a first (detail 1), Firefox
    // counts every tap as a first; the board's own half second does not.
    const state = freshState();
    const comments = el('button');
    expect(press(state, comments, { tap: true })).toBe(false);
    const backdrop = el('div');
    at(1450);
    expect(press(state, backdrop, { tap: true })).toBe(true);
  });

  it('presses what is under a tap a fingertip away or half a second later: a new gesture', () => {
    const state = freshState();
    const three = el('button');
    const four = el('button');
    press(state, three, { tap: true, x: 100 });
    at(1300);
    // The score beside, 48 px away: a correction, not the same gesture.
    expect(press(state, four, { tap: true, x: 148 })).toBe(false);
    at(1900);
    // Past half a second, at the same place: a new gesture too.
    expect(press(state, three, { tap: true, x: 148 })).toBe(false);
  });

  it('counts each tap from the one before, from where the first aimed', () => {
    // A steady pace on a Delete that keeps coming up deletes the first card
    // only, until a pause.
    const state = freshState();
    const a = card('A');
    const b = card('B');
    press(state, a.remove, { tap: true });
    a.card.remove();
    for (const t of [1400, 1800, 2200]) {
      at(t);
      expect(press(state, b.remove, { tap: true }), `tap at ${t}`).toBe(true);
    }
    at(3000);
    expect(press(state, b.remove, { tap: true })).toBe(false);
  });

  it('takes the browser’s count for a tap only within a fingertip of the first', () => {
    // Chromium counts a tap from the one before, and far (100 dp on Android).
    const state = freshState();
    press(state, el('button'), { tap: true, x: 100 });
    at(1200);
    expect(press(state, el('button'), { tap: true, detail: 2, x: 160 })).toBe(false);
  });

  it('never stops the mouse itself for a touch it does not follow', () => {
    const state = freshState();
    press(state, el('button'), { tap: true });
    at(2000);
    expect(press(state, el('button'))).toBe(false);
  });
});

describe('the taps the board claims', () => {
  it('ignores the next tap on another card or group, and acts on the same one again', () => {
    const state = freshState();
    const a = card('A');
    const b = card('B');
    expect(claimedTap(state, a.card)).toBe(true);
    at(1300);
    expect(claimedTap(state, b.card)).toBe(false);
    at(1500);
    expect(claimedTap(state, a.card)).toBe(true);
  });

  it('presses no control with the next tap after one the board claimed, and the reverse', () => {
    // A group picked up by a tap: the next tap, past the browser's count,
    // pressed its Delete group and dissolved it for everyone (H54 → D).
    const state = freshState();
    const group = el('div');
    group.className = 'group-container';
    const deleteGroup = el('button', group);
    claimedTap(state, group);
    at(1400);
    expect(press(state, deleteGroup, { tap: true })).toBe(true);

    const next = freshState();
    const vote = el('button');
    const a = card('A');
    at(3000);
    press(next, vote, { tap: true });
    at(3300);
    expect(claimedTap(next, a.card)).toBe(false);
  });
});

describe('the guard on the window', () => {
  const Guarded = () => {
    useDoubleGestureGuard();
    return null;
  };

  it('stops the press and its click, and never the keyboard’s click', () => {
    render(createElement(Guarded));
    const a = card('A');
    const b = card('B');
    const clicked: string[] = [];
    a.remove.addEventListener('click', () => clicked.push('A'));
    b.remove.addEventListener('click', () => clicked.push('B'));
    const mouse = (target: Element, detail: number) => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    };
    mouse(a.remove, 1);
    at(1120);
    const seen: boolean[] = [];
    b.remove.addEventListener('mousedown', () => seen.push(true));
    mouse(b.remove, 2);
    expect(seen).toEqual([]);
    expect(clicked).toEqual(['A']);
    // The keyboard's click (no detail) is the user's own.
    b.remove.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(clicked).toEqual(['A', 'B']);
  });
});
